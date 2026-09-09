# Mise en production Supabase

Ce guide décrit le socle Supabase de **SAV SC Assistant AI**. Le projet fourni,
`https://exbhajwuniufgedbkipg.supabase.co`, doit d’abord servir de
**préproduction**. Aucune donnée client réelle ne doit être importée avant la
validation complète des contrôles ci-dessous.

## Ce que le socle apporte

- consultation client sans compte, avec référence et code confidentiel ;
- code haché en bcrypt et session de dossier de 30 minutes ;
- jeton brut conservé uniquement dans un cookie `HttpOnly`, jamais en base ;
- séparation stricte des organisations jusque dans les clés étrangères ;
- administration Supabase Auth avec rôles et MFA obligatoire ;
- RLS sur chaque table, RPC client réservées au serveur et réponses filtrées ;
- audit des accès et mesures techniques sans adresse IP ni contenu client ;
- corpus RAG versionné avec recherche lexicale et colonne vectorielle prête.

Les migrations de référence sont versionnées dans `supabase/migrations/`.
La migration de fondation crée le modèle, puis la migration de durcissement
aligne les politiques RLS et les index sur les conseillers Supabase. Le fichier
`supabase/seed.staging.sql` contient uniquement des données fictives et ne doit
jamais être exécuté dans la future base de production.

## 1. Séparer les environnements

Utiliser ce projet comme préproduction. Pour le lancement réel, créer un second
projet Supabase et appliquer exactement la migration validée. Les clés, les
comptes administrateurs et les données ne doivent jamais être partagés entre
les deux environnements.

## 2. Appliquer la migration

Dans le tableau de bord Supabase : **SQL Editor → New query**, coller le contenu
de la migration, puis exécuter la transaction. Vérifier ensuite :

1. les 17 tables applicatives dans `public` ;
2. RLS activée sur chacune d’elles ;
3. les extensions `pgcrypto` et `vector` ;
4. les fonctions `customer_*`, `admin_*` et `bootstrap_admin` ;
5. aucune permission `anon` sur les tables ou RPC sensibles.

Chaque migration est transactionnelle : une erreur annule l’ensemble. Ne corriger
jamais directement une base déjà utilisée ; ajouter une nouvelle migration
versionnée et la faire relire.

## 3. Créer l’organisation

Exécuter une seule fois en préproduction :

```sql
insert into public.organizations (slug, name, support_email)
values ('sav-sc-assistant', 'SAV SC Assistant AI', 'support@entreprise.example')
returning id;
```

Conserver l’UUID retourné dans le coffre de secrets de l’hébergement sous
`SUPABASE_ORGANIZATION_ID`. Ce n’est pas un mot de passe, mais il ne doit pas
être saisi en dur dans l’interface.

## 4. Configurer l’hébergement

Ajouter les variables côté **serveur**, jamais dans Git ni dans du JavaScript
envoyé au navigateur :

| Variable | Valeur attendue | Sensibilité |
| --- | --- | --- |
| `SUPABASE_URL` | `https://exbhajwuniufgedbkipg.supabase.co` | publique |
| `SUPABASE_PUBLISHABLE_KEY` | nouvelle clé `sb_publishable_…` du projet | publique mais côté serveur ici |
| `SUPABASE_SECRET_KEY` | nouvelle clé `sb_secret_…` du projet | **secret critique** |
| `SUPABASE_ORGANIZATION_ID` | UUID créé à l’étape 3 | configuration |
| `APP_EDITION` | `client` | configuration |

Ne jamais communiquer `SUPABASE_SECRET_KEY` dans un chat, une issue GitHub, une
capture d’écran ou un fichier `.env`. En cas d’exposition, la révoquer
immédiatement puis redéployer.

## 5. Provisionner un administrateur

Pour un compte Auth déjà créé et muni d’un mot de passe, le développeur lance
`npm run admin:grant`, saisit l’email exact et confirme le rôle. Aucun mot de passe
n’est modifié et aucun email n’est envoyé. Le compte se connecte sur `/admin`,
puis configure la double authentification TOTP avant tout accès métier.

Pour un premier compte de test encore inexistant : `npm run admin:create`.
La saisie du mot de passe est masquée. Ne recréez pas un compte invité existant.

**Limite actuelle :** cette version ne possède pas de page de traitement des
invitations ou de définition de mot de passe depuis un lien email. L’ancienne
instruction « inviter puis ouvrir le lien pour définir le mot de passe » était
incomplète. Ne l’utilisez pas comme parcours d’installation de cette version.
Voir [le guide local](TESTER-LA-VERSION.md) pour les commandes et les redirections.

Rôles disponibles : `super_admin`, `sav_manager`, `sc_manager`, `adviser` et
`analyst`. Appliquer le moindre privilège ; réserver `super_admin` à un nombre
minimal de personnes.

## 6. Charger les données fictives

Uniquement en préproduction, exécuter `supabase/seed.staging.sql`. Deux parcours
de test sont créés :

- `SAV-2026-1042` avec le code `482731` ;
- `SC-2026-2048` avec le code `639204`.

Ces codes sont publics et impropres à tout usage réel. En production, les codes
sont générés par le SI métier, transmis au client par un canal convenu, puis
enregistrés uniquement via `set_case_access_code`.

## 7. Valider avant publication

La publication client est autorisée seulement si tous les contrôles passent :

- mauvaise référence et mauvais code produisent la même réponse neutre ;
- verrouillage anti-abus par réseau et par référence ;
- aucun dossier n’est accessible avec le jeton d’un autre dossier ;
- fermeture et expiration invalident immédiatement l’accès ;
- aucune donnée interne d’un événement n’apparaît côté client ;
- aucun administrateur n’accède aux données en AAL1 (sans MFA) ;
- chaque rôle reste limité à son organisation ;
- aucun secret n’apparaît dans les bundles, journaux, erreurs ou Git ;
- tests unitaires, lint, typecheck et build réussissent ;
- test mobile réel, clavier, lecteur d’écran et réseau lent réalisés ;
- procédure de restauration testée sur un environnement isolé.

## 8. Passage de préproduction à production

1. geler la migration validée et créer la base de production séparée ;
2. appliquer la migration sans le seed fictif ;
3. connecter le SI SAV/SC par un compte serveur au moindre privilège ;
4. importer un petit lot contrôlé et réconcilier les comptes ;
5. exécuter les tests de contrat et de sécurité ;
6. configurer alertes, rotation des clés, rétention et restauration ;
7. effectuer une revue humaine métier et une revue de sécurité indépendante ;
8. basculer progressivement, avec procédure de retour arrière documentée.

Le LLM n’obtient jamais la référence, le code d’accès, le jeton de session ni
un accès SQL. Il reçoit seulement les faits déjà filtrés dont il a besoin pour
formuler une réponse. Les décisions métier, permissions et mutations restent
déterministes côté serveur.

## Références officielles

- [Clés API Supabase](https://supabase.com/docs/guides/getting-started/api-keys)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [MFA avec Supabase Auth](https://supabase.com/docs/guides/auth/auth-mfa)
- [Checklist de mise en production](https://supabase.com/docs/guides/deployment/going-into-prod)
