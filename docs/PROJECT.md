# AtlasCare AI — périmètre et décisions

Plateforme de démonstration pour l’enseigne fictive Maison Atlas. Code et données synthétiques uniquement. Le produit couvre les consultations SAV et service client, les explications documentaires, les demandes de contact, les confirmations de devis et les simulations.

## Architecture

Interface React/Vinext → API TypeScript → D1/SQLite relationnel. Le serveur applique les autorisations, les transitions et les validations. Le modèle ne reçoit jamais les codes d’accès ni les cookies et ne peut écrire directement dans la base. Budget IA retenu : 0 €. Modes autorisés par défaut : démonstration déterministe (sans LLM) et Ollama local. Les connecteurs externes OpenAI/compatibles restent disponibles dans le code, mais leur activation nécessiterait un nouvel accord budgétaire.

Les visiteurs disposent d’un espace de simulation individuel, protégé par un cookie aléatoire HttpOnly. L’accès client à chaque dossier nécessite une référence et un code. Le rôle opérateur est explicitement un rôle de démonstration, limité au même espace ; il ne représente pas une authentification de salarié de production.

Le mode explicite `free` autorise aussi Gemini pour la démonstration fictive, après enregistrement de `GEMINI_API_KEY` dans l’hébergement et vérification d’un compte Google sans facturation. Il ne modifie pas le défaut `demo`/`zero` et ne valide pas à lui seul le fonctionnement réel du modèle.

## Livraison

- Base relationnelle et scénarios cohérents : réparation, livraison, retour, remboursement, devis et réclamation.
- API de consultation, événements, vérification de code, devis et demande de conseiller.
- Simulation manuelle et horloge automatique rattrapée à la consultation (pas de promesse de processus permanent sur un serveur inactif).
- Recherche documentaire lexicale et réponses sourcées ; génération LLM seulement après configuration explicite.
- Interface client, dossiers, espace opérateur, simulation, connaissances et présentation technique.
- Tests de permissions, transitions, isolation, idempotence et historique.
- Reprise des messages après coupure, réponses et historique enregistrés atomiquement, information de fraîcheur et attente réseau bornée.

## Limites à rendre visibles

Aucune intégration réelle avec une enseigne ou un transporteur. Aucune notification externe, facturation, décision juridique ou remboursement réel. Les estimations sont fictives et identifiées. Un modèle ne sera qualifié de performant qu’après évaluation réelle. La connexion LLM exige un modèle accessible et, selon le fournisseur, une clé configurée comme secret.

## Critères de validation

Un visiteur ne peut accéder à l’espace d’un autre. Un dossier client non vérifié n’est pas transmis au modèle. Un devis exige une confirmation et une version actuelle du dossier. Une requête rejouée ne répète pas une action. Les documents et dates affichés correspondent aux données. Une indisponibilité, un quota ou une réponse fournisseur non vérifiable déclenche un secours déterministe explicitement identifié comme sans IA ; aucune réponse IA réussie n’est simulée.
