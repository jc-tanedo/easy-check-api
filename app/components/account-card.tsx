import { CarFront, Check, History } from 'lucide-react';
import type { AccountRecord } from '../../types/domain';
import { formatPeso } from '../../lib/shared/format';

interface AccountCardProps {
    account: AccountRecord & { balance: number | null };
    revealIds: boolean;
    onHistory: () => void;
}

export default function AccountCard({ account, revealIds, onHistory }: AccountCardProps) {
    const number = account.accountNo || '';
    const label = account.plateNo || account.conductionNo || account.name || 'Linked vehicle';
    const secondary = account.name || (typeof account.accountType === 'string' ? account.accountType : 'Toll account');

    return (
        <article className="account-card">
            <div className="account-card-top">
                <span className="vehicle-icon">
                    <CarFront size={22} />
                </span>
                <span className="rfid-badge">{account.rfidType || 'RFID'}</span>
            </div>
            <h3>{label}</h3>
            <p className="account-name">{secondary}</p>
            <div className="account-number">
                <span>ACCOUNT NO.</span>
                <strong>{revealIds ? number : number ? `•••• •••• ${number.slice(-4)}` : 'Unavailable'}</strong>
            </div>
            <div className="account-balance">
                <div>
                    <span>Current balance</span>
                    <strong>{account.balance === null ? 'Unavailable' : formatPeso(account.balance)}</strong>
                </div>
                <span className="balance-indicator">
                    <Check size={15} /> Linked
                </span>
            </div>
            <button className="button secondary transaction-button" onClick={onHistory} disabled={!account.accountNo}>
                <History size={15} /> View transactions
            </button>
        </article>
    );
}
