import { createHmac, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config';
import type {
    AccountRecord,
    AccountType,
    BalanceResult,
    Credentials,
    TokenMetadata,
    TransactionsResult,
} from '../../../types/domain';
import { sign } from '../crypto';
import { parseExpiry } from './expiry';
import { DriveHubError, request as httpRequest, type UpstreamRequest } from './transport';
import { isRecord, normalizeRecord, records, type JsonRecord } from './schema';

const EXPIRY_MARGIN = 30_000;
const APP_AUTH_TTL = 12 * 60_000;

type Clock = () => number;
type Transport = (options: UpstreamRequest) => Promise<unknown>;

interface ServiceOptions {
    request?: Transport;
    now?: Clock;
}

interface AppAuth {
    token: string;
    sig: string;
    until: number;
}

interface UserAuth {
    token: string;
    expiresAt: number;
    expAt: string;
}

interface BalanceInput {
    email?: unknown;
    password?: unknown;
    id?: unknown;
    accountType?: unknown;
    page?: unknown;
    pageSize?: unknown;
}

interface TransactionInput {
    email?: unknown;
    password?: unknown;
    id?: unknown;
    accountType?: unknown;
}

interface RfidPage extends JsonRecord {
    results: JsonRecord[];
    count?: number;
    next?: unknown;
    previous?: unknown;
}

interface LookupInput {
    id?: string;
    accountType?: AccountType;
    page: number;
    pageSize: number;
}

interface LookupResult {
    accounts: AccountRecord[];
    pagination: BalanceResult['pagination'];
}

function isAccountType(value: unknown): value is AccountType {
    return value === 'primary' || value === 'others';
}

function statusOf(error: unknown): number | undefined {
    return isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
}

function accountRecord(record: JsonRecord): AccountRecord {
    return normalizeRecord(record) as AccountRecord;
}

export function createService(
    config: AppConfig,
    { request = (options) => httpRequest(options, config.drivehubBaseUrl), now = Date.now }: ServiceOptions = {},
) {
    let appAuth: AppAuth | null = null;
    let appAuthPending: Promise<AppAuth> | null = null;
    const users = new Map<string, UserAuth>();
    const logins = new Map<string, Promise<UserAuth>>();
    const cacheKey = randomBytes(32);

    function credentialKey(email: string, password: string): string {
        return createHmac('sha256', cacheKey)
            .update(JSON.stringify([email, password]))
            .digest('hex');
    }

    async function getAppAuth(): Promise<AppAuth> {
        if (appAuth && now() < appAuth.until) return appAuth;
        if (appAuthPending) return appAuthPending;
        appAuthPending = (async () => {
            const basic = Buffer.from(`${config.appUsername}:${config.appPassword}`, 'latin1').toString('base64');
            const result: unknown = await request({
                path: 'auth',
                headers: { Authorization: `Basic ${basic}`, 'client-id': config.clientId },
            });
            if (
                !isRecord(result) ||
                typeof result.access_token !== 'string' ||
                !result.access_token ||
                typeof result.sig !== 'string' ||
                !result.sig
            ) {
                throw new DriveHubError('Unexpected DriveHub app authentication response');
            }
            appAuth = { token: result.access_token, sig: result.sig, until: now() + APP_AUTH_TTL };
            return appAuth;
        })()
            .catch(() => {
                throw new DriveHubError('DriveHub app authentication failed');
            })
            .finally(() => {
                appAuthPending = null;
            });
        return appAuthPending;
    }

    async function withAppAuth<T>(operation: (auth: AppAuth) => Promise<T>, retryUnauthorized = true): Promise<T> {
        const auth = await getAppAuth();
        try {
            return await operation(auth);
        } catch (error: unknown) {
            if (statusOf(error) !== 401 || !retryUnauthorized) throw error;
            if (appAuth === auth) appAuth = null;
            return operation(await getAppAuth());
        }
    }

    function headers(auth: AppAuth, message: string, userToken?: string): Record<string, string> {
        const result: Record<string, string> = {
            Authorization: `Bearer ${auth.token}`,
            username: config.appUsername,
            code: sign(message, auth.sig),
        };
        if (userToken) result['user-token'] = userToken;
        return result;
    }

    async function getUser(email: string, password: string): Promise<UserAuth> {
        const key = credentialKey(email, password);
        const cached = users.get(key);
        if (cached && now() + EXPIRY_MARGIN < cached.expiresAt) return cached;
        const existing = logins.get(key);
        if (existing) return existing;
        const pending = (async () => {
            const result: unknown = await withAppAuth(
                (auth) =>
                    request({
                        path: 'user-v2/user/login',
                        headers: { ...headers(auth, password + email), 'client-id': config.clientId },
                        fields: { email, password },
                    }),
                false,
            );
            if (
                !isRecord(result) ||
                typeof result.token !== 'string' ||
                !result.token ||
                typeof result.exp_at !== 'string'
            ) {
                throw new DriveHubError('DriveHub login did not return a user token', 401);
            }
            const expiresAt = parseExpiry(result.exp_at, config.expiryUtcOffset);
            if (!Number.isFinite(expiresAt) || expiresAt <= now() + EXPIRY_MARGIN) {
                throw new DriveHubError('DriveHub returned an invalid or expired exp_at');
            }
            for (const [id, user] of users) {
                if (user.expiresAt <= now() + EXPIRY_MARGIN) users.delete(id);
            }
            if (users.size >= 1000 && !users.has(key)) {
                const oldestKey = users.keys().next().value;
                if (oldestKey !== undefined) users.delete(oldestKey);
            }
            const user: UserAuth = { token: result.token, expiresAt, expAt: result.exp_at };
            users.set(key, user);
            return user;
        })();
        logins.set(key, pending);
        try {
            return await pending;
        } finally {
            if (logins.get(key) === pending) logins.delete(key);
        }
    }

    async function fetchPage(
        user: UserAuth,
        accountType: AccountType,
        page: number,
        pageSize: number,
    ): Promise<RfidPage> {
        const result: unknown = await withAppAuth((auth) =>
            request({
                path: 'user-v2/user/rfid',
                headers: headers(auth, `${pageSize}${page}${accountType}`, user.token),
                query: { account_type: accountType, page: String(page), page_size: String(pageSize) },
            }),
        );
        if (!isRecord(result) || !Array.isArray(result.results)) {
            throw new DriveHubError('Unexpected DriveHub RFID response');
        }
        const items = records(result.results, 'RFID account');
        if (result.count !== undefined && (typeof result.count !== 'number' || !Number.isFinite(result.count))) {
            throw new DriveHubError('Unexpected DriveHub RFID response');
        }
        return { ...result, results: items } as RfidPage;
    }

    async function lookup(user: UserAuth, options: LookupInput): Promise<LookupResult> {
        const { id, accountType, page, pageSize } = options;
        if (!id) {
            const type = accountType || 'primary';
            const data = await fetchPage(user, type, page, pageSize);
            return {
                accounts: data.results.map(accountRecord),
                pagination: {
                    accountType: type,
                    page,
                    pageSize,
                    count: data.count,
                    hasNext: Boolean(data.next),
                    hasPrevious: Boolean(data.previous),
                },
            };
        }
        for (const type of accountType ? [accountType] : (['primary', 'others'] as const)) {
            for (let current = 1; current <= 100; current++) {
                const data = await fetchPage(user, type, current, 100);
                const account = data.results.find((item) => String(item.account_no) === id);
                if (account) return { accounts: [accountRecord(account)], pagination: null };
                if (!data.next) break;
                if (current === 100) throw new DriveHubError('DriveHub account pagination limit reached');
            }
        }
        throw new DriveHubError('Account was not found among your linked RFID accounts', 404);
    }

    async function withUser<T extends object>(
        email: string,
        password: string,
        operation: (user: UserAuth) => Promise<T>,
    ): Promise<T & TokenMetadata> {
        let user = await getUser(email, password);
        let result: T;
        try {
            result = await operation(user);
        } catch (error: unknown) {
            if (statusOf(error) !== 401) throw error;
            const key = credentialKey(email, password);
            if (users.get(key) === user) users.delete(key);
            user = await getUser(email, password);
            result = await operation(user);
        }
        return { ...result, tokenExpiresAt: user.expAt, tokenExpiresAtUtc: new Date(user.expiresAt).toISOString() };
    }

    async function requestBalance(input: BalanceInput = {}): Promise<BalanceResult> {
        const email = input.email ?? config.email;
        const password = input.password ?? config.password;
        const id = input.id;
        const accountType = input.accountType;
        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 20;
        if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
            throw new DriveHubError('DriveHub email and password are required', 400);
        }
        if (
            (id !== undefined && (typeof id !== 'string' || !/^\d{12}$/.test(id))) ||
            (accountType !== undefined && !isAccountType(accountType)) ||
            typeof page !== 'number' ||
            !Number.isInteger(page) ||
            page < 1 ||
            page > 10000 ||
            typeof pageSize !== 'number' ||
            !Number.isInteger(pageSize) ||
            pageSize < 1 ||
            pageSize > 100
        ) {
            throw new DriveHubError('Invalid account ID, account type, or pagination', 400);
        }
        return withUser(email, password, (user) =>
            lookup(user, { id: typeof id === 'string' ? id : undefined, accountType, page, pageSize }),
        );
    }

    async function requestTransactions(input: TransactionInput = {}): Promise<TransactionsResult> {
        const email = input.email ?? config.email;
        const password = input.password ?? config.password;
        const id = input.id;
        const accountType = input.accountType;
        if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
            throw new DriveHubError('DriveHub email and password are required', 400);
        }
        if (
            typeof id !== 'string' ||
            !/^\d{12}$/.test(id) ||
            (accountType !== undefined && !isAccountType(accountType))
        ) {
            throw new DriveHubError('A valid account ID and account type are required', 400);
        }
        return withUser(email, password, async (user) => {
            await lookup(user, { id, accountType, page: 1, pageSize: 100 });
            const result: unknown = await withAppAuth((auth) =>
                request({
                    path: 'user-v2/user/rfid/trans',
                    headers: headers(auth, id, user.token),
                    query: { account_no: id },
                }),
            );
            if (!isRecord(result) || (!Array.isArray(result.transaction) && result.transaction !== null)) {
                throw new DriveHubError('Unexpected DriveHub transaction response');
            }
            const transactions = records(result.transaction ?? [], 'transaction record');
            return { accountNo: id, transactions: transactions.map(normalizeRecord) };
        });
    }

    async function authenticate(input: Credentials): Promise<TokenMetadata> {
        if (typeof input.email !== 'string' || !input.email || typeof input.password !== 'string' || !input.password) {
            throw new DriveHubError('DriveHub email and password are required', 400);
        }
        const user = await getUser(input.email, input.password);
        return { tokenExpiresAt: user.expAt, tokenExpiresAtUtc: new Date(user.expiresAt).toISOString() };
    }

    return { requestBalance, requestTransactions, authenticate };
}
