export interface AppConfig {
    port: number;
    apiKey: string;
    appUrl: string;
    email: string;
    password: string;
    appUsername: string;
    appPassword: string;
    clientId: string;
    drivehubBaseUrl: string;
    expiryUtcOffset: string;
    redisUrl?: string;
    sessionEncryptionKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    return {
        redisUrl: env.REDIS_URL || undefined,
        sessionEncryptionKey: env.SESSION_ENCRYPTION_KEY || undefined,
        port: Number(env.PORT || 7777),
        apiKey: env.API_KEY || '',
        appUrl: env.APP_URL || '',
        email: env.DRIVEHUB_EMAIL || '',
        password: env.DRIVEHUB_PASSWORD || '',
        appUsername: env.DRIVEHUB_APP_USERNAME || '',
        appPassword: env.DRIVEHUB_APP_PASSWORD || '',
        clientId: env.DRIVEHUB_CLIENT_ID || '',
        drivehubBaseUrl: env.DRIVEHUB_BASE_URL || '',
        // DriveHub's timezone-less exp_at values are treated as Philippine time.
        expiryUtcOffset: env.DRIVEHUB_EXPIRY_UTC_OFFSET || '+08:00',
    };
}

export function validateConfig(config: AppConfig): void {
    try {
        const url = new URL(config.drivehubBaseUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
        throw new Error('DRIVEHUB_BASE_URL must be an HTTPS URL without credentials, query, or fragment');
    }
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
