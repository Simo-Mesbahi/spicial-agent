import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredSchemaForProvider } from '../lib/atlas/structured-output.ts';

test('Gemini structured schema removes unsupported keywords but preserves object closure', () => {
  const schema = {
    type: 'object',
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-z]+$' },
      items: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object',
          properties: { score: { type: 'integer', minimum: 0, maximum: 5 } },
          required: ['score'], additionalProperties: false,
        },
      },
    },
    required: ['label', 'items'], additionalProperties: false,
  };
  const out = structuredSchemaForProvider('gemini', schema);
  assert.equal(out.additionalProperties, false);
  assert.deepEqual(out.required, ['label', 'items']);
  assert.equal(out.properties.label.type, 'string');
  assert.equal(out.properties.label.minLength, undefined);
  assert.equal(out.properties.label.maxLength, undefined);
  assert.equal(out.properties.label.pattern, undefined);
  assert.equal(out.properties.items.minItems, 1);
  assert.equal(out.properties.items.maxItems, 4);
  assert.equal(out.properties.items.items.additionalProperties, false);
  assert.equal(out.properties.items.items.properties.score.minimum, 0);
  assert.equal(out.properties.items.items.properties.score.maximum, 5);
});

test('Non-Gemini providers retain the complete local schema', () => {
  const schema = {
    type: 'object',
    properties: { value: { type: 'string', minLength: 1, maxLength: 5 } },
    required: ['value'], additionalProperties: false,
  };
  for (const provider of ['openai', 'compatible', 'ollama', 'demo'])
    assert.equal(structuredSchemaForProvider(provider, schema), schema);
});
