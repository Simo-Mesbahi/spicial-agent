import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['lib/atlas/mfa-qr.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { mfaQrSource } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));

test('MFA QR accepts raw SVG including XML headers and never needs an external service', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Test &amp; QR</title></svg>';
  for (const prefix of ['', '\n ', '<?xml version="1.0"?>\n', '<?xml version="1.0"?>\n<!-- QR -->\n<!DOCTYPE svg>\n']) {
    const url = mfaQrSource(prefix + svg);
    assert.ok(url.startsWith('data:image/svg+xml;charset=utf-8,'));
    assert.equal(decodeURIComponent(url.split(',')[1]), svg);
  }
});
test('MFA QR keeps embedded image sources and refuses links, markup and oversized data', () => {
  for (const value of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,iVBORw0KGgo=']) {
    assert.equal(mfaQrSource('  ' + value + '  '), value);
  }
  for (const value of [undefined, '', '<html>error</html>', 'https://example.com/qr?secret=test', 'javascript:alert(1)', 'data:text/html,<svg>', 'x'.repeat(200001)]) {
    assert.equal(mfaQrSource(value), null);
  }
});
