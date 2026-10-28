import type { AppConfig } from '../lib/server/config';
import type { createService } from '../lib/server/drivehub/service';

export const metadata = { tokenExpiresAt: '2026-10-28 14:53:22', tokenExpiresAtUtc: '2026-10-28T06:53:22.000Z' };
export const config: AppConfig = {
    port: 7777,
    apiKey: 'synthetic-api-key-at-least-32-characters',
    appUrl: 'https://easy.example',
    email: '',
    password: '',
    appUsername: 'app-user',
    appPassword: 'app-pass',
    clientId: 'app-id',
    expiryUtcOffset: '+08:00',
};
export type Service = ReturnType<typeof createService>;
export type BalanceInput = Parameters<Service['requestBalance']>[0];
export type TransactionInput = Parameters<Service['requestTransactions']>[0];
export function stubService(overrides: Partial<Service> = {}): Service {
    return {
        authenticate: async () => metadata,
        requestBalance: async () => ({
            accounts: [],
            pagination: { page: 1, pageSize: 20, accountType: 'primary', hasNext: false, hasPrevious: false },
            ...metadata,
        }),
        requestTransactions: async () => ({ accountNo: '123456789012', transactions: [], ...metadata }),
        ...overrides,
    };
}
