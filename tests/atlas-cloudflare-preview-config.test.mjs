import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../wrangler.preview.json', import.meta.url), 'utf8'));

test('Cloudflare preview permits capped Gemini trials and keeps P1 disabled', () => {
  assert.equal(config.name, 'sav-sc-assistant-preview');
  assert.equal(config.workers_dev, true);
  assert.equal(config.compatibility_date, '2026-10-10');
  assert.equal(config.vars.APP_ENVIRONMENT, 'PREPRODUCTION');
  assert.equal(config.vars.APP_EDITION, 'client');
  assert.equal(config.vars.LLM_PROVIDER, 'gemini');
  assert.equal(config.vars.LLM_ENABLED_PROVIDERS, 'demo,gemini');
  assert.equal(config.vars.LLM_BUDGET_MODE, 'free');
  assert.equal(config.vars.GEMINI_MODEL, 'gemini-3.5-flash-lite');
  assert.equal(config.vars.LLM_DAILY_LIMIT, '20');
  assert.equal(config.vars.LLM_ORCHESTRATOR, undefined);
  assert.equal(config.vars.LLM_GENERATION_MODE, 'off');
  assert.equal(config.vars.LLM_VALIDATION_MODE, 'off');
  assert.equal(config.vars.LLM_AUTO_FAILOVER, 'false');
  assert.equal(config.vars.P1_RELEASE_MODE, 'off');
});

test('Cloudflare preview keeps credentials out of versioned Wrangler vars', () => {
  const secretLikeVariables = Object.keys(config.vars).filter((name) =>
    /(?:API|PRIVATE|SECRET|ACCESS|SERVICE|PUBLISHABLE|ANON|AUTH).*KEY|TOKEN|PASSWORD/i.test(name),
  );
  assert.deepEqual(secretLikeVariables, []);
});

test('Cloudflare preview points at the provisioned D1 binding and exact origin', () => {
  assert.equal(config.d1_databases.length, 1);
  assert.equal(config.d1_databases[0].binding, 'DB');
  assert.equal(config.d1_databases[0].database_name, 'sav-sc-assistant-preview');
  assert.match(config.d1_databases[0].database_id, /^[0-9a-f-]{36}$/);
  assert.equal(
    config.vars.APP_PUBLIC_ORIGIN,
    'https://sav-sc-assistant-preview.savsc-assistant.workers.dev',
  );
});
