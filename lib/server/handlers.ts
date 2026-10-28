import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import type { AppConfig } from './config';
import type { Credentials, TokenMetadata } from '../../types/domain';
import { equalSecrets } from './crypto';
import { DriveHubError, isDriveHubError } from './drivehub/transport';
import type { createService } from './drivehub/service';
import { json, readJson, errorResponse } from './responses';
import { balanceOptions, credentials, queryOptions } from './balance-input';
import { SessionStore, LoginLimiter, SESSION_SECONDS } from './sessions';
import { BalanceLinks } from './balance-links';

const COOKIE_NAME = 'easycheck_session';
type Service = ReturnType<typeof createService>;

export interface HandlerSet {
    session(request: Request): Promise<Response>;
    balances(request: Request): Promise<Response>;
    transactions(request: Request): Promise<Response>;
    checkBalance(request: Request): Promise<Response>;
    balanceLink(request: Request): Promise<Response>;
    publicBalance(request: Request, token: string): Promise<Response>;
}

interface HandlerOptions {
    now?: () => number;
    sessions?: SessionStore;
    limiter?: LoginLimiter;
}

function errorStatus(error: unknown): number | undefined {
    return isDriveHubError(error) ? error.status : undefined;
}

export function createHandlers(
    config: AppConfig,
    service: Service,
    { now = Date.now, sessions = new SessionStore({ now }), limiter = new LoginLimiter({ now }) }: HandlerOptions = {},
): HandlerSet {
    const links = new BalanceLinks(sessions, service, { now });
    const origin = (request: Request): string => {
        if (config.appUrl) return new URL(config.appUrl).origin;
        const url = new URL(request.url);
        const host = request.headers.get('host');
        if (host) url.host = host;
        return url.origin;
    };
    const sessionId = (request: Request): string | undefined =>
        parseCookie(request.headers.get('cookie') || '')[COOKIE_NAME];
    const sessionCookie = (request: Request, id: string, clear = false): string =>
        serializeCookie(COOKIE_NAME, id, {
            httpOnly: true,
            sameSite: 'strict',
            secure: new URL(origin(request)).protocol === 'https:',
            path: '/',
            maxAge: clear ? 0 : SESSION_SECONDS,
        });
    const sameOrigin = (request: Request): void => {
        if (request.headers.get('origin') !== origin(request)) {
            throw new DriveHubError('Origin is not allowed', 403, 'application');
        }
    };

    function deleteSession(id: string | undefined): void {
        links.revoke(id);
        sessions.delete(id);
    }

    async function balanceLink(request: Request): Promise<Response> {
        try {
            const id = sessionId(request);
            if (!sessions.get(id)) throw new DriveHubError('Sign in to manage your balance URL', 401, 'application');
            if (request.method !== 'GET') sameOrigin(request);
            if (request.method === 'DELETE') {
                links.revoke(id);
                return json({ revoked: true });
            }
            const link = links.get(id, request.method === 'POST');
            return json(
                link
                    ? {
                          url: `${origin(request)}/bal/${link.token}`,
                          sessionExpiresAt: link.sessionExpiresAt,
                          cacheSeconds: link.cacheSeconds,
                      }
                    : { url: null },
            );
        } catch (error: unknown) {
            return errorResponse(error);
        }
    }

    async function publicBalance(request: Request, token: string): Promise<Response> {
        try {
            if (!/^[A-Za-z0-9_-]{12}$/.test(token)) throw new DriveHubError('Balance URL not found', 404);
            return json(await links.fetch(token));
        } catch (error: unknown) {
            const headers: Record<string, string> =
                isDriveHubError(error) && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
            return errorResponse(error, headers);
        }
    }

    async function session(request: Request): Promise<Response> {
        try {
            const id = sessionId(request);
            if (request.method === 'GET') {
                const active = sessions.get(id);
                if (!active) throw new DriveHubError('Sign in to view your accounts', 401, 'application');
                return json({
                    email: active.credentials.email,
                    tokenExpiresAt: active.tokenExpiresAt,
                    tokenExpiresAtUtc: active.tokenExpiresAtUtc,
                    sessionExpiresAt: active.sessionExpiresAt,
                });
            }
            sameOrigin(request);
            if (request.method === 'DELETE') {
                deleteSession(id);
                return json({ signedOut: true }, 200, { 'Set-Cookie': sessionCookie(request, '', true) });
            }
            if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
            const login = credentials(await readJson(request));
            limiter.check(login.email);
            const metadata = await service.authenticate(login);
            limiter.clear(login.email);
            deleteSession(id);
            const newId = sessions.create(login, metadata);
            return json({ email: login.email, ...metadata }, 201, { 'Set-Cookie': sessionCookie(request, newId) });
        } catch (error: unknown) {
            return errorResponse(error);
        }
    }

    async function withSession(
        request: Request,
        operation: (credentials: Credentials) => Promise<TokenMetadata & object>,
    ): Promise<Response> {
        const id = sessionId(request);
        try {
            const active = sessions.get(id);
            if (!active) throw new DriveHubError('Your session has ended. Please sign in again.', 401, 'application');
            const result = await operation(active.credentials);
            sessions.update(id, { tokenExpiresAt: result.tokenExpiresAt, tokenExpiresAtUtc: result.tokenExpiresAtUtc });
            return json(result);
        } catch (error: unknown) {
            if (errorStatus(error) === 401) {
                deleteSession(id);
                return errorResponse(error, { 'Set-Cookie': sessionCookie(request, '', true) });
            }
            return errorResponse(error);
        }
    }

    function balances(request: Request): Promise<Response> {
        return withSession(request, (login) =>
            service.requestBalance({ ...balanceOptions(queryOptions(request)), ...login }),
        );
    }

    function transactions(request: Request): Promise<Response> {
        return withSession(request, (login) => {
            const { id, accountType } = balanceOptions(queryOptions(request));
            return service.requestTransactions({ id, accountType, ...login });
        });
    }

    async function checkBalance(request: Request): Promise<Response> {
        let cors: Record<string, string> = {};
        try {
            const browserOrigin = request.headers.get('origin');
            if (browserOrigin) {
                let allowed = browserOrigin === origin(request);
                try {
                    const url = new URL(browserOrigin);
                    allowed ||=
                        ['http:', 'https:'].includes(url.protocol) &&
                        (url.hostname === 'jczr.dev' || url.hostname.endsWith('.jczr.dev'));
                } catch {
                    // Invalid origins fail the same allowlist check below.
                }
                if (!allowed) throw new DriveHubError('Origin is not allowed', 403, 'application');
                cors = {
                    'Access-Control-Allow-Origin': browserOrigin,
                    Vary: 'Origin',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
                };
            }
            if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
            if (!config.apiKey || !equalSecrets(request.headers.get('x-api-key'), config.apiKey)) {
                throw new DriveHubError('A valid X-API-Key header is required', 401, 'application');
            }
            const query = queryOptions(request);
            const input = request.method === 'POST' ? await readJson(request) : query;
            const result = await service.requestBalance(balanceOptions(input, request.method === 'POST'));
            return json(result, 200, cors);
        } catch (error: unknown) {
            return errorResponse(error, cors);
        }
    }

    return { session, balances, transactions, checkBalance, balanceLink, publicBalance };
}
