import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, rename, lstat, chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { localBase, localModelName, localModel } from '../lib/atlas/model-policy.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const localOrigin = 'http://127.0.0.1:11435';

export function localConfiguration(previous, model = localModel) {
  const values = {
    LLM_BUDGET_MODE: 'zero',
    LLM_PROVIDER: 'ollama',
    LLM_MODEL: localModelName(model),
    LLM_BASE_URL: localOrigin + '/v1',
    LLM_DAILY_LIMIT: '100',
  };
  const lines = previous.split(/\r?\n/).filter((line) => {
    const key = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/)?.[1];
    return !Object.hasOwn(values, key ?? '');
  });
  return (
    lines.join('\n').trimEnd() +
    '\n' +
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n'
  );
}

export async function configureFile(directory, model) {
  const path = resolve(directory, '.dev.vars');
  let previous = '';
  try {
    if (!(await lstat(path)).isFile())
      throw new Error('Configuration locale non régulière : modification refusée.');
    previous = await readFile(path, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const next = localConfiguration(previous, model);
  if (next === previous) return false;
  if (previous)
    await writeFile(path + `.backup-${crypto.randomUUID()}`, previous, { flag: 'wx', mode: 0o600 });
  const temporary = path + `.tmp-${crypto.randomUUID()}`;
  await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return true;
}

export async function inspectLocal(
  fetcher = fetch,
  origin = localOrigin,
  model = localModel,
  inference = false,
) {
  const base = localBase(origin + '/v1');
  localModelName(model);
  const get = async (path, body, timeout = 5000) => {
    const res = await fetcher(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    if (!res.ok) throw new Error('Ollama local a refusé la requête : HTTP ' + res.status);
    return res.json();
  };
  const version = await get('/api/version');
  const tags = await get('/api/tags');
  const installed = tags.models?.find((x) => x.name === model || x.model === model);
  if (!installed) throw new Error(`Modèle absent : ${model}. Relancez npm run ai:local -- --pull.`);
  const details = await get('/api/show', { model });
  if (
    details.remote_host ||
    details.remote_model ||
    installed.remote_host ||
    installed.remote_model
  )
    throw new Error('Un modèle distant est interdit dans ce parcours local.');
  if (!details.capabilities?.includes('tools'))
    throw new Error('Ce modèle ne déclare pas la capacité d’utiliser des outils.');
  let completion = false;
  if (inference) {
    const response = await get(
      '/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: 'Réponds seulement : Bonjour.' }],
        max_tokens: 64,
        reasoning_effort: 'none',
        temperature: 0,
      },
      40000,
    );
    if (
      typeof response.choices?.[0]?.message?.content !== 'string' ||
      !response.choices[0].message.content.trim()
    )
      throw new Error('Le modèle n’a pas produit de texte.');
    completion = true;
  }
  return {
    version: version.version,
    model,
    digest: installed.digest ?? null,
    tools: true,
    completion,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const modelIndex = args.indexOf('--model');
  if (modelIndex >= 0 && !args[modelIndex + 1])
    throw new Error('Nom du modèle manquant après --model.');
  const model = localModelName(modelIndex >= 0 ? args[modelIndex + 1] : localModel);
  const known = args.filter((_, i) => i !== modelIndex + 1 || modelIndex < 0);
  if (known.some((a) => !['--model', '--pull', '--doctor', '--inference', '--help'].includes(a)))
    throw new Error('Option inconnue. Utilisez --help.');
  if (args.includes('--help')) {
    console.log(
      'AtlasCare local : npm run ai:local -- [--pull] [--model qwen3:4b]\nDiagnostic : npm run ai:doctor -- [--inference]\n--pull autorise le téléchargement du modèle. Aucun compte ni clé API requis.',
    );
    return;
  }
  if (args.includes('--doctor')) {
    console.log(
      JSON.stringify(
        await inspectLocal(fetch, localOrigin, model, args.includes('--inference')),
        null,
        2,
      ),
    );
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Utilisez Node.js 24 ou ultérieur pour le lanceur local.');
  if (process.platform === 'win32')
    throw new Error('Ce lanceur utilise les scripts Bash du projet. Utilisez Linux/WSL ou macOS.');
  const binary = spawnSync('ollama', ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (binary.error || binary.status !== 0)
    throw new Error(
      'Ollama est absent ou indisponible. Installez-le depuis https://ollama.com/download puis relancez cette commande.',
    );
  await new Promise((resolvePort, reject) => {
    const port = createServer();
    port.once('error', () =>
      reject(
        new Error(
          'Le port local 11435 est déjà utilisé. Arrêtez uniquement votre ancienne session AtlasCare, puis réessayez.',
        ),
      ),
    );
    port.listen(11435, '127.0.0.1', () => port.close(resolvePort));
  });
  const children = new Set();
  const env = { ...process.env, OLLAMA_HOST: '127.0.0.1:11435', OLLAMA_NO_CLOUD: '1' };
  delete env.CLOUDFLARE_ENV;
  env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
  env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  delete env.OLLAMA_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.LLM_API_KEY;
  delete env.GEMINI_API_KEY;
  const start = (command, args, childEnv = env) => {
    const child = spawn(command, args, {
      cwd: root,
      env: childEnv,
      stdio: 'inherit',
      detached: true,
    });
    children.add(child);
    child.once('exit', () => children.delete(child));
    child.once('error', () => children.delete(child));
    return child;
  };
  const wait = (child) =>
    new Promise((resolveChild, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolveChild()
          : reject(new Error('Le processus local s’est arrêté avec une erreur.')),
      );
    });
  const cleanup = () => {
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Process already stopped. */
      }
    }
  };
  const stop = () => {
    cleanup();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    console.log(
      'AtlasCare : lancement d’un serveur Ollama isolé, cloud désactivé, accès limité à cet ordinateur.',
    );
    const server = start('ollama', ['serve']);
    let serverError;
    server.once('error', (e) => {
      serverError = e;
    });
    let ready = false;
    for (let n = 0; n < 30; n++) {
      if (serverError || server.exitCode !== null)
        throw new Error('Le serveur Ollama local n’a pas démarré.');
      try {
        const r = await fetch(localOrigin + '/api/version', {
          redirect: 'error',
          signal: AbortSignal.timeout(500),
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Local server is still starting. */
      }
      await sleep(500);
    }
    if (!ready) throw new Error('Ollama ne répond pas sur le port local 11435.');
    if (args.includes('--pull')) {
      console.log(
        `Téléchargement explicitement demandé : ${model}. L’espace disque et le temps dépendent du modèle.`,
      );
      await wait(start('ollama', ['pull', model]));
    }
    const report = await inspectLocal(fetch, localOrigin, model);
    console.log(
      `Modèle local disponible : ${report.model}. Capacité outils détectée ; qualité métier à évaluer.`,
    );
    await configureFile(root, model);
    console.log(
      'Configuration locale appliquée. Les anciens réglages modifiés sont sauvegardés hors Git.',
    );
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await wait(start(npm, ['run', 'db:migrate:local']));
    console.log(
      'Ouverture locale : utilisez l’adresse affichée ci-dessous. Ctrl+C arrête les processus lancés ici.',
    );
    await wait(start(npm, ['run', 'dev', '--', '--host', '127.0.0.1']));
  } finally {
    cleanup();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => {
    console.error(
      'AtlasCare : ' +
        (e.cause?.code === 'ECONNREFUSED'
          ? 'Aucun serveur Ollama local ne répond. Lancez npm run ai:local dans un autre terminal.'
          : e.message),
    );
    process.exitCode = 1;
  });
