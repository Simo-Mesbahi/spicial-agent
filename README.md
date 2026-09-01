# SAV SC Assistant AI

**Une plateforme de démonstration SAV et service client, connectée à un système métier simulé.**

SAV SC Assistant AI permet de suivre une réparation, consulter une livraison, examiner un devis et être accompagné jusqu’au bon niveau de résolution. Le chatbot essaie d’abord de traiter la demande avec le client ; il prépare un relais contextualisé lorsqu’une intervention humaine est nécessaire ou confirmée. Le simulateur fait évoluer les dossiers et l’assistant consulte leur état actualisé via une API contrôlée.

> **Budget IA : 0 €.** Le mode public par défaut n’utilise **aucun LLM** : règles et recherche documentaire lexicale. Un vrai modèle peut fonctionner **localement avec Ollama, sans clé API**. Les fournisseurs externes sont bloqués par défaut, même si une clé est présente. Maison Atlas et toutes les données sont fictives ; aucune opération réelle n’est exécutée.

## Essayer

[Ouvrir SAV SC Assistant AI](https://atlas-sav-sc-ai.mohammed-elmesbahi.chatgpt.site)

1. Explorer l’aperçu interactif de l’accueil : réparation, livraison ou devis.
2. Choisir **Vivre l’expérience** pour ouvrir son espace isolé sur le scénario choisi.
3. Cliquer **Utiliser ce code**, puis **Vérifier et consulter le dossier**. La référence et le code sont contrôlés par le serveur avant la première réponse.
4. Suivre le bandeau guidé : **Simuler l’étape suivante**, puis **Consulter le nouvel état**.
5. Lire **Le dossier en clair** : état, suite prévue et consigne client. Une alerte signale une réponse devenue historique ; **Actualiser le suivi** consulte à nouveau le dossier. Le texte complet et **Sources & outils** restent disponibles.
6. Changer de dossier directement dans la conversation, ou explorer **Mes dossiers** pour un devis, un remboursement ou un relais conseiller simulé.

Voir le [guide de démonstration](docs/DEMO.md).
Les [critères d’expérience utilisateur](docs/EXPERIENCE.md) distinguent ce qui est automatisé de ce qui doit encore être évalué par des testeurs.

## Fonctionnalités livrées

| Fonction                                                             | État                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Base relationnelle : clients, produits, achats, dossiers, événements | Implémentée, migrations SQLite/D1                                     |
| Huit scénarios et génération de nouveaux dossiers                    | Implémentées, plafond de 24 dossiers par espace                       |
| Session isolée, code par dossier, expiration, CSRF                   | Implémentés et testés                                                 |
| Suivi SAV/SC, acceptation/refus d’un devis                           | Implémentés ; aucune opération financière                             |
| Aide guidée puis relais conseiller avec contexte                     | Triage progressif ; confirmation respectée et transfert simulé        |
| Simulation manuelle et progression automatique à la consultation     | Implémentées ; pas de daemon permanent                                |
| 12 procédures fictives versionnées                                   | Recherche lexicale, affichage des sources                             |
| Ollama local, lanceur et diagnostic                                  | Sans clé API ; contrats de lecture testés avec réponses simulées      |
| Gemini gratuit à quota limité                                        | Connecteur compatible outils, clé serveur, données fictives seulement |
| Connecteurs externes OpenAI / compatibles                            | Conservés mais bloqués par le budget zéro par défaut                  |
| Interface française, thèmes clair/sombre/système, responsive         | Implémentée                                                           |
| Accueil interactif, parcours guidé, questions contextuelles          | Implémentés ; guide lié aux versions réelles du simulateur            |
| Synthèse de suivi, versions historiques et changement de dossier     | Faits construits côté serveur ; ancien devis non actionnable          |
| Reprise d’un message après coupure et délais réseau bornés           | Rejeu sans doublon, réponse enregistrée avant affichage               |
| Traçabilité et compteurs de session                                  | Mesures observées, sans score de qualité inventé                      |
| Contact email guidé                                                  | Appareil, Gmail ou Outlook ; contexte prérempli et copie de secours   |

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

## Utiliser un vrai modèle sans frais d’API

Prérequis : **Node.js 24**, macOS ou Linux/WSL, [Ollama installé](https://ollama.com/download) et de la mémoire disponible. Après `npm ci` :

```bash
npm run ai:local -- --pull
```

Cette commande démarre un serveur Ollama isolé sur cet ordinateur, désactive son cloud, télécharge le modèle local `qwen3:4b` avec votre accord explicite (`--pull`), prépare la configuration et les migrations locales, puis lance l’application. Les paramètres existants modifiés sont sauvegardés hors Git. Arrêter avec Ctrl+C. Aux lancements suivants, `npm run ai:local` suffit.

Le téléchargement initial représente environ **2,5 Go**, selon la [fiche Ollama du modèle](https://ollama.com/library/qwen3:4b) ; la mémoire nécessaire à son exécution est supérieure à la taille du fichier. Ce choix est un point de départ à évaluer, pas une garantie de performance.

Dans un autre terminal, pendant que le serveur tourne :

```bash
npm run ai:doctor
npm run ai:doctor -- --inference
```

Le premier vérifie l’installation ; le second demande aussi une courte génération locale. Aucun repli vers une API payante. Voir le [guide budget zéro](docs/ZERO-BUDGET.md) pour les limites et le dépannage.

**Le site public n’utilise pas le localhost de votre ordinateur.** Il reste en démonstration sans LLM. Un LLM public permanent exige une ressource d’inférence disponible et son exploitation ; cette livraison ne souscrit aucun hébergement ou abonnement payant.

## Configuration du modèle

| Variable          | Utilisation                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `LLM_BUDGET_MODE` | `zero` par défaut : seuls `demo` et `ollama` sont permis          |
| `LLM_PROVIDER`    | `demo`, `ollama` ; connecteurs externes conservés mais désactivés |
| `GEMINI_API_KEY`  | Secret serveur requis pour le mode `gemini` gratuit               |
| `LLM_MODEL`       | Modèle local installé ; défaut Ollama : `qwen3:4b`                |
| `LLM_BASE_URL`    | Ollama : boucle locale HTTP terminée par `/v1`                    |
| `LLM_DAILY_LIMIT` | Maximum de conversations LLM par fenêtre de 24 h, défaut 100      |

Le lanceur utilise le port **11435** et `OLLAMA_NO_CLOUD=1`. Il conserve le serveur Ollama habituel éventuel sur 11434 et ne le modifie pas. L’API n’envoie aucune clé à Ollama et refuse les redirections HTTP.

`gemini` est le seul fournisseur hébergé autorisé par `LLM_BUDGET_MODE=free`. Il utilise exclusivement `gemini-2.5-flash` ou `gemini-2.5-flash-lite`, l’endpoint officiel compatible OpenAI et `GEMINI_API_KEY` stockée comme secret serveur. Aucun modèle ni endpoint payant ne peut être choisi via l’application. L’offre gratuite dépend des quotas et conditions Google : elle convient à cette démo fictive, pas à une production avec des données clients réelles. Les connecteurs historiques `openai` / `compatible` restent bloqués tant que la politique n’est pas `approved`.

Créer une clé ne l’ajoute pas à l’hébergement. Le [guide Gemini sur téléphone](docs/GEMINI-FREE.md) décrit l’enregistrement sécurisé, l’activation et les limites de gratuité. Un quota SAV SC Assistant AI n’est pas un plafond financier garanti par Google.

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
- Pas d’authentification entreprise, de conseiller connecté ni de notification automatique. La page Contact prépare localement un email contextualisé vers `mohammed.elmesbahi31@gmail.com`, puis laisse choisir l’application par défaut, Gmail ou Outlook. Le visiteur relit et confirme l’envoi dans sa messagerie ; une copie complète reste disponible en secours.
- La simulation avance à la consultation et par actions explicites. Une exécution permanente demande un ordonnanceur distinct.
- L’appel réel aux modèles n’a pas été validé sans identifiants de fournisseur.
- Les tests ne constituent pas un audit de sécurité indépendant ni une certification de production.

Projet réalisé pour Simo Mesbahi. Aucune affiliation à une enseigne réelle.
