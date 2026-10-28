import type { AccountType, Credentials } from '../../types/domain';
import { DriveHubError } from './drivehub/transport';

export interface BalanceOptions {
    id?: string;
    accountType?: AccountType;
    page: number;
    pageSize: number;
    email?: string;
    password?: string;
}

function isAccountType(value: unknown): value is AccountType {
    return value === 'primary' || value === 'others';
}

function jsonObject(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new DriveHubError('Send a JSON object', 400, 'application');
    }
    return input as Record<string, unknown>;
}

function paginationValue(value: unknown): number | null {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

export function balanceOptions(input: unknown, includeCredentials = false): BalanceOptions {
    const data = jsonObject(input);
    const page = paginationValue(data.page === undefined ? 1 : data.page);
    const pageSize = paginationValue(data.pageSize === undefined ? 20 : data.pageSize);
    if (page === null || pageSize === null) {
        throw new DriveHubError('Pagination must use whole numbers', 400, 'application');
    }
    if (data.id !== undefined && typeof data.id !== 'string') {
        throw new DriveHubError('Invalid account ID', 400, 'application');
    }
    if (data.accountType !== undefined && !isAccountType(data.accountType)) {
        throw new DriveHubError('Invalid account type', 400, 'application');
    }
    return {
        ...(typeof data.id === 'string' ? { id: data.id } : {}),
        ...(isAccountType(data.accountType) ? { accountType: data.accountType } : {}),
        page,
        pageSize,
        ...(includeCredentials ? credentials(data) : {}),
    };
}

export function credentials(input: unknown): Credentials {
    const data = jsonObject(input);
    if (
        typeof data.email !== 'string' ||
        !data.email ||
        data.email.length > 320 ||
        typeof data.password !== 'string' ||
        !data.password ||
        data.password.length > 1024
    ) {
        throw new DriveHubError('DriveHub email and password are required', 400, 'application');
    }
    return { email: data.email, password: data.password };
}

export function queryOptions(request: Request): Record<string, string> {
    const params = new URL(request.url).searchParams;
    if (params.has('email') || params.has('password')) {
        throw new DriveHubError('Send credentials in a JSON POST body, not the URL', 400, 'application');
    }
    const input: Record<string, string> = {};
    for (const name of ['id', 'accountType', 'page', 'pageSize']) {
        if (params.getAll(name).length > 1 || params.has(`${name}[]`)) {
            throw new DriveHubError('Parameters must contain a single value', 400, 'application');
        }
        const value = params.get(name);
        if (value !== null) input[name] = value;
    }
    return input;
}
