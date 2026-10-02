# SAV SC Assistant AI

**Plateforme SAV et service client avec vitrine commerciale, démonstration fictive, suivi de dossier sécurisé et administration métier.**

SAV SC Assistant AI est conçu pour présenter puis opérer des parcours de service client encadrés : suivi de dossier SAV, demandes de service client, consultation d’informations gouvernées et orientation vers un humain lorsque nécessaire. Le produit distingue strictement la vitrine publique, la démonstration sur données fictives, l’accès client à un dossier et les surfaces internes d’administration.

> **État de release :** la vitrine commerciale et ses preuves de non-régression sont fusionnées sur `main`. Cela ne constitue **pas** une qualification P1.7 ni une autorisation d’ouvrir les capacités avancées à de vrais clients. La publication Sites et la qualification live restent des étapes distinctes.

## Parcours publics et internes

| Route | Rôle | Frontière |
| --- | --- | --- |
| `/` | Vitrine commerciale | Statique, sans bootstrap Supabase/LLM/API nécessaire à la première vue |
| `/demo` | Démonstration interactive | Données et scénarios fictifs uniquement |
| `/trial` | Demande d’essai accompagné | Ouvre la messagerie du visiteur vers le contact commercial confirmé |
| `/file` | Accès client à un dossier | Référence + code, contrôles serveur et session bornée |
| `/admin` | Administration métier | Authentification, rôles et MFA ; surface interne |

Le contact public confirmé est **`Mohammed.elmesbahi@outlook.com`**. Les pages de contact préparent un brouillon que le visiteur relit et envoie lui-même ; aucun message n’est prétendu envoyé automatiquement.

## Vitrine commerciale

La première page vise une présentation commerciale crédible et rapide :

- proposition de valeur SAV + service client ;
- aperçu représentatif sur données fictives ;
- lecture adaptée à un décideur métier et à un évaluateur fonctionnel/technique ;
- personnalisation possible de l’identité, des parcours, du corpus et des intégrations après cadrage ;
- limites, sécurité et transfert humain décrits sans transformer une simulation en promesse réelle ;
- P1 présenté comme une capacité soumise à qualification, et non comme une release déjà autorisée.

La vitrine est volontairement indépendante d’un fournisseur IA et de Supabase au premier affichage. Une indisponibilité de Gemini, Groq, OpenAI ou du backend métier ne doit donc pas empêcher un prospect de comprendre le produit.

Voir [`docs/PUBLIC-SHOWCASE.md`](docs/PUBLIC-SHOWCASE.md) pour les frontières, budgets de régression, preuves navigateur et règles de publication.

## Socle métier et sécurité

Le projet comprend aujourd’hui deux familles de parcours : une démonstration déterministe/fictive conservée pour présenter le produit et un socle Supabase destiné à la préproduction des parcours client/admin gouvernés.

Le socle Supabase couvre notamment :

- consultation client sans compte par référence et code confidentiel ;
- codes d’accès hachés et sessions de dossier bornées ;
- séparation des organisations ;
- Supabase Auth pour l’administration, rôles et MFA obligatoire ;
- RLS et RPC serveur pour les données sensibles ;
- audit technique et contrôles de session ;
- corpus documentaire versionné et publication gouvernée.

Aucun secret ne doit être placé dans Git, une capture, un message ou du JavaScript livré au navigateur. La clé `SUPABASE_SECRET_KEY` et les clés fournisseurs restent exclusivement côté serveur.

Guide : [`docs/SUPABASE-PRODUCTION.md`](docs/SUPABASE-PRODUCTION.md).

## RAG et génération

Le moteur documentaire conserve un mode lexical et peut activer explicitement un mode hybride gouverné (`RAG_MODE=hybrid`) pour le corpus Supabase configuré. Le pipeline hybride est borné : au plus un embedding de requête, candidats lexicaux/vectoriels filtrés, fusion RRF, déduplication, provenance et seuil de pertinence. En cas de faiblesse d’évidence, le système doit s’abstenir ou revenir au comportement documentaire prévu plutôt qu’inventer une information.

Les embeddings sont configurés séparément du fournisseur de chat. La baseline de qualification décrite dans le projet utilise `gemini-embedding-2` avec sortie 768 dimensions ; tout changement d’espace d’embedding nécessite une réindexation contrôlée.

Guide : [`docs/P1-HYBRID-RETRIEVAL.md`](docs/P1-HYBRID-RETRIEVAL.md).

## Fournisseurs LLM et budget

Le routage administrable prend en charge Gemini, Groq et OpenAI avec politiques serveur explicites :

| Fournisseur | Politique | Remarque |
| --- | --- | --- |
| Gemini | `free` ou `approved` | Modèle autorisé/configuré côté serveur |
| Groq | `free` ou `approved` | Modèles `openai/gpt-oss-*` hébergés par Groq |
| OpenAI | `approved` | Bloqué en mode `free` |
| Demo / local | selon configuration | Utile pour tests déterministes ou exécution locale |

`LLM_BUDGET_MODE=zero` bloque les API hébergées. Le mode `free` est une autorisation applicative d’utiliser un compte configuré ; il ne constitue pas une garantie commerciale sur le plan ou les quotas du fournisseur.

Un secours automatique optionnel est borné à un seul fournisseur secondaire et ne s’applique pas aux erreurs qui doivent rester explicites, par exemple quota/429, authentification, requête invalide, refus ou sortie non valide. Les embeddings restent indépendants du fournisseur de génération.

Guide : [`docs/admin-llm-routing.md`](docs/admin-llm-routing.md).

## P1 / qualification live

Les tests locaux et CI, les dry-runs RAG/grounding/P1 et les diagnostics fournisseur ne remplacent pas la qualification live.

Avant toute ouverture P1 à de vrais clients, il faut conserver la chaîne de release séparée :

`P1.7A Live Qualification → P1.7B freshness/revalidation → P1.7C Customer Release Gate → P1.7D Canary rollout`

La vitrine publique peut être publiée indépendamment de cette activation, à condition de continuer à présenter P1 comme non autorisé tant que ces gates ne sont pas terminés.

## Qualité et non-régression

La CI standard vérifie notamment :

```bash
npm run typecheck
npm run lint:app
npm test
npm run check:regressions
npm run test:origin-runtime
npm run eval:ai
npm run eval:rag
npm run eval:generation
npm run eval:grounding
npm run eval:p1:release
npm run build
npm run test:starter
```

La vitrine possède en plus un workflow navigateur spécialisé qui, pour les changements concernés :

- bloque le trafic navigateur tiers ;
- vérifie l’absence d’appel `/api/` à la première vue ;
- impose un plafond de régression de **128 KiB** sur le HTML brut de la racine ;
- vérifie les routes internes publiques ;
- contrôle l’absence de débordement à 320, 390, 768 px et desktop ;
- teste le premier focus clavier, les CTA et le contact confirmé ;
- capture desktop, mobile et `/trial` ;
- regénère une preuve après merge sur `main`.

Ces métriques sont des garde-fous de CI et ne doivent pas être transformées en promesses de latence production.

## Lancer localement

Prérequis : Node.js **24**, npm, Linux/macOS ou environnement compatible avec les scripts du dépôt.

```bash
git clone https://github.com/Simo-Mesbahi/spicial-agent.git
cd spicial-agent
npm ci
cp .env.example .dev.vars
npm run dev
```

Pour les parcours historiques D1 locaux, appliquer les migrations locales prévues avant les tests concernés. Pour Supabase, suivre le guide dédié et ne jamais réutiliser un secret de production dans un environnement local non maîtrisé.

Pour une qualification locale sans fournisseur hébergé, utiliser les modes `demo`/locaux prévus par le projet. Les tests de contrat n’ont pas besoin d’une clé LLM réelle.

## Déploiement

L’exemplaire hébergé existant est lié à la plateforme **Sites** par [`.openai/hosting.json`](.openai/hosting.json). Le dépôt ne contient pas de workflow GitHub de déploiement production et `wrangler.local.jsonc` sert uniquement au développement local.

URL historique de l’exemplaire Sites :

**https://atlas-sav-sc-ai.mohammed-elmesbahi.chatgpt.site**

Un merge GitHub ne prouve donc pas, à lui seul, que cette URL exécute le dernier commit. Après publication via Sites, vérifier explicitement la racine, `/demo`, `/trial`, `/file`, les métadonnées et le comportement mobile sur la version réellement servie.

## Gouvernance du dépôt

Les workflows produisent des preuves, mais la protection de branche est un contrôle GitHub séparé. Le suivi de gouvernance est documenté dans l’issue **#109** : protection de `main`, PR obligatoires, check `Quality checks / verify`, résolution des conversations, blocage des force-push/suppressions et bypass minimal.

Ne jamais abaisser un test, un seuil P1, un contrôle MFA/RLS ou une validation métier pour obtenir un état vert.

## Documentation principale

- [`docs/PUBLIC-SHOWCASE.md`](docs/PUBLIC-SHOWCASE.md) — vitrine et preuves navigateur
- [`docs/SUPABASE-PRODUCTION.md`](docs/SUPABASE-PRODUCTION.md) — Supabase, Auth, RLS, MFA et environnements
- [`docs/P1-HYBRID-RETRIEVAL.md`](docs/P1-HYBRID-RETRIEVAL.md) — recherche hybride gouvernée
- [`docs/admin-llm-routing.md`](docs/admin-llm-routing.md) — Gemini / Groq / OpenAI et failover borné
- [`docs/P1-CONTROLLED-RELEASE.md`](docs/P1-CONTROLLED-RELEASE.md) — release P1 contrôlée
- [`SECURITY.md`](SECURITY.md) — politique de sécurité
- [`docs/DELIVERY.md`](docs/DELIVERY.md) — snapshot historique de livraison de septembre 2026

## Limites à ne pas masquer

- La vitrine et la démonstration n’utilisent que des exemples fictifs ; elles ne prouvent aucune intégration client réelle.
- La CI n’est pas un audit de sécurité indépendant.
- Le mode hybride doit être qualifié sur l’environnement/corpus exact avant activation production.
- Les fournisseurs hébergés dépendent de clés, quotas, modèles et conditions externes.
- La qualification P1.7 live et la publication Sites restent distinctes du simple état vert de `main`.
- Les performances de charge à grande échelle et la recette sur appareils physiques doivent être démontrées séparément avant une généralisation client.

Projet réalisé pour Simo Mesbahi. Aucune affiliation à une enseigne réelle.
