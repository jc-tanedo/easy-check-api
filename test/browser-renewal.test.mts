import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../lib/server/drivehub/service';
import { createHandlers } from '../lib/server/handlers';
import { SessionStore } from '../lib/server/sessions';
import { config as defaults } from './fixtures';

test('browser session renews the six-hour user token without another credential submission', async () => {
    let now = Date.parse('2026-10-28T00:53:22Z');
    let logins = 0;
    const config = {
        ...defaults,
        appUsername: 'app',
        appPassword: 'password',
        clientId: 'client',
        appUrl: 'https://easy.example',
        expiryUtcOffset: '+08:00',
    };
    const service = createService(config, {
        now: () => now,
        request: async (options) => {
            if (options.path === 'auth') return { access_token: 'app', sig: 'key' };
            if (options.path.endsWith('/login'))
                return { token: `user-${++logins}`, exp_at: new Date(now + 6 * 3600_000).toISOString() };
            return { results: [{ account_no: '123456789012', balance: 123 }], count: 1, next: null };
        },
    });
    const handlers = createHandlers(config, service, { sessions: new SessionStore({ now: () => now }) });
    const login = await handlers.session(
        new Request('https://easy.example/api/session', {
            method: 'POST',
            headers: { Origin: 'https://easy.example', 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'one@example.invalid', password: 'secret' }),
        }),
    );
    assert.equal(login.status, 201);
    const cookieHeader = login.headers.get('set-cookie');
    assert.ok(cookieHeader);
    const cookie = cookieHeader.split(';')[0];
    const request = () => new Request('https://easy.example/api/balances', { headers: { Cookie: cookie } });
    assert.equal((await handlers.balances(request())).status, 200);
    assert.equal(logins, 1);
    now += 6 * 3600_000;
    assert.equal((await handlers.balances(request())).status, 200);
    assert.equal(logins, 2);
    const session = await handlers.session(
        new Request('https://easy.example/api/session', { headers: { Cookie: cookie } }),
    );
    assert.equal((await session.json()).tokenExpiresAtUtc, new Date(now + 6 * 3600_000).toISOString());
});
