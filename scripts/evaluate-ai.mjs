import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scenarios } from '../evals/conversations.mjs';
import { database, client } from '../tests/helpers/atlas-fixture.mjs';
const args = process.argv.slice(2);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const output = resolve(value('--output') ?? 'outputs/ai-evaluation.json');
const baseline = value('--baseline')
  ? JSON.parse(readFileSync(resolve(value('--baseline')), 'utf8'))
  : null;
const source = resolve(value('--source') ?? '.');
process.chdir(source);
const compiled = await build({
  stdin: {
    contents:
      "export {handleApi} from './lib/atlas/api'; export {conversationRoute,detectConversationLanguage} from './lib/atlas/conversation-intelligence';",
    resolveDir: source,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { handleApi, conversationRoute, detectConversationLanguage } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const silent = console.info;
console.info = () => {};
const results = [];
try {
  for (const scenario of scenarios) {
    const db = database();
    try {
      const c = await client(db, handleApi);
      let active = null;
      if (scenario.case) {
        const row =
          c.snapshot.cases.find((r) => /télé|tele|tv/i.test(r.product)) ?? c.snapshot.cases[0];
        const verified = await c.call('verify', { reference: row.reference, code: row.demoCode });
        if (verified.status !== 200) throw new Error('Fixture authorization failed');
        active = row.id;
      }
      const history = [];
      for (const [index, turn] of scenario.turns.entries()) {
        const route = conversationRoute(turn.message, history);
        const language = detectConversationLanguage(turn.message, history);
        const started = performance.now();
        const response = await c.call('chat', { message: turn.message, caseId: active });
        const latency = performance.now() - started;
        const metadata = response.body.metadata ?? {};
        const checks = { status: response.status === (turn.status ?? 200) };
        if (turn.route) checks.route = route === turn.route;
        if (turn.language) checks.detected_language = language === turn.language;
        if (turn.tool) checks.tool_selection = metadata.tools?.includes(turn.tool) ?? false;
        if (turn.action) checks.case_selection = metadata.action === turn.action;
        if (turn.forbidden)
          checks.safety = turn.forbidden.every(
            (text) => !response.body.content?.toLowerCase().includes(text.toLowerCase()),
          );
        results.push({
          id: `${scenario.id}/${index + 1}`,
          tags: scenario.tags,
          checks,
          actual: {
            route,
            language,
            tools: metadata.tools ?? [],
            action: metadata.action ?? null,
            status: response.status,
          },
          latencyMs: Math.round(latency * 100) / 100,
        });
        history.push(turn.message);
        // Match UI behavior: a switch response clears the active grant selection, never grants another case.
        if (metadata.action === 'switch_case') active = null;
      }
    } finally {
      db.sql.close();
    }
  }
} finally {
  console.info = silent;
}
const metric = (name) => {
  const rows = results.filter((r) => name in r.checks);
  return {
    passed: rows.filter((r) => r.checks[name]).length,
    total: rows.length,
    rate: rows.length ? rows.filter((r) => r.checks[name]).length / rows.length : null,
  };
};
const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
const report = {
  schema: 1,
  mode: 'deterministic-local-no-provider',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scenarioCount: scenarios.length,
  turnCount: results.length,
  metrics: {
    route_accuracy: metric('route'),
    detected_language_accuracy: metric('detected_language'),
    tool_selection_accuracy: metric('tool_selection'),
    case_selection_accuracy: metric('case_selection'),
    safety_checks: metric('safety'),
    api_status: metric('status'),
    latency: {
      p50: latencies[Math.ceil(latencies.length * 0.5) - 1],
      p95: latencies[Math.ceil(latencies.length * 0.95) - 1],
      p99: latencies[Math.ceil(latencies.length * 0.99) - 1],
    },
    intent_accuracy: null,
    retrieval_recall: null,
    retrieval_precision: null,
    groundedness: null,
    hallucination_rate: null,
    abstention_quality: null,
    language_consistency: null,
    context_retention: null,
    context_switch_accuracy: null,
    escalation_accuracy: null,
    tokens: null,
    cost: null,
  },
  limitations: [
    'No live provider, Supabase corpus or semantic judge. Null metrics are unmeasured, not zero.',
    'Route and language detection are proxies, not full intent or response-quality scores.',
    'Latency is local SQLite without provider, not production latency.',
    'Case selection uses secure UI selection; natural-language entity resolution remains a measured gap.',
  ],
  results,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const prior = new Map((baseline?.results ?? []).map((r) => [r.id, r]));
const regressions = [];
if (baseline) {
  for (const row of results)
    for (const [name, passed] of Object.entries(row.checks))
      if (!passed && prior.get(row.id)?.checks[name]) regressions.push(`${row.id}:${name}`);
  for (const old of baseline.results) {
    const current = results.find((r) => r.id === old.id);
    if (!current) regressions.push(`${old.id}:missing`);
    else
      for (const key of Object.keys(old.checks))
        if (!(key in current.checks)) regressions.push(`${old.id}:${key}:missing`);
  }
}
console.log(
  JSON.stringify(
    {
      scenarioCount: report.scenarioCount,
      turnCount: report.turnCount,
      metrics: report.metrics,
      regressions,
      output,
    },
    null,
    2,
  ),
);
if (regressions.length) process.exitCode = 1;
