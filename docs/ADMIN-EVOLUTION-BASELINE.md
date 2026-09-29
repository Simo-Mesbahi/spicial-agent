# Administration SAV/SC — référence et évolution

Audit du 29 septembre 2026, base `8c2ab64` (`main`, PR #99).
Cette référence distingue le code vérifié localement de l'exploitation distante.
Les contrôles locaux utilisent des données fictives et ne déclenchent aucun appel LLM.

## Référence avant modification

| Contrôle | Résultat observé |
| --- | --- |
| `npm test` | 755 réussis, 0 échec, 0 ignoré ; 10,22 s sur cet exécuteur |
| `npm run typecheck` | Réussi |
| `npm run lint:app` | Réussi |
| `npm run check:regressions` | Réussi |
| `npm run eval:ai` | 307 scénarios, 1 116 tours, 0 régression de référence, 439 écarts connus |
| Sécurité du corpus hors ligne | 57/57 contrôles ; statut API attendu 1 116/1 116 |
| Latence du corpus hors ligne | P50 0,91 ms ; P95 1,80 ms ; P99 3,61 ms |
| RAG / génération / grounding | Modes dry-run vérifiés, sans appel fournisseur ; aucune nouvelle qualification live |
| Latences API/SQL distantes, charge, quotas réels | Non mesurés : aucun compte fournisseur ou backend distant utilisé |

La latence du corpus mesure un traitement local synthétique. Elle ne représente
ni le temps de réponse réseau de l'application, ni la qualité d'un LLM en direct.
Les 439 écarts sont explicitement conservés : le passage des gates de régression
ne signifie pas une exactitude parfaite. Aucune baseline ou gate n'est abaissée.

## Fonctions et garanties déjà présentes

- Dossiers : création idempotente, référence serveur, recherche client/produit,
  contrôles SAV/SC, transitions métier, version optimiste, événements, notes,
  archivage avec révocation des sessions/code client. Voir `CASE-MANAGEMENT.md`.
- Base documentaire : brouillon, revue, publication, versions, archivage,
  dates/langue/marché, publication des chunks et revalidation des sources P1.
- Pilotage : paramètres versionnés par organisation de déploiement/environnement,
  rôle super_admin/MFA, fournisseur et secours borné, quota, validation serveur.
- Sécurité : contrôles API et RPC, RLS, organisation, origine des mutations,
  absence de clés fournisseur dans les réglages envoyés au navigateur.
- CI : types, lint, tests, régressions historiques, smoke origine, évaluations
  hors ligne, build et tests de rendu. La qualification live est distincte.

## Écarts constatés et ordre de livraison

1. **Navigation dossiers (lot 1)** : l'API accepte déjà `offset`, mais le centre
   opérationnel charge seulement les 30 premiers dossiers sans navigation.
   Des lectures concurrentes peuvent publier une ancienne sélection. Ajouter
   pagination, filtre statut, validation des bornes API et annulation des lectures
   obsolètes. Conserver les contrats de mutation et les droits existants.
2. **Aperçu RAG (lot 2)** : le bouton des réglages appelle `retrieve()` sur le corpus
   statique, même quand le chat utilise Supabase. `ragMinAnchors` concerne ce
   corpus statique uniquement ; il ne règle pas le seuil hybride. Rendre cette
   portée explicite et proposer un aperçu contrôlé de la recherche effectivement
   configurée, sans activer implicitement des appels d'embedding.
3. **Ergonomie métier (lots suivants)** : tester les formulaires réels, les erreurs
   de conflit et la conservation des saisies, avec responsables SAV/SC ; améliorer
   sur cette base. La présence d'un contrôle dans le code ne prouve pas son confort
   d'utilisation en production.
4. **Intégrations** : contrat ERP/CRM et source d'autorité à choisir avec le système
   réel. Préserver les identifiants externes et l'idempotence existants ; qualifier
   synchronisation, conflits et reprise avant branchement de vrais dossiers.
5. **Profils d'agent** : option à évaluer après les fondations. Chaque profil doit
   avoir un schéma borné, une version et une évaluation, sans affaiblir les règles
   serveur ni rendre une attestation P1 valide pour une autre configuration.
6. **Charge et exploitation** : mesurer SQL et API en préproduction sur un volume
   représentatif, définir les objectifs de latence/capacité, puis optimiser les
   requêtes coûteuses. Les pages à offset sont une première correction d'accès,
   pas une promesse de performance à plusieurs millions de dossiers.

## Lot 1 — navigation des dossiers

Avant : un appel borné à 30 dossiers, aucune page suivante dans l'interface.
Après : pages de 30, compteur, précédent/suivant, filtre par statut, maintien des
filtres soumis pendant la navigation. Une recherche ou une mutation rafraîchit la
liste depuis sa première page. Un total réduit par archivage concurrent corrige
une page devenue vide au maximum une fois. Aucun préchargement de tout le corpus.

Les lectures de liste/détail annulées ne peuvent plus restaurer de résultat ou
d'erreur obsolète. Le chargement d'ensemble applique les résultats seulement si
l'ensemble réussit ; une erreur d'authentification efface les données affichées.
Les changements de dossier/page demandent confirmation si des informations du
dossier ou une note ne sont pas enregistrées.

La pagination API refuse les nombres fractionnaires, non finis ou hors limites,
les statuts inconnus et les types de dossier inconnus avant l'appel métier.
Les RPC utilisent toujours le token de l'administrateur, pas une clé privilégiée.

Tests comportementaux : 65 dossiers sur trois pages sans omission, conservation
des filtres, disparition de la dernière page, réponse hors ordre, annulation,
validation API, MFA et refus d'une organisation étrangère.
Aucune migration ni modification de P1_RELEASE_MODE. Rollback : revenir au commit
applicatif précédent ; les données et historiques restent compatibles.

Vérifications du lot 1 : 762 tests réussis (7 nouveaux), types/lint/build réussis.
Le navigateur Chromium de cet exécuteur est absent ; son téléchargement ne fournit
pas une archive exploitable. Le parcours visuel mobile/clavier reste donc à
recetter avant déploiement. Les tests HTTP/contrôleurs ne remplacent pas cette recette.
