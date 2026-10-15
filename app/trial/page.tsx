import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, ArrowRight, ArrowUpRight, Mail } from '@/components/atlas/showcase-icons';
import { CONTACT_RECIPIENT } from '@/lib/atlas/contact';
import { ShowcaseBrand } from '@/components/atlas/showcase-brand';
import { CopyCommercialEmail } from '@/components/atlas/copy-commercial-email';

export const metadata: Metadata = {
  title: 'Demander un essai accompagné',
  description:
    'Présentez vos parcours SAV et service client pour préparer un essai de l’assistant et de l’administration, adapté à votre entreprise.',
  robots: { index: false, follow: true },
};

const CONTACT_SUBJECT = 'Demande d’essai accompagné — SAV SC Assistant AI';
const CONTACT_BODY = `Bonjour,\n\nJe souhaite organiser un essai accompagné de SAV SC Assistant AI.\n\nEntreprise / activité :\n[Votre contexte]\n\nParcours à explorer :\n[SAV, devis, livraison, retour, réclamation…]\n\nObjectifs et outils actuels :\n[Vos besoins, vos systèmes et le niveau de personnalisation souhaité]\n\nDisponibilités :\n[Vos créneaux si utile]\n\nMerci.`;
const CONTACT_HREF = `mailto:${CONTACT_RECIPIENT}?subject=${encodeURIComponent(CONTACT_SUBJECT)}&body=${encodeURIComponent(CONTACT_BODY)}`;

export default function TrialRequestPage() {
  return (
    <div className="showcase">
      <a className="showcase-skip" href="#trial-main">
        Aller au contenu
      </a>
      <header className="showcase-container showcase-nav">
        <ShowcaseBrand />
        <nav className="showcase-nav-links" aria-label="Navigation essai">
          <Link href="/">La plateforme</Link>
          <Link href="/demo">Démonstration</Link>
          <Link href="/file">Suivi client</Link>
        </nav>
      </header>
      <main id="trial-main" className="showcase-container showcase-trial-main" tabIndex={-1}>
        <div className="showcase-section-head">
          <div>
            <span className="showcase-kicker">VOTRE CONTEXTE, NOTRE POINT DE DÉPART</span>
            <h1>
              Préparons une
              <br />
              <span>démonstration utile.</span>
            </h1>
          </div>
          <p>
            Explorons l’assistant et l’administration à partir de vos besoins : parcours client,
            documents, identité visuelle et systèmes à connecter.
          </p>
        </div>
        <div className="showcase-trial-grid">
          <section className="showcase-trial-card" aria-labelledby="trial-next-title">
            <span className="showcase-number-label">UN ÉCHANGE CONCRET</span>
            <h2 id="trial-next-title">Ce que nous préparons ensemble.</h2>
            <p>Une découverte du produit et un périmètre clair pour la suite de votre projet.</p>
            <ol className="showcase-setup-steps">
              <li>
                <span>01</span>
                <h3>Vos usages prioritaires</h3>
                <p>
                  SAV, devis, livraison, retour ou réclamation : choisissez les situations qui
                  comptent pour vos équipes.
                </p>
              </li>
              <li>
                <span>02</span>
                <h3>Un parcours de démonstration</h3>
                <p>
                  Découvrez l’expérience client et l’administration sur des données fictives, avec
                  leurs possibilités et leurs limites.
                </p>
              </li>
              <li>
                <span>03</span>
                <h3>Une mise en place cadrée</h3>
                <p>
                  Identifions les documents, la personnalisation et les connexions à prévoir avant
                  validation sur vos données de test.
                </p>
              </li>
            </ol>
          </section>
          <section className="showcase-trial-card" aria-labelledby="trial-contact-title">
            <span className="showcase-number-label">PARLONS DE VOTRE PROJET</span>
            <h2 id="trial-contact-title">Contact commercial confirmé</h2>
            <p>
              Présentez votre activité et ce que vous souhaitez explorer. Le message prérempli vous
              aide à préparer les éléments utiles.
            </p>
            <strong className="showcase-trial-contact">{CONTACT_RECIPIENT}</strong>
            <a className="showcase-button accent" href={CONTACT_HREF}>
              <Mail size={17} aria-hidden="true" />
              Préparer ma demande par email
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
            <p className="showcase-note">
              Votre messagerie s’ouvre avec un message modifiable. Vous choisissez de l’envoyer :
              rien n’est envoyé automatiquement par la vitrine.
            </p>
            <CopyCommercialEmail />
          </section>
        </div>
        <div className="showcase-trial-bottom">
          <Link className="showcase-text-link" href="/">
            <ArrowLeft size={16} aria-hidden="true" />
            Retour à la vitrine
          </Link>
          <Link className="showcase-text-link" href="/demo">
            Explorer d’abord la démonstration
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </main>
    </div>
  );
}
