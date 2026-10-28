import { randomBytes } from 'node:crypto';
import type { AccountRecord, AccountType, TokenMetadata } from '../../types/domain';
import { DriveHubError, isDriveHubError } from './drivehub/transport';
import type { createService } from './drivehub/service';
import type { ActiveSession, SessionStore } from './sessions';
import type { BalanceLinkRepository } from './stores';

export const CACHE_SECONDS = 5 * 60;

type Service = ReturnType<typeof createService>;

interface LinkSnapshot {
    accounts: AccountRecord[];
    fetchedAt: string;
    cacheExpiresAt: string;
}

interface LinkEntry {
    sessionId: string;
    token: string;
    until: number;
    cache?: { data: LinkSnapshot; until: number };
    pending?: Promise<Record<string, unknown>>;
    failure?: { until: number } | null;
}

export class BalanceLinks implements BalanceLinkRepository {
    private readonly sessions: SessionStore;
    private readonly service: Service;
    private readonly now: () => number;
    private readonly bySession = new Map<string, LinkEntry>();
    private readonly byToken = new Map<string, LinkEntry>();

    constructor(sessions: SessionStore, service: Service, { now = Date.now }: { now?: () => number } = {}) {
        this.sessions = sessions;
        this.service = service;
        this.now = now;
    }

    revoke(sessionId: string | undefined, expected?: LinkEntry): void {
        if (!sessionId) return;
        const entry = this.bySession.get(sessionId);
        if (expected && entry !== expected) return;
        if (entry) this.byToken.delete(entry.token);
        this.bySession.delete(sessionId);
    }

    get(sessionId: string | undefined, create = false) {
        const session = this.sessions.get(sessionId);
        if (!session || !sessionId) throw new DriveHubError('Sign in to generate a balance URL', 401, 'application');
        for (const [id, entry] of this.bySession) {
            if (entry.until <= this.now()) this.revoke(id);
        }
        let entry = this.bySession.get(sessionId);
        if (!entry && create) {
            let token: string;
            do {
                token = randomBytes(9).toString('base64url');
            } while (this.byToken.has(token));
            entry = { sessionId, token, until: Date.parse(session.sessionExpiresAt) };
            this.bySession.set(sessionId, entry);
            this.byToken.set(entry.token, entry);
        }
        return entry
            ? { token: entry.token, sessionExpiresAt: session.sessionExpiresAt, cacheSeconds: CACHE_SECONDS }
            : null;
    }

    private active(entry: LinkEntry): ActiveSession | null {
        return this.byToken.get(entry.token) === entry ? this.sessions.get(entry.sessionId) : null;
    }

    async fetch(token: string): Promise<Record<string, unknown>> {
        const entry = this.byToken.get(token);
        if (!entry) throw new DriveHubError('Balance URL not found', 404);
        const session = this.active(entry);
        if (!session) {
            this.revoke(entry.sessionId, entry);
            throw new DriveHubError('Balance URL not found', 404);
        }
        if (entry.cache && this.now() < entry.cache.until) return { ...entry.cache.data, cached: true };
        if (entry.pending) return entry.pending;
        if (entry.failure && this.now() < entry.failure.until) {
            const error = new DriveHubError('Balance could not be fetched. Try again later.', 502);
            error.retryAfter = Math.ceil((entry.failure.until - this.now()) / 1000);
            throw error;
        }
        entry.pending = (async () => {
            try {
                const accounts: AccountRecord[] = [];
                let metadata: TokenMetadata | undefined;
                for (const accountType of ['primary', 'others'] as const satisfies readonly AccountType[]) {
                    for (let page = 1; page <= 100; page++) {
                        const result = await this.service.requestBalance({
                            ...session.credentials,
                            accountType,
                            page,
                            pageSize: 100,
                        });
                        if (!this.active(entry)) throw new DriveHubError('Balance URL not found', 404);
                        accounts.push(...result.accounts);
                        metadata = {
                            tokenExpiresAt: result.tokenExpiresAt,
                            tokenExpiresAtUtc: result.tokenExpiresAtUtc,
                        };
                        if (!result.pagination?.hasNext) break;
                        if (page === 100) throw new DriveHubError('DriveHub account pagination limit reached');
                    }
                }
                if (!this.active(entry)) throw new DriveHubError('Balance URL not found', 404);
                if (metadata) this.sessions.update(entry.sessionId, metadata);
                const until = this.now() + CACHE_SECONDS * 1000;
                const data: LinkSnapshot = {
                    accounts,
                    fetchedAt: new Date(this.now()).toISOString(),
                    cacheExpiresAt: new Date(until).toISOString(),
                };
                entry.cache = { data, until };
                entry.failure = null;
                return { ...data, cached: false };
            } catch (error: unknown) {
                if (!this.active(entry) || (isDriveHubError(error) && error.status === 401)) {
                    if (isDriveHubError(error) && error.status === 401) this.sessions.delete(entry.sessionId);
                    this.revoke(entry.sessionId, entry);
                    throw new DriveHubError('Balance URL not found', 404);
                }
                entry.failure = { until: this.now() + CACHE_SECONDS * 1000 };
                const failure = new DriveHubError('Balance could not be fetched. Try again later.', 502);
                failure.retryAfter = CACHE_SECONDS;
                throw failure;
            }
        })();
        try {
            return await entry.pending;
        } finally {
            entry.pending = undefined;
        }
    }
}
