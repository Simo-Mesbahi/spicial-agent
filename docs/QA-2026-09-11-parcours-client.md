# Parcours client — validation du 11 septembre 2026

## Changements

- Accueil centré sur « Suivre mon dossier », accessible même si la démonstration ne démarre pas.
- Route `/file` et page `/contact` accessibles directement ; `/suivi` reste compatible.
- Accès au suivi sans compte, avec la même vérification serveur et les mêmes cookies protégés.
- Formulaire visible pendant la connexion au service, bouton désactivé tant que le service n’est pas prêt.
- Sur les petits écrans, formulaire placé avant le texte explicatif, champs de 16 px et contrôles tactiles de 44 px.
- Affichage/masquage du code, aide pour retrouver les identifiants et accès au contact depuis cette aide.
- Contact, suivi et accueil reliés entre eux. Aucun ajout de dépendance ni changement de clé, de rôle ou de base.

## Résultats

- TypeScript et lint applicatif : réussis, sans avertissement applicatif.
- Tests applicatifs : 124/124, incluant six tests du moteur Cloudflare.
- Compilation de production : réussie.
- Tests de rendu : 10/10, dont les routes `/file`, `/suivi` et `/contact` sans session.
- Navigateur de prévisualisation : accueil affiché, clic vers `/file`, bascule afficher/masquer, aide dépliée, navigation vers `/contact`, rendu et liens de messagerie contrôlés. Aucun email envoyé.

## Limites

Le navigateur testé est celui de prévisualisation, pas un iPhone physique. La présentation mobile est adaptée par les règles responsive ; une recette sur téléphone réel reste nécessaire.
Les clés Supabase du propriétaire ne sont pas disponibles dans cet environnement : le navigateur valide ici l’état d’indisponibilité, sans prétendre ouvrir son vrai dossier.
Les parcours métier restent couverts par les tests applicatifs et les vérifications SQL précédentes ; ce contrôle UI ne remplace pas un test avec ses identifiants réels et son MFA.
Aucun test de charge ni appel Gemini réel n’a été effectué. Les statistiques de vitesse en production ne sont donc pas établies par ce rapport.
