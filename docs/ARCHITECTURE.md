# Architecture actuelle

Ce document décrit l’architecture présente dans `main`. Les anciens snapshots de livraison restent utiles pour l’historique, mais ne doivent plus être lus comme la topologie complète du produit actuel.

## Vue d’ensemble

```mermaid
flowchart TD
  PROSPECT[Prospect] --> SHOWCASE[/ vitrine statique]
  PROSPECT --> DEMO[/demo fictif]
  CLIENT[Client] --> FILE[/file accès dossier]
  ADMIN[Administrateur] --> ADMINUI[/admin]

  SHOWCASE -->|aucun bootstrap requis| STATIC[HTML/CSS public]
  DEMO --> LEGACY[Runtime démonstration déterministe]
  LEGACY --> D1[(D1 / SQLite local-historique)]

  FILE --> SERVER[Couche serveur / Worker]
  ADMINUI --> SERVER
  SERVER --> SESSION[Sessions et contrôles d'accès]
  SESSION --> SUPA[(Supabase PostgreSQL)]
  ADMINUI --> AUTH[Supabase Auth + MFA / rôles]
  AUTH --> SUPA

  SERVER --> ORCH[Orchestration structurée]
  ORCH --> FACTS[Faits dossier filtrés]
  ORCH --> RAG[Recherche documentaire gouvernée]
  RAG --> LEX[Canal lexical]
  RAG --> VEC[Canal vectoriel optionnel]
  LEX --> SUPA
  VEC --> EMB[Embedding borné]
  VEC --> SUPA

  ORCH --> VALIDATOR[Validation factuelle]
  VALIDATOR --> GEN[Génération naturelle bornée]
  GEN --> PROVIDERS[Gemini / Groq / OpenAI selon politique]
  ORCH --> HUMAN[Orientation humaine déterministe]
```

## 1. Séparation des surfaces

### `/` — vitrine commerciale

La racine est une surface publique légère. Elle ne nécessite ni composant client, ni session, ni appel `/api/`, ni requête Supabase, ni appel LLM pour présenter le produit. Cette indépendance empêche une panne fournisseur ou backend de dégrader la première impression commerciale.

Les tests dédiés interdisent la réintroduction silencieuse de ces dépendances et vérifient desktop, 320/390/768 px, clavier, routes publiques et budget HTML.

### `/demo` — démonstration fictive

La démonstration interactive historique est conservée séparément. Elle utilise des données/scénarios fictifs et ne doit jamais être confondue avec un environnement client réel ou une qualification P1.

Une partie du socle D1/SQLite historique reste utile pour cette démonstration, les fixtures et les tests locaux. Sa présence ne signifie pas que le plan de données Supabase de préproduction doit être remplacé par D1.

### `/file` — accès client

Le parcours client sans compte s’appuie sur une référence de dossier et un code confidentiel. La couche serveur contrôle les sessions, l’accès au dossier et la forme des réponses avant de transmettre des faits à l’assistant.

### `/admin` — administration interne

L’administration est une surface distincte, protégée par Supabase Auth, rôles métier et MFA/AAL2 pour les opérations concernées. Les paramètres d’assistant, de corpus et d’exploitation ne doivent jamais être exposés par la vitrine.

## 2. Plans de données

### Démonstration / tests historiques

Le dépôt conserve le schéma Drizzle/D1 et ses migrations pour la démonstration et certains tests. Les simulations restent bornées et les actions opérateur sont bloquées dans les éditions qui ne doivent pas les exposer.

### Supabase préproduction / production-aligned

Le socle Supabase apporte :

- PostgreSQL et migrations versionnées ;
- isolation par organisation ;
- RLS ;
- RPC serveur ;
- Auth administrative, rôles et MFA ;
- sessions client bornées ;
- gestion métier des dossiers ;
- corpus documentaire versionné ;
- colonnes/vectorisation nécessaires au mode hybride ;
- observabilité de release P1.

Le projet Supabase actuellement documenté doit rester un environnement de préproduction tant que la recette complète de production n’est pas terminée. Une future production doit être isolée avec ses propres secrets, comptes et données.

Voir [`SUPABASE-PRODUCTION.md`](SUPABASE-PRODUCTION.md).

## 3. Orchestration conversationnelle

La décision métier ne repose pas sur une réponse libre d’un LLM. La chaîne sépare notamment :

1. compréhension/classification structurée ;
2. sélection du dossier et autorisation ;
3. faits métier filtrés ;
4. recherche documentaire si nécessaire ;
5. génération naturelle bornée lorsque la politique l’autorise ;
6. validation factuelle/abstention ;
7. orientation humaine selon la politique métier.

Les classes d’intention prévues par le moteur couvrent les échanges généraux, information, procédure, recherche/changement de dossier, clarification, handoff humain et action. Une génération ne peut pas s’octroyer un droit métier absent ni transformer une simulation en action réelle.

## 4. Recherche documentaire

`RAG_MODE=lexical` conserve le comportement lexical. `RAG_MODE=hybrid` active explicitement le chemin hybride pour le corpus Supabase configuré.

Le mode hybride est borné :

- requête de recherche autonome issue de l’orchestrateur ;
- au plus un embedding de requête ;
- candidats lexicaux et vectoriels filtrés ;
- contrôle organisation/statut/révision/date/locale/marché ;
- fusion par reciprocal rank fusion (RRF) ;
- déduplication et provenance ;
- seuil de pertinence ;
- abstention ou dégradation contrôlée lorsque l’évidence est insuffisante.

L’embedding est indépendant du fournisseur de chat. Le baseline P1 documenté utilise `gemini-embedding-2` en 768 dimensions. Un changement de modèle/espace exige une réindexation contrôlée.

Voir [`P1-HYBRID-RETRIEVAL.md`](P1-HYBRID-RETRIEVAL.md).

## 5. Fournisseurs LLM et failover

Les fournisseurs hébergés supportés par la couche de routage sont Gemini, Groq et OpenAI, en plus des modes démo/local prévus par le projet.

Les autorisations sont fail-closed : clé, modèle, allowlist, politique de budget et configuration doivent toutes être valides avant un appel.

- `LLM_BUDGET_MODE=zero` : bloque les API hébergées ;
- `free` : permet les fournisseurs autorisés pour cette politique, sans garantir le plan commercial du fournisseur ;
- `approved` : permet les fournisseurs explicitement approuvés selon la configuration.

Le failover automatique est optionnel, désactivé par défaut et borné à un seul fournisseur secondaire. Il ne masque pas les quotas/429, erreurs d’authentification, requêtes invalides, refus ou sorties invalides. Il est désactivé pendant les modes P1 qui exigent l’attestation d’un fournisseur/modèle exact.

Voir [`admin-llm-routing.md`](admin-llm-routing.md).

## 6. Sécurité et frontières

Les principes structurants sont :

- aucune clé fournisseur ou Supabase secrète dans le navigateur ;
- aucun jeton brut stocké dans la base client ;
- RLS et organisation appliquées côté données ;
- MFA/rôles pour l’administration ;
- décisions et mutations métier déterministes côté serveur ;
- outils LLM limités aux opérations explicitement autorisées ;
- provenance documentaire et abstention ;
- aucune donnée réelle dans la démonstration publique ;
- séparation des environnements et des flags de release.

Les tests de CI ne remplacent pas un audit de sécurité indépendant, une recette hosted Supabase réelle ou une validation de charge.

## 7. P1 et release

`P1_RELEASE_MODE` est une frontière de release, pas un bouton de qualité. Une CI verte ou un diagnostic fournisseur vert ne suffit pas pour activer P1 à de vrais clients.

La séquence reste :

`P1.7A Live Qualification → P1.7B Documentary freshness/revalidation → P1.7C Customer Release Gate → P1.7D Canary rollout`

Les attestations doivent rester liées à l’environnement, au provider/modèle, au corpus et à l’espace d’embedding qualifiés.

## 8. Hébergement et publication

Le dépôt est lié à un projet Sites par `.openai/hosting.json`. GitHub Actions valide le code et les preuves, mais il n’existe pas de workflow GitHub qui publie automatiquement la production.

Un merge dans `main`, une CI verte et une publication Sites sont donc trois événements distincts. Après chaque publication, vérifier la version réellement servie sur l’URL publique avant de déclarer la release disponible.

## 9. Gouvernance GitHub

La CI produit les preuves techniques, mais les protections de `main` doivent être imposées par GitHub branch protection ou rulesets. L’issue #109 suit ce point : PR obligatoire, check standard requis, résolution des conversations, interdiction des force-push/suppressions et bypass minimal.

Ne jamais modifier les gates, désactiver un test ou assouplir une frontière P1 uniquement pour obtenir un résultat vert.
