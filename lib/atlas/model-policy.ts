/** Provider configuration is server-owned. No request may change the spending policy. */
export type ModelEnvironment = {
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  LLM_BUDGET_MODE?: string;
};

export const localModel = 'qwen3:4b';
export const geminiModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;
const geminiBase = 'https://generativelanguage.googleapis.com/v1beta/openai';

export function localBase(value = 'http://127.0.0.1:11434/v1') {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/v1\/?$/.test(url.pathname)
  )
    throw new Error(
      'Ollama doit utiliser une adresse locale HTTP, sans identifiant, terminée par /v1.',
    );
  return url.origin + '/v1';
}

export function localModelName(value = localModel) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(value) || /cloud|https?:|\.\./i.test(value))
    throw new Error('Choisissez un modèle Ollama local, sans variante cloud.');
  return value;
}

export function modelSettings(env: ModelEnvironment) {
  const provider = env.LLM_PROVIDER ?? 'demo';
  const budgetMode = env.LLM_BUDGET_MODE ?? 'zero';
  if (!['zero', 'free', 'approved'].includes(budgetMode))
    throw new Error('Politique de budget IA invalide.');
  if (provider === 'demo')
    return { provider, budgetMode, model: null, base: null, key: null, timeoutMs: 20000 };
  if (provider === 'ollama')
    return {
      provider,
      budgetMode,
      model: localModelName(env.LLM_MODEL || localModel),
      base: localBase(env.LLM_BASE_URL || undefined),
      key: null,
      timeoutMs: 40000,
    };
  if (provider === 'gemini') {
    if (budgetMode !== 'free')
      throw new Error('Gemini nécessite la politique gratuite explicitement activée côté serveur.');
    const model = env.LLM_MODEL ?? 'gemini-2.5-flash';
    if (!(geminiModels as readonly string[]).includes(model))
      throw new Error('Ce modèle Gemini n’est pas autorisé dans le mode gratuit AtlasCare.');
    if (!env.GEMINI_API_KEY) throw new Error('Clé Gemini manquante.');
    return {
      provider,
      budgetMode,
      model,
      base: geminiBase,
      key: env.GEMINI_API_KEY,
      timeoutMs: 20000,
    };
  }
  if (budgetMode !== 'approved')
    throw new Error(
      'Budget IA 0 € : les fournisseurs externes sont désactivés. Utilisez la démo ou Ollama en local.',
    );
  if (!['openai', 'compatible'].includes(provider) || !env.LLM_MODEL)
    throw new Error('Le fournisseur de modèle n’est pas configuré.');
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : env.LLM_BASE_URL;
  if (!base) throw new Error('Adresse du fournisseur manquante.');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Le fournisseur externe doit utiliser HTTPS, sans identifiant dans l’adresse.');
  const key = provider === 'openai' ? env.OPENAI_API_KEY : env.LLM_API_KEY;
  if (provider === 'openai' && !key) throw new Error('Clé du modèle manquante.');
  return {
    provider,
    budgetMode,
    model: env.LLM_MODEL,
    base: base.replace(/\/$/, ''),
    key,
    timeoutMs: 20000,
  };
}

export function publicModelConfig(env: ModelEnvironment) {
  try {
    const s = modelSettings(env);
    return {
      provider: s.provider,
      model: s.model,
      ready: true,
      budgetMode: s.budgetMode,
      externalCallsAllowed: s.budgetMode === 'approved' || s.provider === 'gemini',
      blockedReason: null,
    };
  } catch (e) {
    return {
      provider: env.LLM_PROVIDER ?? 'demo',
      model: null,
      ready: false,
      budgetMode: env.LLM_BUDGET_MODE ?? 'zero',
      externalCallsAllowed: false,
      blockedReason: e instanceof Error ? e.message : 'Configuration du modèle invalide.',
    };
  }
}
