# Administration — 14 septembre 2026

## Livraison

- Navigation commune persistante : vue d’ensemble, opérations, performance et réglages. Les routes /admin, /admin/operations, /file et /suivi restent présentes.
- /admin/performance : indicateurs réels sur 24 heures, latence P95, erreurs, limitations et ventilation par route ; absence de mesures affichée explicitement.
- Onglet Réglages : fournisseur/modèle autorisé côté serveur, quota quotidien partagé, nombre de documents et sélectivité lexicale. Aperçu de recherche sans appel au LLM ni enregistrement.
- Environnement visible : APP_ENVIRONMENT=LOCAL, PREPRODUCTION ou PRODUCTION. Sans déclaration, seuls les hôtes locaux connus sont identifiés LOCAL. Sinon NON CONFIGURÉ et enregistrement bloqué.
- Révisions D1 persistantes, atomiques et attribuées à leur auteur. Un numéro de version empêche les écrasements concurrents. Les 10 dernières versions peuvent être reprises dans le formulaire puis confirmées.
- Paramètres isolés par environnement et organisation du déploiement. MFA et appartenance active vérifiées avant lecture ; super-administrateur requis pour enregistrer ou tester une recherche.
- Secrets, URL des fournisseurs et politique budgétaire restent côté serveur. Un fournisseur révoqué entraîne un repli documentaire. Aucune température libre ni option de RAG vectoriel fictive.

## Recette

138 tests applicatifs et 10 tests de rendu/composants réussis. TypeScript, lint applicatif et compilation validés. La migration D1 0003 est appliquée et vérifiée localement.

Les nouveaux tests couvrent : sauvegarde et historique, refus d’une version périmée, effet du réglage sur la recherche, quota zéro, refus des changements de budget/secrets, refus du rôle analyste en écriture, MFA, organisation, origine externe, confirmation et isolation des environnements, aperçu sans sauvegarde et révocation d’un fournisseur.

Navigateur sans session : /admin/performance ne révèle pas de réglages et propose la connexion ; /admin conserve le formulaire existant ; la navigation commune affiche LOCAL. La recette authentifiée du formulaire avec un vrai compte MFA, le téléphone physique et le test de charge restent à réaliser. Aucun accès réel n’a été contourné pour cette recette.

## Mise en service

Après récupération du code : `npm run db:migrate:local`, puis `npm run dev`. Garder les clés dans .dev.vars. Définir APP_ENVIRONMENT=LOCAL localement, PREPRODUCTION sur l’environnement de recette et PRODUCTION sur le site final. Ces valeurs doivent être définies dans les variables serveur de chaque hébergement.

L’utilisateur doit ouvrir /admin, terminer le MFA, puis Performance & réglages. Tester une recherche, modifier une valeur, confirmer l’environnement, enregistrer, actualiser et vérifier l’historique. Vérifier également avec un compte analyste que l’enregistrement est interdit. Le rôle super_admin doit appartenir à SUPABASE_ORGANIZATION_ID.

La migration D1 doit accompagner le déploiement ; aucun schéma n’est créé au fil des requêtes. Le chat conserve ses dossiers D1 et ses 12 documents fictifs : ces réglages ne réalisent pas la connexion du chat aux dossiers Supabase de production. Les tests fournisseurs restent simulés. Publication client à condition de terminer la recette authentifiée et métier.

## Évolutions proposées, non implémentées dans cette livraison

1. Alertes sur taux d’erreur, latence P95 et quotas, avec seuils et destinataires configurés.
2. Jeu de questions métier validées et tableau de qualité RAG : pertinence des sources, abstentions et régressions.
3. Cycle de validation des documents : brouillon, approbation, publication et expiration.
4. Mesures d’usage client : résolution sans relais, temps jusqu’à résolution et satisfaction volontaire.
