import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const f of readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sql.exec(readFileSync('drizzle/' + f, 'utf8'));
  return {
    sql,
    prepare(query) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...args) ?? null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } };
        },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const r = [];
        for (const stmt of statements) r.push(await stmt.run());
        sql.exec('COMMIT');
        return r;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
export async function client(db, handleApi) {
  let cookie = '',
    csrf = '';
  const env = { DB: db };
  const call = async (path, payload, method) => {
    const req = new Request('https://atlas.test/api/' + path, {
      method: method ?? (payload === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://atlas.test',
        cookie,
        'x-atlas-csrf': csrf,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const r = await handleApi(req, env);
    const b = await r.json();
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    if (b.space) csrf = b.space.csrf;
    return { status: r.status, body: b };
  };
  const created = await call('session', {});
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return {
    call,
    env,
    get cookie() {
      return cookie;
    },
    get csrf() {
      return csrf;
    },
    snapshot: created.body,
  };
}
