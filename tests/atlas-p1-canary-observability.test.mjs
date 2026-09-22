import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const migrationPath =
  'supabase/migrations/20260922112140_p1_release_observability.sql';
const hardeningPath =
  'supabase/migrations/20260922112354_p1_release_observability_hardening.sql';

test('P1.7 canary telemetry schema is privacy-bounded and deny-by-default', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const table = sql.match(
    /create table if not exists public\.p1_release_events \(([\s\S]*?)\n\);/,
  )?.[1] ?? '';

  assert.ok(table.length > 0);
  assert.doesNotMatch(table, /\b(content|message|case_id|session_id|customer_id)\b/i);
  assert.match(table, /organization_id uuid not null/);
  assert.match(table, /request_id uuid not null/);
  assert.match(table, /unique \(organization_id, request_id\)/);
  assert.match(sql, /alter table public\.p1_release_events enable row level security/);
  assert.match(sql, /create policy p1_release_events_deny_direct[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
  assert.match(sql, /revoke all on public\.p1_release_events[\s\S]*service_role/);
});

test('P1.7 telemetry writes are server-only and admin reads use a SECURITY INVOKER API wrapper', async () => {
  const base = await readFile(migrationPath, 'utf8');
  const hardening = await readFile(hardeningPath, 'utf8');

  assert.match(
    base,
    /create or replace function public\.record_p1_release_event\([\s\S]*security definer/,
  );
  assert.match(
    base,
    /revoke all on function public\.record_p1_release_event\([\s\S]*from public,anon,authenticated/,
  );
  assert.match(
    base,
    /grant execute on function public\.record_p1_release_event\([\s\S]*to service_role/,
  );

  assert.match(
    hardening,
    /create or replace function app_private\.admin_p1_release_metrics\([\s\S]*security definer/,
  );
  assert.match(
    hardening,
    /app_private\.is_admin\(p_organization_id,null,true\)/,
  );
  assert.match(
    hardening,
    /create or replace function public\.admin_p1_release_metrics\([\s\S]*security invoker/,
  );
  assert.match(
    hardening,
    /select app_private\.admin_p1_release_metrics\(p_organization_id,p_hours\)/,
  );
  assert.match(
    hardening,
    /grant execute on function public\.admin_p1_release_metrics\(uuid,integer\)[\s\S]*to authenticated/,
  );
  assert.match(hardening, /'invariant_violations'/);
  assert.match(hardening, /release_mode not in \('canary','on'\)/);
  assert.match(hardening, /or not cohort/);
  assert.match(hardening, /or not attempted/);
  assert.match(hardening, /'release_rate'/);
  assert.match(hardening, /'p95_ms'/);
  assert.match(hardening, /drop index if exists public\.p1_release_events_org_mode_time_idx/);
  assert.match(hardening, /drop index if exists public\.p1_release_events_org_released_time_idx/);
});

test('release telemetry recorder sends only bounded diagnostics and never response prose', async (t) => {
  const compiled = await build({
    stdin: {
      contents:
        "export {recordProductionReleaseEvent} from './lib/atlas/production-api';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { recordProductionReleaseEvent } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );

  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  });

  const env = {
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    SUPABASE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000001',
  };
  const response = Response.json({
    id: 'reply-1',
    role: 'assistant',
    content: 'PRIVATE CUSTOMER RESPONSE THAT MUST NEVER ENTER TELEMETRY',
    metadata: {
      requestId: '00000000-0000-4000-8000-000000000123',
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      providerCalls: 3,
      inputTokens: 210,
      outputTokens: 80,
      latencyMs: 1234.4,
      evidence: {
        sources: ['PRIVATE EVIDENCE'],
      },
      generation: {
        mode: 'release',
        outcome: 'candidate_generated',
        released: true,
      },
      validation: {
        outcome: 'supported_candidate',
        released: true,
      },
      release: {
        mode: 'canary',
        cohort: true,
        cohortBucket: 4,
        canaryPercent: 5,
        attempted: true,
        released: true,
        reason: null,
        plan: 'case',
        evidenceCaseVersion: 8,
        knowledgeSourceCount: 0,
      },
    },
  });

  await recordProductionReleaseEvent(env, '/api/production/chat', response);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/record_p1_release_event$/);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    p_organization_id: env.SUPABASE_ORGANIZATION_ID,
    p_request_id: '00000000-0000-4000-8000-000000000123',
    p_release_mode: 'canary',
    p_cohort: true,
    p_cohort_bucket: 4,
    p_canary_percent: 5,
    p_attempted: true,
    p_released: true,
    p_reason: null,
    p_plan: 'case',
    p_generation_outcome: 'candidate_generated',
    p_validation_outcome: 'supported_candidate',
    p_provider: 'gemini',
    p_model: 'gemini-3.1-flash-lite',
    p_provider_calls: 3,
    p_input_tokens: 210,
    p_output_tokens: 80,
    p_latency_ms: 1234,
  });
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /PRIVATE CUSTOMER|PRIVATE EVIDENCE|case_id|session_id/i);
});

test('release telemetry recorder is silent for non-chat, failed or non-release responses', async (t) => {
  const compiled = await build({
    stdin: {
      contents:
        "export {recordProductionReleaseEvent} from './lib/atlas/production-api';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { recordProductionReleaseEvent } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );

  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 204 });
  });
  const env = {
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    SUPABASE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000001',
  };

  await recordProductionReleaseEvent(
    env,
    '/api/production/health',
    Response.json({ ok: true }),
  );
  await recordProductionReleaseEvent(
    env,
    '/api/production/chat',
    Response.json({ error: 'failed' }, { status: 503 }),
  );
  await recordProductionReleaseEvent(
    env,
    '/api/production/chat',
    Response.json({ metadata: { requestId: crypto.randomUUID(), release: null } }),
  );

  assert.equal(calls, 0);
});

test('worker records P1 release telemetry with waitUntil outside the customer critical path', async () => {
  const source = await readFile('worker/index.ts', 'utf8');
  assert.match(source, /recordProductionReleaseEvent/);
  assert.match(
    source,
    /ctx\.waitUntil\([\s\S]*recordProductionPerformance[\s\S]*recordProductionReleaseEvent/,
  );
});
