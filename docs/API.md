# Contrat HTTP

Toutes les réponses de données utilisent `Cache-Control: no-store`. Les erreurs JSON contiennent un champ `error`. Le cookie de session est requis sauf pour l’état de service, les documents et la création d’espace. Les mutations exigent `Content-Type: application/json`, même origine et `X-Atlas-CSRF` (reçu à la création de l’espace).

| Méthode | Route              | Effet                                                          |
| ------- | ------------------ | -------------------------------------------------------------- |
| GET     | `/api/health`      | Vérification du schéma et mode configuré, aucun dossier        |
| GET     | `/api/knowledge`   | Corpus public fictif                                           |
| POST    | `/api/session`     | Crée l’espace et le cookie, ou restitue la session existante   |
| GET     | `/api/snapshot`    | État de l’espace de démonstration possédé par le visiteur      |
| DELETE  | `/api/session`     | Supprime l’espace courant et ses données                       |
| POST    | `/api/verify`      | Vérifie `reference` et `code`, crée un grant d’une heure       |
| POST    | `/api/chat`        | `message`, `caseId` facultatif ; grant exigé si dossier fourni |
| POST    | `/api/case-action` | `caseId`, `action`, `version`, `requestId`, `confirm`          |
| POST    | `/api/simulation`  | `action`: `toggle` (+ `running`), `tick` ou `generate`         |

Actions : `advance`, `delay` (opérateur fictif limité à son espace) ; `accept_quote`, `decline_quote`, `handoff` (grant et confirmation explicite requis). Un état périmé retourne 409. Le rejeu de `requestId` sur le même dossier ne répète pas la transition.

Codes attendus : 400 données invalides, 401 session manquante/expirée, 403 accès/CSRF/code refusé, 404 ressource inaccessible, 409 état incompatible ou périmé, 413 requête trop grande, 415 format incorrect, 429 quota, 503 dépendance indisponible.

`/api/snapshot` est une API de laboratoire, pas un endpoint client de production : elle expose les identifiants des scénarios fictifs au propriétaire de l’espace pour lui permettre de jouer les deux rôles. Ne pas brancher cet endpoint sur des données clients réelles.
