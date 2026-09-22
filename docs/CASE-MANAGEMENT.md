# Gestion des dossiers SAV / Service client

## Objectif

Le centre opérationnel permet aux responsables autorisés de gérer les dossiers depuis l’application sans écrire directement dans Supabase. Les mutations passent par l’API serveur, une session administrateur MFA AAL2, des contrats Zod puis des RPC PostgreSQL contrôlées.

## Rôles

| Rôle | Lecture | Création / modification | Cycle métier | Notes / relais | Audit détaillé |
| --- | --- | --- | --- | --- | --- |
| `super_admin` | SAV + SC | SAV + SC | SAV + SC | Oui | Oui |
| `sav_manager` | SAV | SAV | SAV | Oui, SAV | Non |
| `sc_manager` | Service client | Service client | Service client | Oui, SC | Non |
| `adviser` | Dossiers opérationnels autorisés | Non | Non | Oui | Non |
| `analyst` | Indicateurs / audit autorisés | Non | Non | Non | Oui |

La base de données répète ces contrôles. Masquer un bouton dans l’interface n’est jamais considéré comme une autorisation.

## Modèle métier

`service_cases` conserve l’état courant optimisé pour la lecture. `case_events` et `audit_events` conservent l’historique append-only des changements métier et des actions sensibles.

Chaque dossier possède :

- un propriétaire métier explicite : `sav` ou `customer_service` ;
- une référence générée côté serveur avec compteur concurrentiel ;
- une version utilisée pour la concurrence optimiste ;
- un cycle de statuts validé côté PostgreSQL ;
- des associations facultatives avec client, produit et magasin ;
- les informations de garantie, devis, remboursement, échéance et mode de remise ;
- un état d’archivage distinct de son statut métier.

## Création

La création est idempotente grâce à `case_commands.request_id`. La référence n’est jamais choisie par le navigateur.

Un code client numérique est généré avec une source cryptographique. Seul son hash bcrypt coût 12 est persisté. Le code en clair est retourné une seule fois à l’administrateur. Un replay d’une requête déjà terminée ne peut pas réafficher ce code.

Les clients et produits avec identifiant externe sont réutilisés de manière concurrent-safe. Les magasins proposés par l’interface sont limités aux magasins actifs de l’organisation.

## Modification et concurrence

Chaque mutation reçoit `expectedVersion`. Une modification concurrente fait échouer la requête au lieu d’écraser silencieusement le travail d’un autre opérateur.

Une mise à jour sans changement effectif reste idempotente et ne crée pas artificiellement une nouvelle version.

Les changements enregistrent uniquement les catégories de champs modifiés dans l’audit ; les valeurs métier sensibles ne sont pas dupliquées inutilement dans les métadonnées d’audit.

## Cycle de vie

Les transitions sont définies par famille de dossier. Le navigateur n’affiche que les transitions prévues, mais PostgreSQL reste l’autorité finale.

Exemples SAV :

`opened → diagnosis → waiting_part → repairing → repaired → ready → delivered → resolved`

Exemples Service client :

`opened → complaint_review → refund_pending → refunded → resolved`

Les états terminaux `resolved` et `cancelled` ne permettent aucune nouvelle transition.

## Code d’accès client

La rotation du code :

1. verrouille le dossier et vérifie sa version ;
2. révoque les codes actifs ;
3. révoque explicitement les sessions client actives ;
4. génère un nouveau code ;
5. stocke uniquement son hash bcrypt ;
6. incrémente la version du dossier ;
7. enregistre événement et audit ;
8. retourne le nouveau code une seule fois.

## Archivage

L’application n’effectue pas de suppression physique d’un dossier métier.

L’archivage :

- conserve le dossier, ses événements et son audit ;
- révoque les codes et sessions client ;
- annule les relais humains encore ouverts ;
- clôt les conversations assistant encore actives ;
- retire le dossier des vues opérationnelles par défaut ;
- exige un motif et une confirmation explicite dans l’interface.

Les dossiers archivés restent consultables avec le filtre dédié et deviennent non modifiables.

## Sécurité

Les propriétés suivantes sont cumulatives :

- MFA AAL2 côté admin ;
- contrôle exact de l’organisation ;
- RBAC SAV / Service client dans les RPC ;
- RLS alignée sur la même propriété métier pour les lectures directes authentifiées ;
- protection Origin / `Sec-Fetch-Site` sur les mutations ;
- validation stricte des payloads ;
- concurrence optimiste ;
- idempotency keys ;
- aucun accès direct aux tables sensibles depuis le navigateur ;
- aucun code client en clair persisté.

## Déploiement

La migration `20260922075414_case_management_engine.sql` doit être appliquée avant d’activer l’interface sur un environnement distant.

Gates obligatoires :

1. CI complète verte ;
2. migration appliquée sans erreur en préproduction ;
3. contrôle Supabase Security Advisor après migration ;
4. smoke test création → consultation client → transition → rotation du code → archivage ;
5. vérification qu’un rôle SAV ne voit/modifie pas un dossier SC, et inversement ;
6. validation mobile / desktop de l’interface ;
7. seulement ensuite promotion vers la production.

Aucune migration destructive ou suppression physique de dossier n’est requise pour le rollback applicatif.
