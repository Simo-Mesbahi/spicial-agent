import { z } from 'zod';
import type { AtlasEnv, Database } from './api';
import { geminiModels, modelSettings, publicModelConfig } from './model-policy';

export type RuntimeEnv = AtlasEnv & { APP_ENVIRONMENT?: string; SUPABASE_ORGANIZATION_ID?: string };
export function environmentLabel(env: { APP_ENVIRONMENT?: string }, url: string) {
  if (['LOCAL', 'PREPRODUCTION', 'PRODUCTION'].includes(env.APP_ENVIRONMENT ?? '')) return env.APP_ENVIRONMENT!;
  return ['localhost', '127.0.0.1', '[::1]', 'terminal.local'].includes(new URL(url).hostname) ? 'LOCAL' : 'NON CONFIGURÉ';
}
export const runtimeConfigSchema = z.object({
  provider: z.enum(['demo', 'gemini', 'ollama', 'openai', 'compatible']),
  model: z.string().max(100),
  dailyLimit: z.number().int().min(0).max(10000),
  ragResults: z.number().int().min(1).max(3),
  ragMinAnchors: z.number().int().min(1).max(3),
}).strict();
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type Revision = { revision: number; config: string; actor: string; created_at: number };
export function scopeKey(env: RuntimeEnv, url: string) {
  if (!env.SUPABASE_ORGANIZATION_ID) throw new Error('Organisation serveur non configurée.');
  return `${environmentLabel(env, url)}:${env.SUPABASE_ORGANIZATION_ID}`;
}
export function defaults(env: RuntimeEnv): RuntimeConfig {
  return { provider: runtimeConfigSchema.shape.provider.parse(env.LLM_PROVIDER ?? 'demo'), model: env.LLM_MODEL ?? '',
    dailyLimit: Math.max(0, Math.min(10000, Math.floor(Number.isFinite(Number(env.LLM_DAILY_LIMIT ?? 100)) ? Number(env.LLM_DAILY_LIMIT ?? 100) : 100))), ragResults: 3, ragMinAnchors: 1 };
}
export function applyConfig(env: RuntimeEnv, config: RuntimeConfig): RuntimeEnv {
  return { ...env, LLM_PROVIDER: config.provider, LLM_MODEL: config.model || undefined,
    LLM_DAILY_LIMIT: String(config.dailyLimit), RAG_RESULTS: config.ragResults, RAG_MIN_ANCHORS: config.ragMinAnchors };
}
export function validateConfig(env: RuntimeEnv, config: RuntimeConfig) {
  // Admin controls cannot change the spending policy, secrets or outbound URL.
  if (!['demo', 'gemini', env.LLM_PROVIDER ?? 'demo'].includes(config.provider)) throw new Error('Ce fournisseur doit être autorisé par le développeur côté serveur.');
  modelSettings(applyConfig(env, config));
}
export async function readSettings(db: Database, scope: string) {
  return db.prepare('SELECT revision,config,actor,created_at FROM runtime_settings WHERE scope=? ORDER BY revision DESC LIMIT 1').bind(scope).first<Revision>();
}
export async function saveSettings(db: Database, scope: string, previous: number, config: RuntimeConfig, actor: string) {
  const result = await db.prepare(`INSERT INTO runtime_settings (id,scope,revision,config,actor,created_at)
    SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM runtime_settings WHERE scope=?),0)=?`)
    .bind(crypto.randomUUID(), scope, previous + 1, JSON.stringify(config), actor, Date.now(), scope, previous).run();
  return result.meta.changes === 1;
}
export async function effectiveEnvironment(env: RuntimeEnv, url: string): Promise<RuntimeEnv> {
  if (!env.SUPABASE_ORGANIZATION_ID) return env;
  const saved = await readSettings(env.DB, scopeKey(env, url));
  if (!saved) return env;
  const config = runtimeConfigSchema.parse(JSON.parse(saved.config));
  // Deployment may have revoked a provider since this revision was saved.
  try { validateConfig(env, config); return applyConfig(env, config); }
  catch { return applyConfig(env, { ...config, provider: 'demo', model: '' }); }
}
export function availableProviders(env: RuntimeEnv) {
  const candidates = [{ provider: 'demo', model: '', label: 'Réponses documentaires' },
    ...geminiModels.map(model => ({ provider: 'gemini', model, label: `Gemini · ${model}` })),
    ...(!['demo', 'gemini'].includes(env.LLM_PROVIDER ?? 'demo') ? [{ provider: env.LLM_PROVIDER!, model: env.LLM_MODEL ?? '', label: `${env.LLM_PROVIDER} · configuration serveur` }] : [])];
  return candidates.map(item => { const state = publicModelConfig({ ...env, LLM_PROVIDER: item.provider, LLM_MODEL: item.model || undefined });
    return { ...item, available: state.ready, reason: state.blockedReason }; });
}
