import assert from 'node:assert/strict';
import test from 'node:test';

async function builtWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('test', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: {
    fetch: async () => new Response('Not found', { status: 404 }),
  },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

test('renders static commercial showcase and production metadata before hydration', async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request('http://localhost/', { headers: { accept: 'text/html' } }),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>SAV SC Assistant AI<\/title>/);
  assert.match(html, /Des demandes client plus/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /href="\/trial"/);
  assert.match(html, /href="\/file"/);
  assert.match(html, /données fictives/i);
  assert.match(html, /personnalisation/i);
  assert.match(html, /P1/i);
  assert.doesNotMatch(html, /mailto:/i);
  assert.doesNotMatch(html, /outloo\.com/i);
  assert.doesNotMatch(html, /Ollama|Gemini|Groq|OpenAI|fournisseur externe/i);
  assert.doesNotMatch(html, /name=["']codex-preview["']/);
});

test('dedicated demo route preserves the pre-existing fictitious discovery experience', async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request('http://localhost/demo', { headers: { accept: 'text/html' } }),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Votre service client/);
  assert.match(html, /href="\/file"/);
  assert.match(html, /APERÇU FICTIF/);
  assert.match(html, /SAV-2026-1042/);
  assert.match(html, /Les exemples ci-contre sont fictifs/);
  assert.doesNotMatch(html, /Le projet|Architecture & limites|GitHub/);
  assert.doesNotMatch(html, /Ollama|Gemini|fournisseur externe/i);
});

for (const path of ['/file', '/suivi', '/contact']) {
  test(`customer route ${path} renders useful content without a session`, async () => {
    const worker = await builtWorker();
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { headers: { accept: 'text/html' } }),
      env,
      ctx,
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    if (path === '/contact') {
      assert.match(html, /mailto:/);
      assert.match(html, /href="\/file"/);
    } else {
      assert.match(html, /Référence du dossier/);
      assert.match(html, /Afficher le code/);
      assert.match(html, /Où trouver ma référence/);
      assert.match(html, /href="\/contact"/);
      assert.match(html, /noindex/);
    }
    assert.doesNotMatch(html, /sb_secret_|SUPABASE_SECRET_KEY/);
  });
}
