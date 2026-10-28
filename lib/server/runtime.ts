import { loadConfig, validateConfig } from './config';
import { createService } from './drivehub/service';
import { createHandlers, type HandlerSet } from './handlers';
import { createRedisStores } from './redis';

const RUNTIME_KEY = Symbol.for('easycheck.runtime');

export function getHandlers(): HandlerSet {
    const runtime = globalThis as unknown as Record<symbol, HandlerSet | undefined>;
    const existing = runtime[RUNTIME_KEY];
    if (existing) return existing;
    const config = loadConfig();
    validateConfig(config);
    const service = createService(config);
    const stores = config.redisUrl
        ? createRedisStores(config.redisUrl, config.sessionEncryptionKey || '', service)
        : undefined;
    const handlers = createHandlers(config, service, stores);
    runtime[RUNTIME_KEY] = handlers;
    return handlers;
}
