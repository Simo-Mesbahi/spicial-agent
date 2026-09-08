import type { Metadata } from 'next';
import './suivi.css';

export const metadata: Metadata = {
  title: 'Suivre mon dossier · SAV SC Assistant AI',
  description: 'Consultez votre dossier SAV ou service client avec votre référence et votre code.',
  robots: { index: false, follow: false },
};

export default function TrackingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
