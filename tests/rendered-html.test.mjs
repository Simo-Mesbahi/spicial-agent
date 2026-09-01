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
  assert.match(html, /Moins de flou/);
  assert.match(html, /Vivre l’expérience/);
  assert.match(html, /APERÇU FICTIF/);
  assert.match(html, /SAV-2026-1042/);
  assert.doesNotMatch(html, /name=["']codex-preview["']/);
});
