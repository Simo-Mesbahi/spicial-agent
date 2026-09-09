# Tester le suivi et l’administration — 9 septembre 2026

## 1. Mettre à jour le code

Dans le terminal du projet, arrêter le serveur avec Ctrl+C. Après récupération
de cette correction sur la branche `fix/local-supabase-access` :

```bash
git fetch origin
git switch fix/local-supabase-access
git pull --ff-only
npm ci
npm run backend:doctor
```

Le diagnostic lit `.dev.vars` à la racine du projet, sans afficher ses valeurs.
Il vérifie Auth, l’organisation et l’interdiction d’accès public aux dossiers.
Si une variable manque, lancer `npm run backend:setup`. Entrée conserve une clé
déjà enregistrée. Ce programme protège le fichier et conserve les autres réglages.

Les quatre noms exacts requis sont :

```dotenv
SUPABASE_URL=https://exbhajwuniufgedbkipg.supabase.co
SUPABASE_PUBLISHABLE_KEY=<clé publique du projet>
SUPABASE_SECRET_KEY=<clé serveur du même projet>
SUPABASE_ORGANIZATION_ID=00000000-0000-4000-8000-000000000001
```

Ne copiez pas les valeurs entre chevrons : utilisez vos propres clés. L’UUID
ci-dessus désigne seulement l’organisation fictive déjà installée en préproduction.
Les clés seules ne suffisent pas. Modifier `.env.example` ne configure pas le serveur.
Ne transmettez jamais `.dev.vars` à GitHub ou dans une capture.

## 2. Relancer et tester le suivi

```bash
npm run db:migrate:local
npm run dev -- --host 0.0.0.0 --port 8000
```

La première commande prépare la base locale utilisée pour la limitation des
tentatives. Elle ne modifie pas la base Supabase distante.

Dans Codespaces, ouvrir le port 8000 depuis **Ports → Ouvrir dans le navigateur**.
Sur ordinateur local, ouvrir `http://localhost:8000/suivi`. Sur téléphone,
utiliser l’adresse HTTPS du port Codespaces ; `localhost` désigne le téléphone.

Dans ce même navigateur, `/api/production/config` doit afficher
`"configured":true`. Cette réponse ne contient pas les clés. Si le diagnostic
passe mais que cette valeur reste fausse, vérifier que le terminal et `.dev.vars`
appartiennent au même dossier, puis arrêter et redémarrer le serveur. Un autre
serveur encore ouvert ou une autre adresse de prévisualisation peut servir l’ancienne version.

Tester `/suivi` avec les données fictives :

| Référence | Code |
| --- | --- |
| SAV-2026-1042 | 482731 |
| SC-2026-2048 | 639204 |

Vérifier l’historique, l’actualisation, la fermeture du dossier et le refus d’un
code erroné. La page cache le dossier à l’expiration de la session, y compris
après un retour depuis une autre application sur téléphone.

## 3. Compte administrateur existant

Créer un utilisateur dans Authentication ne lui attribue **aucun droit métier**.
Pour le compte que vous avez déjà créé et dont vous connaissez le mot de passe :

```bash
npm run admin:grant
```

Saisir son email exact, le nom affiché, puis `ATTRIBUER` pour confirmer le rôle
super_admin. Cette commande est réservée au développeur disposant de la clé
serveur. Elle ne change ni le mot de passe ni l’état de confirmation du compte.

Ouvrir `/admin`, saisir cet email et ce mot de passe, puis configurer le TOTP
avec une application d’authentification. Aucune donnée métier ne doit être
accessible avant cette seconde vérification. Ouvrir ensuite le centre opérationnel.
Dans une fenêtre privée non connectée, `/admin/operations` doit demander la connexion.

Pour un compte de test **inexistant** uniquement : `npm run admin:create`.

## 4. Pourquoi le lien d’invitation peut être inaccessible

Supabase utilise **Authentication → URL Configuration → Site URL** comme
redirection par défaut. Un lien vers `localhost:3000`, un Codespace arrêté ou une
ancienne adresse ne peut pas ouvrir votre application actuelle. Vérifier le
domaine et le port, sans partager la partie du lien contenant des jetons.

La valeur doit correspondre à l’adresse effectivement accessible de votre site.
Les Redirect URLs doivent aussi correspondre aux destinations autorisées.
Voir la [documentation Supabase](https://supabase.com/docs/guides/auth/redirect-urls).

Cette version n’implémente pas la définition d’un mot de passe depuis une
invitation. Corriger l’adresse de redirection ne suffit donc pas à ajouter ce
parcours. Pour le compte déjà confirmé avec mot de passe, utiliser directement
la connexion `/admin` après `admin:grant` : le lien email n’est pas nécessaire.

## Limites de validation

Les clés enregistrées dans votre Codespace ne sont pas présentes dans cet espace
de développement ni automatiquement sur le site publié. Le test local avec vos
clés et votre TOTP reste indispensable. Ne considérer ni la compilation ni les
tests simulés comme une validation de cette connexion réelle.
