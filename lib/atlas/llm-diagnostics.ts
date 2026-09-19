export type ProviderFailureReason =
  | 'network_or_timeout'
  | 'upstream_auth'
  | 'upstream_rate_limited'
  | 'upstream_request_rejected'
  | 'upstream_unavailable'
  | 'upstream_rejected'
  | 'invalid_upstream_response'
  | 'missing_verifiable_sources'
  | 'invalid_tool_arguments'
  | 'tool_loop'
  | 'unknown';

export type ProviderFailureStage =
  | 'configuration'
  | 'network'
  | 'http'
  | 'response_parse'
  | 'response_validation'
  | 'grounding'
  | 'tool_validation'
  | 'tool_loop';

export type ProviderErrorDetails = {
  stage?: ProviderFailureStage;
  upstreamStatus?: number | null;
  upstreamCode?: string | null;
  upstreamRequestId?: string | null;
  providerCalls?: number;
  providerLatencyMs?: number;
};

export function sanitizeDiagnosticToken(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[^a-zA-Z0-9._:/-]/g, '_').slice(0, max);
  return normalized || null;
}

export function providerRequestId(headers: Headers): string | null {
  for (const name of ['x-request-id', 'request-id', 'x-goog-request-id', 'cf-ray']) {
    const value = sanitizeDiagnosticToken(headers.get(name), 160);
    if (value) return value;
  }
  return null;
}

export function providerFailureReason(
  message: string,
  details: ProviderErrorDetails = {},
): ProviderFailureReason {
  const status = details.upstreamStatus;
  if (status === 401 || status === 403) return 'upstream_auth';
  if (status === 429) return 'upstream_rate_limited';
  if (status === 400 || status === 422) return 'upstream_request_rejected';
  if (typeof status === 'number' && status >= 500) return 'upstream_unavailable';

  if (details.stage === 'network') return 'network_or_timeout';
  if (details.stage === 'response_parse' || details.stage === 'response_validation')
    return 'invalid_upstream_response';
  if (details.stage === 'grounding') return 'missing_verifiable_sources';
  if (details.stage === 'tool_validation') return 'invalid_tool_arguments';
  if (details.stage === 'tool_loop') return 'tool_loop';
  if (details.stage === 'http') return 'upstream_rejected';

  const text = message.toLowerCase();
  if (text.includes('fournisseur ia est temporairement indisponible'))
    return 'upstream_unavailable';
  if (text.includes('temporairement indisponible') || text.includes('ne répond pas'))
    return 'network_or_timeout';
  if (text.includes('refusé l’authentification')) return 'upstream_auth';
  if (text.includes('atteint sa limite')) return 'upstream_rate_limited';
  if (text.includes('rejeté le format')) return 'upstream_request_rejected';
  if (text.includes('refusé la requête') || text.includes('redirection'))
    return 'upstream_rejected';
  if (text.includes('réponse invalide') || text.includes('pas fourni de réponse'))
    return 'invalid_upstream_response';
  if (text.includes('sources vérifiables')) return 'missing_verifiable_sources';
  if (text.includes('arguments d’outil') || text.includes('identifiant d’outil'))
    return 'invalid_tool_arguments';
  if (text.includes('finalisée')) return 'tool_loop';
  return 'unknown';
}
