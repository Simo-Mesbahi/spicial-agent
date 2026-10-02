import type { Metadata } from 'next';
import './globals.css';
import './experience.css';
import './showcase.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://atlas-sav-sc-ai.mohammed-elmesbahi.chatgpt.site'),
  title: {
    default: 'SAV SC Assistant AI',
    template: '%s · SAV SC Assistant AI',
  },
  description:
    'SAV SC Assistant AI aide à suivre les dossiers SAV, répondre aux demandes de service client à partir d’informations contrôlées et orienter vers un humain lorsque nécessaire.',
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    title: 'SAV SC Assistant AI',
    description:
      'Découvrez une plateforme SAV et service client conçue pour rendre le suivi plus clair, démontrer ses parcours sur données fictives et préparer un essai accompagné.',
    images: [
      {
        url: '/og.png',
        width: 1731,
        height: 909,
        alt: 'SAV SC Assistant AI — plateforme SAV et service client',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SAV SC Assistant AI',
    description:
      'Plateforme SAV et service client : suivi de dossier, réponses fondées sur les informations disponibles et démonstration sur données fictives.',
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
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
