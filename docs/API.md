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

La configuration publique inclut `budgetMode`, `externalCallsAllowed` et `blockedReason`. `ready` signifie « configuration valide », pas « génération réelle testée » : `/api/health` n’envoie aucun appel au modèle. En budget `zero`, un fournisseur externe retourne 503 avant appel réseau et consommation du quota de messages. Aucun paramètre HTTP ne peut modifier le budget. Les réponses du modèle conservent `mode` et `caseVersion` dans leurs métadonnées.

## Synthèse du dossier dans la conversation

Les nouvelles réponses contiennent `metadata.caseBrief` (schéma 1) uniquement si `get_case` a effectivement été utilisé avec un dossier autorisé. Ce petit instantané est construit côté serveur depuis le dossier, jamais depuis le texte généré par un LLM : référence, produit, état, version, dernière mise à jour, prochaine étape du parcours, consigne client, estimation éventuellement enregistrée et montant pertinent. Il exclut codes, secrets et identité client. `caseVersion` est nul sans consultation du dossier. `metadata.fallback` vaut `daily_limit` ou `provider_unavailable` lorsque le serveur a volontairement remplacé une génération indisponible ou non vérifiable par une réponse déterministe ; le mode affiché devient alors `demo`.

L’instantané est conservé dans les métadonnées JSON du message existant, sans changement de schéma ni nouvelle table. Il reste historique lorsque le simulateur fait avancer le dossier. L’interface compare sa version à celle du même dossier vérifié : une ancienne synthèse propose une nouvelle consultation et ne permet pas de valider son ancien devis. Le serveur continue de vérifier la version et la confirmation de toute action. Les conversations antérieures dépourvues de synthèse restent lisibles.

`metadata.presentation = "case_brief"` ne concerne que les réponses de statut déterministes reconnues par le serveur. Leur texte intégral reste accessible sous la synthèse. Les réponses génératives, documentaires, de sécurité et de relais restent présentées comme du texte ; un éventuel instantané métier est distinct de leur contenu.

Les corps JSON entrants sont limités à 8 192 octets pendant leur lecture, y compris sans en-tête `Content-Length`. Les réponses fournisseur sont limitées à 65 536 octets et doivent respecter un schéma strict. Un outil inconnu, des arguments supplémentaires, un identifiant répété, une réponse tronquée, un contenu trop long ou une consultation obligatoire absente déclenchent le secours déterministe.
