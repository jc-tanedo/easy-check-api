'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Check, Copy, Link2, LoaderCircle, Trash2, X } from 'lucide-react';
import { apiErrorMessage, isUnauthorized } from '../../lib/client/api-error';

interface BalanceLinkData {
    url: string | null;
    sessionExpiresAt?: string;
    cacheSeconds?: number;
}

interface BalanceLinkProps {
    onClose: () => void;
    onExpired: () => void;
}

export default function BalanceLink({ onClose, onExpired }: BalanceLinkProps) {
    const [link, setLink] = useState<BalanceLinkData | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);

    const failure = useCallback(
        (reason: unknown) => {
            if (isUnauthorized(reason)) onExpired();
            else setError(apiErrorMessage(reason, 'Unable to manage the balance URL. Please try again.'));
        },
        [onExpired],
    );

    useEffect(() => {
        const controller = new AbortController();
        axios
            .get<BalanceLinkData>('/api/balance-link', { signal: controller.signal })
            .then((response) => setLink(response.data))
            .catch((reason: unknown) => {
                if (!axios.isCancel(reason)) failure(reason);
            })
            .finally(() => {
                if (!controller.signal.aborted) setBusy(false);
            });
        return () => controller.abort();
    }, [failure]);

    async function generate(): Promise<void> {
        setBusy(true);
        setError('');
        try {
            const response = await axios.post<BalanceLinkData>('/api/balance-link');
            setLink(response.data);
            setCopied(false);
        } catch (reason: unknown) {
            failure(reason);
        } finally {
            setBusy(false);
        }
    }

    async function revoke(): Promise<void> {
        setBusy(true);
        setError('');
        try {
            await axios.delete('/api/balance-link');
            setLink(null);
            setCopied(false);
        } catch (reason: unknown) {
            failure(reason);
        } finally {
            setBusy(false);
        }
    }

    async function copy(): Promise<void> {
        setError('');
        if (!link?.url) return;
        try {
            await navigator.clipboard.writeText(link.url);
            setCopied(true);
        } catch {
            setError('Select the URL in the field to copy it manually.');
        }
    }

    return (
        <section className="balance-link-panel" id="balance-url-panel" aria-labelledby="balance-url-title">
            <div className="balance-link-heading">
                <div>
                    <h2 id="balance-url-title">
                        <Link2 size={18} /> Balance fetching URL
                    </h2>
                    <p>Includes primary and other linked accounts. Responses are cached for 5 minutes.</p>
                </div>
                <button className="icon-button" onClick={onClose} aria-label="Close balance URL panel">
                    <X size={17} />
                </button>
            </div>
            {link?.url ? (
                <>
                    <div className="balance-link-field">
                        <input
                            aria-label="Balance fetching URL"
                            readOnly
                            value={link.url}
                            onFocus={(event) => event.target.select()}
                        />
                        <button className="button secondary" onClick={copy} disabled={busy}>
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? 'Copied' : 'Copy URL'}
                        </button>
                    </div>
                    <div className="balance-link-actions">
                        <span>
                            Anyone with this URL can read balances while this login session is active. Logging out or
                            restarting the server invalidates it.
                        </span>
                        <button className="text-button revoke-link" onClick={revoke} disabled={busy}>
                            {busy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />} Revoke URL
                        </button>
                    </div>
                </>
            ) : (
                <div className="balance-link-create">
                    <p>
                        Generate a URL for a dashboard or another integration. It works without cookies or an API key
                        and expires with this login session.
                    </p>
                    <button className="button secondary" onClick={generate} disabled={busy}>
                        {busy ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />} Generate URL
                    </button>
                </div>
            )}
            {error && (
                <p className="balance-link-error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
