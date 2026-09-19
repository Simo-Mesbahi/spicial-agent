import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, evaluationContract } from '../evals/conversations.mjs';

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
