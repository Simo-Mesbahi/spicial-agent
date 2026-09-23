import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  modelSettings,
  publicModelConfig,
  localBase,
  localModelName,
  geminiModels,
  enabledProviders,
  configuredModel,
} from '../lib/atlas/model-policy.ts';
import { configureFile, inspectLocal, localConfiguration } from '../scripts/local-ai.mjs';

test('Budget defaults to zero and no paid endpoint is selected by the demo', () => {
  const settings = modelSettings({});
  assert.equal(settings.budgetMode, 'zero');
  assert.equal(settings.base, null);
  assert.equal(publicModelConfig({}).externalCallsAllowed, false);
});

test('External providers fail closed regardless of available API keys', () => {
  for (const provider of ['openai', 'compatible']) {
    assert.throws(
      () =>
        modelSettings({
          LLM_PROVIDER: provider,
          LLM_MODEL: 'test',
          OPENAI_API_KEY: 'test-secret',
          LLM_API_KEY: 'compatible-secret',
          LLM_BASE_URL: 'https://llm.test/v1',
        }),
      /approved/,
    );
  }
  assert.throws(
    () => modelSettings({ LLM_PROVIDER: 'unknown', LLM_BUDGET_MODE: 'approved' }),
    /fournisseur de modèle/,
  );
  assert.throws(() => modelSettings({ LLM_BUDGET_MODE: 'typo' }), /invalide/);
});

test('Gemini free mode is a narrow allowlist with a separate secret', () => {
  const settings = modelSettings({
    LLM_PROVIDER: 'gemini',
    LLM_BUDGET_MODE: 'free',
    GEMINI_API_KEY: 'gemini-secret',
  });
  assert.equal(settings.base, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(settings.model, 'gemini-3.1-flash-lite');
  assert.equal(settings.key, 'gemini-secret');
  assert.ok(geminiModels.includes('gemini-2.5-flash-lite'));
  assert.ok(geminiModels.includes('gemini-3.1-flash-lite'));
  assert.equal(
    modelSettings({
      LLM_PROVIDER: 'gemini',
      LLM_BUDGET_MODE: 'free',
      GEMINI_MODEL: 'gemini-3.1-flash-lite',
      GEMINI_API_KEY: 'gemini-secret',
    }).model,
    'gemini-3.1-flash-lite',
  );
  assert.throws(
    () => modelSettings({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'x' }),
    /mode free ou approved/,
  );
  assert.throws(
    () => modelSettings({ LLM_PROVIDER: 'gemini', LLM_BUDGET_MODE: 'free' }),
    /Clé Gemini/,
  );
  assert.throws(
    () =>
      modelSettings({
        LLM_PROVIDER: 'gemini',
        LLM_BUDGET_MODE: 'free',
        GEMINI_API_KEY: 'x',
        LLM_MODEL: 'gemini-2.5-pro',
      }),
    /autorisé/,
  );
  const publicConfig = publicModelConfig({
    LLM_PROVIDER: 'gemini',
    LLM_BUDGET_MODE: 'free',
    GEMINI_API_KEY: 'gemini-secret',
  });
  assert.equal(publicConfig.externalCallsAllowed, true);
  assert.ok(!JSON.stringify(publicConfig).includes('gemini-secret'));
});

test('Provider timeout override is bounded and server-owned', () => {
  const base = {
    LLM_PROVIDER: 'gemini',
    LLM_BUDGET_MODE: 'free',
    GEMINI_API_KEY: 'gemini-secret',
  };
  assert.equal(modelSettings(base).timeoutMs, 20000);
  assert.equal(modelSettings({ ...base, LLM_REQUEST_TIMEOUT_MS: '30000' }).timeoutMs, 30000);
  for (const value of ['999', '60001', 'NaN', '2.5'])
    assert.throws(
      () => modelSettings({ ...base, LLM_REQUEST_TIMEOUT_MS: value }),
      /Délai fournisseur IA invalide/,
    );
});

test('Multiple providers can be configured together while remaining explicitly allowlisted', () => {
  const env = {
    LLM_PROVIDER: 'gemini',
    LLM_ENABLED_PROVIDERS: 'gemini,openai',
    LLM_BUDGET_MODE: 'approved',
    GEMINI_MODEL: 'gemini-2.5-flash-lite',
    GEMINI_API_KEY: 'gemini-secret',
    OPENAI_MODEL: 'approved-openai-model',
    OPENAI_API_KEY: 'openai-secret',
  };
  assert.deepEqual(enabledProviders(env), ['demo', 'gemini', 'openai']);
  assert.equal(configuredModel(env, 'gemini'), 'gemini-2.5-flash-lite');
  assert.equal(configuredModel(env, 'openai'), 'approved-openai-model');
  assert.equal(modelSettings(env).model, 'gemini-2.5-flash-lite');
  assert.equal(
    modelSettings({ ...env, LLM_PROVIDER: 'openai' }).model,
    'approved-openai-model',
  );
  assert.throws(
    () => enabledProviders({ ...env, LLM_ENABLED_PROVIDERS: 'gemini,unknown' }),
    /Fournisseur IA inconnu/,
  );
});

test('Local configuration never forwards keys and disallows external addresses', () => {
  const result = modelSettings({
    LLM_PROVIDER: 'ollama',
    OPENAI_API_KEY: 'test-secret',
    LLM_API_KEY: 'other-secret',
  });
  assert.equal(result.base, 'http://127.0.0.1:11434/v1');
  assert.equal(result.key, null);
  assert.equal(result.model, 'qwen3:4b');
  for (const url of [
    'https://api.openai.com/v1',
    'http://192.168.1.4/v1',
    'http://localhost.attacker.test/v1',
    'http://127.0.0.1@attacker.test/v1',
    'http://user:secret@127.0.0.1/v1',
    'http://127.0.0.1/v1?remote=yes',
    'http://127.0.0.1/api',
    'file:///v1',
  ])
    assert.throws(() => localBase(url));
  assert.equal(localBase('http://[::1]:11435/v1/'), 'http://[::1]:11435/v1');
});

test('Local model selection rejects cloud variants and unsafe names', () => {
  for (const name of [
    'qwen3:4b-cloud',
    'qwen3:cloud',
    'https://host/model',
    '../../model',
    'model\nLLM_PROVIDER=openai',
  ])
    assert.throws(() => localModelName(name));
  assert.equal(localModelName('qwen3:4b'), 'qwen3:4b');
});

test('Public readiness reports budget blocks without exposing credentials', () => {
  const result = publicModelConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'hidden-key' });
  assert.equal(result.ready, false);
  assert.match(result.blockedReason, /approved/);
  assert.ok(!JSON.stringify(result).includes('hidden-key'));
});

test('Local configuration preserves unrelated settings and is idempotent', () => {
  const input =
    '# User setting\nMY_SETTING=keep\nOPENAI_API_KEY=private-test-value\nLLM_PROVIDER=openai\nLLM_PROVIDER=compatible\nLLM_BUDGET_MODE=approved\n';
  const output = localConfiguration(input);
  assert.match(output, /MY_SETTING=keep/);
  assert.match(output, /OPENAI_API_KEY=private-test-value/);
  assert.match(output, /LLM_BUDGET_MODE=zero/);
  assert.equal(output.match(/^LLM_PROVIDER=/gm).length, 1);
  assert.equal(localConfiguration(output), output);
});

test('Local setup protects and backs up existing configuration, refusing symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-local-test-'));
  try {
    const path = join(directory, '.dev.vars');
    await writeFile(path, 'USER_VALUE=kept\n');
    assert.equal(await configureFile(directory, 'qwen3:4b'), true);
    assert.match(await readFile(path, 'utf8'), /USER_VALUE=kept/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readdir(directory)).filter((x) => x.includes('.backup-')).length, 1);
    assert.equal(await configureFile(directory, 'qwen3:4b'), false);
    await rm(path);
    await symlink(join(directory, 'elsewhere'), path);
    await assert.rejects(configureFile(directory, 'qwen3:4b'), /non régulière/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Local doctor distinguishes installation checks from actual inference', async () => {
  let completions = 0;
  const mock = async (url, init) => {
    assert.equal(url.origin, 'http://127.0.0.1:11435');
    assert.equal(init.redirect, 'error');
    if (url.pathname === '/api/version') return Response.json({ version: 'test' });
    if (url.pathname === '/api/tags')
      return Response.json({ models: [{ name: 'qwen3:4b', digest: 'test-digest' }] });
    if (url.pathname === '/api/show')
      return Response.json({ capabilities: ['completion', 'tools'] });
    assert.equal(url.pathname, '/v1/chat/completions');
    completions++;
    const body = JSON.parse(init.body);
    assert.equal(body.reasoning_effort, 'none');
    return Response.json({ choices: [{ message: { content: 'Bonjour.' } }] });
  };
  assert.equal((await inspectLocal(mock)).completion, false);
  assert.equal(completions, 0);
  assert.equal(
    (await inspectLocal(mock, 'http://127.0.0.1:11435', 'qwen3:4b', true)).completion,
    true,
  );
  assert.equal(completions, 1);
});

test('Local doctor refuses remote model metadata and missing tool support', async () => {
  for (const details of [
    { remote_host: 'https://cloud.test', capabilities: ['tools'] },
    { capabilities: ['completion'] },
  ]) {
    const mock = async (url) =>
      Response.json(
        url.pathname === '/api/tags'
          ? { models: [{ name: 'qwen3:4b' }] }
          : url.pathname === '/api/show'
            ? details
            : { version: 'test' },
      );
    await assert.rejects(inspectLocal(mock));
  }
});
