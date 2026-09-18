import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
async function moduleFrom(path) { const output = await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',write:false}); return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64')); }
const {handleAdminOperationsApi} = await moduleFrom('lib/atlas/admin-operations-api.ts');
const {effectiveEnvironment, environmentLabel, defaults, availableProviders} = await moduleFrom('lib/atlas/runtime-settings.ts');
const {demoAnswer} = await moduleFrom('lib/atlas/api.ts');
const org='00000000-0000-4000-8000-000000000001';
function database() {
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

function setup(t, role='super_admin', aal='aal2') {
 const DB=database(); t.after(()=>DB.sql.close());
 const previous=globalThis.fetch; t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async()=>Response.json({user_id:'00000000-0000-4000-8000-000000000900',email:'admin@example.test',aal,memberships:[{organization_id:org,organization_name:'Test',role,display_name:null}]});
 return {DB,APP_ENVIRONMENT:'LOCAL',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SECRET_KEY:'secret-never-expose',SUPABASE_ORGANIZATION_ID:org,LLM_PROVIDER:'demo',LLM_BUDGET_MODE:'zero'};
}
function call(env, body, suffix='settings', headers={}) {
 return handleAdminOperationsApi(new Request(`https://atlas.test/api/production/admin/operations/${suffix}?organizationId=${org}`,{method:body?'POST':'GET',headers:{cookie:'savsc_admin_access=test-token','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
}
const config={provider:'demo',model:'',dailyLimit:0,ragResults:1,ragMinAnchors:2};
const payload={revision:0,config,confirmEnvironment:'LOCAL'};
test('settings persist atomically with author, revision and conflict detection',async t=>{
 const env=setup(t); assert.equal((await call(env,payload)).status,200);
 const saved=await (await call(env)).json();assert.deepEqual(saved.config,config);assert.equal(saved.revision,1);assert.equal(saved.history.length,1);assert.equal(saved.history[0].actor,'00000000-0000-4000-8000-000000000900');
 assert.equal((await call(env,payload)).status,409);assert.equal((await (await call(env)).json()).history.length,1);
 const effective=await effectiveEnvironment(env,'https://atlas.test');assert.equal(effective.LLM_DAILY_LIMIT,'0');assert.equal(effective.RAG_MIN_ANCHORS,2);
 assert.equal(demoAnswer('garantie',null,[],effective).sources.length,0);
 assert.equal(demoAnswer('garantie',null).sources.length,1);
});
test('settings cannot enable paid providers or change secrets and spending policy',async t=>{
 const env=setup(t);
 for(const c of [{...config,provider:'openai',model:'anything'},{...config,provider:'gemini',model:'gemini-2.5-flash'},{...config,GEMINI_API_KEY:'injected'},{...config,LLM_BUDGET_MODE:'approved'}]) assert.equal((await call(env,{...payload,config:c})).status,400);
 const text=await (await call(env)).text();assert.ok(!text.includes('secret-never-expose'));assert.ok(!text.includes('public-test'));
});
test('analyst can inspect but cannot change settings or run previews',async t=>{
 const env=setup(t,'analyst');assert.equal((await call(env)).status,200);assert.equal((await call(env,payload)).status,403);assert.equal((await call(env,{query:'garantie',ragResults:1,ragMinAnchors:1},'settings/preview')).status,403);
});
test('settings enforce MFA and deployment organization',async t=>{
 const env=setup(t,'super_admin','aal1');assert.equal((await call(env)).status,403);
});
test('settings reject a different deployment organization and cross-origin writes',async t=>{
 const env=setup(t);assert.equal((await call({...env,SUPABASE_ORGANIZATION_ID:'00000000-0000-4000-8000-000000000002'})).status,403);
 assert.equal((await call(env,payload,'settings',{origin:'https://evil.test'})).status,403);
});
test('environment must be confirmed and revisions are isolated by environment',async t=>{
 const env=setup(t);assert.equal((await call(env,{...payload,confirmEnvironment:'PRODUCTION'})).status,400);
 assert.equal((await call({...env,APP_ENVIRONMENT:undefined},payload)).status,400);
 assert.equal((await call(env,payload)).status,200);
 assert.equal((await (await call({...env,APP_ENVIRONMENT:'PRODUCTION'})).json()).revision,0);
 assert.equal(environmentLabel({},'https://unfamiliar.test'),'NON CONFIGURÉ');assert.equal(environmentLabel({},'http://localhost:5173'),'LOCAL');
});
test('RAG preview uses draft settings without saving or calling the model',async t=>{
 const env=setup(t);const result=await (await call(env,{query:'garantie',ragResults:1,ragMinAnchors:1},'settings/preview')).json();assert.equal(result.documents.length,1);
 assert.equal((await (await call(env)).json()).revision,0);assert.equal((await call(env,{query:'garantie',ragResults:99,ragMinAnchors:0},'settings/preview')).status,400);
});
test('zero server quota is preserved and revoked providers fall back safely',async t=>{
 const env={...setup(t),LLM_DAILY_LIMIT:'0',LLM_BUDGET_MODE:'free',GEMINI_API_KEY:'private-test-key'};assert.equal(defaults(env).dailyLimit,0);
 assert.equal((await call(env,{...payload,config:{...config,provider:'gemini',model:'gemini-2.5-flash'}})).status,200);
 assert.equal((await effectiveEnvironment({...env,LLM_BUDGET_MODE:'zero'},'https://atlas.test')).LLM_PROVIDER,'demo');
});

test('approved deployment exposes multiple configured providers without exposing secrets',async t=>{
 const env={...setup(t),LLM_PROVIDER:'gemini',LLM_ENABLED_PROVIDERS:'gemini,openai',LLM_BUDGET_MODE:'approved',GEMINI_MODEL:'gemini-2.5-flash-lite',GEMINI_API_KEY:'gemini-private',OPENAI_MODEL:'approved-openai-model',OPENAI_API_KEY:'openai-private'};
 assert.equal(defaults(env).model,'gemini-2.5-flash-lite');
 const providers=availableProviders(env);
 assert.ok(providers.some(item=>item.provider==='gemini'&&item.model==='gemini-2.5-flash-lite'&&item.available));
 assert.ok(providers.some(item=>item.provider==='openai'&&item.model==='approved-openai-model'&&item.available));
 assert.ok(!JSON.stringify(providers).includes('gemini-private'));
 assert.ok(!JSON.stringify(providers).includes('openai-private'));
 const response=await call(env,{...payload,config:{...config,provider:'openai',model:'approved-openai-model'}});
 assert.equal(response.status,200);
});
