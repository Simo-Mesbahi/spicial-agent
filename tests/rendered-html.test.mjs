import assert from 'node:assert/strict';
import test from 'node:test';

test('renders SAV SC Assistant AI discovery and production metadata before hydration', async () => {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('test', `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request('http://localhost/', {
      headers: { accept: 'text/html' },
    }),
    {
      ASSETS: {
        fetch: async () => new Response('Not found', { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>SAV SC Assistant AI<\/title>/);
  assert.match(html, /Votre service client/);
  assert.match(html, /href="\/file"/);
  assert.match(html, /href="\/contact"/);
  assert.match(html, /APERÇU FICTIF/);
  assert.match(html, /SAV-2026-1042/);
  assert.match(html, /Les exemples ci-contre sont fictifs/);
  assert.doesNotMatch(html, /Le projet|Architecture & limites|GitHub/);
  assert.doesNotMatch(html, /Ollama|Gemini|fournisseur externe/i);
  assert.doesNotMatch(html, /name=["']codex-preview["']/);
});

for (const path of ['/file', '/suivi', '/contact']) {
  test(`customer route ${path} renders useful content without a session`, async () => {
    const { default: worker } = await import('../dist/server/index.js');
    const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: 'text/html' } }),
      { ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} });
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
