import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public showcase is static and does not initialize runtime services', async () => {
  const source = await read('app/page.tsx');
  const brand = await read('components/atlas/showcase-brand.tsx');
  for (const content of [source, brand]) {
    assert.doesNotMatch(content, /['"]use client['"]/);
    assert.doesNotMatch(content, /\/api\//);
    assert.doesNotMatch(content, /\bfetch\s*\(/);
    assert.doesNotMatch(content, /requestJson|supabase|GROQ_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY/);
  }
  assert.match(source, /href="\/demo"/);
  assert.match(source, /href="\/trial"/);
  assert.match(source, /href="\/file"/);
});

test('public copy keeps release and demo boundaries explicit', async () => {
  const source = await read('app/page.tsx');
  assert.match(source, /données fictives/i);
  assert.match(source, /qualification, revue humaine et ouverture contrôlée/);
  assert.doesNotMatch(source, /\bP1(?:\.7)?\b/);
  assert.match(source, /intervention humaine/i);
  assert.match(source, /personnalisation/i);
  assert.doesNotMatch(source, /certifi(é|ée|cation) ISO|SOC ?2|conforme RGPD à 100%/i);
});

test('product captures are identified as fictitious data and never expose protected routes', async () => {
  const source = await read('app/page.tsx');
  assert.match(source, /Capture du produit · données fictives/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /width="1440"/);
  assert.doesNotMatch(source, /href="\/admin/);
  for (const file of [
    'public/showcase/client-workspace.png',
    'public/showcase/admin-reports.png',
  ]) {
    const data = await readFile(new URL(`../${file}`, import.meta.url));
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.ok(data.byteLength < 250 * 1024, `${file} exceeds its asset budget`);
  }
});

test('dedicated demo route preserves the existing interactive application', async () => {
  const [root, demo] = await Promise.all([read('app/page.tsx'), read('app/demo/page.tsx')]);
  assert.match(demo, /['"]use client['"]/);
  assert.match(demo, /requestJson/);
  assert.match(demo, /Discovery/);
  assert.notEqual(root, demo);
});

test('guided trial and client contact share one confirmed recipient source', async () => {
  const [trial, contact] = await Promise.all([
    read('app/trial/page.tsx'),
    read('lib/atlas/contact.ts'),
  ]);
  assert.match(trial, /import \{ CONTACT_RECIPIENT \} from ['"]@\/lib\/atlas\/contact['"]/);
  assert.match(trial, /mailto:\$\{CONTACT_RECIPIENT\}/);
  assert.match(trial, /rien\s+n’est envoyé automatiquement/i);
  assert.doesNotMatch(trial, /outloo\.com|elmesbahi31@gmail\.com/i);
  assert.match(contact, /CONTACT_RECIPIENT = ['"]Mohammed\.elmesbahi@outlook\.com['"]/);
  assert.doesNotMatch(contact, /outloo\.com|elmesbahi31@gmail\.com/i);
});

test('showcase evidence is enforced on pull requests and relevant main pushes', async () => {
  const workflow = await read('.github/workflows/showcase-evidence.yml');
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /pull_request:/);
  assert.match(
    workflow,
    /public-showcase-evidence-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  );
  assert.match(workflow, /LLM_BUDGET_MODE:\s*zero/);
  assert.match(workflow, /P1_RELEASE_MODE:\s*off/);
  assert.match(workflow, /components\/atlas\/showcase-brand\.tsx/);
  assert.match(workflow, /components\/atlas\/copy-commercial-email\.tsx/);
});
