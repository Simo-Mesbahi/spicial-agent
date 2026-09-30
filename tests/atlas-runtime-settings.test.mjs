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
const config={provider:'demo',model:'',dailyLimit:0,ragResults:1,ragMinAnchors:2,autoFailover:false,fallbackProvider:null};
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
 const env=setup(t); const identity=globalThis.fetch; const requests=[];
 globalThis.fetch=async (url,init)=>{
  if(String(url).endsWith('/knowledge_search')) { requests.push(JSON.parse(init.body)); return Response.json([publishedRow()]); }
  return identity(url,init);
 };
 const result=await (await call(env,{query:'garantie',ragResults:1,ragMinAnchors:1},'settings/preview')).json();assert.equal(result.documents.length,1);
 assert.equal(result.documents[0].title,'Procédure publiée test');assert.equal(result.diagnostics.scope,'supabase_published');assert.equal(result.diagnostics.embeddingCalls,0);
 assert.equal(requests[0].p_limit,1);assert.equal(requests[0].p_organization_id,org);
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

function multiProviderEnv(t) {
 return {...setup(t),LLM_ENABLED_PROVIDERS:'gemini,groq,openai',LLM_BUDGET_MODE:'free',
   GEMINI_API_KEY:'PRIVATE-gemini',GROQ_API_KEY:'PRIVATE-groq',OPENAI_API_KEY:'PRIVATE-openai',OPENAI_MODEL:'approved-model'};
}
const failoverConfig={...config,provider:'gemini',model:'gemini-3.1-flash-lite',autoFailover:true,fallbackProvider:'groq'};
test('admin can persist Gemini/Groq failover and suspend it without modifying server policy',async t=>{
 const env=multiProviderEnv(t);
 assert.equal((await call(env,{...payload,config:failoverConfig})).status,200);
 const state=await (await call(env)).json();
 assert.equal(state.effectiveAutoFailover,true);
 assert.ok(state.fallbackProviders.some(p=>p.provider==='groq'&&p.available));
 assert.ok(state.fallbackProviders.some(p=>p.provider==='openai'&&!p.available));
 assert.doesNotMatch(JSON.stringify(state),/PRIVATE-/);
 const effective=await effectiveEnvironment(env,'https://atlas.test');
 assert.equal(effective.LLM_AUTO_FAILOVER,'true');
 assert.equal(effective.LLM_FALLBACK_PROVIDER,'groq');
 assert.equal(effective.LLM_BUDGET_MODE,'free');
 assert.equal((await call(env,{...payload,revision:1,config:{...failoverConfig,autoFailover:false}})).status,200);
 assert.equal((await effectiveEnvironment(env,'https://atlas.test')).LLM_AUTO_FAILOVER,'false');
});
test('admin rejects self-fallback, absent secondary, paid bypass, arbitrary models and P1 routing changes',async t=>{
 const env=multiProviderEnv(t);
 for(const candidate of [
  {...failoverConfig,fallbackProvider:'gemini'}, {...failoverConfig,fallbackProvider:null},
  {...failoverConfig,fallbackProvider:'openai'}, {...failoverConfig,provider:'demo',model:''},
  {...failoverConfig,provider:'groq',model:'not-approved',fallbackProvider:'gemini'},
  {...failoverConfig,GROQ_API_KEY:'injected'},
 ]) assert.equal((await call(env,{...payload,config:candidate})).status,400);
 assert.equal((await call({...env,P1_RELEASE_MODE:'on'},{...payload,config:failoverConfig})).status,400);
 assert.equal((await call({...env,LLM_BUDGET_MODE:'approved'},
  {...payload,config:{...config,provider:'openai',model:'arbitrary-expensive-model'}})).status,400);
});
test('a revoked secondary disables only the failover and reports its reason',async t=>{
 const env=multiProviderEnv(t);
 assert.equal((await call(env,{...payload,config:failoverConfig})).status,200);
 const revoked={...env,GROQ_API_KEY:undefined};
 const effective=await effectiveEnvironment(revoked,'https://atlas.test');
 assert.equal(effective.LLM_PROVIDER,'gemini');
 assert.equal(effective.LLM_AUTO_FAILOVER,'false');
 const state=await (await call(revoked)).json();
 assert.equal(state.effectiveProvider,'gemini');
 assert.equal(state.effectiveAutoFailover,false);
 assert.match(state.failoverWarning,/Groq/);
 assert.equal(state.providerWarning,null);
});
test('historical settings without routing fields load with failover disabled',async t=>{
 const env=setup(t);
 const oldConfig={...config}; delete oldConfig.autoFailover; delete oldConfig.fallbackProvider;
 env.DB.sql.prepare('INSERT INTO runtime_settings (id,scope,revision,config,actor,created_at) VALUES (?,?,?,?,?,?)')
   .run('legacy',`LOCAL:${org}`,1,JSON.stringify(oldConfig),'legacy-admin',Date.now());
 const state=await (await call(env)).json();
 assert.equal(state.config.autoFailover,false);
 assert.equal(state.history[0].config.autoFailover,false);
 assert.equal(state.config.fallbackProvider,null);
});
test('empty optional server fallback loads as disabled',async t=>{
 const env={...setup(t),LLM_AUTO_FAILOVER:'false',LLM_FALLBACK_PROVIDER:''};
 assert.equal((await call(env)).status,200);
 assert.equal(defaults(env).fallbackProvider,null);
});

function publishedRow(changes={}) {
 return {document_id:'00000000-0000-4000-8000-000000000101',chunk_id:'00000000-0000-4000-8000-000000000201',title:'Procédure publiée test',category:'SAV',version:'2',locale:'fr-FR',market:'GLOBAL',effective_from:null,effective_until:null,chunk_ordinal:0,content:'Vérifiez les éléments de garantie du dossier.',rank:4,...changes};
}
const previewInput={query:'garantie produit',ragResults:2,ragMinAnchors:2};

test('RAG settings identify the actual source and never expose provider credentials',async t=>{
 const env=setup(t);
 const lexical=await (await call(env)).json();
 assert.deepEqual(lexical.rag,{mode:'lexical',minAnchorsApplies:false,previewMayUseEmbedding:false,locale:'fr-FR',market:null});
 const hybrid=await (await call({...env,RAG_MODE:'hybrid',RAG_CORPUS_LOCALE:'de-DE',RAG_MARKET:'DE',EMBEDDING_API_KEY:'PRIVATE-EMBEDDING'})).json();
 assert.equal(hybrid.rag.mode,'hybrid');assert.equal(hybrid.rag.previewMayUseEmbedding,true);assert.equal(hybrid.rag.locale,'de-DE');
 assert.doesNotMatch(JSON.stringify(hybrid),/PRIVATE-EMBEDDING|secret-never-expose/);
 const {ragConfiguration}=await moduleFrom('lib/atlas/admin-rag-preview.ts');
 const demo=ragConfiguration({...env,SUPABASE_SECRET_KEY:''});assert.equal(demo.minAnchorsApplies,true);
});

test('published preview distinguishes an empty search from a backend failure without demo substitution',async t=>{
 const env=setup(t),identity=globalThis.fetch;let unavailable=false;
 globalThis.fetch=async(url,init)=>String(url).endsWith('/knowledge_search') ? unavailable ? Response.json({message:'unavailable'},{status:503}) : Response.json([]) : identity(url,init);
 const empty=await call(env,previewInput,'settings/preview');assert.equal(empty.status,200);const result=await empty.json();assert.deepEqual(result.documents,[]);assert.equal(result.diagnostics.outcome,'no_match');
 unavailable=true;
 const failed=await call(env,previewInput,'settings/preview');assert.equal(failed.status,503);assert.equal((await failed.json()).code,'rag_preview_unavailable');
});

test('hybrid preview requires explicit embedding acknowledgement before any retrieval or quota reservation',async t=>{
 const env={...setup(t),RAG_MODE:'hybrid'},identity=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).endsWith('/admin_me'));calls++;return identity(url,init);};
 const response=await call(env,previewInput,'settings/preview');assert.equal(response.status,409);assert.equal((await response.json()).code,'embedding_preview_confirmation_required');assert.equal(calls,1);
 assert.equal(env.DB.sql.prepare("select count(*) as n from rate_buckets where id='embedding-global'").get().n,0);
});

test('acknowledged hybrid preview uses one shared-budget embedding, current locale and published provenance',async t=>{
 const env={...setup(t),RAG_MODE:'hybrid',RAG_CORPUS_LOCALE:'de-DE',RAG_MARKET:'DE',LLM_BUDGET_MODE:'approved',EMBEDDING_PROVIDER:'openai',EMBEDDING_MODEL:'text-embedding-3-small',EMBEDDING_API_KEY:'synthetic-only',EMBEDDING_DAILY_LIMIT:'1'};
 const identity=globalThis.fetch;let embeddings=0, searches=0;
 const content='Prüfen Sie die Garantieunterlagen.';
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content))).toString('hex');
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/embeddings')) {embeddings++;return Response.json({data:[{index:0,embedding:[1,...Array(767).fill(0)]}],usage:{prompt_tokens:5}});}
  if(String(url).endsWith('/knowledge_hybrid_candidates')) {
   searches++;const body=JSON.parse(init.body);assert.equal(body.p_locale,'de-DE');assert.equal(body.p_market,'DE');assert.equal(body.p_organization_id,org);
   return Response.json([{...publishedRow({locale:'de-DE',market:'DE',content}),organization_id:org,series_id:'00000000-0000-4000-8000-000000000101',revision:2,status:'published',content_hash:hash,channel:'lexical'}]);
  }
  assert.ok(String(url).endsWith('/admin_me'),'no chat completion call is allowed');return identity(url,init);
 };
 const first=await call(env,{...previewInput,allowEmbedding:true},'settings/preview');assert.equal(first.status,200);const result=await first.json();
 assert.equal(embeddings,1);assert.equal(searches,1);assert.equal(result.diagnostics.embeddingCalls,1);assert.equal(result.documents[0].evidence.locale,'de-DE');assert.equal(result.documents[0].evidence.version,'2');
 const second=await (await call(env,{...previewInput,allowEmbedding:true},'settings/preview')).json();
 assert.equal(embeddings,1);assert.equal(second.diagnostics.embeddingCalls,0);assert.equal(second.diagnostics.fallbackReason,'budget_exhausted');
 assert.equal((await (await call(env)).json()).revision,0);
});

test('preview still refuses invalid fields, foreign configuration, missing MFA and cross-site writes',async t=>{
 const env=setup(t);
 for(const input of [{...previewInput,query:'a'.repeat(501)},{...previewInput,organizationId:'other'},{...previewInput,RAG_MODE:'demo'},{...previewInput,allowEmbedding:'true'}]) assert.equal((await call(env,input,'settings/preview')).status,400);
 assert.equal((await call(env,previewInput,'settings/preview',{origin:'https://evil.test','sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await call({...env,SUPABASE_ORGANIZATION_ID:'00000000-0000-4000-8000-000000000002'},previewInput,'settings/preview')).status,403);
});

test('preview cannot run without MFA',async t=>{
 const env=setup(t,'super_admin','aal1');
 assert.equal((await call(env,previewInput,'settings/preview')).status,403);
});
