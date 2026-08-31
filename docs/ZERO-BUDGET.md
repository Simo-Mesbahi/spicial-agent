# AtlasCare avec un budget IA de 0 €

## Deux usages distincts

| Usage                              | Moteur                        | Condition                                        |
| ---------------------------------- | ----------------------------- | ------------------------------------------------ |
| Site public actuel                 | Règles et documents, sans LLM | Aucune clé ni facture d’API de modèle            |
| Application sur votre ordinateur   | Ollama et modèle local        | Ordinateur disponible et suffisamment de mémoire |
| Démonstration publique optionnelle | Gemini API Free               | Compte Google, clé secrète et quotas fournisseur |

Le budget nul concerne l’absence d’API d’inférence payante et de nouvelle souscription. Le matériel, l’électricité, l’accès Internet, les quotas d’hébergement et les éventuels abonnements existants ne disparaissent pas. Aucun service gratuit distant n’est présenté comme illimité ou garanti permanent.

Le dépôt utilisé reste **Simo-Mesbahi/spicial-agent**. GitHub conserve le code ; il ne fournit pas automatiquement un serveur LLM. Aucun Codespace payant n’est créé par le lanceur.

## Démarrage local

Installer Node.js 24 et [Ollama](https://ollama.com/download) sur macOS ou Linux/WSL. Dans la copie du dépôt :

```bash
npm ci
npm run ai:local -- --pull
```

`--pull` autorise explicitement le téléchargement initial. Le choix par défaut est **qwen3:4b**, modèle à poids ouverts dont la fiche Ollama indique une licence Apache 2.0 et un fichier quantifié d’environ 2,5 Go. Cette taille n’est pas une exigence de RAM : prévoir aussi la mémoire du contexte et de l’application. La latence dépend de votre machine. [Fiche officielle du modèle](https://ollama.com/library/qwen3:4b)

Le lanceur :

1. Vérifie Node, Ollama et la disponibilité du port 11435.
2. Démarre son propre processus Ollama sur `127.0.0.1:11435`, avec `OLLAMA_NO_CLOUD=1`.
3. Vérifie que le modèle est installé, n’annonce pas un hébergement distant et prend en charge les outils.
4. Configure uniquement les paramètres LLM de `.dev.vars`, en sauvegardant l’ancien fichier modifié avec des permissions restreintes. Les autres paramètres restent conservés. Fichier et sauvegardes sont exclus de Git.
5. Applique les migrations à la base locale puis lance l’application, accessible uniquement depuis cet ordinateur.

Utiliser l’adresse locale affichée. **Ctrl+C** arrête les groupes de processus lancés par cette session. Le serveur Ollama déjà présent sur le port 11434 n’est pas arrêté ni reconfiguré. Aux lancements suivants :

```bash
npm run ai:local
```

Un autre modèle local prenant en charge les outils peut être choisi avec `--model NOM`. Aucun modèle distant, téléchargement ou changement de fournisseur n’est décidé automatiquement.

## Diagnostic et validation réelle

Pendant que le lanceur tourne, dans un second terminal :

```bash
npm run ai:doctor
npm run ai:doctor -- --inference
```

Le diagnostic sans option ne génère rien : il contrôle le serveur, le modèle et sa capacité déclarée. L’option `--inference` teste une courte génération locale. Elle ne mesure pas la qualité SAV/SC. Ensuite, exécuter les parcours de [démonstration](DEMO.md) et le [protocole utilisateur](EXPERIENCE.md), en contrôlant références, montants, sources et absence de date inventée.

Les tests automatisés livrés simulent les réponses du fournisseur. Aucun vrai modèle Ollama n’était installé dans l’environnement de livraison : la génération et la performance sur votre matériel ne sont pas encore validées.

## Garde-fous

`LLM_BUDGET_MODE=zero` est la politique par défaut, y compris sans fichier de configuration. Une requête du chatbot ne peut pas la modifier. OpenAI et les endpoints compatibles externes sont bloqués avant l’appel réseau, même si une clé a été renseignée par erreur. Aucune clé n’est transmise à Ollama. Les redirections sont refusées et la boucle d’outils possède une échéance globale.

Ollama n’accepte ici que des adresses HTTP de boucle locale terminées par `/v1` et des noms de modèles sans variante cloud. Le lanceur désactive aussi le cloud côté Ollama : une adresse locale seule ne suffit pas à garantir qu’un autre proxy n’appelle pas un service distant. L’administrateur reste responsable du processus qu’il installe et ne doit pas réactiver des fournisseurs externes sans nouvel accord budgétaire. [Mode local uniquement d’Ollama](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features)

## Si quelque chose bloque

- **Ollama absent** : installer l’application officielle et ouvrir un nouveau terminal.
- **Modèle absent** : relancer avec `--pull` ; prévoir l’espace disque du téléchargement.
- **Port 11435 utilisé** : arrêter votre ancienne session AtlasCare avec Ctrl+C ; ne pas supprimer un processus inconnu.
- **Réponse trop lente** : vérifier la mémoire disponible et fermer les applications lourdes. Ne pas annoncer de performance avant mesure.
- **Site public toujours sans LLM** : c’est le comportement attendu. La boucle locale du site hébergé n’est pas votre ordinateur. Aucun tunnel public non protégé n’est créé.

Une intégration Gemini gratuite est documentée dans [GEMINI-FREE.md](GEMINI-FREE.md). Elle n’est pas active par défaut et ne convient qu’aux données fictives, car les conditions de l’offre gratuite diffèrent du fonctionnement local Ollama.
