import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers, type HandlerSet } from '../lib/server/handlers';
import { SessionStore, SESSION_SECONDS } from '../lib/server/sessions';
import { DriveHubError } from '../lib/server/drivehub/transport';

const apiKey = 'test-api-key-at-least-32-characters';
const metadata = { tokenExpiresAt: '2026-10-28 14:53:22', tokenExpiresAtUtc: '2026-10-28T06:53:22.000Z' };

import { config as defaults, stubService, type Service, type TransactionInput } from './fixtures';
import type { BalanceResult, Credentials } from '../types/domain';
type Input = NonNullable<Parameters<Service['requestBalance']>[0]>;

function fixture(operation?: (input: Input) => Promise<BalanceResult>) {
    const calls: (Input & { login?: Credentials })[] = [];
    const service = stubService({
        authenticate: async (login) => {
            calls.push({ login });
            return metadata;
        },
        requestBalance: async (input = {}) => {
            calls.push(input);
            return operation ? operation(input) : { accounts: [], pagination: null, ...metadata };
        },
    });
    const handlers = createHandlers({ ...defaults, apiKey, appUrl: 'https://easy.example' }, service);
    return {
        calls,
        service,
        handlers,
        send(
            path = '/check-balance',
            options: RequestInit = {},
            target: Exclude<keyof HandlerSet, 'publicBalance'> = 'checkBalance',
        ) {
            return handlers[target](
                new Request(`https://easy.example${path}`, {
                    ...options,
                    headers: { 'X-API-Key': apiKey, ...options.headers },
                }),
            );
        },
    };
}

async function signIn(f: ReturnType<typeof fixture>) {
    const response = await f.send(
        '/api/session',
        {
            method: 'POST',
            headers: {
                Origin: 'https://easy.example',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: 'one@example.invalid', password: 'private-password' }),
        },
        'session',
    );
    assert.equal(response.status, 201);
    const cookieHeader = response.headers.get('set-cookie');
    assert.ok(cookieHeader);
    return cookieHeader.split(';')[0];
}

test('default browser sessions use the handler clock for their expiry', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const handlers = createHandlers(
        { ...defaults, apiKey, appUrl: 'https://easy.example' },
        stubService({ authenticate: async () => metadata }),
        { now: () => now },
    );
    const response = await handlers.session(
        new Request('https://easy.example/api/session', {
            method: 'POST',
            headers: { Origin: 'https://easy.example', 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'one@example.invalid', password: 'synthetic-password' }),
        }),
    );
    assert.equal(response.status, 201);
    const cookieHeader = response.headers.get('set-cookie');
    assert.ok(cookieHeader);
    const cookie = cookieHeader.split(';')[0];
    const current = await handlers.session(
        new Request('https://easy.example/api/session', { headers: { Cookie: cookie } }),
    );
    assert.equal((await current.json()).sessionExpiresAt, new Date(now + SESSION_SECONDS * 1000).toISOString());
});

test('machine API preserves GET account selection and pagination', async () => {
    const f = fixture();
    const res = await f.send('/check-balance?id=123456789012&page=2&pageSize=10');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(f.calls[0], { id: '123456789012', page: 2, pageSize: 10 });
});

test('machine POST takes a complete credential pair in JSON only', async () => {
    const f = fixture();
    const send = (body: unknown) =>
        f.send('/check-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    assert.equal((await send({ email: 'one@example.invalid', password: 'secret', accountType: 'others' })).status, 200);
    assert.equal(f.calls[0].password, 'secret');
    assert.equal(f.calls[0].accountType, 'others');
    assert.equal((await send({ email: 'one@example.invalid' })).status, 400);
    assert.equal((await f.send('/check-balance?password=secret')).status, 400);
    assert.equal(f.calls.length, 1);
});

test('machine API key is required before invoking the service', async () => {
    const f = fixture();
    assert.equal((await f.send('/check-balance', { headers: { 'X-API-Key': 'wrong' } })).status, 401);
    assert.equal(f.calls.length, 0);
});

test('machine CORS allows existing domains, rejects lookalikes, and supports preflight', async () => {
    const f = fixture();
    for (const origin of ['https://jczr.dev', 'https://dashboard.jczr.dev']) {
        const res = await f.send('/check-balance', { headers: { Origin: origin } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('access-control-allow-origin'), origin);
    }
    for (const origin of ['https://jczr.dev.evil.invalid', 'https://eviljczr.dev', 'malformed-origin']) {
        assert.equal((await f.send('/check-balance', { headers: { Origin: origin } })).status, 403);
    }
    const preflight = await f.send('/check-balance', { method: 'OPTIONS', headers: { Origin: 'https://jczr.dev' } });
    assert.equal(preflight.status, 200);
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /X-API-Key/);
});

test('invalid JSON, oversized bodies, and pagination never reach the service', async () => {
    const f = fixture();
    const invalid = await f.send('/check-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"password":"do-not-leak"',
    });
    assert.equal(invalid.status, 400);
    assert.ok(!(await invalid.text()).includes('do-not-leak'));
    const big = await f.send('/check-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(8193),
    });
    assert.equal(big.status, 413);
    for (const path of [
        '/check-balance?page=1.5',
        '/check-balance?page[]=1',
        '/check-balance?page=1abc',
        '/check-balance?page=0x10',
        '/check-balance?page=1e2',
        '/check-balance?page=',
        '/check-balance?page=1&page=2',
    ]) {
        assert.equal((await f.send(path)).status, 400);
    }
    for (const page of [1.5, null, true, '1.5', '9007199254740993']) {
        const res = await f.send('/check-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'one@example.invalid', password: 'secret', page }),
        });
        assert.equal(res.status, 400);
    }
    assert.equal(f.calls.length, 0);
});

test('upstream statuses are mapped and unexpected errors are sanitized', async () => {
    for (const status of [401, 403, 404, 429, 503]) {
        const f = fixture(() => {
            throw new DriveHubError('Upstream failed', status);
        });
        assert.equal((await f.send()).status, status === 503 ? 502 : status);
    }
    const f = fixture(() => {
        throw new Error('password=do-not-leak');
    });
    const response = await f.send();
    assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes('do-not-leak'));
});

test('local session-capacity errors preserve their 503 status', async () => {
    class FullSessionStore extends SessionStore {
        create(): never {
            throw new DriveHubError('Please try signing in later', 503, 'application');
        }
    }
    const handlers = createHandlers(
        { ...defaults, apiKey, appUrl: 'https://easy.example' },
        stubService({ authenticate: async () => metadata }),
        { sessions: new FullSessionStore() },
    );
    const response = await handlers.session(
        new Request('https://easy.example/api/session', {
            method: 'POST',
            headers: { Origin: 'https://easy.example', 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'one@example.invalid', password: 'synthetic-password' }),
        }),
    );
    assert.equal(response.status, 503);
});

test('browser login creates a secure HTTP-only cookie without exposing secrets', async () => {
    const f = fixture();
    const response = await f.send(
        '/api/session',
        {
            method: 'POST',
            headers: {
                Origin: 'https://easy.example',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: 'one@example.invalid', password: 'private-password' }),
        },
        'session',
    );
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie');
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    const data = await response.json();
    assert.equal(data.email, 'one@example.invalid');
    assert.ok(!JSON.stringify(data).includes('private-password'));
    assert.ok(!JSON.stringify(data).includes(apiKey));
    assert.equal(data.token, undefined);
});

test('browser session and balances work without sharing the machine API key', async () => {
    const f = fixture();
    const cookie = await signIn(f);
    const res = await f.send(
        '/api/balances?accountType=others',
        { headers: { Cookie: cookie, 'X-API-Key': '' } },
        'balances',
    );
    assert.equal(res.status, 200);
    assert.equal(f.calls[1].password, 'private-password');
    assert.equal(f.calls[1].accountType, 'others');
    const current = await f.send('/api/session', { headers: { Cookie: cookie } }, 'session');
    assert.equal(current.status, 200);
    assert.equal((await current.json()).email, 'one@example.invalid');
    assert.equal((await f.send('/api/balances', {}, 'balances')).status, 401);
});

test('browser login and logout reject cross-origin mutations', async () => {
    const f = fixture();
    for (const method of ['POST', 'DELETE']) {
        const res = await f.send('/api/session', { method, headers: { Origin: 'https://other.example' } }, 'session');
        assert.equal(res.status, 403);
    }
    assert.equal(f.calls.length, 0);
});

test('logout invalidates the browser session and expires its cookie', async () => {
    const f = fixture();
    const cookie = await signIn(f);
    const res = await f.send(
        '/api/session',
        { method: 'DELETE', headers: { Origin: 'https://easy.example', Cookie: cookie } },
        'session',
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.equal((await f.send('/api/balances', { headers: { Cookie: cookie } }, 'balances')).status, 401);
});

test('five failed browser logins are followed by rate limiting', async () => {
    const f = fixture();
    f.service.authenticate = async () => {
        throw new DriveHubError('Login failed', 401);
    };
    for (let count = 0; count < 6; count++) {
        const res = await f.send(
            '/api/session',
            {
                method: 'POST',
                headers: {
                    Origin: 'https://easy.example',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: 'one@example.invalid', password: 'wrong' }),
            },
            'session',
        );
        assert.equal(res.status, count < 5 ? 401 : 429);
    }
});

test('revoked account login invalidates the browser session', async () => {
    const f = fixture(() => {
        throw new DriveHubError('Login failed', 401);
    });
    const cookie = await signIn(f);
    const response = await f.send('/api/balances', { headers: { Cookie: cookie } }, 'balances');
    assert.equal(response.status, 401);
    assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/);
    const current = await f.send('/api/session', { headers: { Cookie: cookie } }, 'session');
    assert.equal(current.status, 401);
});

test('local origin follows the Host header when Next normalizes request.url', async () => {
    const service = stubService({ authenticate: async () => metadata });
    const handlers = createHandlers({ ...defaults, apiKey, appUrl: '' }, service);
    const login = (origin: string) =>
        new Request('http://localhost:7777/api/session', {
            method: 'POST',
            headers: { Host: '127.0.0.1:7777', Origin: origin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'one@example.invalid', password: 'synthetic-password' }),
        });
    assert.equal((await handlers.session(login('http://127.0.0.1:7777'))).status, 201);
    assert.equal((await handlers.session(login('http://localhost:7777'))).status, 403);
    assert.equal((await handlers.session(login('http://other.example'))).status, 403);
});

test('configured APP_URL takes precedence over the request Host header', async () => {
    const handlers = createHandlers(
        { ...defaults, apiKey, appUrl: 'https://easy.example' },
        stubService({ authenticate: async () => metadata }),
    );
    const login = (origin: string) =>
        new Request('http://localhost:7777/api/session', {
            method: 'POST',
            headers: { Host: 'internal:7777', Origin: origin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'one@example.invalid', password: 'synthetic-password' }),
        });
    const response = await handlers.session(login('https://easy.example'));
    assert.equal(response.status, 201);
    assert.match(response.headers.get('set-cookie') ?? '', /Secure/);
    assert.equal((await handlers.session(login('http://internal:7777'))).status, 403);
});

test('transaction route requires a browser session and passes its credentials to the service', async () => {
    const f = fixture();
    const calls: TransactionInput[] = [];
    f.service.requestTransactions = async (input = {}) => {
        calls.push(input);
        return { accountNo: String(input.id), transactions: [{ amount: '100.00' }], ...metadata };
    };
    assert.equal((await f.send('/api/transactions?id=123456789012', {}, 'transactions')).status, 401);
    const cookie = await signIn(f);
    const response = await f.send(
        '/api/transactions?id=123456789012&accountType=primary',
        { headers: { Cookie: cookie } },
        'transactions',
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], {
        id: '123456789012',
        accountType: 'primary',
        email: 'one@example.invalid',
        password: 'private-password',
    });
    const data = await response.json();
    assert.equal(data.transactions[0].amount, '100.00');
    assert.ok(!JSON.stringify(data).includes('private-password'));
});
