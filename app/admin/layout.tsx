import type { Metadata } from 'next';
import AdminNavigation from './admin-navigation';
import AdminSessionGuard from './admin-session-guard';
import './admin-control.css';
import './admin.css';
import './admin-operations.css';

export const metadata: Metadata = {
  title: 'Administration · SAV SC Assistant AI',
  description: 'Espace sécurisé de pilotage SAV et service client.',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminSessionGuard>
      <AdminNavigation />
      {children}
    </AdminSessionGuard>
  );
}
