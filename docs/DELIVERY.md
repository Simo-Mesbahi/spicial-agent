# Bilan de livraison — 31 août 2026

## Livré

- Plateforme AtlasCare AI déployée sur https://atlascare-ai.mohammed-elmesbahi.chatgpt.site.
- Interface client, dossiers, espace conseiller fictif, laboratoire, documents et présentation du projet.
- Accueil éditorial avec trois aperçus interactifs, vérification guidée, comparaison avant/après d’un dossier, suggestions contextuelles et panneau de suivi repliable sur mobile.
- Base relationnelle, 8 scénarios initiaux et 12 documents fictifs versionnés.
- Connecteurs LLM OpenAI et compatibles, avec outils de consultation contrôlés.
- Mode actif par défaut : démonstration déterministe sans appel à un LLM.
- Budget IA 0 € appliqué par défaut au serveur : fournisseurs externes bloqués, connecteur Ollama local sans clé, lanceur isolé avec cloud désactivé et diagnostic séparant installation et génération réelle.

## Vérifications exécutées

- 28 tests API et réponses : sessions, accès aux dossiers, isolation entre visiteurs, codes erronés, quotas, devis, transitions, rejeu, historique, simulation, relais conseiller, entrées invalides, expiration, versions des réponses, relances contextuelles, blocage des fournisseurs payants et contrats d’appel d’outils simulés.
- 6 tests d’expérience : cohérence des aperçus, étapes du guide, versions historiques, suggestions et recherche sans accents.
- 9 tests de politique de budget, adresses locales, configuration conservée/sauvegardée et diagnostic Ollama simulé.
- 5 tests du rendu serveur et des composants du socle.
- Vérification TypeScript, ESLint applicatif et compilation de production : réussies.
- Les deux migrations ont été appliquées avec succès sur l’émulateur D1 local.
- Le service de déploiement a confirmé la publication de la plateforme et le schéma D1 a été contrôlé.

Ces résultats ne constituent pas un test de bout en bout dans un navigateur, un appel à un modèle réel, un test de charge ni un audit de sécurité indépendant. Le workflow GitHub Actions est fourni ; le résultat de chaque exécution est consultable dans [Actions](https://github.com/Simo-Mesbahi/spicial-agent/actions). Les validations locales et les validations GitHub restent distinctes.
La satisfaction utilisateur n’est pas encore mesurée : le [protocole d’essai](EXPERIENCE.md) prépare cette évaluation, sans publier de résultat inventé.

## Blocages et limites

L’écriture vers `Simo-Mesbahi/spicial-agent` avait initialement été refusée avec `403 Resource not accessible by integration`. Une nouvelle vérification après réautorisation a confirmé que la création de contenu fonctionne désormais. L’autorisation de l’utilisateur dans la conversation ne remplace pas les droits de l’application GitHub. Les sources complètes et leur historique sont à consulter dans [le dépôt du projet](https://github.com/Simo-Mesbahi/spicial-agent) ; l’archive initiale reste une copie de la première livraison.

Aucun serveur Ollama n’est disponible dans l’environnement de livraison. Le diagnostic local a confirmé son absence ; les tests du connecteur simulent le fournisseur. Aucune qualité de génération ni latence réelle de modèle n’a été mesurée. Aucune clé payante n’est demandée pour le parcours local. La recherche documentaire est lexicale. La simulation automatique progresse à la consultation, sans processus permanent en arrière-plan.

## Trois prochaines priorités

1. Maintenir une publication reproductible : contrôler le workflow CI de chaque modification et la cohérence entre les sources et la plateforme.
2. Lancer Ollama sur un ordinateur disponible et évaluer les réponses françaises, les sources, les appels d’outils, la latence et la mémoire sur un jeu de validation métier indépendant, sans activer d’API payante.
3. Préparer un pilote avec l’entreprise : documents validés, contrats d’API SAV/CRM, authentification réelle, contrôle d’accès, tests dans le navigateur et revue de sécurité.
