import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Demander un essai accompagné',
  description:
    'Préparez un essai accompagné de SAV SC Assistant AI et découvrez les parcours de démonstration sur données fictives.',
  robots: { index: false, follow: true },
};

const COMMERCIAL_CONTACT = 'Mohammed.elmesbahi@outlook.com';
const CONTACT_SUBJECT = 'Demande d’essai accompagné — SAV SC Assistant AI';
const CONTACT_BODY = `Bonjour,\n\nJe souhaite organiser un essai accompagné de SAV SC Assistant AI.\n\nContexte / besoin :\n[Décrivez brièvement votre activité, vos parcours SAV ou service client et ce que vous souhaitez évaluer.]\n\nDisponibilités :\n[Indiquez vos créneaux si utile.]\n\nMerci.`;
const CONTACT_HREF = `mailto:${COMMERCIAL_CONTACT}?subject=${encodeURIComponent(CONTACT_SUBJECT)}&body=${encodeURIComponent(CONTACT_BODY)}`;

export default function TrialRequestPage() {
  return (
    <div className="showcase">
      <a className="showcase-skip" href="#trial-main">Aller au contenu</a>
      <header className="showcase-container showcase-nav">
        <Link className="showcase-brand" href="/">
          <span className="showcase-brand-mark" aria-hidden="true">SC</span>
          <span>SAV SC Assistant AI</span>
        </Link>
        <nav className="showcase-nav-links" aria-label="Navigation essai">
          <Link href="/demo">Démonstration</Link>
          <Link href="/file">Suivi client</Link>
          <Link href="/">Retour à la vitrine</Link>
        </nav>
      </header>

      <main id="trial-main" className="showcase-container showcase-section">
        <div className="showcase-section-head">
          <div>
            <span className="showcase-kicker">ESSAI ACCOMPAGNÉ</span>
            <h1 style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}>Préparons une démonstration utile.</h1>
          </div>
          <p>
            L’objectif est de partir de votre contexte : parcours SAV ou service client, identité,
            règles métier, données à connecter et niveau de personnalisation attendu.
          </p>
        </div>

        <div className="showcase-audiences">
          <section className="showcase-audience" aria-labelledby="trial-next-title">
            <small>COMMENT ÇA SE PASSE</small>
            <h2 id="trial-next-title">Après votre demande</h2>
            <ul>
              <li>Nous clarifions le contexte et les objectifs de l’essai.</li>
              <li>Nous choisissons les scénarios fictifs les plus représentatifs.</li>
              <li>Nous distinguons ce qui est déjà démontré de ce qui nécessiterait une intégration.</li>
              <li>Nous définissons les prochaines étapes sans activer de capacité non qualifiée.</li>
            </ul>
          </section>

          <section className="showcase-audience" aria-labelledby="trial-contact-title">
            <small>CONTACT</small>
            <h2 id="trial-contact-title">Contact commercial confirmé</h2>
            <p style={{ color: 'var(--showcase-muted)', lineHeight: 1.7 }}>
              Utilisez votre messagerie pour préparer une demande d’essai à{' '}
              <strong>{COMMERCIAL_CONTACT}</strong>. Le message reste sous votre contrôle : rien
              n’est envoyé automatiquement par la vitrine.
            </p>
            <a className="showcase-button accent" href={CONTACT_HREF}>
              Préparer ma demande par email
            </a>
            <p className="showcase-note">
              Votre application de messagerie s’ouvre avec un objet et un message préremplis ; vous
              pouvez les modifier avant l’envoi.
            </p>
          </section>
        </div>

        <div className="showcase-actions" style={{ marginTop: 36 }}>
          <Link className="showcase-button" href="/demo">Découvrir d’abord la démonstration</Link>
          <Link className="showcase-button" href="/">Retour à la vitrine</Link>
        </div>
      </main>
    </div>
  );
}
