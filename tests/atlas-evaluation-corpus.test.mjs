import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, evaluationContract } from '../evals/conversations.mjs';
import { p1ReleaseQualificationContract } from '../evals/p1-release-contract.mjs';

test('enterprise AI evaluation corpus keeps its coverage contract', () => {
  const ids = scenarios.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, 'scenario ids must stay unique');

  const turns = scenarios.reduce((total, scenario) => total + scenario.turns.length, 0);
  const critical = scenarios.filter((scenario) => scenario.priority === 'critical').length;
  const high = scenarios.filter((scenario) => scenario.priority === 'high').length;
  const long = scenarios.filter((scenario) => scenario.turns.length >= 10).length;
  const tags = new Set(scenarios.flatMap((scenario) => scenario.tags ?? []));
  const riskCounts = Object.fromEntries(
    evaluationContract.allowedRiskDomains.map((risk) => [
      risk,
      scenarios.filter((scenario) => (scenario.riskDomains ?? []).includes(risk)).length,
    ]),
  );
  const capabilityCounts = Object.fromEntries(
    evaluationContract.allowedCapabilities.map((capability) => [
      capability,
      scenarios.filter((scenario) => (scenario.capabilities ?? []).includes(capability)).length,
    ]),
  );

  assert.ok(scenarios.length >= evaluationContract.minimums.scenarios);
  assert.ok(turns >= evaluationContract.minimums.turns);
  assert.ok(critical >= evaluationContract.minimums.criticalScenarios);
  assert.ok(high >= evaluationContract.minimums.highPriorityScenarios);
  assert.ok(long >= evaluationContract.minimums.longScenarios);

  for (const tag of evaluationContract.requiredTags)
    assert.ok(tags.has(tag), 'missing required evaluation tag: ' + tag);

  for (const [risk, minimum] of Object.entries(evaluationContract.riskMinimums))
    assert.ok(
      riskCounts[risk] >= minimum,
      'risk coverage below contract: ' + risk + '=' + riskCounts[risk] + ' < ' + minimum,
    );

  for (const [capability, minimum] of Object.entries(evaluationContract.capabilityMinimums))
    assert.ok(
      capabilityCounts[capability] >= minimum,
      'capability coverage below contract: ' +
        capability +
        '=' +
        capabilityCounts[capability] +
        ' < ' +
        minimum,
    );

  const languageCounts = Object.fromEntries(
    evaluationContract.supportedLanguages.map((language) => [
      language,
      scenarios
        .flatMap((scenario) => scenario.turns)
        .filter((turn) => turn.language === language).length,
    ]),
  );
  for (const [language, count] of Object.entries(languageCounts))
    assert.ok(
      count >= evaluationContract.minimums.turnsPerLanguage,
      language + ' coverage below contract: ' + count,
    );
});

test('critical evaluation turns declare only supported blocking checks', () => {
  const allowed = new Set(evaluationContract.allowedRequiredChecks);
  for (const scenario of scenarios) {
    for (const [index, turn] of scenario.turns.entries()) {
      for (const check of turn.requiredChecks ?? [])
        assert.ok(allowed.has(check), scenario.id + '/' + (index + 1) + ': unsupported check ' + check);
    }
  }
});

test('historical P0 scenario ids remain present for baseline comparability', () => {
  for (let index = 1; index <= 58; index++)
    assert.ok(scenarios.some((scenario) => scenario.id === 'single-' + String(index).padStart(3, '0')));
  for (const id of [
    'mandatory-tv-switch',
    'ten-turn-language-switch',
    'twenty-turn-context',
    'security-extraction',
    'unauthorized-case',
    'unknown-policy',
    'thirty-turn-corrections',
  ])
    assert.ok(scenarios.some((scenario) => scenario.id === id), 'missing historical scenario ' + id);
});


test('critical evaluation scenarios are explicitly governed and blocking', () => {
  const risks = new Set(evaluationContract.allowedRiskDomains);
  const capabilities = new Set(evaluationContract.allowedCapabilities);
  const critical = scenarios.filter((scenario) => scenario.priority === 'critical');
  let blocking = 0;

  for (const scenario of critical) {
    assert.ok(
      Array.isArray(scenario.riskDomains) && scenario.riskDomains.length,
      scenario.id + ': critical scenario must declare riskDomains',
    );
    assert.ok(
      Array.isArray(scenario.capabilities) && scenario.capabilities.length,
      scenario.id + ': critical scenario must declare capabilities',
    );
    for (const risk of scenario.riskDomains)
      assert.ok(risks.has(risk), scenario.id + ': unsupported risk domain ' + risk);
    for (const capability of scenario.capabilities)
      assert.ok(capabilities.has(capability), scenario.id + ': unsupported capability ' + capability);

    const hasBlocking = scenario.turns.some((turn) => (turn.requiredChecks ?? []).length > 0);
    assert.ok(hasBlocking, scenario.id + ': critical scenario must contain a blocking check');
    if (hasBlocking) blocking++;
  }

  assert.ok(
    blocking >= evaluationContract.minimums.blockingCriticalScenarios,
    'blocking critical coverage below contract: ' +
      blocking +
      ' < ' +
      evaluationContract.minimums.blockingCriticalScenarios,
  );
});

test('risk and capability metadata stay normalized', () => {
  const riskSet = new Set(evaluationContract.allowedRiskDomains);
  const capabilitySet = new Set(evaluationContract.allowedCapabilities);

  for (const scenario of scenarios) {
    assert.equal(
      new Set(scenario.riskDomains ?? []).size,
      (scenario.riskDomains ?? []).length,
      scenario.id + ': duplicate risk domain',
    );
    assert.equal(
      new Set(scenario.capabilities ?? []).size,
      (scenario.capabilities ?? []).length,
      scenario.id + ': duplicate capability',
    );
    for (const risk of scenario.riskDomains ?? [])
      assert.ok(riskSet.has(risk), scenario.id + ': unknown risk domain ' + risk);
    for (const capability of scenario.capabilities ?? [])
      assert.ok(capabilitySet.has(capability), scenario.id + ': unknown capability ' + capability);
  }
});


test('Pre-P1 multilingual matrix keeps strict parity and semantic targets', () => {
  const preP1 = scenarios.filter((scenario) => scenario.suite === 'pre-p1-conversation-contract');
  const families = new Set(preP1.map((scenario) => scenario.matrixFamily));

  assert.ok(
    families.size >= evaluationContract.minimums.preP1MatrixFamilies,
    'Pre-P1 family coverage below contract',
  );
  assert.ok(
    preP1.length >= evaluationContract.minimums.preP1MatrixScenarios,
    'Pre-P1 scenario coverage below contract',
  );

  const allowedIntents = new Set(evaluationContract.allowedTargetIntents);
  const allowedGuidance = new Set(evaluationContract.allowedGuidanceModes);
  const supportedLanguages = new Set(evaluationContract.supportedLanguages);

  for (const family of families) {
    const rows = preP1.filter((scenario) => scenario.matrixFamily === family);
    assert.equal(
      rows.length,
      evaluationContract.preP1Matrix.scenariosPerFamily,
      family + ': must cover every supported language exactly once',
    );
    assert.deepEqual(
      new Set(rows.map((scenario) => scenario.matrixLanguage)),
      supportedLanguages,
      family + ': language parity mismatch',
    );
  }

  let targetTurns = 0;
  for (const scenario of preP1) {
    assert.ok(supportedLanguages.has(scenario.matrixLanguage), scenario.id + ': unsupported language');
    assert.equal(
      scenario.turns.length,
      evaluationContract.preP1Matrix.turnsPerScenario,
      scenario.id + ': unexpected turn count',
    );

    for (const [index, row] of scenario.turns.entries()) {
      targetTurns++;
      assert.equal(row.language, scenario.matrixLanguage, scenario.id + ': language drift');
      assert.ok(row.target, scenario.id + '/' + (index + 1) + ': target required');
      assert.ok(
        allowedIntents.has(row.target.intent),
        scenario.id + '/' + (index + 1) + ': invalid semantic intent',
      );
      assert.ok(
        allowedGuidance.has(row.target.guidance),
        scenario.id + '/' + (index + 1) + ': invalid guidance mode',
      );
      assert.equal(typeof row.target.requiresCase, 'boolean');
      assert.equal(typeof row.target.conversationRepair, 'boolean');
      assert.ok(
        supportedLanguages.has(row.target.responseLanguage),
        scenario.id + '/' + (index + 1) + ': invalid response language',
      );
    }
  }

  assert.ok(
    targetTurns >= evaluationContract.minimums.preP1TargetTurns,
    'Pre-P1 target turn coverage below contract',
  );

  for (const language of evaluationContract.supportedLanguages) {
    const count = preP1.filter((scenario) => scenario.matrixLanguage === language).length;
    assert.ok(
      count >= evaluationContract.minimums.preP1ScenariosPerLanguage,
      language + ': Pre-P1 scenario parity below contract',
    );
  }
});

test('Pre-P1 contract explicitly covers guidance restraint and conversation repair', () => {
  const preP1 = scenarios.filter((scenario) => scenario.suite === 'pre-p1-conversation-contract');
  const targets = preP1.flatMap((scenario) => scenario.turns.map((row) => row.target));

  assert.ok(targets.some((target) => target.guidance === 'soft_offer'));
  assert.ok(targets.some((target) => target.guidance === 'respect_decline'));
  assert.ok(targets.some((target) => target.guidance === 'clarify'));
  assert.ok(targets.some((target) => target.guidance === 'business_direct'));
  assert.ok(targets.some((target) => target.guidance === 'handoff'));
  assert.ok(targets.some((target) => target.conversationRepair === true));
  assert.ok(targets.some((target) => target.requiresCase === true));
  assert.ok(targets.some((target) => target.requiresCase === false));
});


test('P1.7 live structured qualification is multilingual, critical-family and budget bounded', () => {
  const contract = p1ReleaseQualificationContract;
  const preP1 = scenarios.filter((scenario) => scenario.suite === 'pre-p1-conversation-contract');
  const selected = preP1.filter((scenario) =>
    contract.structured.requiredFamilies.includes(scenario.matrixFamily),
  );

  const expectedScenarioCount =
    contract.structured.requiredFamilies.length * contract.supportedLanguages.length;
  assert.equal(selected.length, expectedScenarioCount);

  const selectedIds = new Set(selected.map((scenario) => scenario.id));
  for (const family of contract.structured.requiredFamilies) {
    for (const language of contract.supportedLanguages) {
      assert.ok(
        selectedIds.has(`pre-p1-${family}-${language}`),
        `missing P1.7 live scenario ${family}/${language}`,
      );
    }
  }

  const turns = selected.reduce((total, scenario) => total + scenario.turns.length, 0);
  assert.equal(turns, contract.structured.minimumTurns);
  assert.equal(turns, contract.structured.maximumTurns);

  for (const language of contract.supportedLanguages) {
    const languageTurns = selected
      .filter((scenario) => scenario.matrixLanguage === language)
      .reduce((total, scenario) => total + scenario.turns.length, 0);
    assert.ok(
      languageTurns >= contract.structured.minimumTurnsPerLanguage,
      `${language}: P1.7 live turn coverage below contract`,
    );
  }

  const completionCalls =
    contract.structured.minimumTurns +
    contract.generation.requiredScenarios +
    contract.grounding.requiredScenarios;
  assert.ok(
    completionCalls <= contract.liveBudget.maximumTotalCompletionCalls,
    'P1.7 live qualification exceeds completion-call budget',
  );
  assert.ok(
    contract.retrieval.requiredQueries <= contract.liveBudget.maximumEmbeddingCalls,
    'P1.7 live qualification exceeds embedding-call budget',
  );
});
