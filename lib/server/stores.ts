import type { Credentials, TokenMetadata } from '../../types/domain';
import type { ActiveSession } from './sessions';

type Result<T> = T | Promise<T>;

export interface SessionRepository {
    create(credentials: Credentials, metadata: TokenMetadata): Result<string>;
    get(id: string | undefined): Result<ActiveSession | null>;
    update(id: string | undefined, metadata: TokenMetadata): Result<void>;
    delete(id: string | undefined): Result<void>;
}

export interface LoginLimitRepository {
    check(email: string): Result<void>;
    clear(email: string): Result<void>;
}

export interface BalanceLinkRepository {
    revoke(id: string | undefined): Result<void>;
    get(
        id: string | undefined,
        create?: boolean,
    ): Result<{
        token: string;
        sessionExpiresAt: string;
        cacheSeconds: number;
    } | null>;
    fetch(token: string): Promise<Record<string, unknown>>;
}
