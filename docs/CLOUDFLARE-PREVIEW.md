# Préproduction Cloudflare

Cette configuration publie une préproduction isolée pour vérifier l’application sur Cloudflare Workers. Elle ne correspond pas à la production client.

| Élément | Configuration |
| --- | --- |
| Worker | `sav-sc-assistant-preview` |
| URL prévue | `https://sav-sc-assistant-preview.savsc-assistant.workers.dev` |
| Environnement applicatif | `PREPRODUCTION`, édition `client` |
| IA | fournisseur `demo`, seul fournisseur autorisé, budget `zero` |
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

Le Worker attend notamment `SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY`. Tant que ces secrets ne sont pas configurés, les routes d’accès aux dossiers et l’administration restent en échec fermé; la vitrine et les parcours fictifs peuvent être testés séparément. Les clés de fournisseurs LLM et d’embedding ne sont pas nécessaires à cette préproduction démo et ne doivent pas y être ajoutées.

`workers.dev` est destiné à l’évaluation. Ne pas y importer de données client réelles. Avant l’ouverture client, utiliser une base Supabase de production distincte, configurer et tester les secrets, un domaine propre, la sauvegarde/restauration et les contrôles de sécurité. Garder `P1_RELEASE_MODE=off` jusqu’à la qualification live P1.7, la revalidation de fraîcheur, l’approbation métier et le canary supervisé.
