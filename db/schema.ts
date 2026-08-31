import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  csrf: text('csrf').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  running: integer('running').notNull().default(0),
  tickAt: integer('tick_at').notNull(),
  tick: integer('tick').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  lockedUntil: integer('locked_until').notNull().default(0),
  chatCount: integer('chat_count').notNull().default(0),
  chatWindow: integer('chat_window').notNull(),
});
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  spaceId: text('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  city: text('city').notNull(),
});
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  spaceId: text('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category').notNull(),
  sku: text('sku').notNull(),
  price: integer('price').notNull(),
});
export const purchases = sqliteTable('purchases', {
  id: text('id').primaryKey(),
  spaceId: text('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  receipt: text('receipt').notNull(),
  purchasedAt: integer('purchased_at').notNull(),
  store: text('store').notNull(),
});
export const cases = sqliteTable(
  'cases',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id),
    reference: text('reference').notNull(),
    codeHash: text('code_hash').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull(),
    warranty: text('warranty').notNull(),
    quoteCents: integer('quote_cents'),
    refundCents: integer('refund_cents'),
    deliveryMode: text('delivery_mode').notNull(),
    estimate: text('estimate'),
    version: integer('version').notNull().default(0),
    lastEvent: text('last_event'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('case_space').on(t.spaceId),
    uniqueIndex('case_ref_space').on(t.spaceId, t.reference),
  ],
);
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    label: text('label').notNull(),
    actor: text('actor').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('events_case').on(t.caseId, t.createdAt)],
);
export const grants = sqliteTable('grants', {
  id: text('id').primaryKey(),
  spaceId: text('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    caseId: text('case_id'),
    role: text('role').notNull(),
    content: text('content').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('messages_space').on(t.spaceId, t.createdAt)],
);
export const handoffs = sqliteTable(
  'handoffs',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('handoff_case').on(t.spaceId, t.caseId)],
);
export const audits = sqliteTable('audits', {
  id: text('id').primaryKey(),
  spaceId: text('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
  createdAt: integer('created_at').notNull(),
});

// Atomic rolling quotas. No raw IP addresses are stored.
export const rateBuckets = sqliteTable('rate_buckets', {
  id: text('id').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
