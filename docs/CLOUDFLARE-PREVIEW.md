# Préproduction Cloudflare

Cette configuration publie une préproduction isolée pour vérifier l’application sur Cloudflare Workers. Elle ne correspond pas à la production client.

| Élément | Configuration |
| --- | --- |
| Worker | `sav-sc-assistant-preview` |
| URL prévue | `https://sav-sc-assistant-preview.savsc-assistant.workers.dev` |
| Environnement applicatif | `PREPRODUCTION`, édition `client` |
| IA | Gemini `gemini-3.5-flash-lite`, budget `free`, plafond applicatif de 3 interactions IA par fenêtre glissante de 24 h, repli démo si quota ou fournisseur indisponible |
| Release P1 | `P1_RELEASE_MODE=off` |
| D1 | `sav-sc-assistant-preview`, migrations `0000` à `0007` appliquées |
| Supabase | projet de préproduction européen, clés serveur à configurer séparément |

## Déployer

Prévalider le build Cloudflare, les assets et le bundle Wrangler sans déployer :

```bash
npm run check:cloudflare:preview
```

Après authentification Wrangler avec le compte Cloudflare du projet, exécuter :

```bash
npm run deploy:cloudflare:preview
```

La commande reconstruit le commit local, vérifie les paramètres de préproduction générés, puis déploie le Worker et les assets avec Wrangler. Elle refuse de publier si le Worker, D1 ou les garde-fous IA/P1 ne correspondent pas à la configuration relue.

Les migrations D1 sont une opération séparée et ne sont pas exécutées pendant le déploiement du Worker :

```bash
npm run db:migrate:cloudflare:preview
```

Les migrations déjà appliquées sont enregistrées dans `d1_migrations`, au format Wrangler. Examiner et valider chaque nouvelle migration avant de l’appliquer à distance.

## Secrets et limites

Ne jamais placer une clé ou valeur de secret dans Git, la configuration Wrangler versionnée, les arguments d’une commande, une issue ou une conversation. Ajouter les valeurs directement dans Cloudflare comme secrets Worker, ou utiliser `wrangler secret put` depuis une session Wrangler autorisée.

Le Worker attend `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` et `GEMINI_API_KEY` comme secrets Cloudflare. Aucune valeur de clé ne doit être inscrite dans `wrangler.preview.json`. La vitrine ne déclenche pas Gemini au chargement ; seules les questions envoyées à `/demo` peuvent en déclencher. Le parcours `/file` ne propose pas le chat avancé tant que `LLM_ORCHESTRATOR` n'est pas activé et qualifié. `LLM_DAILY_LIMIT=20` borne les interactions IA dans D1 à 20 pour toute la démonstration (plafond global partagé, pas par visiteur), par fenêtre glissante de 24 h. La réponse automatique à l’ouverture d’un dossier reste activée et peut consommer une interaction. Ce réglage ne relève pas les quotas propres au projet Google, mais **ne mesure pas les appels Google** : une question métier peut en demander plusieurs et épuiser la limite Google avant ce plafond. Le repli local reste disponible en cas de quota ou d'indisponibilité ; inspecter les métadonnées `mode`, `providerCalls` et `fallback` pour distinguer une vraie réponse Gemini.

`workers.dev` est destiné à l’évaluation. N'y saisir que des questions et dossiers fictifs : le niveau gratuit de Gemini permet à Google d'utiliser les contenus pour améliorer ses produits. Avant l’ouverture client, utiliser une base Supabase de production distincte, une offre et une gouvernance des données adaptées, un domaine propre, la sauvegarde/restauration et les contrôles de sécurité. Garder `P1_RELEASE_MODE=off` jusqu’à la qualification live P1.7, la revalidation de fraîcheur, l’approbation métier et le canary supervisé.
