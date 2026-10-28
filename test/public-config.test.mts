import test from 'node:test';
import assert from 'node:assert/strict';
import { getGithubUrl } from '../lib/server/public-config.ts';

test('GitHub footer defaults to the project and reads overrides on every call', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    assert.equal(getGithubUrl(env), 'https://github.com/jc-tanedo/easy-check-api');
    env.GITHUB_URL = 'https://github.com/example/first';
    assert.equal(getGithubUrl(env), 'https://github.com/example/first');
    env.GITHUB_URL = ' https://github.com/example/second ';
    assert.equal(getGithubUrl(env), 'https://github.com/example/second');
});

test('GitHub footer hides empty, malformed, unsafe, or credential-bearing URLs', () => {
    for (const value of [
        '',
        '  ',
        'not a url',
        'javascript:alert(1)',
        'http://github.com/example',
        'https://user:secret@github.com/example',
    ]) {
        assert.equal(getGithubUrl({ NODE_ENV: 'test', GITHUB_URL: value }), null);
    }
});
