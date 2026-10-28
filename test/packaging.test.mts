import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Git and Docker exclude runtime secrets while retaining the example environment file', () => {
    const root = path.resolve(__dirname, '..');
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
    assert.match(gitignore, /^\.env\.\*$/m);
    assert.match(gitignore, /^!\.env\.example$/m);
    assert.match(gitignore, /^\.drivehub-client\.json$/m);
    assert.match(gitignore, /^\/docker-compose\.yml$/m);
    assert.match(dockerignore, /^\.env\.\*$/m);
    assert.match(dockerignore, /^\.drivehub-client\.json$/m);
});

test('Compose example uses environment credentials without a credential-file mount', () => {
    const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.example.yml'), 'utf8');
    assert.match(compose, /env_file:\s*\n\s*- \.env/);
    assert.doesNotMatch(compose, /DRIVEHUB_CLIENT_CONFIG|drivehub-client|secrets:/);
});

test('standalone packaging copies assets and removes secrets without modifying source config', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easycheck-package-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const write = (name: string, data: string) => {
        const file = path.join(dir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
    };
    write('.env', 'API_KEY=synthetic-source-secret');
    write('.next/static/chunk.js', 'static content');
    write('public/test.svg', '<svg/>');
    for (const name of ['.env', '.env.local', '.env.production', '.drivehub-client.json']) {
        write(`.next/standalone/${name}`, 'synthetic secret');
    }
    write('.next/standalone/app/.env.production', 'nested synthetic secret');
    write('.next/standalone/node_modules/pkg/.drivehub-client.json', 'nested credential secret');
    execFileSync(process.execPath, [path.join(__dirname, '../scripts/prepare-standalone.js')], { cwd: dir });
    for (const name of ['.env', '.env.local', '.env.production', '.drivehub-client.json']) {
        assert.ok(!fs.existsSync(path.join(dir, '.next/standalone', name)));
    }
    assert.ok(!fs.existsSync(path.join(dir, '.next/standalone/app/.env.production')));
    assert.ok(!fs.existsSync(path.join(dir, '.next/standalone/node_modules/pkg/.drivehub-client.json')));
    assert.equal(fs.readFileSync(path.join(dir, '.next/standalone/.next/static/chunk.js'), 'utf8'), 'static content');
    assert.ok(fs.existsSync(path.join(dir, '.next/standalone/public/test.svg')));
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'API_KEY=synthetic-source-secret');
});
