'use client';

import { useEffect, useRef } from 'react';
import { useTransactions } from '../hooks/use-transactions';
import { formatPeso, parseAmount } from '../../lib/shared/format';
import type { AccountRecord, AccountType, TransactionRecord } from '../../types/domain';
import { CircleAlert, History, LoaderCircle, RefreshCw, X } from 'lucide-react';

const calendarDate = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
});
const clockTime = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
});

interface TransactionHistoryProps {
    account: AccountRecord;
    accountType: AccountType;
    onClose: () => void;
    onExpired: () => void;
}

export default function TransactionHistory({ account, accountType, onClose, onExpired }: TransactionHistoryProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const { loading, error, transactions, refreshHistory } = useTransactions(account.accountNo, accountType, onExpired);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        return () => element.close();
    }, []);

    return (
        <dialog
            className="history-dialog"
            ref={dialog}
            aria-labelledby="history-title"
            onCancel={onClose}
            onClick={(event) => {
                if (event.target === dialog.current) onClose();
            }}
        >
            <div className="history-content">
                <header className="history-header">
                    <div>
                        <h2 id="history-title">Transaction history</h2>
                        <p>
                            {account.plateNo || account.conductionNo || account.name || 'RFID account'} · Account ending{' '}
                            {String(account.accountNo).slice(-4)}
                        </p>
                    </div>
                    <button className="icon-button" onClick={onClose} aria-label="Close transaction history">
                        <X size={19} />
                    </button>
                </header>
                <div className="history-body">
                    {loading ? (
                        <div className="history-state" role="status">
                            <LoaderCircle className="spin" size={25} />
                            <p>Loading transactions…</p>
                        </div>
                    ) : error ? (
                        <div className="history-state" role="alert">
                            <CircleAlert size={26} />
                            <p>{error}</p>
                            <button className="button secondary" onClick={refreshHistory}>
                                Try again <RefreshCw size={15} />
                            </button>
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="history-state">
                            <History size={28} />
                            <h3>No transactions returned</h3>
                            <p>DriveHub returned no transaction records for this account.</p>
                        </div>
                    ) : (
                        <TransactionTimeline transactions={transactions} />
                    )}
                </div>
                <footer className="history-footer">
                    <span>
                        {loading
                            ? 'Requesting records from DriveHub'
                            : error
                              ? 'Transaction history unavailable'
                              : `${transactions.length} ${transactions.length === 1 ? 'record' : 'records'} returned by DriveHub`}
                    </span>
                    <button className="button secondary compact" onClick={refreshHistory} disabled={loading}>
                        <RefreshCw size={14} /> Refresh
                    </button>
                </footer>
            </div>
        </dialog>
    );
}

function TransactionTimeline({ transactions }: { transactions: TransactionRecord[] }) {
    return (
        <ol className="transaction-timeline" aria-label="Transactions">
            {transactions.map((transaction, index) => {
                const amount = parseAmount(transaction.amount);
                const value = String(transaction.date || '').trim();
                // DriveHub already supplies Philippine wall-clock time. Preserve its
                // date/time fields even when a timezone suffix is present.
                const wallClock = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(
                    value,
                );
                const localFields = wallClock ? `${wallClock[1]}T${wallClock[2]}` : null;
                const date = localFields ? new Date(`${localFields}Z`) : null;
                const validDate =
                    date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === localFields;
                const type = typeof transaction.type === 'string' ? transaction.type.trim().toLowerCase() : '';
                const kind =
                    type === 'passage' ? 'passage' : ['reload', 'reloaded'].includes(type) ? 'reload' : 'unknown';
                return (
                    <li
                        className="transaction-item"
                        data-transaction-kind={kind}
                        key={`${transaction.referenceNo || 'transaction'}-${index}`}
                    >
                        <time
                            className="transaction-date"
                            dateTime={validDate ? `${localFields}+08:00` : value || undefined}
                        >
                            <strong>
                                {validDate ? calendarDate.format(date) : value.replace('T', ' ') || 'Unavailable'}
                            </strong>
                            {validDate && <span>{clockTime.format(date)}</span>}
                        </time>
                        <span className="timeline-marker" aria-hidden="true">
                            <span />
                        </span>
                        <div className="transaction-details">
                            <div className="transaction-heading">
                                <strong className="transaction-amount">
                                    {amount === null ? 'Unavailable' : formatPeso(amount)}
                                </strong>
                                <span className="transaction-type">{transaction.type || 'Type unavailable'}</span>
                            </div>
                            <p className="transaction-description">
                                {transaction.description || 'No description provided'}
                            </p>
                            <dl className="transaction-metadata">
                                <div>
                                    <dt>Plate</dt>
                                    <dd>{transaction.plate || '—'}</dd>
                                </div>
                                <div>
                                    <dt>Reference</dt>
                                    <dd className="transaction-reference">{transaction.referenceNo || '—'}</dd>
                                </div>
                            </dl>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
