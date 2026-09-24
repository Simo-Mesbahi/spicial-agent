import type { z } from 'zod';
import type { AtlasEnv } from './api';
import {
  caseKinds,
  caseSchema,
  caseStatuses,
  warrantyStatuses,
  type CaseStatus,
  type ProductionCaseKind,
  type WarrantyStatus,
} from './case-schema';
import { z as schema } from 'zod';
import { supabaseRequest, supabaseSettings, SupabaseRequestError } from './supabase';

export class CaseAccessError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function caseSessionHash(organizationId: string, token: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`production-case:${organizationId}:${token}`),
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export type CaseFacts = {
  source: 'supabase';
  organizationId: string;
  id: string;
  reference: string;
  kind: ProductionCaseKind;
  status: CaseStatus;
  product: string | null;
  warranty: { status: WarrantyStatus; label: string | null };
  quote: { cents: number; currency: string } | null;
  refund: { cents: number; currency: string } | null;
  estimatedAt: string | null;
  confirmedEta: null;
  version: number;
  updatedAt: string;
  retrievedAt: string;
};
export function normalizeCase(
  snapshot: z.infer<typeof caseSchema>,
  organizationId: string,
): CaseFacts {
  if (
    !caseKinds.includes(snapshot.kind as ProductionCaseKind) ||
    !caseStatuses.includes(snapshot.status as CaseStatus) ||
    !warrantyStatuses.includes(snapshot.warranty_status as WarrantyStatus) ||
    !Number.isFinite(Date.parse(snapshot.updated_at)) ||
    (snapshot.estimated_at && !Number.isFinite(Date.parse(snapshot.estimated_at))) ||
    !/^[A-Z]{3}$/.test(snapshot.currency)
  )
    throw new CaseAccessError(
      502,
      'invalid_case_response',
      'Les données du dossier ne peuvent pas être confirmées.',
    );
  return {
    source: 'supabase',
    organizationId,
    id: snapshot.id,
    reference: snapshot.reference,
    kind: snapshot.kind,
    status: snapshot.status,
    product: snapshot.product?.name ?? null,
    warranty: { status: snapshot.warranty_status, label: snapshot.warranty_label },
    quote:
      snapshot.quote_cents === null
        ? null
        : { cents: snapshot.quote_cents, currency: snapshot.currency },
    refund:
      snapshot.refund_cents === null
        ? null
        : { cents: snapshot.refund_cents, currency: snapshot.currency },
    // An estimated_at value is never silently upgraded to a confirmed commitment.
    estimatedAt: snapshot.estimated_at,
    confirmedEta: null,
    version: snapshot.version,
    updatedAt: snapshot.updated_at,
    retrievedAt: new Date().toISOString(),
  };
}
type Binding = { space_id: string; case_id: string; expires_at: number; csrf: string };
export async function bindProductionCaseSession(
  env: AtlasEnv,
  token: string,
  caseId: string,
  expiry: string,
) {
  const now = Date.now(),
    parsedExpiry = Date.parse(expiry);
  if (!/^[a-f0-9]{64}$/.test(token) || !Number.isFinite(parsedExpiry) || parsedExpiry <= now)
    throw new CaseAccessError(502, 'invalid_case_response', 'La session du dossier est invalide.');
  const organizationId = supabaseSettings(env).organizationId;
  const key = await caseSessionHash(organizationId, token),
    id = crypto.randomUUID();
  const expiresAt = Math.min(parsedExpiry, now + 30 * 60_000);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO spaces (id,token_hash,csrf,created_at,expires_at,running,tick_at,tick,attempts,locked_until,chat_count,chat_window)
      VALUES (?,?,?,?,?,0,?,0,0,0,0,?)`,
    ).bind(id, key, crypto.randomUUID(), now, expiresAt, now, now),
    env.DB.prepare(
      'INSERT INTO production_case_bindings (session_hash,space_id,organization_id,case_id,expires_at) VALUES (?,?,?,?,?)',
    ).bind(key, id, organizationId, caseId, expiresAt),
  ]);
}
export async function productionCaseAdapter(env: AtlasEnv, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new CaseAccessError(
      401,
      'case_session_required',
      'Vérifiez votre dossier pour continuer.',
    );
  const organizationId = supabaseSettings(env).organizationId;
  const sessionHash = await caseSessionHash(organizationId, token);
  const binding = await env.DB.prepare(
    `SELECT b.space_id,b.case_id,b.expires_at,s.csrf FROM production_case_bindings b
    JOIN spaces s ON s.id=b.space_id WHERE b.session_hash=? AND b.organization_id=? AND b.expires_at>? AND s.expires_at>?`,
  )
    .bind(sessionHash, organizationId, Date.now(), Date.now())
    .first<Binding>();
  if (!binding)
    throw new CaseAccessError(
      401,
      'case_session_expired',
      'Vérifiez à nouveau votre dossier pour utiliser l’assistant.',
    );
  const read = async (requestedId = binding.case_id): Promise<CaseFacts> => {
    if (requestedId !== binding.case_id)
      throw new CaseAccessError(
        403,
        'case_access_denied',
        'Ce dossier nécessite une vérification distincte.',
      );
    if (binding.expires_at <= Date.now())
      throw new CaseAccessError(401, 'case_session_expired', 'Votre accès au dossier a expiré.');
    let result: unknown;
    try {
      result = await supabaseRequest(env, '/rest/v1/rpc/customer_case_snapshot', {
        mode: { kind: 'privileged' },
        method: 'POST',
        body: { p_access_token: token },
        timeoutMs: 5000,
      });
    } catch (error) {
      if (
        error instanceof SupabaseRequestError &&
        (error.code === 'invalid_case_session' || error.code === 'P0001')
      )
        throw new CaseAccessError(401, 'case_session_expired', 'Votre accès au dossier a expiré.');
      throw error;
    }
    const parsed = schema
      .object({ expires_at: schema.string(), case: caseSchema })
      .strict()
      .safeParse(result);
    if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.expires_at)))
      throw new CaseAccessError(
        502,
        'invalid_case_response',
        'Les données du dossier ne peuvent pas être confirmées.',
      );
    if (Date.parse(parsed.data.expires_at) <= Date.now())
      throw new CaseAccessError(401, 'case_session_expired', 'Votre accès au dossier a expiré.');
    if (parsed.data.case.id !== binding.case_id)
      throw new CaseAccessError(
        403,
        'case_access_denied',
        'Ce dossier nécessite une vérification distincte.',
      );
    return normalizeCase(parsed.data.case, organizationId);
  };
  return {
    spaceId: binding.space_id,
    expiresAt: binding.expires_at,
    csrf: binding.csrf,
    caseId: binding.case_id,
    organizationId,
    read,
  };
}
