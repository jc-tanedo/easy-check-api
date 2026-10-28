import axios, { type AxiosInstance } from 'axios';

export type ErrorSource = 'application' | 'upstream';

export class DriveHubError extends Error {
    readonly status: number;
    readonly source: ErrorSource;
    retryAfter?: number;

    constructor(message: string, status = 502, source: ErrorSource = 'upstream') {
        super(message);
        this.name = 'DriveHubError';
        this.status = status;
        this.source = source;
    }
}

// Structural identification also works when multiple module loaders instantiate
// the class separately (for example, Node's test workers loading TS modules).
export function isDriveHubError(error: unknown): error is DriveHubError {
    if (!(error instanceof Error) || error.name !== 'DriveHubError') return false;
    const candidate = error as DriveHubError;
    return (
        Number.isInteger(candidate.status) && (candidate.source === 'application' || candidate.source === 'upstream')
    );
}

export interface UpstreamRequest {
    path: string;
    headers: Record<string, string>;
    fields?: Record<string, string>;
    query?: Record<string, string>;
}

const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 30_000;

export async function request<T = unknown>(
    { path, headers, fields, query }: UpstreamRequest,
    client: Pick<AxiosInstance, 'request'> = axios,
): Promise<T> {
    const url = new URL(path, 'https://upstream.example.test/');
    if (query) url.search = new URLSearchParams(query).toString();
    const body = fields ? new URLSearchParams(fields).toString() : undefined;
    const requestHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';

    let envelope: unknown;
    try {
        const response = await client.request<unknown>({
            url: url.href,
            method: body === undefined ? 'GET' : 'POST',
            headers: requestHeaders,
            data: body,
            timeout: REQUEST_TIMEOUT_MS,
            maxContentLength: MAX_RESPONSE_BYTES,
            maxRedirects: 0,
            responseType: 'json',
            transitional: { silentJSONParsing: false },
        });
        envelope = response.data;
    } catch (error: unknown) {
        // Axios errors carry request headers, credentials, and response bodies.
        // Translate them instead of forwarding or logging the original error.
        if (axios.isAxiosError(error) && Number.isInteger(error.response?.status)) {
            const status = error.response?.status;
            if (status !== undefined && (status < 200 || status >= 300)) {
                throw new DriveHubError('DriveHub rejected the request', status);
            }
        }
        throw new DriveHubError('DriveHub request failed');
    }

    if (!isEnvelope(envelope)) throw new DriveHubError('Unexpected DriveHub response');
    if (typeof envelope.code === 'number' && Number.isInteger(envelope.code) && envelope.code >= 400) {
        throw new DriveHubError('DriveHub rejected the request', envelope.code);
    }
    return envelope.data as T;
}

interface ResponseEnvelope {
    data: unknown;
    code?: unknown;
}

function isEnvelope(value: unknown): value is ResponseEnvelope {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, 'data');
}
