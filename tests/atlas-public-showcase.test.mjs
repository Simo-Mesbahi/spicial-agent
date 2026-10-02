import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public showcase is static and does not initialize runtime services', async () => {
  const source = await read('app/page.tsx');
  assert.doesNotMatch(source, /['"]use client['"]/);
  assert.doesNotMatch(source, /\/api\//);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /requestJson|supabase|GROQ_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY/);
  assert.match(source, /href="\/demo"/);
  assert.match(source, /href="\/trial"/);
  assert.match(source, /href="\/file"/);
});

test('public copy keeps release and demo boundaries explicit', async () => {
  const source = await read('app/page.tsx');
  assert.match(source, /données fictives/i);
  assert.match(source, /P1.*qualification|qualification.*P1/is);
  assert.match(source, /intervention humaine/i);
  assert.match(source, /personnalisation/i);
  assert.doesNotMatch(source, /certifi(é|ée|cation) ISO|SOC ?2|conforme RGPD à 100%/i);
});

test('dedicated demo route preserves the existing interactive application', async () => {
  const [root, demo] = await Promise.all([read('app/page.tsx'), read('app/demo/page.tsx')]);
  assert.match(demo, /['"]use client['"]/);
  assert.match(demo, /requestJson/);
  assert.match(demo, /Discovery/);
  assert.notEqual(root, demo);
});

test('guided trial page fails closed until the prospect recipient is confirmed', async () => {
  const source = await read('app/trial/page.tsx');
  assert.match(source, /à confirmer avant publication/i);
  assert.doesNotMatch(source, /mailto:/i);
  assert.doesNotMatch(source, /outloo\.com/i);
  assert.doesNotMatch(source, /outlook\.com/i);
});
