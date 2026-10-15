import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  FileCheck2,
  Headphones,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Wrench,
} from '@/components/atlas/showcase-icons';
import { ShowcaseBrand } from '@/components/atlas/showcase-brand';

export const metadata: Metadata = {
  title: 'Assistant IA SAV et service client',
  description:
    'Un assistant IA pour expliquer le suivi client, une administration pour piloter les dossiers et une expérience personnalisable à votre entreprise. Démonstration sur données fictives.',
};

const scenarios = [
  {
    id: 'repair',
    label: 'Réparation',
    icon: Wrench,
    title: 'Expliquer où en est la réparation.',
    description: 'Le client retrouve l’état enregistré et comprend ce qui doit arriver ensuite.',
    question: 'Ma réparation avance ? Et quelle est la suite ?',
    answer:
      'Votre dossier est en attente de pièce. La réparation pourra reprendre après sa réception et la confirmation de l’atelier. Aucune date de réception n’est confirmée.',
    status: 'En attente de pièce',
    next: 'Réparation, après réception et validation',
    boundary: 'Une étape prévue reste distincte d’une étape réalisée.',
  },
  {
    id: 'quote',
    label: 'Devis',
    icon: FileCheck2,
    title: 'Rendre la décision plus simple.',
    description:
      'L’assistant explique le devis disponible et les choix prévus par votre procédure.',
    question: 'Est-ce que la réparation a déjà commencé ?',
    answer:
      'Le dossier indique qu’un devis attend votre décision. La réparation n’est pas indiquée comme commencée. Consultez le montant et les conditions du devis avant de vous prononcer.',
    status: 'Devis à consulter',
    next: 'Décision du client selon le parcours prévu',
    boundary: 'Expliquer un choix ne vaut pas acceptation du devis.',
  },
  {
    id: 'delivery',
    label: 'Livraison',
    icon: Truck,
    title: 'Clarifier une livraison incomplète.',
    description: 'Le suivi distingue ce qui a été reçu des éléments encore à vérifier.',
    question: 'J’ai reçu mon colis, mais il manque un accessoire.',
    answer:
      'La livraison enregistrée ne confirme pas que tous les articles ont été reçus. Précisez l’accessoire manquant pour préparer la vérification avec le service client. Aucun nouvel envoi n’est confirmé.',
    status: 'Livraison partielle à vérifier',
    next: 'Vérification des éléments manquants',
    boundary: 'Une expédition ou une prise en charge n’est jamais inventée.',
  },
  {
    id: 'return',
    label: 'Retour',
    icon: RotateCcw,
    title: 'Distinguer retour et remboursement.',
    description: 'Chaque étape est expliquée à partir du dossier et de vos règles de retour.',
    question: 'J’ai renvoyé le produit. Mon remboursement est fait ?',
    answer:
      'L’envoi du retour ne confirme pas un remboursement. La réception du produit, son contrôle et la décision de remboursement doivent être vérifiés dans le dossier.',
    status: 'Retour envoyé par le client',
    next: 'Réception et contrôle à confirmer',
    boundary: 'Aucun montant ni délai de remboursement n’est promis sans preuve.',
  },
];

const faq = [
  {
    q: 'Que puis-je essayer dès maintenant ?',
    a: 'La démonstration permet d’explorer le suivi et la conversation sur des dossiers fictifs. Elle est séparée des dossiers réels. Les aperçus de cette page illustrent le produit ; aucun envoi, remboursement ou changement de dossier n’y est exécuté.',
  },
  {
    q: 'Que peut faire mon équipe dans l’administration ?',
    a: 'Selon ses droits, elle peut créer et corriger des dossiers, gérer leur statut et leur historique, tenir les fiches clients, produits et magasins, publier des procédures et consulter des rapports exportables. L’accès à l’administration est protégé et distinct de la démonstration publique.',
  },
  {
    q: 'L’assistant peut-il reprendre mes procédures et ma marque ?',
    a: 'Oui. Le projet peut couvrir votre identité visuelle, le vocabulaire, les documents de référence et les étapes de vos parcours. Vos règles sont examinées avec vous avant publication. Le périmètre de personnalisation et les connexions sont définis avant l’implémentation.',
  },
  {
    q: 'Comment se passe le relais vers un conseiller ?',
    a: 'L’assistant peut signaler le besoin d’une intervention humaine et aider à conserver le contexte. Le contact et la prise en charge dépendent de l’organisation et des canaux raccordés. Un conseiller n’est pas présenté comme contacté tant que le transfert n’est pas confirmé.',
  },
  {
    q: 'Quand peut-on l’ouvrir à nos vrais clients ?',
    a: 'Après validation de vos règles, des connexions, des accès et des parcours sur vos données de test. Les fonctions IA avancées restent soumises à qualification, revue humaine et ouverture contrôlée. La démonstration publique ne vaut pas autorisation de mise en production.',
  },
  {
    q: 'Quel est le périmètre et le coût d’une mise en place ?',
    a: 'Ils dépendent des parcours, de la personnalisation et des systèmes à connecter. L’essai accompagné sert à préciser vos besoins et à définir une proposition adaptée. Aucun tarif, délai d’intégration ou connecteur actif n’est annoncé sans validation du périmètre.',
  },
];

function ProductCapture({ kind }: { kind: 'client' | 'admin' }) {
  const client = kind === 'client';
  const src = client ? '/showcase/client-workspace.png' : '/showcase/admin-reports.png';
  return (
    <figure className="showcase-product-capture">
      <div className="showcase-window-bar">
        <span className="showcase-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{client ? 'Espace client' : 'Administration · Rapports'}</span>
        <LockKeyhole size={13} aria-hidden="true" />
      </div>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Agrandir la capture ${client ? 'de l’espace client' : 'de l’administration'} (nouvel onglet)`}
      >
        {/* Exact product captures; dimensions reserve space before lazy loading. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          width="1440"
          height={client ? '1137' : '1308'}
          loading="lazy"
          decoding="async"
          alt={
            client
              ? 'Capture de l’assistant : réponse, tableau des étapes et contexte du dossier fictif.'
              : 'Capture de l’administration : rapport d’activité, états des dossiers et export CSV ou PDF sur données fictives.'
          }
        />
        <span className="showcase-capture-zoom">
          Agrandir <ArrowUpRight size={15} aria-hidden="true" />
        </span>
      </a>
      <figcaption>Capture du produit · données fictives</figcaption>
    </figure>
  );
}

export default function PublicShowcasePage() {
  return (
    <div className="showcase showcase-home">
      <a className="showcase-skip" href="#main-content">
        Aller au contenu
      </a>
      <header className="showcase-container showcase-nav">
        <ShowcaseBrand />
        <nav className="showcase-nav-links" aria-label="Navigation principale">
          <a href="#produit">Le produit</a>
          <a href="#parcours">Cas d’usage</a>
          <a href="#personnalisation">Votre marque</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link className="showcase-nav-cta" href="/trial">
          Parlons de votre projet <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="showcase-container showcase-hero" aria-labelledby="showcase-title">
          <div className="showcase-hero-copy">
            <span className="showcase-kicker">ASSISTANT IA · SAV & SERVICE CLIENT</span>
            <h1 id="showcase-title">
              Un SAV plus clair.
              <br />
              Pour vos clients.
              <br />
              <span>Pour vos équipes.</span>
            </h1>
            <p className="showcase-lead">
              Un assistant qui explique le suivi. Une administration qui garde la main. Vos dossiers
              et vos procédures, dans une expérience à votre marque.
            </p>
            <div className="showcase-actions">
              <Link className="showcase-button accent" href="/demo">
                Explorer la démonstration <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link className="showcase-button" href="/trial">
                Demander un essai accompagné
              </Link>
            </div>
            <p className="showcase-note">
              Démonstration sur données fictives. Ouverture réelle après validation de vos règles et
              connexions.
            </p>
            <Link className="showcase-client-access" href="/file">
              Déjà une référence et un code ?{' '}
              <strong>
                Accéder à votre dossier <ArrowUpRight size={14} aria-hidden="true" />
              </strong>
            </Link>
          </div>
          <div
            className="showcase-hero-visual"
            aria-label="Aperçu illustratif de l’assistant sur un dossier fictif"
          >
            <div className="showcase-visual-caption">
              <span className="showcase-mini-dot" /> LE DOSSIER DONNE LE CONTEXTE. L’ASSISTANT
              L’EXPLIQUE.
            </div>
            <div className="showcase-assistant-window">
              <div className="showcase-assistant-header">
                <span className="showcase-assistant-avatar">
                  <Sparkles size={20} aria-hidden="true" />
                </span>
                <div>
                  <strong>Votre assistant SAV</strong>
                  <span>Le bon contexte, à chaque échange.</span>
                </div>
                <span className="showcase-illustration-tag">Aperçu fictif</span>
              </div>
              <div className="showcase-hero-conversation">
                <p className="showcase-bubble-user">Où en est ma réparation ?</p>
                <div className="showcase-bubble-ai">
                  <span className="showcase-response-label">
                    <Sparkles size={13} aria-hidden="true" /> LE DOSSIER EN CLAIR
                  </span>
                  <p>
                    Le diagnostic est terminé.
                    <br />
                    <strong>Une pièce est attendue</strong> avant de reprendre la réparation.
                  </p>
                  <div className="showcase-evidence-row">
                    <Check size={14} aria-hidden="true" /> État enregistré dans le dossier fictif
                  </div>
                </div>
                <div className="showcase-next-step">
                  <span>LA SUITE PRÉVUE</span>
                  <strong>
                    Reprendre la réparation <ArrowRight size={16} aria-hidden="true" />
                  </strong>
                  <small>Après réception de la pièce et confirmation de l’atelier.</small>
                </div>
                <p className="showcase-no-date">
                  <ShieldCheck size={14} aria-hidden="true" /> Aucun délai confirmé n’est
                  enregistré.
                </p>
              </div>
              <div className="showcase-visual-composer" aria-hidden="true">
                <span>Et maintenant, quelle est la suite ?</span>
                <span>
                  <ArrowRight size={17} />
                </span>
              </div>
            </div>
            <div className="showcase-context-card">
              <span className="showcase-context-icon">
                <BookOpen size={18} aria-hidden="true" />
              </span>
              <div>
                <strong>Vos procédures, son point d’appui.</strong>
                <span>Des réponses guidées par le dossier et les contenus publiés.</span>
              </div>
            </div>
          </div>
        </section>

        <div
          className="showcase-container showcase-value-strip"
          aria-label="Les trois piliers du produit"
        >
          <div>
            <MessageSquareText size={22} aria-hidden="true" />
            <span>
              <strong>Clair pour le client</strong>
              <small>L’état, le contexte, la prochaine étape.</small>
            </span>
          </div>
          <div>
            <SlidersHorizontal size={22} aria-hidden="true" />
            <span>
              <strong>Pilotable par vos équipes</strong>
              <small>Dossiers, procédures et rapports.</small>
            </span>
          </div>
          <div>
            <Layers3 size={22} aria-hidden="true" />
            <span>
              <strong>Adaptable à votre entreprise</strong>
              <small>Votre marque et vos règles métier.</small>
            </span>
          </div>
        </div>

        <section
          className="showcase-container showcase-section"
          id="produit"
          aria-labelledby="product-title"
        >
          <div className="showcase-section-head">
            <div>
              <span className="showcase-kicker">LE PRODUIT, EN SITUATION</span>
              <h2 id="product-title">
                Deux espaces.
                <br />
                <span>Un même fil conducteur.</span>
              </h2>
            </div>
            <p>
              Le client comprend sa situation. Votre équipe tient les informations à jour et choisit
              les procédures qui guident les réponses.
            </p>
          </div>
          <article className="showcase-product-row">
            <div className="showcase-product-copy">
              <span className="showcase-number-label">01 / CÔTÉ CLIENT</span>
              <h3>
                Une question.
                <br />
                Une situation plus claire.
              </h3>
              <p>
                Un échange qui garde le contexte du dossier et explique les étapes sans faire
                répéter tout l’historique.
              </p>
              <ul className="showcase-check-list">
                <li>
                  <Check aria-hidden="true" />
                  État actuel et prochaine étape expliqués
                </li>
                <li>
                  <Check aria-hidden="true" />
                  Réponses appuyées sur les informations disponibles
                </li>
                <li>
                  <Check aria-hidden="true" />
                  Besoin de conseiller clairement signalé
                </li>
              </ul>
              <Link className="showcase-text-link" href="/demo">
                Essayer le parcours client <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <ProductCapture kind="client" />
          </article>
          <article className="showcase-product-row showcase-product-row-admin">
            <div className="showcase-product-copy">
              <span className="showcase-number-label">02 / CÔTÉ ADMINISTRATION</span>
              <h3>
                Votre activité.
                <br />
                Vos décisions.
              </h3>
              <p>
                Un espace protégé pour travailler sur les dossiers et garder la maîtrise des
                informations, selon les droits de chaque rôle.
              </p>
              <ul className="showcase-check-list">
                <li>
                  <Check aria-hidden="true" />
                  Création, corrections et historique des dossiers
                </li>
                <li>
                  <Check aria-hidden="true" />
                  Fiches clients, produits et magasins
                </li>
                <li>
                  <Check aria-hidden="true" />
                  Procédures publiées et rapports exportables
                </li>
              </ul>
              <Link className="showcase-text-link" href="/trial">
                Découvrir l’administration lors d’un essai{' '}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <ProductCapture kind="admin" />
          </article>
        </section>

        <section className="showcase-usecases" id="parcours" aria-labelledby="journey-title">
          <div className="showcase-container">
            <div className="showcase-section-head">
              <div>
                <span className="showcase-kicker">VOS DEMANDES DU QUOTIDIEN</span>
                <h2 id="journey-title">
                  Du dossier
                  <br />
                  <span>à la prochaine étape.</span>
                </h2>
              </div>
              <p>
                Quatre exemples pour voir comment l’assistant explique une situation. Les réponses
                ci-dessous sont illustratives et utilisent des données fictives.
              </p>
            </div>
            <fieldset className="showcase-scenarios">
              <legend className="showcase-sr-only">Choisir un exemple de parcours</legend>
              <div className="showcase-scenario-options">
                {scenarios.map(({ id, label, icon: Icon }, i) => (
                  <label key={id} className="showcase-scenario-option">
                    <input
                      type="radio"
                      name="showcase-scenario"
                      id={`scenario-${id}`}
                      value={id}
                      defaultChecked={i === 0}
                      aria-controls={`example-${id}`}
                    />
                    <span>
                      <Icon size={18} aria-hidden="true" />
                      {label}
                    </span>
                  </label>
                ))}
              </div>
              {scenarios.map(
                ({ id, label, title, description, question, answer, status, next, boundary }) => (
                  <div
                    key={id}
                    id={`example-${id}`}
                    className={`showcase-scenario-panel scenario-${id}`}
                    role="region"
                    aria-label={`Exemple ${label.toLowerCase()}`}
                  >
                    <div className="showcase-scenario-story">
                      <span className="showcase-number-label">UNE SITUATION CONCRÈTE</span>
                      <h3>{title}</h3>
                      <p>{description}</p>
                      <div className="showcase-scenario-facts">
                        <div>
                          <span>Situation de l’exemple</span>
                          <strong>{status}</strong>
                        </div>
                        <div>
                          <span>Prochaine étape</span>
                          <strong>{next}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="showcase-scenario-dialog">
                      <p className="showcase-bubble-user">{question}</p>
                      <div className="showcase-bubble-ai">
                        <span className="showcase-response-label">
                          <Sparkles size={13} aria-hidden="true" /> L’ASSISTANT EXPLIQUE
                        </span>
                        <p>{answer}</p>
                      </div>
                      <p className="showcase-scenario-boundary">
                        <ShieldCheck size={17} aria-hidden="true" />
                        {boundary}
                      </p>
                    </div>
                  </div>
                ),
              )}
            </fieldset>
            <div className="showcase-usecases-bottom">
              <span>Explorez ensuite le produit dans la démonstration interactive.</span>
              <Link className="showcase-text-link" href="/demo">
                Ouvrir la démonstration <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section
          className="showcase-container showcase-section"
          id="personnalisation"
          aria-labelledby="custom-title"
        >
          <div className="showcase-section-head">
            <div>
              <span className="showcase-kicker">VOTRE MARQUE. VOS MÉTHODES.</span>
              <h2 id="custom-title">
                L’expérience s’adapte
                <br />
                <span>à votre entreprise.</span>
              </h2>
            </div>
            <p>
              La personnalisation se prépare avec vous : ce que voit le client, les informations
              utilisées et les parcours propres à votre activité.
            </p>
          </div>
          <div className="showcase-custom-grid">
            <article className="showcase-brand-card">
              <div className="showcase-brand-sample" aria-hidden="true">
                <span className="showcase-sample-logo">
                  <Sparkles size={19} /> Votre marque
                </span>
                <div className="showcase-sample-bubble">Bonjour, comment puis-je vous aider ?</div>
                <div className="showcase-brand-palette">
                  <i />
                  <i />
                  <i />
                  <i />
                  <span>Votre identité, jusque dans l’échange.</span>
                </div>
              </div>
              <div>
                <span className="showcase-number-label">IDENTITÉ & EXPÉRIENCE</span>
                <h3>Votre univers, dès le premier échange.</h3>
                <p>
                  Couleurs, vocabulaire et présentation définis pour votre marque et vos clients.
                </p>
              </div>
            </article>
            <article className="showcase-custom-card">
              <BookOpen size={25} aria-hidden="true" />
              <h3>Vos connaissances</h3>
              <p>
                Documents, procédures et règles métier examinés, organisés et publiés pour guider
                les réponses.
              </p>
              <span>Un contenu que votre équipe peut faire évoluer.</span>
            </article>
            <article className="showcase-custom-card">
              <Layers3 size={25} aria-hidden="true" />
              <h3>Vos parcours</h3>
              <p>
                Étapes, décisions et points de contact définis selon votre organisation et les
                systèmes à raccorder.
              </p>
              <span>Chaque connexion est cadrée et vérifiée.</span>
            </article>
          </div>
        </section>

        <section
          className="showcase-container showcase-confidence"
          aria-labelledby="confidence-title"
        >
          <div className="showcase-confidence-intro">
            <span className="showcase-kicker">LA CONFIANCE SE CONSTRUIT DANS LES DÉTAILS</span>
            <h2 id="confidence-title">
              Utile quand il sait.
              <br />
              <em>Clair quand il faut vérifier.</em>
            </h2>
            <p>
              Les faits du dossier, les règles de l’entreprise et les décisions humaines gardent
              chacun leur place.
            </p>
            <span className="showcase-confidence-note">
              Démonstration fictive disponible.
              <br />
              Usage réel soumis à validation et ouverture contrôlée.
            </span>
          </div>
          <div className="showcase-confidence-points">
            <div>
              <FileCheck2 aria-hidden="true" />
              <span>
                <h3>Des informations étayées</h3>
                <p>
                  Les réponses s’appuient sur le dossier et les procédures disponibles. Une
                  information manquante est signalée.
                </p>
              </span>
            </div>
            <div>
              <LockKeyhole aria-hidden="true" />
              <span>
                <h3>Des accès encadrés</h3>
                <p>
                  Suivi client et administration sont séparés, avec des droits et des actions
                  contrôlés.
                </p>
              </span>
            </div>
            <div>
              <Headphones aria-hidden="true" />
              <span>
                <h3>Une place pour le conseiller</h3>
                <p>
                  Le besoin d’intervention est explicite. La prise en charge est confirmée
                  uniquement si le relais a réellement abouti.
                </p>
              </span>
            </div>
          </div>
        </section>

        <section
          className="showcase-container showcase-section"
          id="mise-en-place"
          aria-labelledby="setup-title"
        >
          <div className="showcase-section-head">
            <div>
              <span className="showcase-kicker">UNE MISE EN PLACE ACCOMPAGNÉE</span>
              <h2 id="setup-title">
                Du premier essai
                <br />
                <span>à votre contexte métier.</span>
              </h2>
            </div>
            <p>
              Nous définissons ensemble le périmètre, les connexions et les validations nécessaires
              avant toute ouverture à vos clients.
            </p>
          </div>
          <ol className="showcase-setup-steps">
            <li>
              <span>01</span>
              <h3>Explorer le produit</h3>
              <p>
                Parcourez la démonstration fictive et identifiez les usages utiles à votre activité.
              </p>
            </li>
            <li>
              <span>02</span>
              <h3>Cadrer votre projet</h3>
              <p>Précisons vos règles, vos documents, votre marque et les systèmes à connecter.</p>
            </li>
            <li>
              <span>03</span>
              <h3>Valider avant d’ouvrir</h3>
              <p>
                Vérifiez les accès, les réponses et les parcours sur vos données de test, puis
                préparez une ouverture contrôlée.
              </p>
            </li>
          </ol>
        </section>

        <section
          className="showcase-container showcase-section showcase-faq-section"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div>
            <span className="showcase-kicker">AVANT DE VOUS LANCER</span>
            <h2 id="faq-title">
              Les bonnes
              <br />
              <span>questions.</span>
            </h2>
            <p>Un projet clair commence par des réponses précises.</p>
            <Link className="showcase-text-link" href="/trial">
              Parlons de votre besoin <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="showcase-faq">
            {faq.map((item) => (
              <details key={item.q}>
                <summary>
                  {item.q}
                  <Plus size={18} aria-hidden="true" />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="showcase-container showcase-final" aria-labelledby="trial-title">
          <div>
            <span className="showcase-kicker">LE PROCHAIN ÉCHANGE COMMENCE ICI</span>
            <h2 id="trial-title">
              Et si on regardait
              <br />
              <em>votre service client ?</em>
            </h2>
            <p>
              Découvrez le produit, présentez vos parcours et définissons un essai utile à votre
              entreprise.
            </p>
          </div>
          <div className="showcase-final-actions">
            <Link className="showcase-button accent" href="/trial">
              Demander un essai accompagné <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
            <Link className="showcase-final-secondary" href="/demo">
              Explorer d’abord la démonstration <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <span>Données fictives dans la démonstration.</span>
          </div>
        </section>
      </main>

      <footer className="showcase-container showcase-footer">
        <div>
          <ShowcaseBrand />
          <p>Un suivi plus clair. Une équipe qui garde la main.</p>
        </div>
        <nav aria-label="Liens de pied de page">
          <Link href="/demo">Démonstration</Link>
          <Link href="/trial">Contact commercial</Link>
          <Link href="/file">Accès à mon dossier</Link>
        </nav>
        <div className="showcase-footer-bottom">
          <span>© SAV SC Assistant AI</span>
          <span>Démonstration fictive · Déploiement accompagné</span>
        </div>
      </footer>
    </div>
  );
}
