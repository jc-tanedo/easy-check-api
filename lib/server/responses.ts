import { DriveHubError, isDriveHubError } from './drivehub/transport';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return Response.json(data, {
        status,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
    });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        throw new DriveHubError('Send application/json', 415, 'application');
    }
    if (!request.body) throw new DriveHubError('Send a JSON object', 400, 'application');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
            await reader.cancel();
            throw new DriveHubError('Request body is too large', 413, 'application');
        }
        chunks.push(value);
    }
    try {
        const data: unknown = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected object');
        return data as Record<string, unknown>;
    } catch {
        throw new DriveHubError('Invalid JSON body', 400, 'application');
    }
}

function publicStatus(error: DriveHubError): number {
    if (error.source === 'application') {
        return [400, 401, 403, 404, 413, 415, 429, 503].includes(error.status) ? error.status : 500;
    }
    return [400, 401, 403, 404, 413, 415, 429].includes(error.status) ? error.status : 502;
}

export function errorResponse(error: unknown, headers: Record<string, string> = {}): Response {
    if (isDriveHubError(error)) return json({ error: error.message }, publicStatus(error), headers);
    return json({ error: 'The request could not be completed' }, 500, headers);
}
