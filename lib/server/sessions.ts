import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { Credentials, TokenMetadata } from '../../types/domain';
import type { SessionRepository, LoginLimitRepository } from './stores';
import { DriveHubError } from './drivehub/transport';

export const SESSION_SECONDS = 24 * 60 * 60;

export interface ActiveSession extends TokenMetadata {
    credentials: Credentials;
    sessionExpiresAt: string;
}

interface SessionEntry {
    iv: Buffer;
    encrypted: Buffer;
    tag: Buffer;
    metadata: TokenMetadata;
    until: number;
}

// Structural branding survives Node's mixed ESM/TypeScript loaders.
export function isMemorySessionStore(store: SessionRepository): store is SessionStore {
    return 'backend' in store && store.backend === 'memory';
}

export class SessionStore implements SessionRepository {
    readonly backend = 'memory';
    private readonly now: () => number;
    private readonly key = randomBytes(32);
    readonly sessions = new Map<string, SessionEntry>();

    constructor({ now = Date.now }: { now?: () => number } = {}) {
        this.now = now;
    }

    create(credentials: Credentials, metadata: TokenMetadata): string {
        for (const [id, entry] of this.sessions) {
            if (entry.until <= this.now()) this.sessions.delete(id);
        }
        if (this.sessions.size >= 1000) {
            throw new DriveHubError('Please try signing in later', 503, 'application');
        }
        const id = randomBytes(32).toString('base64url');
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
        this.sessions.set(id, {
            iv,
            encrypted,
            tag: cipher.getAuthTag(),
            metadata,
            until: this.now() + SESSION_SECONDS * 1000,
        });
        return id;
    }

    get(id: string | undefined): ActiveSession | null {
        if (!id) return null;
        const entry = this.sessions.get(id);
        if (!entry) return null;
        if (entry.until <= this.now()) {
            this.sessions.delete(id);
            return null;
        }
        const decipher = createDecipheriv('aes-256-gcm', this.key, entry.iv);
        decipher.setAuthTag(entry.tag);
        const data = JSON.parse(
            Buffer.concat([decipher.update(entry.encrypted), decipher.final()]).toString('utf8'),
        ) as Credentials;
        return { credentials: data, ...entry.metadata, sessionExpiresAt: new Date(entry.until).toISOString() };
    }

    update(id: string | undefined, metadata: TokenMetadata): void {
        if (!id) return;
        const entry = this.sessions.get(id);
        if (entry) entry.metadata = metadata;
    }

    delete(id: string | undefined): void {
        if (id) this.sessions.delete(id);
    }
}

interface AttemptEntry {
    count: number;
    until: number;
}

export class LoginLimiter implements LoginLimitRepository {
    private readonly now: () => number;
    private readonly key = randomBytes(32);
    readonly attempts = new Map<string, AttemptEntry>();

    constructor({ now = Date.now }: { now?: () => number } = {}) {
        this.now = now;
    }

    private identity(email: string): string {
        return createHmac('sha256', this.key).update(email.toLowerCase()).digest('hex');
    }

    check(email: string): void {
        for (const [key, entry] of this.attempts) {
            if (entry.until <= this.now()) this.attempts.delete(key);
        }
        const key = this.identity(email);
        const entry = this.attempts.get(key) || { count: 0, until: this.now() + 15 * 60_000 };
        if (entry.count >= 5 || this.attempts.size >= 5000) {
            throw new DriveHubError('Too many sign-in attempts. Please try again later.', 429, 'application');
        }
        entry.count++;
        this.attempts.set(key, entry);
    }

    clear(email: string): void {
        this.attempts.delete(this.identity(email));
    }
}
