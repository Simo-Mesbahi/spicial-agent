import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['lib/atlas/mfa-qr.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { mfaQrGeometry } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);

// Public, synthetic fixture only; never use a real enrollment credential in tests.
const secret = 'JBSWY3DPEHPK3PXP';

function decodeGeometry(qr) {
  const scale = 6;
  const width = qr.size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const match of qr.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    assert.ok(x >= 4 && y >= 4 && x < qr.size - 4 && y < qr.size - 4);
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const offset = ((y * scale + dy) * width + x * scale + dx) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
  }
  return jsQR(pixels, width, width)?.data;
}

test('MFA QR geometry preserves a trusted Auth URI and independently decodes it', () => {
  for (const label of ['SAV:test@example.invalid', 'SAV:équipe@example.invalid']) {
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=SAV%20SC&algorithm=SHA1&digits=6&period=30`;
    const qr = mfaQrGeometry(uri, secret);
    assert.ok(qr);
    assert.equal(decodeGeometry(qr), new URL(uri).href);
    assert.deepEqual(mfaQrGeometry(uri, secret), qr);
  }
});

test('MFA QR falls back locally when Auth URI is absent, malformed or mismatched', () => {
  for (const uri of [
    undefined,
    '',
    'https://example.invalid/?secret=' + secret,
    'javascript:alert(1)',
    `otpauth://hotp/test?secret=${secret}`,
    'otpauth://totp/test?secret=OTHER',
    `otpauth://totp/test?secret=${secret}&secret=${secret}`,
    'x'.repeat(4001),
  ]) {
    const qr = mfaQrGeometry(uri, secret);
    assert.ok(qr);
    const payload = new URL(decodeGeometry(qr));
    assert.equal(payload.protocol, 'otpauth:');
    assert.equal(payload.hostname, 'totp');
    assert.equal(payload.searchParams.get('secret'), secret);
    assert.equal(payload.searchParams.get('issuer'), 'SAV SC Administration');
    assert.equal(payload.searchParams.get('algorithm'), 'SHA1');
    assert.equal(payload.searchParams.get('digits'), '6');
    assert.equal(payload.searchParams.get('period'), '30');
  }
});

test('MFA QR normalizes safe Base32 formatting but still fails closed without a valid secret', () => {
  const spaced = 'jbsw y3dp ehpk 3pxp';
  const qr = mfaQrGeometry(null, spaced);
  assert.ok(qr);
  assert.equal(new URL(decodeGeometry(qr)).searchParams.get('secret'), secret);

  for (const invalid of [undefined, '', 'NOT-BASE32-01', '***', 'A'.repeat(513)])
    assert.equal(mfaQrGeometry(null, invalid), null);
});
