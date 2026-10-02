import Link from 'next/link';

const benefits = [
  {
    title: 'Un suivi compréhensible',
    text: 'Le client retrouve son dossier, son état et la prochaine étape sans devoir reconstruire l’historique à chaque échange.',
  },
  {
    title: 'Des réponses rattachées aux informations disponibles',
    text: 'L’expérience est conçue pour distinguer les faits du dossier, les informations documentaires et les éléments qui nécessitent une validation humaine.',
  },
  {
    title: 'Une escalade visible, pas simulée',
    text: 'Lorsque l’automatisation ne doit pas décider seule, le parcours indique clairement qu’une intervention humaine est nécessaire.',
  },
];

const faq = [
  {
    q: 'La démonstration utilise-t-elle de vrais dossiers clients ?',
    a: 'Non. La démonstration publique est isolée et utilise uniquement des dossiers, produits, enseignes et événements fictifs. Elle ne doit recevoir aucune donnée personnelle réelle.',
  },
  {
    q: 'Les intégrations présentées sont-elles toutes actives ?',
    a: 'Non. La vitrine distingue volontairement les fonctions démontrées, les capacités configurables et les intégrations qui nécessitent encore un raccordement au système du client.',
  },
  {
    q: 'L’assistant peut-il transférer automatiquement une demande à un humain ?',
    a: 'Le produit sait identifier qu’une intervention humaine est nécessaire et préparer le contexte. L’exécution réelle du transfert dépend de l’intégration métier mise en place chez le client.',
  },
  {
    q: 'Peut-on adapter la plateforme à notre marque ?',
    a: 'Oui. L’identité visuelle, les parcours, les contenus, les règles métier et l’intégration au site ou à l’espace client peuvent être définis avec chaque organisation. Cette personnalisation est une prestation à cadrer, pas une promesse d’intégration instantanée.',
  },
  {
    q: 'P1 est-il déjà ouvert aux vrais clients ?',
    a: 'Non. Les capacités avancées restent soumises à leur qualification P1.7, à la revue humaine et aux contrôles de mise en production. La vitrine et la démonstration ne constituent pas une autorisation de release.',
  },
];

export default function Home() {
  return (
    <div className="showcase">
      <a className="showcase-skip" href="#main-content">Aller au contenu</a>

      <header className="showcase-container showcase-nav">
        <Link className="showcase-brand" href="/" aria-label="SAV SC Assistant AI — accueil">
          <span className="showcase-brand-mark" aria-hidden="true">SC</span>
          <span>SAV SC Assistant AI</span>
        </Link>
        <nav className="showcase-nav-links" aria-label="Navigation principale">
          <a href="#capacites">Capacités</a>
          <a href="#evaluation">Évaluer</a>
          <a href="#personnalisation">Personnalisation</a>
          <a href="#securite">Sécurité</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link className="showcase-nav-cta" href="/trial">Demander un essai</Link>
      </header>

      <main id="main-content">
        <section className="showcase-container showcase-hero" aria-labelledby="showcase-title">
          <div>
            <span className="showcase-kicker">SAV · SERVICE CLIENT · ASSISTANCE GUIDÉE</span>
            <h1 id="showcase-title">Des demandes client plus <span>claires.</span></h1>
            <p className="showcase-lead">
              SAV SC Assistant AI réunit suivi de dossier, demandes de service client, consultation
              d’informations contrôlées et orientation vers un humain lorsque la situation le
              nécessite — dans une expérience pensée pour rester lisible côté client et vérifiable
              côté équipe.
            </p>
            <div className="showcase-actions">
              <Link className="showcase-button accent" href="/demo">Découvrir la démonstration</Link>
              <Link className="showcase-button primary" href="/trial">Demander un essai accompagné</Link>
              <Link className="showcase-button" href="/file">Accéder à un dossier client</Link>
            </div>
            <p className="showcase-note">
              La démonstration publique utilise exclusivement des données fictives. L’assistant
              avancé P1 reste soumis à qualification avant toute ouverture à de vrais clients.
            </p>
          </div>

          <div className="showcase-preview" aria-label="Aperçu représentatif de l’expérience client">
            <div className="showcase-preview-window">
              <div className="showcase-preview-top">
                <span className="showcase-dots" aria-hidden="true"><i/><i/><i/></span>
                <span>Aperçu fictif</span>
              </div>
              <div className="showcase-chat">
                <div className="showcase-message user">Où en est ma réparation ?</div>
                <div className="showcase-message ai">
                  Votre dossier indique que le diagnostic est terminé et qu’une pièce est en
                  attente. Aucune date de réception confirmée n’est enregistrée pour le moment.
                </div>
              </div>
              <div className="showcase-case">
                <div className="showcase-case-head">
                  <strong>Dossier SAV-2026-1042</strong>
                  <span className="showcase-status">En attente de pièce</span>
                </div>
                <small>Exemple fictif · aucune donnée client réelle</small>
              </div>
            </div>
          </div>
        </section>

        <div className="showcase-container showcase-trustbar" aria-label="Principes du produit">
          <div><strong>Données séparées</strong><span>Vitrine, démonstration et environnements internes gardent des frontières distinctes.</span></div>
          <div><strong>Réponses contrôlées</strong><span>Le système privilégie les faits disponibles et l’abstention lorsque l’information manque.</span></div>
          <div><strong>Actions confirmées</strong><span>Les décisions sensibles ne sont pas présentées comme exécutées sans confirmation réelle.</span></div>
          <div><strong>Humain quand nécessaire</strong><span>Le parcours rend visible le besoin d’escalade sans inventer une prise en charge.</span></div>
        </div>

        <section className="showcase-container showcase-section" id="capacites">
          <div className="showcase-section-head">
            <div>
              <span className="showcase-kicker">CE QUE LE CLIENT VOIT</span>
              <h2>Du besoin à la prochaine étape.</h2>
            </div>
            <p>
              L’objectif n’est pas d’ajouter une couche de conversation au-dessus du service client.
              Il est de rendre la situation plus compréhensible, de conserver le contexte utile et
              de laisser les règles métier contrôler ce qui peut réellement être affirmé ou exécuté.
            </p>
          </div>
          <div className="showcase-grid">
            {benefits.map((benefit, index) => (
              <article className="showcase-card" key={benefit.title}>
                <span className="showcase-card-number">0{index + 1}</span>
                <h3>{benefit.title}</h3>
                <p>{benefit.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="showcase-container showcase-section" id="evaluation">
          <div className="showcase-section-head">
            <div>
              <span className="showcase-kicker">DEUX FAÇONS D’ÉVALUER</span>
              <h2>Comprendre vite. Vérifier en profondeur.</h2>
            </div>
            <p>
              La même plateforme doit parler à un décideur métier et à la personne chargée de
              vérifier concrètement le fonctionnement. La démonstration reste ouverte sur des données
              fictives ; les environnements internes et les contrôles d’administration restent séparés.
            </p>
          </div>
          <div className="showcase-audiences">
            <article className="showcase-audience">
              <small>Pour un décideur métier</small>
              <h3>Voir l’expérience et les bénéfices.</h3>
              <ul>
                <li>Suivre un dossier SAV sans créer de compte dans le parcours prévu.</li>
                <li>Comprendre comment une réponse s’appuie sur le dossier ou une procédure.</li>
                <li>Observer les limites explicites et le passage vers un accompagnement humain.</li>
                <li>Identifier ce qui peut être adapté à l’identité et aux processus de l’entreprise.</li>
              </ul>
            </article>
            <article className="showcase-audience">
              <small>Pour une personne chargée d’évaluer</small>
              <h3>Tester les frontières du système.</h3>
              <ul>
                <li>Utiliser plusieurs scénarios fictifs et observer leur évolution.</li>
                <li>Vérifier qu’une date absente n’est pas inventée.</li>
                <li>Contrôler qu’une action sensible demande une confirmation.</li>
                <li>Examiner le comportement quand une information ou un service est indisponible.</li>
              </ul>
            </article>
          </div>
          <div className="showcase-actions">
            <Link className="showcase-button accent" href="/demo">Ouvrir la démonstration fictive</Link>
            <Link className="showcase-button" href="/trial">Préparer un essai accompagné</Link>
          </div>
        </section>

        <section className="showcase-container showcase-section" id="personnalisation">
          <div className="showcase-custom">
            <div>
              <span className="showcase-kicker">UNE BASE, VOTRE EXPÉRIENCE</span>
              <h2>Une plateforme qui peut s’intégrer à votre univers.</h2>
              <p className="showcase-lead">
                Une intégration commerciale peut être définie avec chaque organisation : identité
                visuelle, emplacement sur le site, vocabulaire, parcours, règles métier, corpus
                documentaire et points de contact. Le périmètre est cadré avant implémentation.
              </p>
              <p className="showcase-note">
                La personnalisation est présentée comme une prestation à définir ensemble ; aucune
                intégration tierce n’est annoncée comme active tant qu’elle n’est pas réellement raccordée.
              </p>
            </div>
            <div className="showcase-custom-panel">
              <div><strong>Identité</strong><span>Couleurs, ton, marque et composants adaptés au contexte du client.</span></div>
              <div><strong>Parcours</strong><span>SAV, livraison, retour, réclamation ou autres flux selon les processus réels.</span></div>
              <div><strong>Connaissance</strong><span>Procédures et contenus publiés selon des règles de gouvernance définies.</span></div>
              <div><strong>Intégration</strong><span>Site, espace client et systèmes métier après cadrage technique et sécurité.</span></div>
            </div>
          </div>
        </section>

        <section className="showcase-container showcase-section" id="securite">
          <div className="showcase-safety">
            <div>
              <span className="showcase-badge">SÉCURITÉ & LIMITES VISIBLES</span>
              <h2>La confiance vient aussi de ce que le produit refuse de prétendre.</h2>
              <p>
                La vitrine ne dépend d’aucun fournisseur IA ni d’une base métier pour s’afficher.
                La démonstration reste fictive. Les fonctions de production conservent leurs propres
                contrôles d’accès, validations et gates de publication.
              </p>
            </div>
            <ul>
              <li>Aucun dossier réel n’est exposé dans la vitrine ou la démonstration publique.</li>
              <li>Aucun appel LLM n’est déclenché simplement parce qu’un prospect charge cette page.</li>
              <li>Une CI verte ne vaut pas qualification P1.7 ni autorisation de release client.</li>
              <li>P1 avancé est présenté comme bientôt disponible tant que sa qualification n’est pas achevée.</li>
              <li>Les transferts humains et intégrations réelles ne sont annoncés comme exécutés que s’ils sont effectivement raccordés.</li>
            </ul>
          </div>
        </section>

        <section className="showcase-container showcase-section" id="faq">
          <div className="showcase-section-head">
            <div>
              <span className="showcase-kicker">QUESTIONS UTILES</span>
              <h2>Ce qu’il faut savoir avant un essai.</h2>
            </div>
            <p>
              Des réponses volontairement précises : pas de certification inventée, pas de faux
              client, pas de chiffre de performance sans mesure et pas de promesse d’intégration non démontrée.
            </p>
          </div>
          <div className="showcase-faq">
            {faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="showcase-container showcase-final" id="essai">
          <div>
            <span className="showcase-kicker">ESSAI ACCOMPAGNÉ</span>
            <h2>Voyez le produit dans votre contexte.</h2>
            <p>
              Un essai accompagné permet de parcourir les scénarios, discuter du périmètre de
              personnalisation et identifier les intégrations à qualifier avant un déploiement réel.
            </p>
          </div>
          <Link className="showcase-button" href="/trial">Demander un essai accompagné</Link>
        </section>
      </main>

      <footer className="showcase-container showcase-footer">
        <span>© SAV SC Assistant AI</span>
        <span>Vitrine publique · Démonstration fictive · Environnements internes séparés</span>
      </footer>
    </div>
  );
}
