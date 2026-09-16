import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['lib/atlas/mfa-qr.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { mfaQrGeometry } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
// Public, synthetic fixture only; never use a real enrollment credential in tests.
const secret = 'JBSWY3DPEHPK3PXP';
function decodeGeometry(qr) {
  const scale = 6;
  const width = qr.size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const match of qr.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x = Number(match[1]), y = Number(match[2]);
    assert.ok(x >= 4 && y >= 4 && x < qr.size - 4 && y < qr.size - 4);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const offset = ((y * scale + dy) * width + x * scale + dx) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
  }
  return jsQR(pixels, width, width)?.data;
}
test('MFA QR geometry independently decodes to the Auth URI, including Unicode labels', () => {
  for (const label of ['SAV:test@example.invalid', 'SAV:équipe@example.invalid']) {
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=SAV%20SC&algorithm=SHA1&digits=6&period=30`;
    const qr = mfaQrGeometry(uri, secret);
    assert.ok(qr);
    assert.equal(decodeGeometry(qr), new URL(uri).href);
    assert.deepEqual(mfaQrGeometry(uri, secret), qr);
  }
});
test('MFA QR refuses external URLs, mismatched or duplicate secrets and excessive input', () => {
  for (const uri of [undefined, '', 'https://example.invalid/?secret=' + secret, 'javascript:alert(1)', `otpauth://hotp/test?secret=${secret}`, `otpauth://totp/test?secret=OTHER`, `otpauth://totp/test?secret=${secret}&secret=${secret}`, 'x'.repeat(4001)]) {
    assert.equal(mfaQrGeometry(uri, secret), null);
  }
  assert.equal(mfaQrGeometry(`otpauth://totp/test?secret=${secret}`, undefined), null);
});

test('Browser bundle generates a decodable QR and reports only safe diagnostic codes', async () => {
  const browserBuild = await build({ entryPoints: ['lib/atlas/mfa-qr.ts'], bundle: true, platform: 'browser', format: 'esm', minify: true, write: false });
  const { mfaQrResult } = await import('data:text/javascript;base64,' + Buffer.from(browserBuild.outputFiles[0].text).toString('base64'));
  const uri = `otpauth://totp/SAV:qa@example.invalid?algorithm=SHA1&digits=6&issuer=SAV&period=30&secret=${secret}`;
  const qr = mfaQrResult(uri, secret);
  assert.equal(qr.ok, true);
  assert.equal(decodeGeometry(qr), uri);
  for (const [input, key, code] of [[undefined, secret, 'missing_data'], ['not-a-url', secret, 'invalid_uri'], [uri, 'INVALID!', 'invalid_secret'], [uri, 'AAAAAAAAAAAAAAAA', 'secret_mismatch']]) {
    assert.deepEqual(mfaQrResult(input, key), {ok:false,code});
  }
});
