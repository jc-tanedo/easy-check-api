'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import type { BalanceResult, TokenMetadata } from '../../types/domain';
import { apiErrorMessage, isUnauthorized } from '../../lib/client/api-error';
import { useBalances } from './use-balances';

interface SessionInfo extends TokenMetadata {
    email: string;
    sessionExpiresAt?: string;
}
type Phase = 'checking' | 'signed-in' | 'signed-out';

export function useSession() {
    const [phase, setPhase] = useState<Phase>('checking');
    const [session, setSession] = useState<SessionInfo | null>(null);
    const [signingIn, setSigningIn] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [loginError, setLoginError] = useState('');
    const onExpired = useCallback(() => {
        setSession(null);
        setPhase('signed-out');
        setLoginError('Your session has ended. Sign in again to continue.');
    }, []);
    const onMetadata = useCallback((result: BalanceResult) => {
        setSession((previous) => (previous ? { ...previous, tokenExpiresAtUtc: result.tokenExpiresAtUtc } : previous));
    }, []);
    const balances = useBalances(onExpired, onMetadata);
    const { loadBalances, cancel, reset, setBalanceError } = balances;

    useEffect(() => {
        const controller = new AbortController();
        axios
            .get<SessionInfo>('/api/session', { signal: controller.signal })
            .then((response) => {
                if (controller.signal.aborted) return;
                setSession(response.data);
                setPhase('signed-in');
                void loadBalances();
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted || axios.isCancel(error)) return;
                setPhase('signed-out');
                if (!isUnauthorized(error)) setLoginError('The service is unavailable. Please try again shortly.');
            });
        return () => {
            controller.abort();
            cancel();
        };
    }, [loadBalances, cancel]);

    const signIn = useCallback(
        async (email: string, password: string): Promise<boolean> => {
            setSigningIn(true);
            setLoginError('');
            try {
                const response = await axios.post<SessionInfo>('/api/session', { email, password });
                setSession(response.data);
                setPhase('signed-in');
                void loadBalances();
                return true;
            } catch (error: unknown) {
                setLoginError(apiErrorMessage(error, 'We couldn’t connect. Please try again.'));
                return false;
            } finally {
                setSigningIn(false);
            }
        },
        [loadBalances],
    );

    const signOut = useCallback(async (): Promise<boolean> => {
        setSigningOut(true);
        // Invalidate outstanding balance requests before waiting for logout.
        cancel();
        try {
            await axios.delete('/api/session');
            reset();
            setSession(null);
            setPhase('signed-out');
            return true;
        } catch (error: unknown) {
            setBalanceError(apiErrorMessage(error, 'We couldn’t connect. Please try again.'));
            return false;
        } finally {
            setSigningOut(false);
        }
    }, [cancel, reset, setBalanceError]);

    return { phase, session, signingIn, signingOut, loginError, signIn, signOut, onExpired, ...balances };
}
