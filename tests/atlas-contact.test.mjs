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
const {
  buildContactClientLinks,
  buildContactEmail,
  buildContactMailto,
  CONTACT_RECIPIENT,
  validateContactDraft,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

test('Contact messages always target the configured recipient', () => {
  const link = buildContactMailto({
    subject: 'Question SAV',
    message: 'Bonjour, je souhaite obtenir plus d’informations.',
  });
  assert.equal(CONTACT_RECIPIENT, 'mohammed.elmesbahi31@gmail.com');
  assert.match(link, new RegExp('^mailto:' + CONTACT_RECIPIENT.replace('.', '\\.')));
});

test('Contact link preserves readable Unicode content', () => {
  const link = buildContactMailto({
    subject: '  Produit défectueux  ',
    message: ' Première ligne.\r\nDeuxième ligne avec un café. ',
  });
  const url = new URL(link);
  assert.equal(url.searchParams.get('subject'), '[SAV SC Assistant AI] Produit défectueux');
  assert.match(url.searchParams.get('body'), /^Première ligne\./m);
  assert.match(url.searchParams.get('body'), /Deuxième ligne avec un café\./);
});

test('Every client receives the same prepared recipient, subject and body', () => {
  const input = {
    subject: 'Dossier SAV-2026-1042',
    message: 'Bonjour, je souhaite être accompagné pour mon dossier.',
  };
  const email = buildContactEmail(input);
  const links = buildContactClientLinks(input);
  const url = new URL(links.defaultApp);
  const gmail = new URL(links.gmailWeb);
  const outlook = new URL(links.outlookWeb);
  assert.equal(email.recipient, CONTACT_RECIPIENT);
  assert.equal(url.searchParams.get('subject'), email.subject);
  assert.equal(url.searchParams.get('body'), email.body);
  assert.equal(gmail.searchParams.get('to'), CONTACT_RECIPIENT);
  assert.equal(gmail.searchParams.get('su'), email.subject);
  assert.equal(gmail.searchParams.get('body'), email.body);
  assert.equal(outlook.searchParams.get('to'), CONTACT_RECIPIENT);
  assert.equal(outlook.searchParams.get('subject'), email.subject);
  assert.equal(outlook.searchParams.get('body'), email.body);
  assert.match(links.gmailApp, /^googlegmail:\/\/co\?/);
  assert.match(links.outlookApp, /^ms-outlook:\/\/compose\?/);
});

test('Contact subject cannot inject mail headers', () => {
  const clean = validateContactDraft({
    subject: 'Question\r\nBcc: intrus@example.com',
    message: 'Un message suffisamment détaillé.',
  });
  assert.equal(clean.subject, 'Question Bcc: intrus@example.com');
});

test('Contact validation rejects invalid or incomplete drafts', () => {
  const valid = {
    subject: 'Question SAV',
    message: 'Un message suffisamment détaillé.',
  };
  assert.throws(() => validateContactDraft({ ...valid, subject: '  ' }), /objet/i);
  assert.throws(() => validateContactDraft({ ...valid, message: 'Court' }), /message/i);
  assert.throws(() => validateContactDraft({ ...valid, message: 'x'.repeat(3001) }), /3 000/);
});
