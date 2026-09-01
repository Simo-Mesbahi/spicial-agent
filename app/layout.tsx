import type { Metadata } from 'next';
import './globals.css';
import './experience.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://atlas-sav-sc-ai.mohammed-elmesbahi.chatgpt.site'),
  title: 'SAV SC Assistant AI',
  description:
    'Moins de flou. Plus de réponses. Essayez SAV SC Assistant AI, une expérience SAV et service client fondée sur des dossiers fictifs qui évoluent.',
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    title: 'SAV SC Assistant AI',
    description:
      'Votre SAV, en clair. Essayez le suivi de réparation, les devis et le service client avec des dossiers fictifs.',
    images: [
      {
        url: '/og.png',
        width: 1731,
        height: 909,
        alt: 'SAV SC Assistant AI. Votre SAV, en clair. Démonstration interactive.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SAV SC Assistant AI',
    description: 'Votre SAV, en clair. Démonstration interactive avec des dossiers fictifs.',
    images: ['/og.png'],
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
