/** Provider configuration is server-owned. No request may change secrets or spending policy. */
export type ModelEnvironment = {
  LLM_PROVIDER?: string;
  LLM_ENABLED_PROVIDERS?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_BUDGET_MODE?: string;

  GEMINI_MODEL?: string;
  GEMINI_API_KEY?: string;

  OPENAI_MODEL?: string;
  OPENAI_REASONING_EFFORT?: string;
  OPENAI_API_KEY?: string;

  OLLAMA_MODEL?: string;
  OLLAMA_BASE_URL?: string;

  COMPATIBLE_MODEL?: string;
  COMPATIBLE_BASE_URL?: string;
  COMPATIBLE_API_KEY?: string;
};

export const localModel = 'qwen3:4b';
export const geminiModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;
export const providerIds = ['demo', 'gemini', 'ollama', 'openai', 'compatible'] as const;
export type ProviderId = (typeof providerIds)[number];

const geminiBase = 'https://generativelanguage.googleapis.com/v1beta/openai';

function isProviderId(value: string): value is ProviderId {
  return (providerIds as readonly string[]).includes(value);
}

export function enabledProviders(env: ModelEnvironment): ProviderId[] {
  const raw = env.LLM_ENABLED_PROVIDERS?.trim();
  const requested = raw
    ? raw
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    : ['gemini', env.LLM_PROVIDER ?? 'demo'];

  const result: ProviderId[] = ['demo'];
  for (const provider of requested) {
    if (!isProviderId(provider))
      throw new Error(`Fournisseur IA inconnu dans LLM_ENABLED_PROVIDERS : ${provider}.`);
    if (!result.includes(provider)) result.push(provider);
  }
  return result;
}

export function configuredModel(env: ModelEnvironment, provider: ProviderId): string {
  const activeOverride = env.LLM_PROVIDER === provider ? env.LLM_MODEL?.trim() : '';
  if (activeOverride) return activeOverride;
  if (provider === 'gemini') return env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  if (provider === 'openai') return env.OPENAI_MODEL?.trim() || '';
  if (provider === 'ollama') return env.OLLAMA_MODEL?.trim() || localModel;
  if (provider === 'compatible') return env.COMPATIBLE_MODEL?.trim() || '';
  return '';
}

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
  if (!isProviderId(provider)) throw new Error('Le fournisseur de modèle n’est pas configuré.');
  if (!['zero', 'free', 'approved'].includes(budgetMode))
    throw new Error('Politique de budget IA invalide.');

  if (provider === 'demo')
    return { provider, budgetMode, model: null, base: null, key: null, timeoutMs: 20000 };

  if (provider === 'ollama')
    return {
      provider,
      budgetMode,
      model: localModelName(configuredModel(env, 'ollama')),
      base: localBase(env.OLLAMA_BASE_URL || env.LLM_BASE_URL || undefined),
      key: null,
      timeoutMs: 40000,
    };

  if (provider === 'gemini') {
    if (!['free', 'approved'].includes(budgetMode))
      throw new Error(
        'Gemini nécessite le mode free ou approved explicitement activé côté serveur.',
      );
    const model = configuredModel(env, 'gemini');
    if (!(geminiModels as readonly string[]).includes(model))
      throw new Error(
        'Ce modèle Gemini n’est pas autorisé dans SAV SC Assistant AI.',
      );
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
      'Budget IA 0 / mode non approuvé : les fournisseurs externes payants nécessitent LLM_BUDGET_MODE=approved.',
    );

  if (provider === 'openai') {
    const effort = env.OPENAI_REASONING_EFFORT?.trim();
    if (effort && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort))
      throw new Error('Effort de raisonnement OpenAI invalide.');
    const model = configuredModel(env, 'openai');
    if (!model) throw new Error('Modèle OpenAI manquant.');
    if (!env.OPENAI_API_KEY) throw new Error('Clé OpenAI manquante.');
    return {
      provider,
      budgetMode,
      model,
      base: 'https://api.openai.com/v1',
      key: env.OPENAI_API_KEY,
      timeoutMs: 20000,
    };
  }

  const model = configuredModel(env, 'compatible');
  if (!model) throw new Error('Modèle compatible manquant.');
  const base = env.COMPATIBLE_BASE_URL || env.LLM_BASE_URL;
  if (!base) throw new Error('Adresse du fournisseur compatible manquante.');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Le fournisseur externe doit utiliser HTTPS, sans identifiant dans l’adresse.');
  const key = env.COMPATIBLE_API_KEY || env.LLM_API_KEY;
  if (!key) throw new Error('Clé du fournisseur compatible manquante.');
  return {
    provider,
    budgetMode,
    model,
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
