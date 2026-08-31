import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AtlasCare AI',
  description:
    'Le service client, en toute clarté. Plateforme de démonstration SAV, assistant et simulation métier.',
  other: {
    'codex-preview': 'development',
  },
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
