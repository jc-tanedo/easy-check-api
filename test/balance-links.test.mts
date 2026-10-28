import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../lib/server/handlers';
import { SessionStore, SESSION_SECONDS } from '../lib/server/sessions';
import { DriveHubError } from '../lib/server/drivehub/transport';

import { config as defaults, metadata, stubService, type Service } from './fixtures';
import type { BalanceResult } from '../types/domain';
type BalanceOptions = NonNullable<Parameters<Service['requestBalance']>[0]>;
type SnapshotResult = Pick<BalanceResult, 'accounts'> &
    Partial<Pick<BalanceResult, 'tokenExpiresAt' | 'tokenExpiresAtUtc'>> & {
        pagination: { hasNext?: boolean };
    };

function fixture(operation?: (options: BalanceOptions) => Promise<SnapshotResult>) {
    let now = Date.parse('2026-10-28T00:00:00Z');
    const sessions = new SessionStore({ now: () => now });
    const calls: BalanceOptions[] = [];
    const service = stubService({
        requestBalance: async (options = {}) => {
            calls.push(options);
            const result = operation
                ? await operation(options)
                : {
                      accounts: [{ accountNo: String(options.accountType), balance: 123 }],
                      pagination: { hasNext: false },
                      tokenExpiresAt: 'synthetic-expiry',
                  };
            return {
                ...metadata,
                ...result,
                pagination: {
                    page: 1,
                    pageSize: 20,
                    accountType: 'primary',
                    hasPrevious: false,
                    hasNext: false,
                    ...result.pagination,
                },
            };
        },
    });
    const config = { ...defaults, apiKey: 'synthetic-api-key-at-least-32-characters', appUrl: 'https://easy.example' };
    const handlers = createHandlers(config, service, { sessions, now: () => now });
    const id = sessions.create({ email: 'one@example.invalid', password: 'private-password' }, metadata);
    const cookie = `easycheck_session=${id}`;
    const manage = (method = 'POST', selectedCookie = cookie, origin = config.appUrl) =>
        handlers.balanceLink(
            new Request(config.appUrl + '/api/balance-link', {
                method,
                headers: { Cookie: selectedCookie, Origin: origin },
            }),
        );
    const fetch = (url: string) =>
        handlers.publicBalance(new Request(url), new URL(url).pathname.split('/').pop() ?? '');
    const generate = async (selectedCookie?: string): Promise<string> =>
        (await (await manage('POST', selectedCookie)).json()).url;
    return {
        handlers,
        sessions,
        calls,
        cookie,
        id,
        manage,
        fetch,
        generate,
        service,
        config,
        advance(ms: number) {
            now += ms;
        },
    };
}

test('generating is authenticated, CSRF-protected, idempotent, and does not expose the session cookie', async () => {
    const f = fixture();
    assert.equal((await f.manage('POST', '')).status, 401);
    assert.equal((await f.manage('POST', f.cookie, 'https://other.example')).status, 403);
    assert.equal((await (await f.manage('GET')).json()).url, null);
    const url = await f.generate();
    assert.equal(await f.generate(), url);
    assert.match(url, /^https:\/\/easy\.example\/bal\/[A-Za-z0-9_-]{12}$/);
    assert.ok(!url.includes(f.id));
    assert.equal(f.calls.length, 0);
});

test('generated URL works without cookies, caches for five minutes, and ignores cache-busting queries', async () => {
    const f = fixture();
    const url = await f.generate();
    const first = await f.fetch(url);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.notEqual(first.headers.get('access-control-allow-origin'), '*');
    const data = await first.json();
    assert.equal(data.accounts.length, 2);
    assert.equal(data.cached, false);
    assert.equal(Date.parse(data.cacheExpiresAt) - Date.parse(data.fetchedAt), 300000);
    assert.ok(!JSON.stringify(data).includes('private-password'));
    assert.equal(data.tokenExpiresAt, undefined);
    assert.equal(f.calls.length, 2);
    assert.equal((await (await f.fetch(url + '?nocache=123')).json()).cached, true);
    f.advance(299999);
    assert.equal((await (await f.fetch(url)).json()).cached, true);
    assert.equal(f.calls.length, 2);
    f.advance(1);
    assert.equal((await (await f.fetch(url)).json()).cached, false);
    assert.equal(f.calls.length, 4);
});

test('simultaneous requests share one upstream snapshot refresh', async () => {
    const f = fixture();
    const url = await f.generate();
    const responses = await Promise.all(Array.from({ length: 20 }, () => f.fetch(url)));
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(f.calls.length, 2);
    f.advance(300000);
    await Promise.all(Array.from({ length: 20 }, () => f.fetch(url)));
    assert.equal(f.calls.length, 4);
});

test('snapshot includes both account categories and every returned page', async () => {
    const f = fixture(async (options) => ({
        accounts: [{ accountNo: `${options.accountType}-${options.page}` }],
        pagination: { hasNext: options.accountType === 'primary' && options.page === 1 },
    }));
    const data = await (await f.fetch(await f.generate())).json();
    assert.deepEqual(
        data.accounts.map((account: { accountNo: string }) => account.accountNo),
        ['primary-1', 'primary-2', 'others-1'],
    );
    assert.equal(f.calls.length, 3);
});

test('logout invalidates the URL immediately even when balances are cached', async () => {
    const f = fixture();
    const url = await f.generate();
    await f.fetch(url);
    const logout = await f.handlers.session(
        new Request('https://easy.example/api/session', {
            method: 'DELETE',
            headers: { Cookie: f.cookie, Origin: 'https://easy.example' },
        }),
    );
    assert.equal(logout.status, 200);
    assert.equal((await f.fetch(url)).status, 404);
    assert.equal(f.calls.length, 2);
});

test('session expiry and a fresh server state invalidate generated URLs', async () => {
    const f = fixture();
    const url = await f.generate();
    await f.fetch(url);
    f.advance(SESSION_SECONDS * 1000);
    assert.equal((await f.fetch(url)).status, 404);
    const fresh = createHandlers(f.config, f.service);
    assert.equal(
        (await fresh.publicBalance(new Request(url), new URL(url).pathname.split('/').pop() ?? '')).status,
        404,
    );
});

test('separate users have separate links, credentials, and cache entries', async () => {
    const f = fixture(async (options) => ({
        accounts: [{ balance: options.email === 'one@example.invalid' ? 100 : 200 }],
        pagination: {},
    }));
    const second = f.sessions.create({ email: 'two@example.invalid', password: 'other-password' }, metadata);
    const firstUrl = await f.generate();
    const secondUrl = await f.generate(`easycheck_session=${second}`);
    assert.notEqual(firstUrl, secondUrl);
    assert.equal((await (await f.fetch(firstUrl)).json()).accounts[0].balance, 100);
    assert.equal((await (await f.fetch(secondUrl)).json()).accounts[0].balance, 200);
    assert.equal(f.calls.length, 4);
});

test('revocation invalidates the old URL and replacement generation uses a new token', async () => {
    const f = fixture();
    const url = await f.generate();
    assert.equal((await f.manage('DELETE')).status, 200);
    assert.equal((await f.fetch(url)).status, 404);
    const replacement = await f.generate();
    assert.notEqual(url, replacement);
    assert.equal((await f.fetch(replacement)).status, 200);
});

test('logout during an in-flight fetch cannot publish balances', async () => {
    let release: () => void = () => {
        throw new Error('Gate not initialized');
    };
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = fixture(async () => {
        await gate;
        return { accounts: [], pagination: {} };
    });
    const url = await f.generate();
    const pending = f.fetch(url);
    await f.handlers.session(
        new Request('https://easy.example/api/session', {
            method: 'DELETE',
            headers: { Cookie: f.cookie, Origin: 'https://easy.example' },
        }),
    );
    release();
    assert.equal((await pending).status, 404);
    assert.equal((await f.fetch(url)).status, 404);
    assert.equal(f.calls.length, 1);
});

test('a revoked in-flight request cannot invalidate a replacement link', async () => {
    let release: () => void = () => {
        throw new Error('Gate not initialized');
    };
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let count = 0;
    const f = fixture(async () => {
        if (++count === 1) await gate;
        return { accounts: [], pagination: {} };
    });
    const oldUrl = await f.generate();
    const pending = f.fetch(oldUrl);
    await f.manage('DELETE');
    const newUrl = await f.generate();
    release();
    assert.equal((await pending).status, 404);
    assert.equal((await f.fetch(newUrl)).status, 200);
});

test('upstream outages are sanitized and backed off for five minutes', async () => {
    const f = fixture(async () => {
        throw new Error('secret-password-never-return');
    });
    const url = await f.generate();
    const response = await f.fetch(url);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('retry-after'), '300');
    assert.ok(!(await response.text()).includes('secret-password'));
    for (let count = 0; count < 10; count++) assert.equal((await f.fetch(url)).status, 502);
    assert.equal(f.calls.length, 1);
    f.advance(300000);
    assert.equal((await f.fetch(url)).status, 502);
    assert.equal(f.calls.length, 2);
});

test('rejected user credentials invalidate the session and its URL', async () => {
    const f = fixture(async () => {
        throw new DriveHubError('rejected', 401);
    });
    const url = await f.generate();
    assert.equal((await f.fetch(url)).status, 404);
    assert.equal(f.sessions.get(f.id), null);
    assert.equal((await f.manage('GET')).status, 401);
});
