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

  assert.ok(scenarios.length >= evaluationContract.minimums.scenarios);
  assert.ok(turns >= evaluationContract.minimums.turns);
  assert.ok(critical >= evaluationContract.minimums.criticalScenarios);
  assert.ok(high >= evaluationContract.minimums.highPriorityScenarios);
  assert.ok(long >= evaluationContract.minimums.longScenarios);

  for (const tag of evaluationContract.requiredTags)
    assert.ok(tags.has(tag), 'missing required evaluation tag: ' + tag);

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
