import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, LoginLimiter, SESSION_SECONDS } from '../lib/server/sessions';

test('browser sessions encrypt credentials, isolate users, and expire after 24 hours', () => {
    let now = Date.now();
    const store = new SessionStore({ now: () => now });
    const first = store.create(
        { email: 'one@example.invalid', password: 'never-store-plain' },
        { tokenExpiresAt: 'first', tokenExpiresAtUtc: 'first' },
    );
    const second = store.create(
        { email: 'two@example.invalid', password: 'another-password' },
        { tokenExpiresAt: 'second', tokenExpiresAtUtc: 'second' },
    );
    assert.equal(store.get(first)?.credentials.password, 'never-store-plain');
    assert.equal(store.get(second)?.credentials.email, 'two@example.invalid');
    assert.ok(!JSON.stringify([...store.sessions.values()]).includes('never-store-plain'));
    store.update(first, { tokenExpiresAt: 'renewed', tokenExpiresAtUtc: 'renewed' });
    assert.equal(store.get(first)?.tokenExpiresAt, 'renewed');
    assert.equal(store.get(second)?.tokenExpiresAt, 'second');
    assert.equal(store.get('forged-cookie'), null);
    now += SESSION_SECONDS * 1000;
    assert.equal(store.get(first), null);
});

test('login limit resets after the window or a successful login', () => {
    let now = 0;
    const limiter = new LoginLimiter({ now: () => now });
    for (let count = 0; count < 5; count++) limiter.check('one@example.invalid');
    assert.throws(() => limiter.check('ONE@example.invalid'), { status: 429 });
    now += 15 * 60_000;
    limiter.check('one@example.invalid');
    limiter.clear('one@example.invalid');
    assert.equal(limiter.attempts.size, 0);
});
