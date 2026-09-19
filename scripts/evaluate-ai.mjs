import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scenarios, evaluationContract } from '../evals/conversations.mjs';
import { database, client } from '../tests/helpers/atlas-fixture.mjs';

const args = process.argv.slice(2);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const output = resolve(value('--output') ?? 'outputs/ai-evaluation.json');
const baseline = value('--baseline')
  ? JSON.parse(readFileSync(resolve(value('--baseline')), 'utf8'))
  : null;
const source = resolve(value('--source') ?? '.');

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const allowedRoutes = new Set(evaluationContract.allowedRoutes);
const allowedLanguages = new Set(evaluationContract.supportedLanguages);
const allowedPriorities = new Set(evaluationContract.allowedPriorities);
const allowedRequiredChecks = new Set(evaluationContract.allowedRequiredChecks);
const allowedRiskDomains = new Set(evaluationContract.allowedRiskDomains ?? []);
const allowedCapabilities = new Set(evaluationContract.allowedCapabilities ?? []);
const allowedTargetIntents = new Set(evaluationContract.allowedTargetIntents ?? []);
const allowedGuidanceModes = new Set(evaluationContract.allowedGuidanceModes ?? []);

function validateCorpus() {
  const errors = [];
  const ids = new Set();
  let turns = 0;
  let criticalScenarios = 0;
  let highPriorityScenarios = 0;
  let longScenarios = 0;
  const tags = new Set();
  const riskCounts = new Map((evaluationContract.allowedRiskDomains ?? []).map((risk) => [risk, 0]));
  const capabilityCounts = new Map(
    (evaluationContract.allowedCapabilities ?? []).map((capability) => [capability, 0]),
  );
  let blockingCriticalScenarios = 0;
  const languageTurns = new Map(evaluationContract.supportedLanguages.map((language) => [language, 0]));
  const preP1ScenariosByLanguage = new Map(
    evaluationContract.supportedLanguages.map((language) => [language, 0]),
  );
  let preP1MatrixScenarios = 0;
  let preP1TargetTurns = 0;
  const preP1MatrixFamilies = new Set();

  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== 'object') {
      errors.push('scenario:not_object');
      continue;
    }
    if (typeof scenario.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(scenario.id))
      errors.push(`scenario:${String(scenario.id)}:invalid_id`);
    if (ids.has(scenario.id)) errors.push(`scenario:${scenario.id}:duplicate_id`);
    ids.add(scenario.id);

    const priority = scenario.priority ?? 'standard';
    if (!allowedPriorities.has(priority)) errors.push(`scenario:${scenario.id}:invalid_priority`);
    if (priority === 'critical') criticalScenarios++;
    if (priority === 'high') highPriorityScenarios++;

    const riskDomains = scenario.riskDomains ?? [];
    const capabilities = scenario.capabilities ?? [];
    if (!Array.isArray(riskDomains))
      errors.push(`scenario:${scenario.id}:invalid_risk_domains`);
    else {
      for (const risk of riskDomains) {
        if (!allowedRiskDomains.has(risk)) errors.push(`scenario:${scenario.id}:unknown_risk:${risk}`);
        else riskCounts.set(risk, (riskCounts.get(risk) ?? 0) + 1);
      }
    }
    if (!Array.isArray(capabilities))
      errors.push(`scenario:${scenario.id}:invalid_capabilities`);
    else {
      for (const capability of capabilities) {
        if (!allowedCapabilities.has(capability))
          errors.push(`scenario:${scenario.id}:unknown_capability:${capability}`);
        else capabilityCounts.set(capability, (capabilityCounts.get(capability) ?? 0) + 1);
      }
    }

    if (!Array.isArray(scenario.tags) || !scenario.tags.length)
      errors.push(`scenario:${scenario.id}:missing_tags`);
    else scenario.tags.forEach((tag) => tags.add(tag));

    if (!Array.isArray(scenario.turns) || !scenario.turns.length) {
      errors.push(`scenario:${scenario.id}:missing_turns`);
      continue;
    }
    if (scenario.turns.length >= 10) longScenarios++;

    if (scenario.suite === 'pre-p1-conversation-contract') {
      preP1MatrixScenarios++;
      if (typeof scenario.matrixFamily !== 'string' || !scenario.matrixFamily)
        errors.push(`scenario:${scenario.id}:missing_matrix_family`);
      else preP1MatrixFamilies.add(scenario.matrixFamily);
      if (!evaluationContract.supportedLanguages.includes(scenario.matrixLanguage))
        errors.push(`scenario:${scenario.id}:invalid_matrix_language`);
      else
        preP1ScenariosByLanguage.set(
          scenario.matrixLanguage,
          (preP1ScenariosByLanguage.get(scenario.matrixLanguage) ?? 0) + 1,
        );
    }

    let criticalBlockingCheck = false;
    for (const [index, turn] of scenario.turns.entries()) {
      turns++;
      const prefix = `${scenario.id}/${index + 1}`;
      if (!turn || typeof turn !== 'object') {
        errors.push(`${prefix}:invalid_turn`);
        continue;
      }
      if (typeof turn.message !== 'string' || !turn.message.trim() || turn.message.length > 1500)
        errors.push(`${prefix}:invalid_message`);
      if (turn.route && !allowedRoutes.has(turn.route)) errors.push(`${prefix}:invalid_route`);
      if (turn.language && !allowedLanguages.has(turn.language)) errors.push(`${prefix}:invalid_language`);
      if (turn.language) languageTurns.set(turn.language, (languageTurns.get(turn.language) ?? 0) + 1);
      if (turn.status !== undefined && (!Number.isInteger(turn.status) || turn.status < 100 || turn.status > 599))
        errors.push(`${prefix}:invalid_status`);
      if (turn.forbidden && (!Array.isArray(turn.forbidden) || turn.forbidden.some((x) => typeof x !== 'string' || !x)))
        errors.push(`${prefix}:invalid_forbidden`);
      if (turn.toolsAll && (!Array.isArray(turn.toolsAll) || turn.toolsAll.some((x) => typeof x !== 'string' || !x)))
        errors.push(`${prefix}:invalid_tools_all`);
      if (turn.toolsNone && (!Array.isArray(turn.toolsNone) || turn.toolsNone.some((x) => typeof x !== 'string' || !x)))
        errors.push(`${prefix}:invalid_tools_none`);
      if (scenario.suite === 'pre-p1-conversation-contract') {
        preP1TargetTurns++;
        if (!turn.target || typeof turn.target !== 'object') {
          errors.push(`${prefix}:missing_target`);
        } else {
          if (!allowedTargetIntents.has(turn.target.intent))
            errors.push(`${prefix}:invalid_target_intent:${String(turn.target.intent)}`);
          if (!allowedGuidanceModes.has(turn.target.guidance))
            errors.push(`${prefix}:invalid_guidance_mode:${String(turn.target.guidance)}`);
          if (typeof turn.target.requiresCase !== 'boolean')
            errors.push(`${prefix}:invalid_requires_case`);
          if (typeof turn.target.conversationRepair !== 'boolean')
            errors.push(`${prefix}:invalid_conversation_repair`);
          if (!allowedLanguages.has(turn.target.responseLanguage))
            errors.push(`${prefix}:invalid_response_language`);
        }
      }

      if (turn.requiredChecks) {
        if (!Array.isArray(turn.requiredChecks) || !turn.requiredChecks.length)
          errors.push(`${prefix}:invalid_required_checks`);
        else {
          for (const check of turn.requiredChecks) {
            if (!allowedRequiredChecks.has(check))
              errors.push(`${prefix}:unknown_required_check:${check}`);
            else criticalBlockingCheck = true;
          }
        }
      }
    }

    if (priority === 'critical') {
      if (!Array.isArray(riskDomains) || !riskDomains.length)
        errors.push(`scenario:${scenario.id}:critical_missing_risk_domain`);
      if (!Array.isArray(capabilities) || !capabilities.length)
        errors.push(`scenario:${scenario.id}:critical_missing_capability`);
      if (!criticalBlockingCheck)
        errors.push(`scenario:${scenario.id}:critical_without_blocking_check`);
      else blockingCriticalScenarios++;
    }
  }

  const minimums = evaluationContract.minimums;
  if (scenarios.length < minimums.scenarios) errors.push(`coverage:scenarios:${scenarios.length}<${minimums.scenarios}`);
  if (turns < minimums.turns) errors.push(`coverage:turns:${turns}<${minimums.turns}`);
  if (criticalScenarios < minimums.criticalScenarios)
    errors.push(`coverage:critical:${criticalScenarios}<${minimums.criticalScenarios}`);
  if (highPriorityScenarios < minimums.highPriorityScenarios)
    errors.push(`coverage:high:${highPriorityScenarios}<${minimums.highPriorityScenarios}`);
  if (longScenarios < minimums.longScenarios)
    errors.push(`coverage:long:${longScenarios}<${minimums.longScenarios}`);
  if (blockingCriticalScenarios < (minimums.blockingCriticalScenarios ?? 0))
    errors.push(
      `coverage:blocking_critical:${blockingCriticalScenarios}<${minimums.blockingCriticalScenarios}`,
    );
  for (const [language, count] of languageTurns)
    if (count < minimums.turnsPerLanguage)
      errors.push(`coverage:language:${language}:${count}<${minimums.turnsPerLanguage}`);
  for (const tag of evaluationContract.requiredTags)
    if (!tags.has(tag)) errors.push(`coverage:missing_tag:${tag}`);

  if (preP1MatrixFamilies.size < (minimums.preP1MatrixFamilies ?? 0))
    errors.push(
      `coverage:pre_p1_families:${preP1MatrixFamilies.size}<${minimums.preP1MatrixFamilies}`,
    );
  if (preP1MatrixScenarios < (minimums.preP1MatrixScenarios ?? 0))
    errors.push(
      `coverage:pre_p1_scenarios:${preP1MatrixScenarios}<${minimums.preP1MatrixScenarios}`,
    );
  if (preP1TargetTurns < (minimums.preP1TargetTurns ?? 0))
    errors.push(
      `coverage:pre_p1_target_turns:${preP1TargetTurns}<${minimums.preP1TargetTurns}`,
    );
  for (const [language, count] of preP1ScenariosByLanguage)
    if (count < (minimums.preP1ScenariosPerLanguage ?? 0))
      errors.push(
        `coverage:pre_p1_language:${language}:${count}<${minimums.preP1ScenariosPerLanguage}`,
      );

  for (const [risk, minimum] of Object.entries(evaluationContract.riskMinimums ?? {})) {
    const actual = riskCounts.get(risk) ?? 0;
    if (actual < minimum) errors.push(`coverage:risk:${risk}:${actual}<${minimum}`);
  }
  for (const [capability, minimum] of Object.entries(evaluationContract.capabilityMinimums ?? {})) {
    const actual = capabilityCounts.get(capability) ?? 0;
    if (actual < minimum)
      errors.push(`coverage:capability:${capability}:${actual}<${minimum}`);
  }

  return {
    errors,
    summary: {
      scenarios: scenarios.length,
      turns,
      criticalScenarios,
      highPriorityScenarios,
      longScenarios,
      blockingCriticalScenarios,
      languageTurns: Object.fromEntries(languageTurns),
      riskDomains: Object.fromEntries(riskCounts),
      capabilities: Object.fromEntries(capabilityCounts),
      tagCount: tags.size,
      preP1: {
        families: preP1MatrixFamilies.size,
        scenarios: preP1MatrixScenarios,
        targetTurns: preP1TargetTurns,
        scenariosByLanguage: Object.fromEntries(preP1ScenariosByLanguage),
      },
    },
  };
}

const corpus = validateCorpus();
if (corpus.errors.length) {
  console.error(JSON.stringify({ corpusValidation: corpus }, null, 2));
  process.exit(1);
}

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
        const returnedTools = metadata.tools ?? [];

        const checks = { status: response.status === (turn.status ?? 200) };
        if (turn.route) checks.route = route === turn.route;
        if (turn.language) checks.detected_language = language === turn.language;
        if (turn.tool) checks.tool_selection = returnedTools.includes(turn.tool);
        if (turn.toolsAll) checks.tool_set = turn.toolsAll.every((tool) => returnedTools.includes(tool));
        if (turn.toolsNone) checks.tool_exclusion = turn.toolsNone.every((tool) => !returnedTools.includes(tool));
        if (own(turn, 'action')) checks.case_selection = (metadata.action ?? null) === turn.action;
        if (turn.forbidden)
          checks.safety = turn.forbidden.every(
            (needle) => !String(response.body.content ?? '').toLowerCase().includes(needle.toLowerCase()),
          );

        results.push({
          id: `${scenario.id}/${index + 1}`,
          suite: scenario.suite ?? 'p0-legacy',
          priority: scenario.priority ?? 'standard',
          tags: scenario.tags,
          riskDomains: scenario.riskDomains ?? [],
          capabilities: scenario.capabilities ?? [],
          requiredChecks: turn.requiredChecks ?? [],
          target: turn.target ?? null,
          checks,
          actual: {
            route,
            language,
            tools: returnedTools,
            action: metadata.action ?? null,
            status: response.status,
          },
          latencyMs: Math.round(latency * 100) / 100,
        });

        history.push(turn.message);
        if (metadata.action === 'switch_case') active = null;
      }
    } finally {
      db.sql.close();
    }
  }
} finally {
  console.info = silent;
}

const metricFor = (rows, name) => {
  const selected = rows.filter((row) => name in row.checks);
  const passed = selected.filter((row) => row.checks[name]).length;
  return {
    passed,
    total: selected.length,
    rate: selected.length ? passed / selected.length : null,
  };
};
const metric = (name) => metricFor(results, name);
const latencies = results.map((row) => row.latencyMs).sort((a, b) => a - b);
const percentile = (p) =>
  latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;

function groupedCoverage(field) {
  const keys = new Set();
  for (const row of results) {
    const value = row[field];
    if (Array.isArray(value)) value.forEach((item) => keys.add(item));
    else if (value) keys.add(value);
  }
  return Object.fromEntries(
    [...keys].sort().map((key) => {
      const rows = results.filter((row) =>
        Array.isArray(row[field]) ? row[field].includes(key) : row[field] === key,
      );
      const checks = rows.flatMap((row) => Object.keys(row.checks));
      const uniqueChecks = [...new Set(checks)];
      return [
        key,
        {
          turns: rows.length,
          checks: Object.fromEntries(uniqueChecks.map((name) => [name, metricFor(rows, name)])),
        },
      ];
    }),
  );
}

const prior = new Map((baseline?.results ?? []).map((row) => [row.id, row]));
const regressions = [];
if (baseline) {
  for (const row of results)
    for (const [name, passed] of Object.entries(row.checks))
      if (!passed && prior.get(row.id)?.checks?.[name]) regressions.push(`${row.id}:${name}`);

  for (const old of baseline.results ?? []) {
    const current = results.find((row) => row.id === old.id);
    if (!current) regressions.push(`${old.id}:missing`);
    else
      for (const key of Object.keys(old.checks ?? {}))
        if (!(key in current.checks)) regressions.push(`${old.id}:${key}:missing`);
  }
}

const requiredFailures = [];
for (const row of results)
  for (const check of row.requiredChecks)
    if (row.checks[check] !== true) requiredFailures.push(`${row.id}:${check}`);

const knownGaps = results
  .filter((row) => Object.values(row.checks).some((passed) => passed === false))
  .map((row) => ({
    id: row.id,
    suite: row.suite,
    priority: row.priority,
    failedChecks: Object.entries(row.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
  }));

const report = {
  schema: 2,
  corpusVersion: evaluationContract.corpusVersion,
  mode: 'deterministic-local-no-provider',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  corpus: corpus.summary,
  scenarioCount: scenarios.length,
  turnCount: results.length,
  metrics: {
    route_accuracy: metric('route'),
    detected_language_accuracy: metric('detected_language'),
    tool_selection_accuracy: metric('tool_selection'),
    tool_set_accuracy: metric('tool_set'),
    tool_exclusion_accuracy: metric('tool_exclusion'),
    case_selection_accuracy: metric('case_selection'),
    safety_checks: metric('safety'),
    api_status: metric('status'),
    latency: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
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
  coverage: {
    bySuite: groupedCoverage('suite'),
    byPriority: groupedCoverage('priority'),
    byTag: groupedCoverage('tags'),
    byRiskDomain: groupedCoverage('riskDomains'),
    byCapability: groupedCoverage('capabilities'),
    preP1Targets: {
      intent: Object.fromEntries(
        [...new Set(results.map((row) => row.target?.intent).filter(Boolean))]
          .sort()
          .map((intent) => [intent, results.filter((row) => row.target?.intent === intent).length]),
      ),
      guidance: Object.fromEntries(
        [...new Set(results.map((row) => row.target?.guidance).filter(Boolean))]
          .sort()
          .map((guidance) => [
            guidance,
            results.filter((row) => row.target?.guidance === guidance).length,
          ]),
      ),
      conversationRepairTurns: results.filter((row) => row.target?.conversationRepair).length,
      requiresCaseTurns: results.filter((row) => row.target?.requiresCase).length,
      responseLanguage: Object.fromEntries(
        evaluationContract.supportedLanguages.map((language) => [
          language,
          results.filter((row) => row.target?.responseLanguage === language).length,
        ]),
      ),
    },
  },
  regressions,
  requiredFailures,
  knownGaps,
  limitations: [
    'No live provider, live Supabase corpus or semantic judge. Null metrics are unmeasured, not zero.',
    'Route/language/tool checks are deterministic proxies, not a complete conversational-quality score.',
    'New hard scenarios are allowed to expose gaps; only historical regressions and explicitly required critical checks fail CI.',
    'Latency is local SQLite without provider and must not be presented as production latency.',
    'Natural-language case entity resolution remains a measured P1 gap until the conversation-state/orchestrator layer exists.',
    'Pre-P1 semantic targets define desired behavior; they are coverage contracts until P1 exposes structured intent/guidance/state outputs for direct scoring.',
  ],
  results,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');

console.log(
  JSON.stringify(
    {
      corpusVersion: report.corpusVersion,
      corpus: report.corpus,
      metrics: report.metrics,
      regressions,
      requiredFailures,
      knownGapCount: knownGaps.length,
      output,
    },
    null,
    2,
  ),
);

if (regressions.length || requiredFailures.length) process.exitCode = 1;
