import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check-only'))
  throw new Error('Supported option: --check-only.');
const checkOnly = args.includes('--check-only');
const expected = JSON.parse(
  await readFile(path.join(projectRoot, 'wrangler.preview.json'), 'utf8'),
);
const buildEnvironment = {
  ...process.env,
  CLOUDFLARE_DEPLOY_TARGET: 'preview',
};
const wranglerEnvironment = {
  ...process.env,
  WRANGLER_LOG_PATH: path.join(projectRoot, '.wrangler', 'logs'),
  WRANGLER_WRITE_LOGS: 'false',
};

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0)
    process.exit(result.status ?? 1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const wrangler = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);

run(npm, ['run', 'build'], buildEnvironment);

const generatedConfigPath = path.join(projectRoot, 'dist', 'server', 'wrangler.json');
const generated = JSON.parse(await readFile(generatedConfigPath, 'utf8'));
const expectedDatabase = expected.d1_databases[0];
const generatedDatabase = generated.d1_databases?.find(
  (binding) => binding.binding === expectedDatabase.binding,
);

const expectedVariables = expected.vars;
const mismatchedVariables = Object.entries(expectedVariables)
  .filter(([key, value]) => generated.vars?.[key] !== value)
  .map(([key]) => key);

if (
  generated.name !== expected.name ||
  generated.compatibility_date !== expected.compatibility_date ||
  generated.workers_dev !== true ||
  generatedDatabase?.database_id !== expectedDatabase.database_id ||
  generatedDatabase?.database_name !== expectedDatabase.database_name ||
  mismatchedVariables.length > 0
) {
  throw new Error(
    `Refusing Cloudflare deploy: generated preview config does not match its reviewed settings${mismatchedVariables.length ? ` (${mismatchedVariables.join(', ')})` : ''}.`,
  );
}

const configPath = path.relative(projectRoot, generatedConfigPath);
run(wrangler, ['deploy', '--dry-run', '--config', configPath], wranglerEnvironment);

if (checkOnly) {
  console.log('Cloudflare preview build and Wrangler dry-run are valid; no deployment was started.');
  process.exit(0);
}

console.log(
  `Deploying ${generated.name} to workers.dev with PREPRODUCTION, demo-only AI, zero budget and P1_RELEASE_MODE=off.`,
);
run(wrangler, ['deploy', '--config', configPath], wranglerEnvironment);
