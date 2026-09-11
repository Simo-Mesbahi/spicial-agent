import Link from 'next/link';
import { ContactPage } from '@/components/atlas/contact-page';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Nous contacter · SAV SC Assistant AI' };
export default function ContactRoute() {
  return <div className="customer-contact-route">
    <header className="customer-contact-nav"><Link href="/">SAV SC Assistant AI</Link><nav aria-label="Services"><Link href="/file">Mon suivi</Link><Link href="/">Accueil</Link></nav></header>
    <main><ContactPage /></main>
  </div>;
}
