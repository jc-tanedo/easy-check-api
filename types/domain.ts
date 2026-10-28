export type AccountType = 'primary' | 'others';

export interface Credentials {
    email: string;
    password: string;
}

export interface PaginationInput {
    page: number;
    pageSize: number;
}

export interface TokenMetadata {
    tokenExpiresAt: string;
    tokenExpiresAtUtc: string;
}

export interface AccountRecord {
    accountNo?: string;
    plateNo?: string;
    conductionNo?: string;
    name?: string;
    accountType?: string;
    rfidType?: string;
    balance?: number | string | null;
    [field: string]: unknown;
}

export interface TransactionRecord {
    amount?: number | string | null;
    date?: string | null;
    type?: string | null;
    description?: string | null;
    plate?: string | null;
    referenceNo?: string | null;
    [field: string]: unknown;
}

export interface BalanceResult extends TokenMetadata {
    accounts: AccountRecord[];
    pagination:
        | (PaginationInput & {
              accountType: AccountType;
              count?: number;
              hasNext: boolean;
              hasPrevious: boolean;
          })
        | null;
}

export interface TransactionsResult extends TokenMetadata {
    accountNo: string;
    transactions: TransactionRecord[];
}
