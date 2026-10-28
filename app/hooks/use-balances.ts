'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { AccountRecord, AccountType, BalanceResult } from '../../types/domain';
import { apiErrorMessage, isUnauthorized } from '../../lib/client/api-error';
import { parseAmount } from '../../lib/shared/format';

export type DisplayAccount = AccountRecord & { balance: number | null };
type DisplayBalanceResult = Omit<BalanceResult, 'accounts'> & { accounts: DisplayAccount[] };

export function useBalances(onExpired: () => void, onMetadata: (result: BalanceResult) => void) {
    const [balanceError, setBalanceError] = useState('');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<DisplayBalanceResult | null>(null);
    const [accountType, setAccountType] = useState<AccountType>('primary');
    const [page, setPage] = useState(1);
    const [checkedAt, setCheckedAt] = useState<Date | null>(null);
    const generation = useRef(0);
    const active = useRef<AbortController | null>(null);

    const cancel = useCallback(() => {
        generation.current++;
        active.current?.abort();
    }, []);
    const reset = useCallback(() => {
        cancel();
        setData(null);
        setLoading(false);
        setBalanceError('');
    }, [cancel]);
    useEffect(() => cancel, [cancel]);

    const loadBalances = useCallback(
        async (type: AccountType = 'primary', currentPage = 1) => {
            cancel();
            const id = generation.current;
            const controller = new AbortController();
            active.current = controller;
            setAccountType(type);
            setPage(currentPage);
            setLoading(true);
            setBalanceError('');
            setData(null);
            try {
                const response = await axios.get<BalanceResult>('/api/balances', {
                    params: { accountType: type, page: currentPage, pageSize: 20 },
                    signal: controller.signal,
                });
                if (id !== generation.current || controller.signal.aborted) return;
                const accounts = response.data.accounts.map((account) => ({
                    ...account,
                    balance: parseAmount(account.balance),
                }));
                setData({ ...response.data, accounts });
                setCheckedAt(new Date());
                onMetadata(response.data);
            } catch (error: unknown) {
                if (axios.isCancel(error) || id !== generation.current || controller.signal.aborted) return;
                if (isUnauthorized(error)) {
                    reset();
                    onExpired();
                } else setBalanceError(apiErrorMessage(error, 'We couldn’t connect. Please try again.'));
            } finally {
                if (id === generation.current) setLoading(false);
            }
        },
        [cancel, reset, onExpired, onMetadata],
    );

    return { balanceError, setBalanceError, loading, data, accountType, page, checkedAt, loadBalances, reset, cancel };
}
