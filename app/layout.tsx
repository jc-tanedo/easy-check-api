import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'EasyCheck — RFID account balances',
    description: 'View balances for RFID accounts linked to your DriveHub account.',
    robots: { index: false, follow: false },
};

interface RootLayoutProps {
    children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
