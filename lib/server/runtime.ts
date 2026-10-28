import { loadConfig, validateConfig } from './config';
import { createService } from './drivehub/service';
import { createHandlers, type HandlerSet } from './handlers';

const RUNTIME_KEY = Symbol.for('easycheck.runtime');

export function getHandlers(): HandlerSet {
    const runtime = globalThis as unknown as Record<symbol, HandlerSet | undefined>;
    const existing = runtime[RUNTIME_KEY];
    if (existing) return existing;
    const config = loadConfig();
    validateConfig(config);
    const handlers = createHandlers(config, createService(config));
    runtime[RUNTIME_KEY] = handlers;
    return handlers;
}
