import type { Metadata } from 'next';
import './admin.css';

export const metadata: Metadata = {
  title: 'Administration · SAV SC Assistant AI',
  description: 'Espace sécurisé de pilotage SAV et service client.',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
