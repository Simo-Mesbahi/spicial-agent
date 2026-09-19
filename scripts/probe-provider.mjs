// Explicit live gate. Uses only synthetic D1 cases/public demo documents, never customer records.
import { build } from 'esbuild';
import { database, client } from '../tests/helpers/atlas-fixture.mjs';
if (!process.argv.includes('--live')) {
  console.error(
    'Live calls disabled. Use --live with server-owned provider configuration and budget.',
  );
  process.exit(2);
}
const names = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_BUDGET_MODE',
  'LLM_DAILY_LIMIT',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_REASONING_EFFORT',
  'GEMINI_MODEL',
  'GEMINI_API_KEY',
  'OLLAMA_MODEL',
  'OLLAMA_BASE_URL',
  'COMPATIBLE_MODEL',
  'COMPATIBLE_BASE_URL',
  'COMPATIBLE_API_KEY',
];
const config = Object.fromEntries(
  names.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
);
const compiled = await build({
  stdin: {
    contents:
      "export {handleApi} from './lib/atlas/api'; export {publicModelConfig} from './lib/atlas/model-policy';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { handleApi, publicModelConfig } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const readiness = publicModelConfig(config);
if (!readiness.ready || readiness.provider === 'demo') {
  console.error(
    JSON.stringify({
      status: 'not_run',
      reason: 'No enabled, configured live provider. No requests sent.',
    }),
  );
  process.exit(2);
}
const db = database(),
  log = console.info;
console.info = () => {};
const checks = [];
try {
  const c = await client(db, handleApi);
  Object.assign(c.env, config);
  const row = c.snapshot.cases[0];
  const verified = await c.call('verify', { reference: row.reference, code: row.demoCode });
  if (verified.status !== 200) throw new Error('Synthetic fixture verification failed');
  for (const [name, message, caseId, tool] of [
    ['no_tool', 'Raconte-moi une blague courte', null, null],
    ['get_case', 'Où en est mon dossier ?', row.id, 'get_case'],
    ['search_knowledge', 'Comment fonctionne la garantie ?', null, 'search_knowledge'],
    ['multi_turn', 'Et la prise en charge en garantie ?', null, 'search_knowledge'],
  ]) {
    const r = await c.call('chat', { message, caseId });
    const m = r.body.metadata ?? {};
    const passed =
      r.status === 200 &&
      m.mode === readiness.provider &&
      m.fallback === null &&
      m.inputTokens > 0 &&
      m.outputTokens > 0 &&
      m.latencyMs > 0 &&
      (!tool || m.executedTools?.includes(tool));
    checks.push({
      name,
      passed,
      status: r.status,
      provider: m.provider,
      model: m.model,
      mode: m.mode,
      fallback: m.fallback,
      fallbackReason: m.fallbackReason,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      latencyMs: m.latencyMs,
      providerCalls: m.providerCalls,
      executedTools: m.executedTools,
    });
  }
} finally {
  db.sql.close();
  console.info = log;
}
console.log(JSON.stringify({ kind: 'real-provider-synthetic-data', checks }, null, 2));
if (checks.some((c) => !c.passed)) process.exitCode = 1;
