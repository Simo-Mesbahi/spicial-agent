import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({
  stdin: {
    contents: "export {localizedCaseReply} from './lib/atlas/conversation-intelligence';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { localizedCaseReply } = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
);

test('waiting-part case fallback uses complete localized sentences without an invented date', () => {
  const currentCase = {
    reference: 'SAV-2026-1042',
    product: 'Télévision',
    status: 'waiting_part',
    quote_cents: null,
    refund_cents: null,
    store: 'Test',
    updated_at: '2026-09-28T00:00:00Z',
  };
  const expected = {
    fr: 'Votre dossier de réparation SAV-2026-1042 est en attente d’une pièce.',
    en: 'Your repair case SAV-2026-1042 is waiting for a part.',
    de: 'Für Ihren Reparaturvorgang SAV-2026-1042 wird derzeit auf ein Ersatzteil gewartet.',
    es: 'Su reparación (expediente SAV-2026-1042) está a la espera de una pieza.',
    ar: 'إصلاح جهازك في الملف SAV-2026-1042 بانتظار قطعة غيار.',
  };
  for (const [language, sentence] of Object.entries(expected)) {
    const actual = localizedCaseReply(language, currentCase);
    assert.equal(actual, sentence, language);
    assert.equal(actual.includes('Télévision'), false, language);
    assert.equal(/\b(?:2026-09-28|tomorrow|mañana|morgen)\b/i.test(actual), false, language);
  }
});
