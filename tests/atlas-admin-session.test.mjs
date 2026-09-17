import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/atlas/admin-session.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const session = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

test('admin idle session stays active before warning window', () => {
  const now = 1_000_000;
  const state = session.adminIdleSnapshot(now - 5 * 60_000, now);
  assert.equal(state.status, 'active');
  assert.equal(state.remainingMs, 10 * 60_000);
});

test('admin idle session warns two minutes before automatic logout', () => {
  const now = 1_000_000;
  const state = session.adminIdleSnapshot(now - 13 * 60_000 - 1, now);
  assert.equal(state.status, 'warning');
  assert.ok(state.remainingMs < session.ADMIN_IDLE_WARNING_MS);
});

test('admin idle session expires at fifteen minutes and rejects missing activity', () => {
  const now = 1_000_000;
  assert.equal(session.adminIdleSnapshot(now - session.ADMIN_IDLE_TIMEOUT_MS, now).status, 'expired');
  assert.equal(session.adminIdleSnapshot(0, now).status, 'expired');
});

test('idle countdown is stable and user readable', () => {
  assert.equal(session.formatAdminIdleCountdown(120_000), '2:00');
  assert.equal(session.formatAdminIdleCountdown(61_001), '1:02');
  assert.equal(session.formatAdminIdleCountdown(0), '0:00');
});
