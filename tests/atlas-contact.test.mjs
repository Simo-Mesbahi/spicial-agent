import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/atlas/contact.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { buildContactMailto, CONTACT_RECIPIENT, validateContactDraft } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

test('Contact messages always target the configured recipient', () => {
  const link = buildContactMailto({
    email: 'client@example.com',
    subject: 'Question SAV',
    message: 'Bonjour, je souhaite obtenir plus d’informations.',
  });
  assert.equal(CONTACT_RECIPIENT, 'mohammed.elmesbahi31@gmail.com');
  assert.match(link, new RegExp('^mailto:' + CONTACT_RECIPIENT.replace('.', '\\.')));
});

test('Contact link preserves readable Unicode content and a reply address', () => {
  const link = buildContactMailto({
    email: ' Client@Example.COM ',
    subject: '  Produit défectueux  ',
    message: ' Première ligne.\r\nDeuxième ligne avec un café. ',
  });
  const url = new URL(link);
  assert.equal(url.searchParams.get('subject'), '[SAV SC Assistant AI] Produit défectueux');
  assert.match(url.searchParams.get('body'), /^Adresse de réponse : client@example\.com/m);
  assert.match(url.searchParams.get('body'), /Deuxième ligne avec un café\./);
});

test('Contact subject cannot inject mail headers', () => {
  const clean = validateContactDraft({
    email: 'client@example.com',
    subject: 'Question\r\nBcc: intrus@example.com',
    message: 'Un message suffisamment détaillé.',
  });
  assert.equal(clean.subject, 'Question Bcc: intrus@example.com');
});

test('Contact validation rejects invalid or incomplete drafts', () => {
  const valid = {
    email: 'client@example.com',
    subject: 'Question SAV',
    message: 'Un message suffisamment détaillé.',
  };
  assert.throws(() => validateContactDraft({ ...valid, email: 'invalid' }), /email valide/);
  assert.throws(() => validateContactDraft({ ...valid, subject: '  ' }), /objet/i);
  assert.throws(() => validateContactDraft({ ...valid, message: 'Court' }), /message/i);
  assert.throws(() => validateContactDraft({ ...valid, message: 'x'.repeat(3001) }), /3 000/);
});
