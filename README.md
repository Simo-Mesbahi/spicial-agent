# AtlasCare AI

**Une plateforme de démonstration SAV et service client, connectée à un système métier simulé.**

AtlasCare permet de suivre une réparation, consulter une livraison, examiner un devis et transmettre une demande à un conseiller fictif. Le simulateur fait évoluer les dossiers ; l’assistant consulte leur état actualisé via une API contrôlée.

> **Transparence :** Maison Atlas, ses clients et ses produits sont fictifs. Le mode par défaut n’utilise **aucun LLM** : il fonctionne avec des règles et une recherche documentaire lexicale. Les connecteurs OpenAI et compatibles sont implémentés, mais nécessitent un modèle accessible et une configuration serveur. Aucun remboursement, email ou SMS réel n’est envoyé.

## Essayer

[Ouvrir AtlasCare AI](https://atlascare-ai.mohammed-elmesbahi.chatgpt.site)

1. Explorer l’aperçu interactif de l’accueil : réparation, livraison ou devis.
2. Choisir **Vivre l’expérience** pour ouvrir son espace isolé sur le scénario choisi.
3. Cliquer **Utiliser ce code**, puis **Vérifier et consulter le dossier**. La référence et le code sont contrôlés par le serveur avant la première réponse.
4. Suivre le bandeau guidé : **Simuler l’étape suivante**, puis **Consulter le nouvel état**.
5. Comparer les réponses et consulter **Sources & outils**. La version du dossier consultée est enregistrée avec chaque réponse.
6. Explorer **Mes dossiers** pour un devis, un remboursement ou un relais conseiller simulé.

Voir le [guide de démonstration](docs/DEMO.md).
Les [critères d’expérience utilisateur](docs/EXPERIENCE.md) distinguent ce qui est automatisé de ce qui doit encore être évalué par des testeurs.

## Fonctionnalités livrées

| Fonction                                                             | État                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Base relationnelle : clients, produits, achats, dossiers, événements | Implémentée, migrations SQLite/D1                             |
| Huit scénarios et génération de nouveaux dossiers                    | Implémentées, plafond de 24 dossiers par espace               |
| Session isolée, code par dossier, expiration, CSRF                   | Implémentés et testés                                         |
| Suivi SAV/SC, acceptation/refus d’un devis                           | Implémentés ; aucune opération financière                     |
| Demande de conseiller avec contexte                                  | Enregistrée dans l’espace opérateur simulé                    |
| Simulation manuelle et progression automatique à la consultation     | Implémentées ; pas de daemon permanent                        |
| 12 procédures fictives versionnées                                   | Recherche lexicale, affichage des sources                     |
| OpenAI / API compatible, dont Ollama                                 | Connecteurs avec outils de lecture ; tests de contrat simulés |
| Interface française, thèmes clair/sombre/système, responsive         | Implémentée                                                   |
| Accueil interactif, parcours guidé, questions contextuelles          | Implémentés ; guide lié aux versions réelles du simulateur    |
| Traçabilité et compteurs de session                                  | Mesures observées, sans score de qualité inventé              |

## Lancer localement

Prérequis : Node.js **24 LTS**, npm, environnement Linux/macOS (les scripts de build nécessitent GNU `timeout`, généralement `coreutils` sur macOS).

```bash
git clone https://github.com/Simo-Mesbahi/spicial-agent.git
cd spicial-agent
npm ci
cp .env.example .dev.vars
npm run db:migrate:local
npm run dev
```

Utiliser l’adresse affichée par Vite. D1 est émulé localement ; sa persistance est dans `.wrangler/state`. Les identifiants et données de session restent côté serveur. Seul le thème est enregistré dans le navigateur.

```bash
npm run typecheck
npm run lint:app
npm test
npm run build
```

Les tests d’API utilisent une base SQLite réelle en mémoire et les migrations livrées. Les échanges avec un LLM sont simulés dans les tests de contrat ; aucune clé n’est nécessaire pour les exécuter.

## Brancher un modèle

Modifier **les secrets serveur**, jamais le code client ni le dépôt :

| Variable          | Utilisation                                                |
| ----------------- | ---------------------------------------------------------- |
| `LLM_PROVIDER`    | `demo` (défaut), `openai` ou `compatible`                  |
| `LLM_MODEL`       | Identifiant exact du modèle disponible chez le fournisseur |
| `OPENAI_API_KEY`  | Clé OpenAI, seulement pour `openai`                        |
| `LLM_BASE_URL`    | URL de base `/v1` pour un fournisseur compatible           |
| `LLM_API_KEY`     | Clé éventuelle du fournisseur compatible                   |
| `LLM_DAILY_LIMIT` | Conversations LLM maximum par fenêtre de 24 h, défaut 100  |

Pour Ollama en local, utiliser `LLM_BASE_URL=http://localhost:11434/v1` et un modèle installé prenant en charge les outils. Le nom du modèle, sa licence, sa mémoire nécessaire et ses performances doivent être vérifiés avant sélection. Un site hébergé ne peut pas joindre le `localhost` de votre ordinateur : utiliser un service HTTPS privé accessible au serveur, sans exposer une API Ollama non protégée.

Les appels utilisent Chat Completions avec schémas d’outils stricts. La compatibilité des API n’implique pas des performances identiques. Le plafond limite les **conversations**, pas les euros ; configurer aussi les alertes et limites chez le fournisseur.

## Architecture et sécurité

- [Architecture et responsabilités](docs/ARCHITECTURE.md)
- [Contrat de l’API](docs/API.md)
- [Périmètre et décisions](docs/PROJECT.md)
- [Limites et préparation entreprise](docs/PRODUCTION.md)
- [Politique de sécurité](SECURITY.md)

La démonstration publique ne représente pas une authentification de salarié. L’opérateur et le client sont des rôles joués par un visiteur dans son **propre espace fictif**. Les codes de démonstration sont donc visibles à ce visiteur. Ne jamais injecter des dossiers clients réels dans ce mode.

## Déploiement

Le projet utilise React, TypeScript, Vinext et un Worker Cloudflare avec D1. Les migrations Drizzle sont versionnées dans `drizzle/`. La plateforme Sites gère le déploiement de cet exemplaire ; `.openai/hosting.json` identifie le site. `wrangler.local.jsonc` sert uniquement au développement local et ne configure pas un compte Cloudflare de production.

Les sources et les configurations de test sont incluses dans la livraison ; aucun secret ni fichier de base de données n’y figure. Voir le [bilan de livraison](docs/DELIVERY.md) pour l’état de la synchronisation GitHub et des validations.

## Limites actuelles

- Données synthétiques, scénarios bornés et procédures fictives ; pas de connexion à un SI réel.
- Recherche lexicale ; embeddings, recherche hybride et reranking restent des évolutions à évaluer.
- Pas d’authentification entreprise, de conseiller connecté ni de notification externe.
- La simulation avance à la consultation et par actions explicites. Une exécution permanente demande un ordonnanceur distinct.
- L’appel réel aux modèles n’a pas été validé sans identifiants de fournisseur.
- Les tests ne constituent pas un audit de sécurité indépendant ni une certification de production.

Projet réalisé pour Simo Mesbahi. Aucune affiliation à une enseigne réelle.
