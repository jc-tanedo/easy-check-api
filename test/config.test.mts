import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, validateConfig } from '../lib/server/config.ts';
import { config } from './fixtures';

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

test('client credential files accept only an object with optional string fields', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easycheck-config-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const configPath = path.join(dir, 'client.json');
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DRIVEHUB_CLIENT_CONFIG: configPath };

    fs.writeFileSync(configPath, JSON.stringify({ username: 'client-user', password: 'client-pass', client_id: 'id' }));
    assert.equal(loadConfig(env).appUsername, 'client-user');
    assert.equal(loadConfig(env).appPassword, 'client-pass');
    assert.equal(loadConfig(env).clientId, 'id');

    fs.writeFileSync(configPath, JSON.stringify({ username: 42, password: 'secret' }));
    assert.throws(() => loadConfig(env), /optional string fields/);

    fs.writeFileSync(configPath, '[]');
    assert.throws(() => loadConfig(env), /optional string fields/);

    fs.writeFileSync(configPath, ' '.repeat(16 * 1024 + 1));
    assert.throws(() => loadConfig(env), /no larger than 16 KiB/);
});
