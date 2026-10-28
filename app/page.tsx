'use client';

import { useCallback, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSession } from './hooks/use-session';
import type { DisplayAccount } from './hooks/use-balances';
import { formatPeso } from '../lib/shared/format';
import TransactionHistory from './components/transaction-history';
import BalanceLink from './components/balance-link';
import AccountCard from './components/account-card';
import {
    ArrowDownLeft,
    ArrowRight,
    ArrowUpRight,
    CarFront,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    Clock3,
    CreditCard,
    Eye,
    EyeOff,
    Link2,
    LoaderCircle,
    LockKeyhole,
    LogOut,
    Mail,
    RefreshCw,
    Route,
    ShieldCheck,
    Wallet,
} from 'lucide-react';

function Brand() {
    return (
        <Link className="brand" href="/" aria-label="EasyCheck home">
            <span className="brand-mark">
                <Route size={22} strokeWidth={2.4} />
            </span>
            <span>
                easy<span className="brand-light">check</span>
                <span className="brand-dot">.</span>
            </span>
        </Link>
    );
}

export default function Home() {
    const {
        phase,
        session,
        signingIn,
        signingOut,
        loginError,
        balanceError,
        loading,
        data,
        accountType,
        page,
        checkedAt,
        loadBalances,
        signIn: login,
        signOut: logout,
        onExpired,
        reset,
    } = useSession();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [revealIds, setRevealIds] = useState(false);
    const [historyAccount, setHistoryAccount] = useState<DisplayAccount | null>(null);
    const [showBalanceLink, setShowBalanceLink] = useState(false);
    const expireSession = useCallback(() => {
        reset();
        setHistoryAccount(null);
        setShowBalanceLink(false);
        onExpired();
    }, [onExpired, reset]);

    async function signIn(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (await login(email, password)) setPassword('');
    }

    async function signOut(): Promise<void> {
        if (await logout()) {
            setPassword('');
            setRevealIds(false);
            setHistoryAccount(null);
            setShowBalanceLink(false);
        }
    }

    const accounts = data?.accounts || [];
    const total = accounts.reduce((sum, account) => sum + (account.balance ?? 0), 0);

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="topbar-inner">
                    <Brand />
                    {phase === 'signed-in' ? (
                        <div className="header-session">
                            <span className="connection">
                                <span /> Connected to DriveHub
                            </span>
                            <span className="header-divider" />
                            <span className="user-email" title={session?.email}>
                                {session?.email}
                            </span>
                            <button
                                className="icon-button"
                                onClick={signOut}
                                disabled={signingOut}
                                aria-label="Sign out"
                                title="Sign out"
                            >
                                {signingOut ? <LoaderCircle size={18} className="spin" /> : <LogOut size={18} />}
                            </button>
                        </div>
                    ) : (
                        <span className="header-caption">RFID balance dashboard</span>
                    )}
                </div>
            </header>

            {phase === 'checking' ? (
                <main className="initial-loading" aria-live="polite">
                    <LoaderCircle className="spin" size={28} />
                    <p>Checking session…</p>
                </main>
            ) : phase === 'signed-out' ? (
                <main className="login-layout">
                    <section className="login-intro">
                        <span className="eyebrow">
                            <span className="tiny-line" /> DRIVEHUB ACCOUNT ACCESS
                        </span>
                        <h1>
                            RFID account
                            <br />
                            <span>balances.</span>
                        </h1>
                        <p className="intro-copy">
                            Sign in to view balances for RFID accounts linked to your DriveHub account.
                        </p>
                        <div className="intro-features">
                            <div>
                                <span>
                                    <CreditCard size={20} />
                                </span>
                                <p>
                                    <strong>Linked RFID accounts</strong>
                                    <small>View your primary and other linked accounts.</small>
                                </p>
                            </div>
                            <div>
                                <span>
                                    <RefreshCw size={20} />
                                </span>
                                <p>
                                    <strong>Balance refresh</strong>
                                    <small>Request updated balances when needed.</small>
                                </p>
                            </div>
                        </div>
                        <div className="road-art" aria-hidden="true">
                            <div className="road-grid" />
                            <svg viewBox="0 0 460 150" fill="none">
                                <path
                                    d="M-10 110H112C152 110 152 40 202 40H275C325 40 315 110 365 110H480"
                                    stroke="currentColor"
                                    strokeWidth="38"
                                />
                                <path
                                    d="M-10 110H112C152 110 152 40 202 40H275C325 40 315 110 365 110H480"
                                    stroke="#b8d9b8"
                                    strokeWidth="1.5"
                                    strokeDasharray="8 10"
                                />
                            </svg>
                            <span className="road-point road-point-start">
                                <span />
                            </span>
                            <span className="road-point road-point-end">
                                <CarFront size={19} />
                            </span>
                        </div>
                    </section>
                    <section className="login-card" aria-labelledby="signin-title">
                        <div className="login-icon">
                            <LockKeyhole size={23} />
                        </div>
                        <h2 id="signin-title">Welcome to EasyCheck</h2>
                        <p className="muted">Sign in with your DriveHub account.</p>
                        <form onSubmit={signIn}>
                            <label htmlFor="email">Email address</label>
                            <div className="input-wrap">
                                <Mail size={18} />
                                <input
                                    id="email"
                                    type="email"
                                    autoComplete="username"
                                    required
                                    maxLength={320}
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    disabled={signingIn}
                                />
                            </div>
                            <label htmlFor="password">Password</label>
                            <div className="input-wrap">
                                <LockKeyhole size={18} />
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    required
                                    maxLength={1024}
                                    placeholder="Your DriveHub password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    disabled={signingIn}
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {loginError && (
                                <div className="notice error" role="alert">
                                    <CircleAlert size={18} />
                                    <span>{loginError}</span>
                                </div>
                            )}
                            <button className="button primary sign-in-button" type="submit" disabled={signingIn}>
                                {signingIn ? (
                                    <>
                                        <LoaderCircle size={18} className="spin" /> Connecting…
                                    </>
                                ) : (
                                    <>
                                        Connect my account <ArrowRight size={18} />
                                    </>
                                )}
                            </button>
                        </form>
                        <p className="login-privacy">
                            <ShieldCheck size={16} /> Your password is never saved to disk.
                        </p>
                        <div className="login-card-footer">
                            New to DriveHub?{' '}
                            <a href="https://www.mptdrivehub.com.ph/" target="_blank" rel="noreferrer">
                                Visit DriveHub <ArrowUpRight size={13} />
                            </a>
                        </div>
                    </section>
                </main>
            ) : (
                <main className="dashboard">
                    <div className="page-heading">
                        <div>
                            <span className="eyebrow">OVERVIEW</span>
                            <h1>Account balances</h1>
                            <p className="muted">View balances for your linked RFID accounts.</p>
                        </div>
                        <div className="page-actions">
                            <button
                                className="button secondary"
                                onClick={() => setShowBalanceLink(!showBalanceLink)}
                                aria-expanded={showBalanceLink}
                                aria-controls="balance-url-panel"
                            >
                                <Link2 size={16} /> Balance URL
                            </button>
                            <button
                                className="button secondary"
                                disabled={loading || signingOut}
                                onClick={() => loadBalances(accountType, page)}
                            >
                                <RefreshCw size={16} className={loading ? 'spin' : ''} />{' '}
                                {loading ? 'Refreshing…' : 'Refresh balances'}
                            </button>
                        </div>
                    </div>
                    {showBalanceLink && (
                        <BalanceLink onClose={() => setShowBalanceLink(false)} onExpired={expireSession} />
                    )}

                    <div className="overview-grid">
                        <section className="balance-summary">
                            <div className="summary-label">
                                <span>
                                    <Wallet size={18} /> BALANCE ON THIS PAGE
                                </span>
                                <ArrowDownLeft size={21} />
                            </div>
                            <div className="summary-amount">
                                {loading ? (
                                    <span className="skeleton amount-skeleton" />
                                ) : balanceError ? (
                                    '—'
                                ) : (
                                    formatPeso(total)
                                )}
                            </div>
                            <div className="summary-bottom">
                                <span>
                                    {loading
                                        ? 'Checking your accounts'
                                        : `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} displayed`}
                                </span>
                                <span className="php-label">PHP</span>
                            </div>
                            <div className="summary-decoration" aria-hidden="true" />
                        </section>
                        <section className="detail-summary">
                            <span className="stat-icon">
                                <CreditCard size={20} />
                            </span>
                            <span className="stat-label">Linked accounts</span>
                            <strong>{loading ? '—' : (data?.pagination?.count ?? accounts.length)}</strong>
                            <span className="stat-note">
                                {accountType === 'primary' ? 'Your primary accounts' : 'Your other linked accounts'}
                            </span>
                        </section>
                        <section className="detail-summary">
                            <span className="stat-icon">
                                <Clock3 size={20} />
                            </span>
                            <span className="stat-label">Last checked</span>
                            <strong className="checked-time">
                                {checkedAt
                                    ? new Intl.DateTimeFormat('en-PH', {
                                          hour: 'numeric',
                                          minute: '2-digit',
                                          timeZone: 'Asia/Manila',
                                      }).format(checkedAt)
                                    : '—'}
                            </strong>
                            <span className="stat-note">Philippine time · Refresh to update</span>
                        </section>
                    </div>

                    <section className="accounts-section" aria-labelledby="accounts-title">
                        <div className="section-top">
                            <div>
                                <h2 id="accounts-title">Your RFID accounts</h2>
                                <p className="muted">Select an account category to view its balances.</p>
                            </div>
                            <button className="text-button" onClick={() => setRevealIds(!revealIds)}>
                                {revealIds ? <EyeOff size={16} /> : <Eye size={16} />}
                                {revealIds ? 'Hide' : 'Show'} account numbers
                            </button>
                        </div>
                        <div className="accounts-toolbar">
                            <div className="tabs" role="tablist" aria-label="Account type">
                                <button
                                    role="tab"
                                    aria-selected={accountType === 'primary'}
                                    className={accountType === 'primary' ? 'active' : ''}
                                    onClick={() => loadBalances('primary', 1)}
                                >
                                    My accounts
                                </button>
                                <button
                                    role="tab"
                                    aria-selected={accountType === 'others'}
                                    className={accountType === 'others' ? 'active' : ''}
                                    onClick={() => loadBalances('others', 1)}
                                >
                                    Other accounts
                                </button>
                            </div>
                            <span className="account-count">{loading ? 'Loading…' : `${accounts.length} shown`}</span>
                        </div>

                        {balanceError ? (
                            <div className="empty-state" role="alert">
                                <CircleAlert size={28} />
                                <h3>We couldn’t load your accounts</h3>
                                <p>{balanceError}</p>
                                <button className="button secondary" onClick={() => loadBalances(accountType, page)}>
                                    Try again <RefreshCw size={15} />
                                </button>
                            </div>
                        ) : loading ? (
                            <div className="account-grid" aria-live="polite" aria-label="Loading accounts">
                                {[0, 1, 2].map((id) => (
                                    <div className="account-card skeleton-card" key={id}>
                                        <div className="skeleton" />
                                        <div className="skeleton" />
                                        <div className="skeleton" />
                                    </div>
                                ))}
                            </div>
                        ) : accounts.length === 0 ? (
                            <div className="empty-state">
                                <CreditCard size={30} />
                                <h3>No accounts here yet</h3>
                                <p>Link an RFID account in the DriveHub app, then refresh to see it here.</p>
                                <button className="button secondary" onClick={() => loadBalances(accountType, page)}>
                                    Refresh accounts <RefreshCw size={15} />
                                </button>
                            </div>
                        ) : (
                            <div className="account-grid">
                                {accounts.map((account, index) => (
                                    <AccountCard
                                        key={account.accountNo || index}
                                        account={account}
                                        revealIds={revealIds}
                                        onHistory={() => setHistoryAccount(account)}
                                    />
                                ))}
                            </div>
                        )}

                        {data?.pagination && (data.pagination.hasNext || data.pagination.hasPrevious) && (
                            <div className="pagination">
                                <span>Page {page}</span>
                                <div>
                                    <button
                                        className="button secondary compact"
                                        disabled={loading || !data.pagination.hasPrevious}
                                        onClick={() => loadBalances(accountType, page - 1)}
                                    >
                                        <ChevronLeft size={16} /> Previous
                                    </button>
                                    <button
                                        className="button secondary compact"
                                        disabled={loading || !data.pagination.hasNext}
                                        onClick={() => loadBalances(accountType, page + 1)}
                                    >
                                        Next <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                    <div className="dashboard-note">
                        <ShieldCheck size={16} />
                        <span>
                            Connected through your DriveHub account. Your connection refreshes automatically while
                            you’re signed in.
                        </span>
                    </div>
                </main>
            )}
            {phase === 'signed-in' && historyAccount && (
                <TransactionHistory
                    account={historyAccount}
                    accountType={accountType}
                    onClose={() => setHistoryAccount(null)}
                    onExpired={expireSession}
                />
            )}
            <footer className="footer">
                <span>
                    EasyCheck <span className="footer-dot">·</span> DriveHub RFID balances
                </span>
                <span>
                    Amounts in PHP <Wallet size={14} />
                </span>
            </footer>
        </div>
    );
}
