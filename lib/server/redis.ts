import { createClient } from 'redis';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Credentials, TokenMetadata, AccountRecord } from '../../types/domain';
import type { SessionRepository, LoginLimitRepository, BalanceLinkRepository } from './stores';
import type { ActiveSession } from './sessions';
import { SESSION_SECONDS } from './sessions';
import { CACHE_SECONDS } from './balance-links';
import { DriveHubError, isDriveHubError } from './drivehub/transport';
import type { createService } from './drivehub/service';

const unavailable = () =>
    new DriveHubError('Session storage is unavailable. Please try again later.', 503, 'application');
const missing = () => new DriveHubError('Balance URL not found', 404);

/** One private standalone Redis database; scripts intentionally use multiple keys. */
export class RedisStorage {
    readonly client;
    private connecting?: Promise<unknown>;
    constructor(
        url: string,
        readonly prefix = 'easycheck:',
    ) {
        this.client = createClient({
            url,
            disableOfflineQueue: true,
            socket: { connectTimeout: 3000, reconnectStrategy: false },
        });
        // Redis errors may contain connection credentials; never log raw client errors.
        this.client.on('error', () => {});
    }
    key(suffix: string) {
        return this.prefix + suffix;
    }
    async command(args: string[]): Promise<unknown> {
        try {
            if (!this.client.isReady) {
                this.connecting ??= this.client.connect().finally(() => {
                    this.connecting = undefined;
                });
                await this.connecting;
            }
            return await this.client.sendCommand(args, { timeout: 5000 });
        } catch {
            throw unavailable();
        }
    }
    async get(key: string): Promise<string | null> {
        const result = await this.command(['GET', key]);
        return typeof result === 'string' ? result : null;
    }
    eval(script: string, keys: string[], args: string[] = []) {
        return this.command(['EVAL', script, String(keys.length), ...keys, ...args]);
    }
    async close() {
        if (this.client.isOpen) await this.client.quit();
    }
}

export class RedisSessions implements SessionRepository {
    constructor(
        readonly storage: RedisStorage,
        private readonly encryptionKey: Buffer,
    ) {
        if (encryptionKey.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must encode 32 bytes');
    }
    key(id: string) {
        return this.storage.key(`session:${id}`);
    }
    async create(credentials: Credentials, metadata: TokenMetadata): Promise<string> {
        const id = randomBytes(32).toString('base64url');
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()]);
        const payload = JSON.stringify({
            iv: iv.toString('base64'),
            encrypted: encrypted.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            metadata,
        });
        const result = await this.storage.eval(
            `
            local t = redis.call('TIME'); local now = t[1] * 1000 + math.floor(t[2] / 1000)
            redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
            if redis.call('ZCARD', KEYS[2]) >= 1000 then return 0 end
            redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
            redis.call('ZADD', KEYS[2], now + ARGV[2] * 1000, ARGV[3])
            return 1`,
            [this.key(id), this.storage.key('sessions')],
            [payload, String(SESSION_SECONDS), id],
        );
        if (result !== 1) throw new DriveHubError('Please try signing in later', 503, 'application');
        return id;
    }
    async get(id: string | undefined): Promise<ActiveSession | null> {
        if (!id) return null;
        const reply = await this.storage.eval(
            `
            local value = redis.call('GET', KEYS[1]); if not value then return nil end
            local t = redis.call('TIME')
            return {value, tostring(t[1] * 1000 + math.floor(t[2] / 1000) + redis.call('PTTL', KEYS[1]))}
        `,
            [this.key(id)],
        );
        if (!reply) return null;
        try {
            if (!Array.isArray(reply) || typeof reply[0] !== 'string') throw new Error();
            const entry = JSON.parse(reply[0]);
            const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(entry.iv, 'base64'));
            decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
            const credentials: unknown = JSON.parse(
                Buffer.concat([decipher.update(Buffer.from(entry.encrypted, 'base64')), decipher.final()]).toString(
                    'utf8',
                ),
            );
            if (
                !credentials ||
                typeof credentials !== 'object' ||
                !('email' in credentials) ||
                !('password' in credentials) ||
                typeof credentials.email !== 'string' ||
                typeof credentials.password !== 'string' ||
                typeof entry.metadata?.tokenExpiresAt !== 'string' ||
                typeof entry.metadata?.tokenExpiresAtUtc !== 'string'
            )
                throw new Error();
            return {
                credentials: { email: credentials.email, password: credentials.password },
                tokenExpiresAt: entry.metadata.tokenExpiresAt,
                tokenExpiresAtUtc: entry.metadata.tokenExpiresAtUtc,
                sessionExpiresAt: new Date(Number(reply[1])).toISOString(),
            };
        } catch {
            throw unavailable();
        }
    }
    async update(id: string | undefined, metadata: TokenMetadata): Promise<void> {
        if (!id) return;
        await this.storage.eval(
            `local v = redis.call('GET', KEYS[1]); if not v then return 0 end
            local entry = cjson.decode(v); entry.metadata = cjson.decode(ARGV[1])
            redis.call('SET', KEYS[1], cjson.encode(entry), 'KEEPTTL'); return 1`,
            [this.key(id)],
            [JSON.stringify(metadata)],
        );
    }
    async delete(id: string | undefined): Promise<void> {
        if (!id) return;
        await this.storage.eval(
            `redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[2], ARGV[1]); return 1`,
            [this.key(id), this.storage.key('sessions')],
            [id],
        );
    }
}

export class RedisLoginLimiter implements LoginLimitRepository {
    constructor(
        private readonly storage: RedisStorage,
        private readonly key: Buffer,
    ) {}
    private identity(email: string) {
        return this.storage.key('login:' + createHmac('sha256', this.key).update(email.toLowerCase()).digest('hex'));
    }
    async check(email: string): Promise<void> {
        const identity = this.identity(email);
        const result = await this.storage.eval(
            `
            local t = redis.call('TIME'); local now = t[1] * 1000 + math.floor(t[2] / 1000)
            redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
            local count = tonumber(redis.call('GET', KEYS[1]) or '0')
            if count >= 5 or redis.call('ZCARD', KEYS[2]) >= 5000 then return 0 end
            if count == 0 then
                redis.call('SET', KEYS[1], 1, 'EX', 900)
                redis.call('ZADD', KEYS[2], now + 900000, KEYS[1])
            else redis.call('INCR', KEYS[1]) end
            return 1`,
            [identity, this.storage.key('login-attempts')],
        );
        if (result !== 1)
            throw new DriveHubError('Too many sign-in attempts. Please try again later.', 429, 'application');
    }
    async clear(email: string): Promise<void> {
        const id = this.identity(email);
        await this.storage.eval(`redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[2], KEYS[1]); return 1`, [
            id,
            this.storage.key('login-attempts'),
        ]);
    }
}

export class RedisBalanceLinks implements BalanceLinkRepository {
    constructor(
        private readonly storage: RedisStorage,
        private readonly sessions: RedisSessions,
        private readonly service: ReturnType<typeof createService>,
    ) {}
    private link(id: string) {
        return this.storage.key(`link:${id}`);
    }
    private token(token: string) {
        return this.storage.key(`token:${token}`);
    }
    private cache(token: string) {
        return this.storage.key(`snapshot:${token}`);
    }
    private lock(token: string) {
        return this.storage.key(`refresh:${token}`);
    }
    async revoke(id: string | undefined): Promise<void> {
        if (!id) return;
        // Token removal is atomic with session->token removal; old refreshes cannot publish.
        await this.storage.eval(
            `local token = redis.call('GET', KEYS[1]); if token then
            redis.call('DEL', ARGV[1] .. 'token:' .. token, ARGV[1] .. 'snapshot:' .. token,
                ARGV[1] .. 'refresh:' .. token) end
            redis.call('DEL', KEYS[1]); return 1`,
            [this.link(id)],
            [this.storage.prefix],
        );
    }
    async get(id: string | undefined, create = false) {
        if (!id) throw new DriveHubError('Sign in to generate a balance URL', 401, 'application');
        const session = await this.sessions.get(id);
        if (!session) throw new DriveHubError('Sign in to generate a balance URL', 401, 'application');
        const candidate = randomBytes(9).toString('base64url');
        const token = await this.storage.eval(
            `
            local ttl = redis.call('PTTL', KEYS[1]); if ttl <= 0 then return nil end
            local token = redis.call('GET', KEYS[2]); if token then return token end
            if ARGV[1] ~= '1' then return nil end
            if redis.call('EXISTS', KEYS[3]) == 1 then return nil end
            redis.call('SET', KEYS[2], ARGV[2], 'PX', ttl)
            redis.call('SET', KEYS[3], ARGV[3], 'PX', ttl); return ARGV[2]`,
            [this.sessions.key(id), this.link(id), this.token(candidate)],
            [create ? '1' : '0', candidate, id],
        );
        return typeof token === 'string'
            ? { token, sessionExpiresAt: session.sessionExpiresAt, cacheSeconds: CACHE_SECONDS }
            : null;
    }
    private async active(token: string, id: string) {
        return (
            (await this.storage.eval(
                `if redis.call('EXISTS', KEYS[1]) == 1 and redis.call('GET', KEYS[2]) == ARGV[1]
            and redis.call('GET', KEYS[3]) == ARGV[2] then return 1 end return 0`,
                [this.sessions.key(id), this.token(token), this.link(id)],
                [id, token],
            )) === 1
        );
    }
    async fetch(token: string): Promise<Record<string, unknown>> {
        const id = await this.storage.get(this.token(token));
        if (!id || !(await this.active(token, id))) throw missing();
        const owner = randomBytes(16).toString('hex');
        for (let attempt = 0; attempt < 100; attempt++) {
            // Validate ownership and read cache in one operation, even during logout/revoke.
            const cached = await this.storage.eval(
                `
                if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('GET', KEYS[2]) ~= ARGV[1]
                    or redis.call('GET', KEYS[3]) ~= ARGV[2] then return 'revoked' end
                return redis.call('GET', KEYS[4])`,
                [this.sessions.key(id), this.token(token), this.link(id), this.cache(token)],
                [id, token],
            );
            if (cached === 'revoked') throw missing();
            if (typeof cached === 'string') {
                return this.readCache(cached);
            }
            if ((await this.storage.command(['SET', this.lock(token), owner, 'NX', 'PX', '120000'])) === 'OK') {
                try {
                    // A different worker may have published after our first cache read.
                    // Read again under the lease before starting any upstream work.
                    const latest = await this.storage.eval(
                        `
                        if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('GET', KEYS[2]) ~= ARGV[1]
                            or redis.call('GET', KEYS[3]) ~= ARGV[2] then return 'revoked' end
                        return redis.call('GET', KEYS[4])`,
                        [this.sessions.key(id), this.token(token), this.link(id), this.cache(token)],
                        [id, token],
                    );
                    if (latest === 'revoked') throw missing();
                    if (typeof latest === 'string') return this.readCache(latest);
                    return await this.refresh(token, id, owner);
                } finally {
                    await this.storage.eval(
                        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
                        [this.lock(token)],
                        [owner],
                    );
                }
            }
            await sleep(100);
        }
        throw new DriveHubError('Balance refresh is busy. Please try again later.', 503, 'application');
    }
    private readCache(raw: string): Record<string, unknown> {
        let value: unknown;
        try {
            value = JSON.parse(raw);
        } catch {
            throw unavailable();
        }
        if (!value || typeof value !== 'object') throw unavailable();
        if ('failure' in value && value.failure === true && 'until' in value && typeof value.until === 'number') {
            const failure = new DriveHubError('Balance could not be fetched. Try again later.', 502);
            failure.retryAfter = Math.max(1, Math.ceil((value.until - Date.now()) / 1000));
            throw failure;
        }
        if (
            !('accounts' in value) ||
            !Array.isArray(value.accounts) ||
            !('fetchedAt' in value) ||
            typeof value.fetchedAt !== 'string' ||
            !('cacheExpiresAt' in value) ||
            typeof value.cacheExpiresAt !== 'string'
        )
            throw unavailable();
        return { ...value, cached: true };
    }
    private async publish(token: string, id: string, owner: string, value: object) {
        const result = await this.storage.eval(
            `
            if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('GET', KEYS[2]) ~= ARGV[1]
                or redis.call('GET', KEYS[3]) ~= ARGV[2] or redis.call('GET', KEYS[4]) ~= ARGV[3] then return 0 end
            local ttl = math.min(redis.call('PTTL', KEYS[1]), ARGV[5] * 1000)
            if ttl <= 0 then return 0 end
            redis.call('SET', KEYS[5], ARGV[4], 'PX', ttl); return 1`,
            [this.sessions.key(id), this.token(token), this.link(id), this.lock(token), this.cache(token)],
            [id, token, owner, JSON.stringify(value), String(CACHE_SECONDS)],
        );
        if (result !== 1) {
            if (!(await this.active(token, id))) throw missing();
            throw new DriveHubError('Balance refresh is busy. Please try again later.', 503, 'application');
        }
    }
    private async refresh(token: string, id: string, owner: string): Promise<Record<string, unknown>> {
        try {
            const session = await this.sessions.get(id);
            if (!session || !(await this.active(token, id))) throw missing();
            const accounts: AccountRecord[] = [];
            let metadata: TokenMetadata | undefined;
            for (const accountType of ['primary', 'others'] as const) {
                for (let page = 1; page <= 100; page++) {
                    const result = await this.service.requestBalance({
                        ...session.credentials,
                        accountType,
                        page,
                        pageSize: 100,
                    });
                    if (!(await this.active(token, id))) throw missing();
                    const renewed = await this.storage.eval(
                        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], 120000) end return 0`,
                        [this.lock(token)],
                        [owner],
                    );
                    if (renewed !== 1) throw new DriveHubError('Balance refresh lease expired', 503, 'application');
                    accounts.push(...result.accounts);
                    metadata = { tokenExpiresAt: result.tokenExpiresAt, tokenExpiresAtUtc: result.tokenExpiresAtUtc };
                    if (!result.pagination?.hasNext) break;
                    if (page === 100) throw new DriveHubError('DriveHub account pagination limit reached');
                }
            }
            if (metadata) await this.sessions.update(id, metadata);
            const data = {
                accounts,
                fetchedAt: new Date().toISOString(),
                cacheExpiresAt: new Date(Date.now() + CACHE_SECONDS * 1000).toISOString(),
            };
            await this.publish(token, id, owner, data);
            return { ...data, cached: false };
        } catch (error: unknown) {
            if (isDriveHubError(error) && error.status === 503 && error.source === 'application') throw error;
            if (!(await this.active(token, id))) throw missing();
            if (isDriveHubError(error) && error.status === 401) {
                // An old request must not invalidate a replacement link created
                // during its upstream call. Check and invalidate atomically.
                await this.storage.eval(
                    `
                    if redis.call('GET', KEYS[2]) ~= ARGV[1] or redis.call('GET', KEYS[3]) ~= ARGV[2] then return 0 end
                    redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5])
                    redis.call('ZREM', KEYS[6], ARGV[1]); return 1`,
                    [
                        this.sessions.key(id),
                        this.token(token),
                        this.link(id),
                        this.cache(token),
                        this.lock(token),
                        this.storage.key('sessions'),
                    ],
                    [id, token],
                );
                throw missing();
            }
            await this.publish(token, id, owner, { failure: true, until: Date.now() + CACHE_SECONDS * 1000 });
            const failure = new DriveHubError('Balance could not be fetched. Try again later.', 502);
            failure.retryAfter = CACHE_SECONDS;
            throw failure;
        }
    }
}

export function createRedisStores(url: string, hexKey: string, service: ReturnType<typeof createService>) {
    if (!/^[a-f\d]{64}$/i.test(hexKey)) throw new Error('SESSION_ENCRYPTION_KEY must be 64 hexadecimal characters');
    const storage = new RedisStorage(url);
    const key = Buffer.from(hexKey, 'hex');
    const sessions = new RedisSessions(storage, key);
    return {
        sessions,
        limiter: new RedisLoginLimiter(storage, key),
        links: new RedisBalanceLinks(storage, sessions, service),
    };
}
