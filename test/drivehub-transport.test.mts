import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { once } from 'node:events';
import axios from 'axios';
import { request, isDriveHubError, type UpstreamRequest } from '../lib/server/drivehub/transport';

// Exercise Axios's real adapter against a local server, preserving its encoding,
// JSON parsing, redirect handling, and response-size checks.
async function transport(t: TestContext, handler: http.RequestListener) {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const client = axios.create({ proxy: false });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return (options: UpstreamRequest) =>
        request(options, 'https://upstream.example.test/', {
            request: (requestOptions) => {
                const url = new URL(requestOptions.url ?? '');
                url.protocol = 'http:';
                url.host = `127.0.0.1:${address.port}`;
                return client.request({ ...requestOptions, url: url.href });
            },
        });
}

test('transport resolves requests against the configured upstream URL', async () => {
    let capturedUrl: string | undefined;
    const client = axios.create();
    client.defaults.adapter = async (options) => {
        capturedUrl = options.url;
        return { data: { data: { ok: true } }, status: 200, statusText: 'OK', headers: {}, config: options };
    };
    await request({ path: 'auth', headers: {}, query: { page: '2' } }, 'https://configured.example.test/api/', client);
    assert.equal(capturedUrl, 'https://configured.example.test/api/auth?page=2');
});

test('Axios form-encodes credentials without losing special characters', async (t) => {
    let captured:
        { url: string; method: string | undefined; headers: http.IncomingHttpHeaders; body: string } | undefined;
    const localRequest = await transport(t, async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        captured = {
            url: req.url ?? '',
            method: req.method,
            headers: req.headers,
            body: Buffer.concat(chunks).toString(),
        };
        res.setHeader('Content-Type', 'application/json');
        res.end('{"data":{"token":"user"}}');
    });
    const fields = { email: 'a+b@example.invalid', password: ' space+&=é ' };
    const result = await localRequest({ path: 'user-v2/user/login', headers: {}, fields });
    assert.deepEqual(result, { token: 'user' });
    assert.ok(captured);
    assert.equal(captured.url, '/user-v2/user/login');
    assert.equal(captured.method, 'POST');
    assert.equal(Number(captured.headers['content-length']), Buffer.byteLength(captured.body));
    assert.deepEqual(Object.fromEntries(new URLSearchParams(captured.body)), fields);
    assert.ok(!captured.url.includes('password'));
});

test('Axios preserves signed headers and RFID query parameters', async (t) => {
    let captured: http.IncomingMessage | undefined;
    const localRequest = await transport(t, (req, res) => {
        captured = req;
        res.end('{"data":{"results":[]}}');
    });
    const result = await localRequest({
        path: 'user-v2/user/rfid',
        headers: { Authorization: 'Bearer app', 'user-token': 'user', username: 'app-user', code: 'signature' },
        query: { account_type: 'others', page: '2', page_size: '20' },
    });
    assert.deepEqual(result, { results: [] });
    assert.ok(captured);
    assert.equal(captured.method, 'GET');
    assert.equal(captured.url, '/user-v2/user/rfid?account_type=others&page=2&page_size=20');
    assert.equal(captured.headers.authorization, 'Bearer app');
    assert.equal(captured.headers['user-token'], 'user');
    assert.equal(captured.headers.code, 'signature');
});

test('Axios rejects redirects without following them or exposing upstream secrets', async (t) => {
    let calls = 0;
    const localRequest = await transport(t, (req, res) => {
        calls++;
        res.writeHead(302, { Location: '/must-not-follow' });
        res.end('{"password":"do-not-leak"}');
    });
    await assert.rejects(
        localRequest({ path: 'auth', headers: {} }),
        (error: unknown) =>
            isDriveHubError(error) &&
            error.status === 302 &&
            !error.message.includes('do-not-leak') &&
            !('config' in error),
    );
    assert.equal(calls, 1);
});

test('Axios preserves HTTP error status without exposing response data', async (t) => {
    const localRequest = await transport(t, (req, res) => {
        res.writeHead(401);
        res.end('{"message":"do-not-leak"}');
    });
    await assert.rejects(
        localRequest({ path: 'auth', headers: {} }),
        (error: unknown) =>
            isDriveHubError(error) &&
            error.status === 401 &&
            !error.message.includes('do-not-leak') &&
            !('response' in error),
    );
});

test('transport rejects application errors inside a successful HTTP response', async (t) => {
    const localRequest = await transport(t, (req, res) => res.end('{"code":401,"data":null,"message":"do-not-leak"}'));
    await assert.rejects(
        localRequest({ path: 'auth', headers: {} }),
        (error: unknown) => isDriveHubError(error) && error.status === 401 && !error.message.includes('do-not-leak'),
    );
});

test('Axios rejects malformed JSON with a sanitized error', async (t) => {
    const localRequest = await transport(t, (req, res) => res.end('do-not-leak'));
    await assert.rejects(localRequest({ path: 'auth', headers: {} }), {
        status: 502,
        message: 'DriveHub request failed',
    });
});

test('transport rejects JSON without the expected response envelope', async (t) => {
    const localRequest = await transport(t, (req, res) => res.end('{"unexpected":"do-not-leak"}'));
    await assert.rejects(localRequest({ path: 'auth', headers: {} }), {
        status: 502,
        message: 'Unexpected DriveHub response',
    });
});

test('Axios enforces the response-size limit', async (t) => {
    const localRequest = await transport(t, (req, res) => res.end('x'.repeat(2_000_001)));
    await assert.rejects(localRequest({ path: 'auth', headers: {} }), {
        status: 502,
        message: 'DriveHub request failed',
    });
});

test('transport strips Axios request details from network and timeout errors', async () => {
    await assert.rejects(
        request({ path: 'auth', headers: {} }, 'https://upstream.example.test/', {
            request: async () => {
                const error = Object.assign(new Error('password=do-not-leak'), {
                    code: 'ECONNABORTED',
                    config: { headers: { Authorization: 'do-not-leak' } },
                });
                throw error;
            },
        }),
        (error: unknown) =>
            isDriveHubError(error) &&
            error.status === 502 &&
            error.message === 'DriveHub request failed' &&
            !('config' in error),
    );
});
