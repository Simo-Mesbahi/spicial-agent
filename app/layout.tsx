import type { Metadata } from 'next';
import './globals.css';
import './experience.css';

export const metadata: Metadata = {
  title: 'AtlasCare AI',
  description:
    'Moins de flou. Plus de réponses. Essayez AtlasCare : un assistant SAV et service client connecté à des dossiers fictifs qui évoluent.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
