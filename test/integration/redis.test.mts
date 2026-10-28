import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { RedisStorage, RedisSessions, RedisLoginLimiter, RedisBalanceLinks } from '../../lib/server/redis';
import { createHandlers } from '../../lib/server/handlers';
import { DriveHubError } from '../../lib/server/drivehub/transport';
import { metadata, config, stubService, type Service } from '../fixtures';

const url = process.env.REDIS_TEST_URL;
if (!url) throw new Error('Set REDIS_TEST_URL to a disposable standalone Redis server');
const credentials = { email: 'private@example.com', password: 'private-password' };
const key = randomBytes(32);

function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function fixture(t: TestContext, service: Service = stubService()) {
    const prefix = `easycheck-test:${randomBytes(12).toString('hex')}:`;
    const a = new RedisStorage(url!, prefix);
    const b = new RedisStorage(url!, prefix);
    const stores = (storage: RedisStorage) => {
        const sessions = new RedisSessions(storage, key);
        return {
            sessions,
            limiter: new RedisLoginLimiter(storage, key),
            links: new RedisBalanceLinks(storage, sessions, service),
        };
    };
    t.after(async () => {
        try {
            const keys = await a.command(['KEYS', prefix + '*']);
            if (Array.isArray(keys) && keys.length) await a.command(['DEL', ...keys.map(String)]);
        } finally {
            await Promise.all([a.close(), b.close()]);
        }
    });
    const one = stores(a),
        two = stores(b);
    const id = await one.sessions.create(credentials, metadata);
    return { a, b, one, two, id, service };
}

test('Redis sessions share encrypted credentials and metadata across application instances without sliding TTL', async (t) => {
    const f = await fixture(t);
    const raw = await f.a.get(f.one.sessions.key(f.id));
    assert.ok(raw);
    assert.ok(!raw.includes(credentials.email) && !raw.includes(credentials.password));
    const active = await f.two.sessions.get(f.id);
    assert.deepEqual(active?.credentials, credentials);
    const before = Number(await f.a.command(['PTTL', f.one.sessions.key(f.id)]));
    assert.ok(before > 86_390_000 && before <= 86_400_000);
    await f.two.sessions.update(f.id, { ...metadata, tokenExpiresAtUtc: '2027-01-01T00:00:00.000Z' });
    assert.equal((await f.one.sessions.get(f.id))?.tokenExpiresAtUtc, '2027-01-01T00:00:00.000Z');
    const after = Number(await f.a.command(['PTTL', f.one.sessions.key(f.id)]));
    assert.ok(after <= before);
    await f.two.sessions.delete(f.id);
    await f.one.sessions.update(f.id, metadata);
    assert.equal(await f.one.sessions.get(f.id), null);
});

test('Redis login limits are shared and hashed, and clear/reset across instances', async (t) => {
    const f = await fixture(t);
    for (let n = 0; n < 5; n++) await (n % 2 ? f.one : f.two).limiter.check(credentials.email);
    await assert.rejects(f.two.limiter.check(credentials.email.toUpperCase()), { status: 429 });
    const keys = JSON.stringify(await f.a.command(['KEYS', f.a.key('login:*')]));
    assert.ok(!keys.includes(credentials.email));
    await f.two.limiter.clear(credentials.email);
    await f.one.limiter.check(credentials.email);
    const attemptKeys = await f.a.command(['KEYS', f.a.key('login:*')]);
    assert.ok(Array.isArray(attemptKeys));
    for (const name of attemptKeys) await f.a.command(['PEXPIRE', String(name), '1']);
    await sleep(10);
    await f.two.limiter.check(credentials.email);
});

test('Redis generation is idempotent across instances; snapshots share one distributed refresh', async (t) => {
    let calls = 0;
    const f = await fixture(
        t,
        stubService({
            requestBalance: async (input = {}) => {
                calls++;
                await sleep(30);
                return {
                    accounts: [{ accountNo: String(input.accountType), balance: 42 }],
                    pagination: null,
                    ...metadata,
                };
            },
        }),
    );
    const generated = await Promise.all(
        Array.from({ length: 8 }, (_, n) => (n % 2 ? f.one : f.two).links.get(f.id, true)),
    );
    const token = generated[0]?.token;
    assert.ok(token);
    assert.ok(generated.every((value) => value?.token === token));
    const results = await Promise.all([f.one.links.fetch(token), f.two.links.fetch(token)]);
    assert.equal(calls, 2);
    assert.deepEqual(results.map((result) => result.cached).sort(), [false, true]);
    assert.equal((await f.two.links.fetch(token)).cached, true);
    assert.equal(calls, 2);
    const ttl = Number(await f.a.command(['PTTL', f.a.key(`snapshot:${token}`)]));
    assert.ok(ttl > 290_000 && ttl <= 300_000);
});

test('Redis session expiry invalidates a cached public link', async (t) => {
    const f = await fixture(t);
    const link = await f.one.links.get(f.id, true);
    assert.ok(link);
    await f.one.links.fetch(link.token);
    await f.a.command(['PEXPIRE', f.one.sessions.key(f.id), '1']);
    await sleep(10);
    assert.equal(await f.two.sessions.get(f.id), null);
    await assert.rejects(f.two.links.fetch(link.token), { status: 404 });
});

test('Redis logout on one handler invalidates another instance and cached links', async (t) => {
    const f = await fixture(t);
    const link = await f.one.links.get(f.id, true);
    assert.ok(link);
    await f.one.links.fetch(link.token);
    const first = createHandlers(config, f.service, f.one);
    const second = createHandlers(config, f.service, f.two);
    const headers = { cookie: `easycheck_session=${f.id}`, origin: config.appUrl };
    const response = await first.session(new Request(config.appUrl + '/api/session', { method: 'DELETE', headers }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
    assert.equal((await second.session(new Request(config.appUrl + '/api/session', { headers }))).status, 401);
    assert.equal(
        (await second.publicBalance(new Request(config.appUrl + '/bal/' + link.token), link.token)).status,
        404,
    );
});

test('Redis logout during refresh cannot publish a snapshot', async (t) => {
    const started = gate(),
        release = gate();
    const f = await fixture(
        t,
        stubService({
            requestBalance: async () => {
                started.resolve();
                await release.promise;
                return { accounts: [{ balance: 42 }], pagination: null, ...metadata };
            },
        }),
    );
    const link = await f.one.links.get(f.id, true);
    assert.ok(link);
    const pending = f.one.links.fetch(link.token);
    const rejection = assert.rejects(pending, { status: 404 });
    await started.promise;
    await f.two.sessions.delete(f.id);
    await f.two.links.revoke(f.id);
    release.resolve();
    await rejection;
    assert.equal(await f.a.get(f.a.key(`snapshot:${link.token}`)), null);
});

test('Redis revoked in-flight credential failure cannot invalidate a replacement link', async (t) => {
    const started = gate(),
        release = gate();
    const f = await fixture(
        t,
        stubService({
            requestBalance: async () => {
                started.resolve();
                await release.promise;
                throw new DriveHubError('credentials rejected', 401);
            },
        }),
    );
    const old = await f.one.links.get(f.id, true);
    assert.ok(old);
    const pending = f.one.links.fetch(old.token);
    const rejection = assert.rejects(pending, { status: 404 });
    await started.promise;
    await f.two.links.revoke(f.id);
    const replacement = await f.two.links.get(f.id, true);
    assert.ok(replacement && replacement.token !== old.token);
    release.resolve();
    await rejection;
    assert.ok(await f.two.sessions.get(f.id));
    assert.equal((await f.one.links.get(f.id))?.token, replacement.token);
});

test('Redis upstream failures are sanitized and backed off across instances', async (t) => {
    let calls = 0;
    const f = await fixture(
        t,
        stubService({
            requestBalance: async () => {
                calls++;
                throw new DriveHubError('upstream-private-secret', 503);
            },
        }),
    );
    const link = await f.one.links.get(f.id, true);
    assert.ok(link);
    for (const stores of [f.one, f.two]) {
        const handler = createHandlers(config, f.service, stores);
        const response = await handler.publicBalance(new Request(config.appUrl), link.token);
        assert.equal(response.status, 502);
        assert.ok(Number(response.headers.get('retry-after')) > 0);
        assert.ok(!(await response.text()).includes('upstream-private-secret'));
    }
    assert.equal(calls, 1);
});

test('Redis rejected credentials invalidate both session and link', async (t) => {
    const f = await fixture(
        t,
        stubService({
            requestBalance: async () => {
                throw new DriveHubError('rejected', 401);
            },
        }),
    );
    const link = await f.one.links.get(f.id, true);
    assert.ok(link);
    await assert.rejects(f.two.links.fetch(link.token), { status: 404 });
    assert.equal(await f.one.sessions.get(f.id), null);
    await assert.rejects(f.one.links.fetch(link.token), { status: 404 });
});

test('Redis expired lease cannot publish data or delete a new worker lease', async (t) => {
    const started = gate(),
        release = gate();
    const f = await fixture(
        t,
        stubService({
            requestBalance: async () => {
                started.resolve();
                await release.promise;
                return { accounts: [], pagination: null, ...metadata };
            },
        }),
    );
    const link = await f.one.links.get(f.id, true);
    assert.ok(link);
    const pending = f.one.links.fetch(link.token);
    const rejection = assert.rejects(pending, { status: 503 });
    await started.promise;
    await f.b.command(['SET', f.b.key(`refresh:${link.token}`), 'new-owner', 'PX', '10000']);
    release.resolve();
    await rejection;
    assert.equal(await f.a.get(f.a.key(`snapshot:${link.token}`)), null);
    assert.equal(await f.a.get(f.a.key(`refresh:${link.token}`)), 'new-owner');
});

test('Redis global session capacity is enforced atomically', async (t) => {
    const f = await fixture(t);
    const future = String(Date.now() + 60000);
    const members = Array.from({ length: 999 }, (_, n) => [future, `occupied-${n}`]).flat();
    await f.a.command(['ZADD', f.a.key('sessions'), ...members]);
    await assert.rejects(f.two.sessions.create(credentials, metadata), { status: 503 });
});

test('Redis wrong encryption key fails closed without exposing credentials', async (t) => {
    const f = await fixture(t);
    const sessions = new RedisSessions(f.b, randomBytes(32));
    await assert.rejects(sessions.get(f.id), { status: 503 });
});

test('Redis isolates different accounts and survives application client recreation', async (t) => {
    const f = await fixture(
        t,
        stubService({
            requestBalance: async (input = {}) => ({
                accounts: [{ accountNo: String(input.email), balance: 42 }],
                pagination: null,
                ...metadata,
            }),
        }),
    );
    const other = await f.two.sessions.create({ email: 'other@example.com', password: 'other-pass' }, metadata);
    const firstLink = await f.one.links.get(f.id, true);
    const secondLink = await f.two.links.get(other, true);
    assert.ok(firstLink && secondLink && firstLink.token !== secondLink.token);
    await f.one.links.fetch(firstLink.token);
    await f.a.close();
    const restarted = new RedisStorage(url!, f.a.prefix);
    t.after(() => restarted.close());
    const sessions = new RedisSessions(restarted, key);
    const links = new RedisBalanceLinks(restarted, sessions, f.service);
    assert.deepEqual((await sessions.get(f.id))?.credentials, credentials);
    assert.equal((await links.fetch(firstLink.token)).cached, true);
    const second = await links.fetch(secondLink.token);
    assert.deepEqual(second.accounts, [
        { accountNo: 'other@example.com', balance: 42 },
        { accountNo: 'other@example.com', balance: 42 },
    ]);
    await links.revoke(f.id);
    assert.ok(await f.two.sessions.get(other));
    assert.equal((await f.two.links.fetch(secondLink.token)).cached, true);
});

test('Redis reconnects on the next request after a dropped connection', async (t) => {
    const f = await fixture(t);
    assert.ok(await f.two.sessions.get(f.id));
    f.b.client.destroy();
    assert.ok(await f.two.sessions.get(f.id));
});

test('Redis outages return sanitized 503 instead of falling back to local sessions', async () => {
    const storage = new RedisStorage('redis://private:secret@127.0.0.1:1');
    try {
        const service = stubService();
        const sessions = new RedisSessions(storage, key);
        const handlers = createHandlers(config, service, {
            sessions,
            limiter: new RedisLoginLimiter(storage, key),
            links: new RedisBalanceLinks(storage, sessions, service),
        });
        const response = await handlers.session(
            new Request(config.appUrl, { headers: { cookie: 'easycheck_session=test' } }),
        );
        assert.equal(response.status, 503);
        const body = await response.text();
        assert.ok(!body.includes('secret') && !body.includes('127.0.0.1'));
    } finally {
        await storage.close();
    }
});
