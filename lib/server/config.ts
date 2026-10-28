import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
    port: number;
    apiKey: string;
    appUrl: string;
    email: string;
    password: string;
    appUsername: string;
    appPassword: string;
    clientId: string;
    expiryUtcOffset: string;
    redisUrl?: string;
    sessionEncryptionKey?: string;
}

interface ClientCredentials {
    username?: string;
    password?: string;
    client_id?: string;
}

const MAX_CLIENT_CONFIG_BYTES = 16 * 1024;

function isClientCredentials(value: unknown): value is ClientCredentials {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const credentials = value as Record<string, unknown>;
    return ['username', 'password', 'client_id'].every(
        (key) => credentials[key] === undefined || typeof credentials[key] === 'string',
    );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const clientFile = env.DRIVEHUB_CLIENT_CONFIG || path.join(process.cwd(), '.drivehub-client.json');
    let client: ClientCredentials = {};
    if (fs.existsSync(clientFile)) {
        const stats = fs.statSync(clientFile);
        if (!stats.isFile() || stats.size > MAX_CLIENT_CONFIG_BYTES) {
            throw new Error('DriveHub client config must be a regular file no larger than 16 KiB');
        }
        const parsed: unknown = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
        if (!isClientCredentials(parsed)) {
            throw new Error('DriveHub client config must be an object with optional string fields');
        }
        client = parsed;
    }
    return {
        redisUrl: env.REDIS_URL || undefined,
        sessionEncryptionKey: env.SESSION_ENCRYPTION_KEY || undefined,
        port: Number(env.PORT || 7777),
        apiKey: env.API_KEY || '',
        appUrl: env.APP_URL || '',
        email: env.DRIVEHUB_EMAIL || '',
        password: env.DRIVEHUB_PASSWORD || '',
        appUsername: env.DRIVEHUB_APP_USERNAME || client.username || '',
        appPassword: env.DRIVEHUB_APP_PASSWORD || client.password || '',
        clientId: env.DRIVEHUB_CLIENT_ID || client.client_id || '',
        // DriveHub's timezone-less exp_at values are treated as Philippine time.
        expiryUtcOffset: env.DRIVEHUB_EXPIRY_UTC_OFFSET || '+08:00',
    };
}

export function validateConfig(config: AppConfig): void {
    if (config.redisUrl) {
        try {
            const url = new URL(config.redisUrl);
            if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error();
        } catch {
            // URL parser errors can include the original URL and its password.
            throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
        }
        if (!/^[a-f\d]{64}$/i.test(config.sessionEncryptionKey || '')) {
            throw new Error('SESSION_ENCRYPTION_KEY must be 64 hexadecimal characters when REDIS_URL is set');
        }
    }
    for (const name of ['apiKey', 'appUsername', 'appPassword', 'clientId'] as const) {
        if (!config[name]) throw new Error(`Missing required configuration: ${name}`);
    }
    if (config.apiKey.length < 32) throw new Error('API_KEY must contain at least 32 characters');
    if (config.appUrl) {
        const url = new URL(config.appUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('APP_URL must be an HTTP(S) URL');
    }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535');
    }
    if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(config.expiryUtcOffset)) {
        throw new Error('DRIVEHUB_EXPIRY_UTC_OFFSET must look like +08:00');
    }
}
