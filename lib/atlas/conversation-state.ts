import { z } from 'zod';
import type { Database, Statement } from './api';
import { intents, languages, topics } from './conversation-contract';

const identifier = z.string().min(1).max(80).nullable();
export const conversationStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    activeCaseId: identifier,
    previousCaseId: identifier,
    language: z.enum(languages),
    preferredResponseLanguage: z.enum(languages).nullable(),
    currentTopic: z.enum(topics).nullable(),
    previousTopic: z.enum(topics).nullable(),
    topicHistory: z.array(z.enum(topics)).max(6),
    lastIntent: z.enum(intents).nullable(),
    previousIntent: z.enum(intents).nullable(),
    pendingClarification: z.boolean(),
    pendingCaseSwitch: z.boolean(),
    pendingHandoff: z.boolean(),
    referencedProduct: z.string().max(100).nullable(),
    businessGuidanceOffered: z.boolean(),
    businessGuidanceDeclined: z.boolean(),
    stylePreferences: z.object({ short: z.boolean(), emoji: z.boolean() }).strict(),
    // No case facts, tool results, customer identifiers, or generated business claims.
    recentTurns: z
      .array(
        z.object({ user: z.string().max(400), conversationalReply: z.string().max(600) }).strict(),
      )
      .max(6),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type ConversationState = z.infer<typeof conversationStateSchema>;
export const STATE_TTL_MS = 30 * 60 * 1000;
export const STATE_LEASE_MS = 60 * 1000;
export function emptyConversationState(now = Date.now()): ConversationState {
  return {
    schemaVersion: 1,
    activeCaseId: null,
    previousCaseId: null,
    language: 'fr',
    preferredResponseLanguage: null,
    currentTopic: null,
    previousTopic: null,
    topicHistory: [],
    lastIntent: null,
    previousIntent: null,
    pendingClarification: false,
    pendingCaseSwitch: false,
    pendingHandoff: false,
    referencedProduct: null,
    businessGuidanceOffered: false,
    businessGuidanceDeclined: false,
    stylePreferences: { short: false, emoji: true },
    recentTurns: [],
    updatedAt: now,
  };
}
export class ConversationBusy extends Error {}
export type ConversationLease = {
  spaceId: string;
  owner: string;
  version: number;
  state: ConversationState;
  sessionExpiresAt: number;
};

export async function acquireConversation(
  db: Database,
  spaceId: string,
  sessionExpiresAt: number,
): Promise<ConversationLease> {
  const now = Date.now(),
    owner = crypto.randomUUID();
  const claimed = await db
    .prepare(
      `INSERT INTO conversation_states
    (space_id,payload,version,expires_at,lock_id,lock_until) VALUES (?,?,0,?,?,?)
    ON CONFLICT(space_id) DO UPDATE SET lock_id=excluded.lock_id,lock_until=excluded.lock_until
    WHERE conversation_states.lock_until<=?`,
    )
    .bind(
      spaceId,
      JSON.stringify(emptyConversationState(now)),
      Math.min(sessionExpiresAt, now + STATE_TTL_MS),
      owner,
      now + STATE_LEASE_MS,
      now,
    )
    .run();
  if (!claimed.meta.changes) throw new ConversationBusy();
  const row = await db
    .prepare(
      'SELECT payload,version,expires_at FROM conversation_states WHERE space_id=? AND lock_id=?',
    )
    .bind(spaceId, owner)
    .first<{ payload: string; version: number; expires_at: number }>();
  if (!row) throw new ConversationBusy();
  let state = emptyConversationState(now);
  if (row.expires_at > now && row.payload.length <= 12000) {
    try {
      const parsed = conversationStateSchema.safeParse(JSON.parse(row.payload));
      if (parsed.success) state = parsed.data;
    } catch {
      /* Incompatible/corrupt state is discarded, never treated as authority. */
    }
  }
  return { spaceId, owner, version: row.version, state, sessionExpiresAt };
}

// Include this statement in the SAME D1 batch as messages and idempotent reply.
// A stale lease/version deliberately violates NOT NULL, rolling the whole batch back.
export function commitConversation(
  db: Database,
  lease: ConversationLease,
  state: ConversationState,
): Statement {
  const now = Date.now();
  const payload = JSON.stringify(conversationStateSchema.parse({ ...state, updatedAt: now }));
  if (payload.length > 12000) throw new Error('Conversation state exceeds bound');
  return db
    .prepare(
      `UPDATE conversation_states SET
    payload=CASE WHEN lock_id=? AND lock_until>? AND version=? AND ?>? THEN ? ELSE NULL END,
    version=version+1,expires_at=?,lock_id='',lock_until=0 WHERE space_id=?`,
    )
    .bind(
      lease.owner,
      now,
      lease.version,
      lease.sessionExpiresAt,
      now,
      payload,
      Math.min(lease.sessionExpiresAt, now + STATE_TTL_MS),
      lease.spaceId,
    );
}
export async function releaseConversation(db: Database, lease: ConversationLease) {
  await db
    .prepare(
      "UPDATE conversation_states SET lock_id='',lock_until=0 WHERE space_id=? AND lock_id=?",
    )
    .bind(lease.spaceId, lease.owner)
    .run();
}
