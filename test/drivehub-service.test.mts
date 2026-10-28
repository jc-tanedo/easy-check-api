import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createService } from '../lib/server/drivehub/service';
import { DriveHubError } from '../lib/server/drivehub/transport';
import { parseExpiry } from '../lib/server/drivehub/expiry';

import { config as defaults } from './fixtures';
import type { UpstreamRequest } from '../lib/server/drivehub/transport';
type TestRequest = UpstreamRequest & { fields: Record<string, string>; query: Record<string, string> };

const config = {
    ...defaults,
    appUsername: 'app-user',
    appPassword: 'app-pass',
    clientId: 'app-id',
    email: 'owner@example.invalid',
    password: 'pass+&é',
    expiryUtcOffset: '+08:00',
};

function fixture(overrides: { request?: (options: TestRequest) => Promise<unknown> } = {}) {
    let clock = Date.parse('2026-10-28T00:53:22Z'); // 08:53:22 Philippine time
    let loginCount = 0;
    let appCount = 0;
    const calls: TestRequest[] = [];
    const request = async (input: UpstreamRequest) => {
        const options = { ...input, fields: input.fields ?? {}, query: input.query ?? {} };
        calls.push(options);
        if (overrides.request) return overrides.request(options);
        if (options.path === 'auth') return { access_token: `app-${++appCount}`, sig: 'signing-key' };
        if (options.path.endsWith('/login')) {
            loginCount++;
            return {
                token: `user-${loginCount}-${options.fields.email}`,
                exp_at: new Date(clock + 6 * 3600_000 + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' '),
            };
        }
        return {
            results: [{ account_no: '123456789012', plate_no: 'ABC1234', balance: 123.45 }],
            count: 1,
            next: null,
            previous: null,
        };
    };
    const service = createService(config, { request, now: () => clock });
    return {
        service,
        calls,
        advance(ms: number) {
            clock += ms;
        },
        logins: () => calls.filter((call) => call.path.endsWith('/login')),
        apps: () => calls.filter((call) => call.path === 'auth'),
    };
}

test('expiry uses Philippine offset independently of host timezone and honors explicit zones', () => {
    assert.equal(parseExpiry('2026-10-28 14:53:22'), Date.parse('2026-10-28T06:53:22Z'));
    assert.equal(parseExpiry('2026-10-28T14:53:22Z'), Date.parse('2026-10-28T14:53:22Z'));
    assert.equal(parseExpiry('2026-10-28 14:53:22+09:00'), Date.parse('2026-10-28T05:53:22Z'));
    assert.equal(parseExpiry('2026-10-28 14:53:22', '+00:00'), Date.parse('2026-10-28T14:53:22Z'));
    for (const value of [undefined, null, 123, '', 'tomorrow', '2026-02-30 12:00:00', '2026-10-28 25:00:00']) {
        assert.ok(Number.isNaN(parseExpiry(value)));
    }
});

test('request headers and HMAC inputs match the APK; response omits tokens', async () => {
    const f = fixture();
    const result = await f.service.requestBalance({ accountType: 'others', page: 2, pageSize: 20 });
    const [app, login, balance] = f.calls;
    assert.equal(app.headers.Authorization, 'Basic YXBwLXVzZXI6YXBwLXBhc3M=');
    assert.deepEqual(login.fields, { email: config.email, password: config.password });
    assert.equal(
        login.headers.code,
        createHmac('sha512', 'signing-key')
            .update(config.password + config.email)
            .digest('hex'),
    );
    assert.equal(balance.headers.code, createHmac('sha512', 'signing-key').update('202others').digest('hex'));
    assert.equal(balance.headers['user-token'], `user-1-${config.email}`);
    assert.equal(balance.headers.Authorization, 'Bearer app-1');
    assert.deepEqual(balance.query, { account_type: 'others', page: '2', page_size: '20' });
    assert.equal(result.accounts[0].accountNo, '123456789012');
    assert.equal(result.accounts[0].plateNo, 'ABC1234');
    assert.equal(result.tokenExpiresAt, '2026-10-28 14:53:22');
    assert.equal(result.tokenExpiresAtUtc, '2026-10-28T06:53:22.000Z');
    assert.ok(!JSON.stringify(result).includes('user-1'));
    assert.ok(!JSON.stringify(result).includes(config.password));
});

test('user token survives app auth renewal and is reused until the absolute expiry margin', async () => {
    const f = fixture();
    await f.service.requestBalance();
    f.advance(5 * 3600_000);
    await f.service.requestBalance();
    assert.equal(f.logins().length, 1);
    assert.equal(f.apps().length, 2);
    f.advance(3600_000 - 31_000);
    await f.service.requestBalance();
    assert.equal(f.logins().length, 1);
    f.advance(1_000);
    await f.service.requestBalance();
    assert.equal(f.logins().length, 2);
});

test('concurrent requests share login and isolate different credentials', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 8 }, () => f.service.requestBalance()));
    assert.equal(f.logins().length, 1);
    assert.equal(f.apps().length, 1);
    await f.service.requestBalance({ email: 'second@example.invalid', password: 'other-password' });
    await f.service.requestBalance({ password: 'changed-password' });
    assert.equal(f.logins().length, 3);
    await f.service.requestBalance();
    assert.equal(f.logins().length, 3);
});

test('malformed and past expiries fail without caching a user token', async () => {
    for (const expiry of ['bad date', '2026-10-28 08:53:22']) {
        let logins = 0;
        const f = fixture({
            request: async (options) => {
                if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
                logins++;
                return { token: 'user', exp_at: expiry };
            },
        });
        await assert.rejects(f.service.requestBalance(), /invalid or expired exp_at/);
        await assert.rejects(f.service.requestBalance(), /invalid or expired exp_at/);
        assert.equal(logins, 2);
    }
});

test('failed login is not cached or automatically retried with the same password', async () => {
    let logins = 0;
    const f = fixture({
        request: async (options) => {
            if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
            logins++;
            throw new DriveHubError('DriveHub rejected the request', 401);
        },
    });
    await assert.rejects(f.service.requestBalance(), { status: 401 });
    assert.equal(logins, 1);
    await assert.rejects(f.service.requestBalance(), { status: 401 });
    assert.equal(logins, 2);
});

test('early user-token rejection refreshes app auth, then relogs in once', async () => {
    let logins = 0;
    const f = fixture({
        request: async (options) => {
            if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
            if (options.path.endsWith('/login')) return { token: `user-${++logins}`, exp_at: '2026-10-28 14:53:22' };
            if (options.headers['user-token'] === 'user-1') throw new DriveHubError('rejected', 401);
            return { results: [], count: 0, next: null };
        },
    });
    await f.service.requestBalance();
    assert.equal(logins, 2);
    assert.equal(f.apps().length, 2);
    await f.service.requestBalance();
    assert.equal(logins, 2);
});

test('persistent rejection stops after one relogin and does not retry rate limits', async () => {
    for (const status of [401, 429]) {
        let logins = 0;
        const f = fixture({
            request: async (options) => {
                if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
                if (options.path.endsWith('/login'))
                    return { token: `user-${++logins}`, exp_at: '2026-10-28 14:53:22' };
                throw new DriveHubError('rejected', status);
            },
        });
        await assert.rejects(f.service.requestBalance(), { status });
        assert.equal(logins, status === 401 ? 2 : 1);
    }
});

test('account ID lookup checks every linked page and both account types', async () => {
    const f = fixture({
        request: async (options) => {
            if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
            if (options.path.endsWith('/login')) return { token: 'user', exp_at: '2026-10-28 14:53:22' };
            if (options.query.account_type === 'primary') return { results: [], next: null };
            return options.query.page === '1'
                ? { results: [], next: 'never-follow-this-url' }
                : { results: [{ account_no: '123456789012', balance: 42 }], next: null };
        },
    });
    const result = await f.service.requestBalance({ id: '123456789012' });
    assert.equal(result.accounts[0].balance, 42);
    assert.equal(result.pagination, null);
    assert.deepEqual(
        f.calls.filter((c) => c.path.endsWith('/rfid')).map((c) => [c.query.account_type, c.query.page]),
        [
            ['primary', '1'],
            ['others', '1'],
            ['others', '2'],
        ],
    );
    const missing = fixture();
    await assert.rejects(missing.service.requestBalance({ id: '000000000000' }), { status: 404 });
});

test('malformed RFID records are rejected instead of being returned as account data', async () => {
    for (const record of [null, 'not-an-account', 42]) {
        const f = fixture({
            request: async (options) => {
                if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
                if (options.path.endsWith('/login')) return { token: 'user', exp_at: '2026-10-28 14:53:22' };
                return { results: [record], count: 1, next: null };
            },
        });
        await assert.rejects(f.service.requestBalance(), {
            status: 502,
            message: 'Unexpected DriveHub RFID account',
        });
    }
});

test('malformed transaction records are rejected instead of being returned as history', async () => {
    const f = fixture({
        request: async (options) => {
            if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
            if (options.path.endsWith('/login')) return { token: 'user', exp_at: '2026-10-28 14:53:22' };
            if (options.path.endsWith('/trans')) return { transaction: [null] };
            return { results: [{ account_no: '123456789012' }], next: null };
        },
    });
    await assert.rejects(f.service.requestTransactions({ id: '123456789012' }), {
        status: 502,
        message: 'Unexpected DriveHub transaction record',
    });
});

test('bad request inputs fail before sending any upstream credentials', async () => {
    const f = fixture();
    for (const options of [{ email: '' }, { id: 'bad' }, { accountType: 'all' }, { page: 0 }, { pageSize: 101 }]) {
        await assert.rejects(f.service.requestBalance(options), { status: 400 });
    }
    assert.equal(f.calls.length, 0);
});

test('transaction history signs the account number and normalizes APK field names', async () => {
    const f = fixture({
        request: async (options) => {
            if (options.path === 'auth') return { access_token: 'app', sig: 'signing-key' };
            if (options.path.endsWith('/login')) return { token: 'user-tx', exp_at: '2026-10-28 14:53:22' };
            if (options.path.endsWith('/trans'))
                return {
                    transaction: [
                        {
                            Amount: '120.00',
                            Date: '2026-10-28T01:00:00Z',
                            Description: 'NLEX toll',
                            Plate: 'ABC1234',
                            Reference_No: 'TRX-1',
                            Type: 'Toll',
                        },
                    ],
                };
            return { results: [{ account_no: '123456789012' }], next: null };
        },
    });
    const result = await f.service.requestTransactions({ id: '123456789012', accountType: 'primary' });
    const call = f.calls.find((call) => call.path.endsWith('/trans'));
    assert.ok(call);
    assert.equal(call.path, 'user-v2/user/rfid/trans');
    assert.deepEqual(call.query, { account_no: '123456789012' });
    assert.equal(call.headers['user-token'], 'user-tx');
    assert.equal(call.headers.code, createHmac('sha512', 'signing-key').update('123456789012').digest('hex'));
    assert.deepEqual(result.transactions[0], {
        amount: '120.00',
        date: '2026-10-28T01:00:00Z',
        description: 'NLEX toll',
        plate: 'ABC1234',
        referenceNo: 'TRX-1',
        type: 'Toll',
    });
    assert.equal(result.accountNo, '123456789012');
    assert.equal(result.tokenExpiresAtUtc, '2026-10-28T06:53:22.000Z');
});

test('transaction history rejects unlinked accounts before requesting their records', async () => {
    const f = fixture();
    await assert.rejects(f.service.requestTransactions({ id: '000000000000' }), { status: 404 });
    assert.equal(f.calls.filter((call) => call.path.endsWith('/trans')).length, 0);
    await assert.rejects(f.service.requestTransactions({ id: 'bad' }), { status: 400 });
});

test('transaction history accepts a null list as empty and rejects unexpected shapes', async () => {
    for (const transaction of [null, 'invalid']) {
        const f = fixture({
            request: async (options) => {
                if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
                if (options.path.endsWith('/login')) return { token: 'user', exp_at: '2026-10-28 14:53:22' };
                if (options.path.endsWith('/trans')) return { transaction };
                return { results: [{ account_no: '123456789012' }], next: null };
            },
        });
        const pending = f.service.requestTransactions({ id: '123456789012' });
        if (transaction === null) assert.deepEqual((await pending).transactions, []);
        else await assert.rejects(pending, /Unexpected DriveHub transaction response/);
    }
});

test('transaction history relogs in once when its user token is rejected early', async () => {
    let logins = 0;
    const f = fixture({
        request: async (options) => {
            if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
            if (options.path.endsWith('/login')) return { token: `user-${++logins}`, exp_at: '2026-10-28 14:53:22' };
            if (options.path.endsWith('/trans')) {
                if (options.headers['user-token'] === 'user-1') throw new DriveHubError('rejected', 401);
                return { transaction: [] };
            }
            return { results: [{ account_no: '123456789012' }], next: null };
        },
    });
    assert.deepEqual((await f.service.requestTransactions({ id: '123456789012' })).transactions, []);
    assert.equal(logins, 2);
});
