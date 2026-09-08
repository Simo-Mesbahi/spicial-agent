import type { Metadata } from 'next';
import { Activity } from 'lucide-react';
import './admin.css';
import './admin-operations.css';

export const metadata: Metadata = {
  title: 'Administration · SAV SC Assistant AI',
  description: 'Espace sécurisé de pilotage SAV et service client.',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <a className="admin-operations-launcher" href="/admin/operations" aria-label="Ouvrir le centre opérationnel">
        <Activity size={16} /> Centre opérationnel
      </a>
    </>
  );
}
