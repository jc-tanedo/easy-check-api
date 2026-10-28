import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, validateConfig } from '../lib/server/config.ts';
import { config } from './fixtures';

test('DriveHub base URL is required, validated, and never included in configuration errors', () => {
    assert.equal(loadConfig({ NODE_ENV: 'test' }).drivehubBaseUrl, '');
    const url = 'https://upstream.example.test/';
    assert.equal(loadConfig({ NODE_ENV: 'test', DRIVEHUB_BASE_URL: url }).drivehubBaseUrl, url);
    assert.doesNotThrow(() => validateConfig({ ...config, drivehubBaseUrl: url }));
    for (const value of [
        '',
        'not a URL',
        'http://upstream.example.test/',
        'https://user:secret@upstream.example.test/',
        `${url}?secret=value`,
        `${url}#fragment`,
    ]) {
        assert.throws(() => validateConfig({ ...config, drivehubBaseUrl: value }), {
            message: 'DRIVEHUB_BASE_URL must be an HTTPS URL without credentials, query, or fragment',
        });
    }
});

test('Redis requires a valid URL and a separate stable 32-byte encryption key', () => {
    assert.throws(() => validateConfig({ ...config, redisUrl: 'redis://localhost:6379' }), /SESSION_ENCRYPTION_KEY/);
    assert.throws(
        () => validateConfig({ ...config, redisUrl: 'redis://localhost:6379', sessionEncryptionKey: 'x'.repeat(64) }),
        /SESSION_ENCRYPTION_KEY/,
    );
    assert.throws(
        () => validateConfig({ ...config, redisUrl: 'https://localhost', sessionEncryptionKey: 'a'.repeat(64) }),
        /REDIS_URL/,
    );
    assert.doesNotThrow(() =>
        validateConfig({ ...config, redisUrl: 'rediss://localhost:6379', sessionEncryptionKey: 'a'.repeat(64) }),
    );
    assert.doesNotThrow(() => validateConfig(config));
});

test('DriveHub application credentials come only from environment variables', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easycheck-config-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const configPath = path.join(dir, 'client.json');
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DRIVEHUB_CLIENT_CONFIG: configPath };

    fs.writeFileSync(configPath, JSON.stringify({ username: 'client-user', password: 'client-pass', client_id: 'id' }));
    const missing = loadConfig(env);
    assert.equal(missing.appUsername, '');
    assert.equal(missing.appPassword, '');
    assert.equal(missing.clientId, '');
    assert.throws(() => validateConfig({ ...config, appUsername: missing.appUsername }), /appUsername/);
    assert.throws(() => validateConfig({ ...config, appPassword: missing.appPassword }), /appPassword/);
    assert.throws(() => validateConfig({ ...config, clientId: missing.clientId }), /clientId/);

    // Even a malformed legacy file must not be read.
    fs.writeFileSync(configPath, 'not JSON');
    const loaded = loadConfig({
        ...env,
        API_KEY: 'a'.repeat(32),
        DRIVEHUB_APP_USERNAME: 'env-user',
        DRIVEHUB_APP_PASSWORD: 'env-pass',
        DRIVEHUB_CLIENT_ID: 'env-client',
        DRIVEHUB_BASE_URL: 'https://upstream.example.test/',
    });
    assert.equal(loaded.appUsername, 'env-user');
    assert.equal(loaded.appPassword, 'env-pass');
    assert.equal(loaded.clientId, 'env-client');
    assert.doesNotThrow(() => validateConfig(loaded));
});
