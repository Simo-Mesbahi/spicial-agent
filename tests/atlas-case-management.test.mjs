import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  allowedNextStatuses,
  canManageCase,
  caseCreateInputSchema,
  caseUpdateInputSchema,
  serviceKinds,
} from '../lib/atlas/case-management.ts';

test('case management role boundaries are explicit by service', () => {
  assert.equal(canManageCase('super_admin', 'sav'), true);
  assert.equal(canManageCase('super_admin', 'customer_service'), true);
  assert.equal(canManageCase('sav_manager', 'sav'), true);
  assert.equal(canManageCase('sav_manager', 'customer_service'), false);
  assert.equal(canManageCase('sc_manager', 'sav'), false);
  assert.equal(canManageCase('sc_manager', 'customer_service'), true);
  assert.equal(canManageCase('adviser', 'sav'), false);
  assert.equal(canManageCase('analyst', 'customer_service'), false);
});

test('case service kinds prevent cross-domain creation', () => {
  assert.deepEqual(serviceKinds('sav'), ['repair', 'exchange', 'refund', 'delivery', 'other']);
  assert.deepEqual(serviceKinds('customer_service'), ['complaint', 'refund', 'account', 'other']);

  const base = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    title: 'Demande test',
    requestId: '12345678-1234-4234-8234-123456789012',
  };

  assert.equal(
    caseCreateInputSchema.safeParse({ ...base, serviceType: 'sav', kind: 'repair' }).success,
    true,
  );
  assert.equal(
    caseCreateInputSchema.safeParse({ ...base, serviceType: 'customer_service', kind: 'repair' }).success,
    false,
  );
});

test('lifecycle exposes only declared next states', () => {
  assert.deepEqual(allowedNextStatuses('sav', 'resolved'), []);
  assert.deepEqual(allowedNextStatuses('customer_service', 'cancelled'), []);
  assert.ok(allowedNextStatuses('sav', 'diagnosis').includes('repairing'));
  assert.ok(!allowedNextStatuses('sav', 'diagnosis').includes('resolved'));
  assert.ok(allowedNextStatuses('customer_service', 'complaint_review').includes('resolved'));
  assert.ok(!allowedNextStatuses('customer_service', 'complaint_review').includes('repairing'));
});

test('case update contract rejects unsafe money and malformed timestamps', () => {
  const base = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    caseId: '00000000-0000-4000-8000-000000000401',
    expectedVersion: 1,
    title: 'Dossier',
    description: '',
    customerId: null,
    productId: null,
    storeId: null,
    warrantyStatus: 'unknown',
    warrantyLabel: null,
    quoteCents: null,
    refundCents: null,
    currency: 'EUR',
    deliveryMode: null,
    estimatedAt: null,
    requestId: '12345678-1234-4234-8234-123456789012',
  };

  assert.equal(caseUpdateInputSchema.safeParse(base).success, true);
  assert.equal(caseUpdateInputSchema.safeParse({ ...base, quoteCents: -1 }).success, false);
  assert.equal(
    caseUpdateInputSchema.safeParse({ ...base, estimatedAt: '2026-09-30 10:00' }).success,
    false,
  );
});

test('case management migration preserves audit, idempotency and soft-delete invariants', () => {
  const sql = readFileSync(
    'supabase/migrations/20260922072000_case_management_engine.sql',
    'utf8',
  );

  for (const token of [
    'app_private.case_reference_counters',
    'app_private.case_transition_allowed',
    'public.admin_create_case',
    'public.admin_update_case',
    'public.admin_transition_case',
    'public.admin_rotate_case_access_code',
    'public.admin_archive_case',
    'public.audit_events',
    'public.case_commands',
    'archived_at=now()',
    'update public.case_access_codes',
    'update public.case_sessions',
    'extensions.crypt',
    "extensions.gen_salt('bf',12)",
    'create policy cases_admin_select',
    'app_private.case_id_read_allowed',
    'app_private.conversation_read_allowed',
  ])
    assert.ok(sql.includes(token), `missing migration invariant: ${token}`);

  assert.equal(/delete\s+from\s+public\.service_cases/i.test(sql), false);
  assert.equal(/grant\s+(?:insert|update|delete)[^;]*service_cases[^;]*authenticated/i.test(sql), false);
  assert.equal((sql.match(/create or replace function app_private\.admin_create_case/g) ?? []).length, 1);
  assert.equal((sql.match(/create or replace function app_private\.admin_archive_case/g) ?? []).length, 1);
});

test('staging seed assigns explicit service ownership to both case families', () => {
  const seed = readFileSync('supabase/seed.staging.sql', 'utf8');
  assert.match(seed, /'SAV-2026-1042', 'sav', 'repair'/);
  assert.match(seed, /'SC-2026-2048', 'customer_service', 'complaint'/);
});
