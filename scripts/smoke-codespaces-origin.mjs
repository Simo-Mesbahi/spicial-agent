import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const host = '127.0.0.1';
const port = 5173;
const baseUrl = `http://${host}:${port}`;
const codespaceName = 'ci-origin-smoke';
const forwardingDomain = 'app.github.dev';
const publicOrigin = `https://${codespaceName}-${port}.${forwardingDomain}`;

const env = {
  ...process.env,
  CODESPACES: 'true',
  CODESPACE_NAME: codespaceName,
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: forwardingDomain,
  APP_ENVIRONMENT: 'LOCAL',
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_LOG_PATH: '.wrangler/wrangler.log',
  MINIFLARE_REGISTRY_PATH: '.wrangler/registry',
};

function fail(message, logs = '') {
  const detail = logs.trim() ? `\n--- dev server output ---\n${logs.trim()}\n--- end output ---` : '';
  throw new Error(`${message}${detail}`);
}

const migration = spawnSync('npm', ['run', 'db:migrate:local'], {
  env,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (migration.status !== 0) {
  fail(
    'Local D1 migrations failed before the reverse-proxy smoke test.',
    `${migration.stdout ?? ''}\n${migration.stderr ?? ''}`,
  );
}

const child = spawn('npm', ['run', 'dev'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});

let output = '';
const capture = (chunk) => {
  output += chunk.toString();
  if (output.length > 32_000) output = output.slice(-32_000);
};

child.stdout?.on('data', capture);
child.stderr?.on('data', capture);

async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000),
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      fail(`Dev server exited early with code ${child.exitCode}.`, output);

    try {
      const response = await fetch(`${baseUrl}/api/live`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Vite/Worker startup is still in progress.
    }

    await delay(250);
  }

  fail('Timed out waiting for the Vite/Worker dev server.', output);
}

async function postSession(origin, extraHeaders = {}) {
  return fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: '{}',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
}

try {
  await waitUntilReady();

  const accepted = await postSession(publicOrigin);
  if (accepted.status !== 201) {
    fail(
      `Expected trusted Codespaces origin to create a session with HTTP 201, got ${accepted.status}: ${await accepted.text()}`,
      output,
    );
  }

  const hostile = await postSession('https://attacker.example');
  if (hostile.status !== 403) {
    fail(
      `Expected hostile Origin to be rejected with HTTP 403, got ${hostile.status}: ${await hostile.text()}`,
      output,
    );
  }

  const crossSite = await postSession(publicOrigin, {
    'Sec-Fetch-Site': 'cross-site',
  });
  if (crossSite.status !== 403) {
    fail(
      `Expected Sec-Fetch-Site=cross-site to be rejected with HTTP 403, got ${crossSite.status}: ${await crossSite.text()}`,
      output,
    );
  }

  console.log(
    JSON.stringify({
      status: 'ok',
      publicOrigin,
      acceptedStatus: accepted.status,
      hostileStatus: hostile.status,
      crossSiteStatus: crossSite.status,
    }),
  );
} finally {
  await stop();
}
