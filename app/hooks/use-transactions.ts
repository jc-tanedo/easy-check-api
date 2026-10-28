'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { AccountType, TransactionRecord, TransactionsResult } from '../../types/domain';
import { apiErrorMessage, isUnauthorized } from '../../lib/client/api-error';

export function useTransactions(accountNo: string | undefined, accountType: AccountType, onExpired: () => void) {
    const active = useRef<AbortController | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
    const load = useCallback(async () => {
        active.current?.abort();
        const controller = new AbortController();
        active.current = controller;
        try {
            const response = await axios.get<TransactionsResult>('/api/transactions', {
                params: { id: accountNo, accountType },
                signal: controller.signal,
            });
            if (!controller.signal.aborted) setTransactions(response.data.transactions);
        } catch (failure: unknown) {
            if (axios.isCancel(failure) || controller.signal.aborted) return;
            if (isUnauthorized(failure)) onExpired();
            else setError(apiErrorMessage(failure, 'Unable to load transaction history. Please try again.'));
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, [accountNo, accountType, onExpired]);
    const refreshHistory = useCallback(() => {
        setError('');
        setLoading(true);
        return load();
    }, [load]);
    useEffect(() => {
        // State updates follow the request response, not synchronous effect work.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
        return () => active.current?.abort();
    }, [load]);
    return { loading, error, transactions, refreshHistory };
}
