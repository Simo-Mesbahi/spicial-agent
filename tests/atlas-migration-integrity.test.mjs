import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

function migrations() {
  return readdirSync('supabase/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

test('migration filenames are chronological, unique and deployable by convention', () => {
  const files = migrations();
  const timestamps = new Set();

  for (const file of files) {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(file);
    assert.ok(match, `invalid migration filename: ${file}`);
    assert.equal(timestamps.has(match[1]), false, `duplicate migration timestamp: ${match[1]}`);
    timestamps.add(match[1]);
  }

  assert.deepEqual(files, [...files].sort());
});

test('SQL migrations never contain truncated anonymous dollar quotes', () => {
  for (const file of migrations()) {
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
    const lines = sql.split('\n');

    lines.forEach((line, index) => {
      assert.doesNotMatch(
        line,
        /^\s*as \$\s*$/i,
        `${file}:${index + 1} contains a truncated dollar-quote opener`,
      );
      assert.doesNotMatch(
        line,
        /^\s*\$;\s*$/,
        `${file}:${index + 1} contains a truncated dollar-quote closer`,
      );
    });
  }
});

test('double-dollar SQL blocks are balanced in every migration', () => {
  for (const file of migrations()) {
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
    const doubleDollarCount = sql.match(/\$\$/g)?.length ?? 0;
    assert.equal(
      doubleDollarCount % 2,
      0,
      `${file} has an unbalanced $$ delimiter count`,
    );
  }
});
