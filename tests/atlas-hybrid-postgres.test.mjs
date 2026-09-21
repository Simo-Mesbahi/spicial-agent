import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgePostgres } from './helpers/knowledge-postgres.mjs';
const org = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002';
const doc = '00000000-0000-4000-8000-000000000101',
  chunk = '00000000-0000-4000-8000-000000000201',
  space = 'a'.repeat(64);
const vector = [1, ...Array(767).fill(0)];
test('PostgreSQL: hybrid RPCs enforce source validity, permissions and atomic embedding writes', async (t) => {
  const db = await knowledgePostgres();
  t.after(() => db.close());
  await db.query('insert into organizations(id) values($1),($2)', [org, other]);
  await db.query(
    `insert into knowledge_documents(id,organization_id,title,category,version,content,checksum,status,series_id) values($1,$2,'Retour produit','retour','1','Procédure de retour autorisée','doc-checksum','published',$1)`,
    [doc, org],
  );
  await db.query(
    'insert into knowledge_chunks(id,organization_id,document_id,ordinal,content) values($1,$2,$3,0,$4)',
    [chunk, org, doc, 'Procédure de retour autorisée'],
  );
  const rpc = async (sql) => (await db.query(sql)).rows[0];
  const search = async (tenant = org, v = vector) =>
    (
      await db.query(
        'select knowledge_hybrid_candidates($1,$2,$3,$4,$5,$6::extensions.vector,$7) data',
        [tenant, 'retour produit', 'fr-FR', 'FR', space, v ? JSON.stringify(v) : null, 0.7],
      )
    ).rows[0].data;
  await db.exec('set role service_role');
  assert.equal((await search()).filter((x) => x.channel === 'lexical').length, 1);
  assert.equal((await search()).filter((x) => x.channel === 'vector').length, 0);
  const batch = (await db.query('select knowledge_embedding_batch($1,$2,32) data', [org, space]))
    .rows[0].data;
  assert.equal(batch.length, 1);
  const write = async (rows) =>
    db.query('select knowledge_store_embeddings($1,$2,$3::jsonb) n', [
      org,
      space,
      JSON.stringify(rows),
    ]);
  await write([{ chunk_id: chunk, checksum: batch[0].checksum, embedding: vector }]);
  assert.equal((await search()).filter((x) => x.channel === 'vector').length, 1);
  assert.equal((await search(other)).length, 0);
  assert.equal((await search(org, null)).filter((x) => x.channel === 'vector').length, 0);
  assert.equal(
    (await db.query('select knowledge_embedding_batch($1,$2,32) data', [org, space])).rows[0].data
      .length,
    0,
  );
  await assert.rejects(
    write([
      { chunk_id: chunk, checksum: batch[0].checksum, embedding: [0, 1, ...Array(766).fill(0)] },
      { chunk_id: chunk, checksum: 'bad', embedding: vector },
    ]),
    /embedding_source_changed/,
  );
  await assert.rejects(
    write([{ chunk_id: chunk, checksum: batch[0].checksum, embedding: Array(768).fill(0) }]),
    /invalid_embedding/,
  );
  await assert.rejects(search(org, [1, 0]), /invalid_knowledge_query/);
  assert.equal(
    (await search()).filter((x) => x.channel === 'vector').length,
    1,
    'failed batch rolled back the changed first vector',
  );
  for (const role of ['anon', 'authenticated']) {
    await db.exec('reset role; set role ' + role);
    await assert.rejects(search(), /permission denied/);
    await assert.rejects(
      rpc(`select knowledge_embedding_batch('${org}','${space}',32)`),
      /permission denied/,
    );
    await assert.rejects(
      write([{ chunk_id: chunk, checksum: batch[0].checksum, embedding: vector }]),
      /permission denied/,
    );
  }
  await db.exec('reset role');
  for (const update of [
    "status='draft'",
    "status='review'",
    "status='archived'",
    'effective_from=current_date+1',
    'effective_until=current_date-1',
    "locale='de-DE'",
    "market='DE'",
  ]) {
    await db.exec('begin');
    await db.query(`update knowledge_documents set ${update} where id=$1`, [doc]);
    await db.exec('set local role service_role');
    assert.equal((await search()).length, 0, update);
    await db.exec('rollback');
  }
  await db.exec('begin');
  await db.query(
    `insert into knowledge_documents(id,organization_id,title,category,version,content,checksum,status,series_id,revision) values(gen_random_uuid(),$1,'Retour V2','retour','2','Procédure remplacée','v2','published',$2,2)`,
    [org, doc],
  );
  await db.exec('set local role service_role');
  assert.equal((await search()).length, 0);
  await db.exec('rollback');
  await db.query(`update knowledge_chunks set embedding_space=$1 where id=$2`, [
    'b'.repeat(64),
    chunk,
  ]);
  assert.equal((await search()).filter((x) => x.channel === 'vector').length, 0);
  await db.query('update knowledge_chunks set embedding_space=$1 where id=$2', [space, chunk]);
  await db.query(
    `insert into knowledge_chunks(id,organization_id,document_id,ordinal,content) values(gen_random_uuid(),$1,$2,1,'Second paragraphe')`,
    [org, doc],
  );
  assert.equal(
    (await search()).filter((x) => x.channel === 'vector').length,
    0,
    'partially indexed document',
  );
  await db.query('delete from knowledge_chunks where document_id=$1 and ordinal=1', [doc]);
  await db.query(`update knowledge_chunks set content='Procédure de retour modifiée' where id=$1`, [
    chunk,
  ]);
  const stale = (
    await db.query(
      'select embedding,embedding_space,embedding_checksum from knowledge_chunks where id=$1',
      [chunk],
    )
  ).rows[0];
  assert.deepEqual(stale, { embedding: null, embedding_space: null, embedding_checksum: null });
  assert.equal((await search()).filter((x) => x.channel === 'vector').length, 0);
});
