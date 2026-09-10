import { createInterface } from 'node:readline/promises';
import { readFile, writeFile, rename, lstat, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function localFile(directory = root) {
  const path = resolve(directory, '.dev.vars');
  try {
    const stat = await lstat(path);
    if (!stat.isFile())
      throw new Error('.dev.vars doit être un fichier régulier, sans lien symbolique.');
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export function mergeConfiguration(previous, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z_]+$/.test(key) || typeof value !== 'string' || /[\r\n\0]/.test(value))
      throw new Error('Valeur de configuration invalide.');
  }
  const lines = previous.split(/\r?\n/).filter((line) => {
    const key = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/)?.[1];
    return !Object.hasOwn(values, key ?? '');
  });
  return (
    lines.join('\n').trimEnd() +
    '\n' +
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') +
    '\n'
  );
}

export async function saveConfiguration(values, directory = root) {
  const previous = await localFile(directory);
  const next = mergeConfiguration(previous, values);
  const path = resolve(directory, '.dev.vars');
  if (previous)
    await writeFile(path + '.backup-' + crypto.randomUUID(), previous, { flag: 'wx', mode: 0o600 });
  const temporary = path + '.tmp-' + crypto.randomUUID();
  await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function question(label, fallback = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (
      (await rl.question(label + (fallback ? ` [${fallback}]` : '') + ' : ')).trim() || fallback
    );
  } finally {
    rl.close();
  }
}

async function secret(label) {
  if (!process.stdin.isTTY)
    throw new Error('Ouvrez un terminal interactif pour saisir les secrets sans les afficher.');
  process.stdout.write(label + ' (saisie masquée) : ');
  return new Promise((resolveValue, reject) => {
    let value = '';
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(!!wasRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolveValue(value);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') return finish(new Error('Saisie annulée.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && char !== '\u001b') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

export function validateBackend(env) {
  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    throw new Error('SUPABASE_URL manque ou est invalide.');
  }
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Utilisez l’URL HTTPS officielle de votre projet Supabase.');
  if (!UUID.test(env.SUPABASE_ORGANIZATION_ID ?? ''))
    throw new Error('SUPABASE_ORGANIZATION_ID manque ou est invalide.');
  for (const [name, prefix] of [
    ['SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_'],
    ['SUPABASE_SECRET_KEY', 'sb_secret_'],
  ]) {
    const value = env[name] ?? '';
    if (
      (!value.startsWith(prefix) && !value.startsWith('eyJ')) ||
      value.length < 25 ||
      /\s/.test(value)
    )
      throw new Error(`${name} manque ou n’a pas le format attendu.`);
  }
  return env;
}

export async function backendCall(env, path, { body, publishable = false, fetcher = fetch } = {}) {
  validateBackend(env);
  const key = publishable ? env.SUPABASE_PUBLISHABLE_KEY : env.SUPABASE_SECRET_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  let response;
  try {
    response = await fetcher(env.SUPABASE_URL.replace(/\/$/, '') + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Supabase a refusé l’opération (HTTP ${response.status}). Vérifiez les clés, les migrations et les droits du projet.`,
      );
    if (response.status === 204) return null;
    return await response.json();
  } catch (error) {
    if (response && !response.ok) throw error;
    throw new Error(
      'Connexion Supabase interrompue ou réponse invalide. Vérifiez l’état avant de réessayer.',
    );
  }
}

async function setup() {
  const previous = parseEnv(await localFile());
  console.log(
    'Configuration locale du serveur. Les clés ne seront pas affichées. Entrée conserve une clé déjà enregistrée.',
  );
  const values = {
    APP_EDITION: 'client',
    SUPABASE_URL: await question(
      'URL Supabase',
      previous.SUPABASE_URL || 'https://exbhajwuniufgedbkipg.supabase.co',
    ),
    SUPABASE_ORGANIZATION_ID: await question(
      'UUID organisation (valeur proposée = préproduction fictive)',
      previous.SUPABASE_ORGANIZATION_ID || '00000000-0000-4000-8000-000000000001',
    ),
    SUPABASE_PUBLISHABLE_KEY:
      (await secret('SUPABASE_PUBLISHABLE_KEY')).trim() || previous.SUPABASE_PUBLISHABLE_KEY || '',
    SUPABASE_SECRET_KEY:
      (await secret('SUPABASE_SECRET_KEY')).trim() || previous.SUPABASE_SECRET_KEY || '',
  };
  validateBackend(values);
  const gemini = await question(
    'Activer Gemini sur le compte gratuit, sans facturation activée ? o/n',
    'n',
  );
  if (/^(o|oui)$/i.test(gemini)) {
    values.GEMINI_API_KEY =
      (await secret('GEMINI_API_KEY')).trim() || previous.GEMINI_API_KEY || '';
    if (values.GEMINI_API_KEY.length < 20 || /\s/.test(values.GEMINI_API_KEY))
      throw new Error('Clé Gemini invalide.');
    values.LLM_PROVIDER = 'gemini';
    values.LLM_BUDGET_MODE = 'free';
    values.LLM_MODEL = 'gemini-2.5-flash';
    values.LLM_DAILY_LIMIT = '100';
    console.log(
      'Gemini configuré pour la démonstration. Les quotas dépendent de Google ; la limite applicative n’est pas un plafond de facturation.',
    );
  } else {
    values.LLM_PROVIDER = previous.LLM_PROVIDER || 'demo';
    values.LLM_BUDGET_MODE = previous.LLM_BUDGET_MODE || 'zero';
    values.LLM_MODEL = previous.LLM_MODEL || '';
  }
  await saveConfiguration(values);
  console.log(
    'Configuration enregistrée dans .dev.vars, protégée et ignorée par Git. Redémarrez le serveur si nécessaire.',
  );
}

async function doctor(env) {
  console.log('Diagnostic : .dev.vars à la racine du projet (valeurs secrètes masquées).');
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ORGANIZATION_ID'])
    console.log(key + ' : ' + (env[key]?.trim() ? 'présente' : 'MANQUANTE'));
  validateBackend(env);
  await backendCall(env, '/auth/v1/health', { publishable: true });
  const orgs = await backendCall(
    env,
    `/rest/v1/organizations?select=id,active&id=eq.${env.SUPABASE_ORGANIZATION_ID}`,
  );
  if (!Array.isArray(orgs) || orgs.length !== 1 || orgs[0].active !== true)
    throw new Error('Organisation absente ou inactive. Vérifiez son UUID.');
  // A publishable key must never be able to read customer cases.
  try {
    const cases = await backendCall(env, '/rest/v1/service_cases?select=id&limit=1', {
      publishable: true,
    });
    if (!Array.isArray(cases) || cases.length) throw new Error('READABLE');
  } catch (error) {
    if (!/HTTP (401|403)/.test(error.message))
      throw new Error(
        'La vérification des permissions publiques a échoué. Ne publiez pas avant correction.',
      );
  }
  console.log(
    'OK : Auth accessible, clés reconnues, organisation active, dossiers protégés en accès public.',
  );
  console.log('Ce diagnostic ne remplace pas le test de connexion et de MFA sur /admin.');
}

export async function provisionAdmin(env, { email, password, displayName }, fetcher = fetch) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error('Adresse email invalide.');
  if (password.length < 14 || password.length > 128 || /[\r\n\0]/.test(password))
    throw new Error('Choisissez un mot de passe de 14 à 128 caractères.');
  if (!displayName.trim() || displayName.length > 160) throw new Error('Nom invalide.');
  const user = await backendCall(env, '/auth/v1/admin/users', {
    fetcher,
    body: { email, password, email_confirm: true, user_metadata: { display_name: displayName } },
  });
  if (!UUID.test(user?.id ?? ''))
    throw new Error('Création non confirmée. Consultez Authentication → Users avant de réessayer.');
  try {
    await backendCall(env, '/rest/v1/rpc/bootstrap_admin', {
      fetcher,
      body: {
        p_organization_id: env.SUPABASE_ORGANIZATION_ID,
        p_email: email,
        p_role: 'super_admin',
        p_display_name: displayName,
      },
    });
  } catch {
    throw new Error(
      'Le compte Auth est créé, mais son rôle reste à attribuer. Suivez « Compte déjà existant » dans docs/TESTER-LA-VERSION.md. Ne recréez pas le compte.',
    );
  }
}

export async function grantAdmin(env, { email, displayName }, fetcher = fetch) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error('Adresse email invalide.');
  if (!displayName.trim() || displayName.length > 160) throw new Error('Nom invalide.');
  await backendCall(env, '/rest/v1/rpc/bootstrap_admin', {
    fetcher,
    body: {
      p_organization_id: env.SUPABASE_ORGANIZATION_ID,
      p_email: email,
      p_role: 'super_admin',
      p_display_name: displayName,
    },
  });
}

async function adminGrant(env) {
  await doctor(env);
  console.log('Compte Auth existant : attribuer le rôle super_admin, sans modifier son mot de passe ni envoyer un email.');
  const email = await question('Email exact du responsable déjà créé dans Supabase');
  const displayName = await question('Nom affiché', 'Responsable SAV & SC');
  const confirmation = await question('Confirmer ce rôle pour ' + email + ' ? Tapez ATTRIBUER');
  if (confirmation !== 'ATTRIBUER') throw new Error('Attribution annulée.');
  await grantAdmin(env, { email, displayName });
  console.log('Rôle attribué. Ouvrez /admin avec votre mot de passe existant, puis configurez la double authentification.');
}

async function adminCreate(env) {
  await doctor(env);
  console.log(
    'Création par le développeur du premier responsable (super_admin). Aucun email ne sera envoyé.',
  );
  const email = await question('Email de connexion');
  const displayName = await question('Nom affiché', 'Responsable SAV & SC');
  const password = await secret('Mot de passe administrateur (14 caractères minimum)');
  if (password !== (await secret('Répétez le mot de passe')))
    throw new Error('Les mots de passe ne correspondent pas.');
  await provisionAdmin(env, { email, password, displayName });
  console.log(
    'Administrateur créé. Ouvrez /admin, connectez-vous puis configurez la double authentification.',
  );
}

async function main() {
  const action = process.argv[2];
  if (!['setup', 'doctor', 'admin-create', 'admin-grant'].includes(action))
    throw new Error(
      'Utilisez npm run backend:setup, backend:doctor, admin:create ou admin:grant. Ne passez jamais de clé en argument.',
    );
  if (process.argv.length > 3)
    throw new Error(
      'Aucun argument supplémentaire accepté. Les secrets sont saisis dans le terminal.',
    );
  if (action === 'setup') return setup();
  // Wrangler uses .dev.vars as the local source; do not silently override it with shell values.
  const env = parseEnv(await localFile());
  if (action === 'doctor') return doctor(env);
  if (action === 'admin-grant') return adminGrant(env);
  return adminCreate(env);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
