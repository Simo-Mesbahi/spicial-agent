import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Demander un essai accompagné',
  description:
    'Préparez un essai accompagné de SAV SC Assistant AI et découvrez les parcours de démonstration sur données fictives.',
  robots: { index: false, follow: true },
};

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
            <h2 id="trial-contact-title">Canal de réception à confirmer avant publication</h2>
            <p style={{ color: 'var(--showcase-muted)', lineHeight: 1.7 }}>
              L’adresse communiquée pour cette vitrine contient le domaine « outloo.com ». Pour
              éviter toute redirection vers une adresse non validée, aucun bouton d’envoi n’est
              activé dans cette branche tant que l’adresse finale n’a pas été confirmée explicitement.
            </p>
            <p className="showcase-note">
              Cette limitation est volontaire : la page ne prétend pas qu’un message est envoyé
              lorsqu’aucun canal de réception n’est encore validé.
            </p>
          </section>
        </div>

        <div className="showcase-actions" style={{ marginTop: 36 }}>
          <Link className="showcase-button accent" href="/demo">Découvrir d’abord la démonstration</Link>
          <Link className="showcase-button" href="/">Retour à la vitrine</Link>
        </div>
      </main>
    </div>
  );
}
