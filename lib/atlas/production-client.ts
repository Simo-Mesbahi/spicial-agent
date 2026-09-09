import { boundedJson } from './bounded-json';

export class ProductionRequestError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = 'network_error',
  ) {
    super(message);
  }
}

/** No automatic replay of writes. The deadline covers both headers and body. */
export async function productionRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  init.signal?.addEventListener('abort', cancel, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`/api/production${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const data = await boundedJson(response, 1024 * 1024, controller.signal);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new ProductionRequestError('Réponse du service invalide.', 502, 'invalid_response');
    const body = data as Record<string, unknown>;
    if (!response.ok)
      throw new ProductionRequestError(
        typeof body.error === 'string' ? body.error : 'Le service est temporairement indisponible.',
        response.status,
        typeof body.code === 'string' ? body.code : 'request_failed',
      );
    return data as T;
  } catch (error) {
    if (error instanceof ProductionRequestError) throw error;
    throw new ProductionRequestError(
      controller.signal.aborted
        ? 'Le délai de réponse est dépassé. Vérifiez la situation avant de réessayer.'
        : 'Connexion interrompue. Vérifiez votre réseau puis réessayez.',
      0,
      controller.signal.aborted ? 'timeout' : 'network_error',
    );
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancel);
  }
}

export const statusLabels: Record<string, string> = {
  opened: 'Demande ouverte',
  deposited: 'Produit déposé',
  received: 'Reçu au SAV',
  diagnosis: 'Diagnostic',
  waiting_part: 'Pièce attendue',
  quote_pending: 'Devis à confirmer',
  repairing: 'En réparation',
  repaired: 'Réparé',
  exchanged: 'Échangé',
  shipping: 'Expédition',
  transit: 'En transit',
  ready: 'Disponible au retrait',
  delivered: 'Livré',
  refund_pending: 'Remboursement en cours',
  refunded: 'Remboursé',
  complaint_review: 'Réclamation en analyse',
  resolved: 'Résolu',
  cancelled: 'Annulé',
  delayed: 'Retard signalé',
};
export const kindLabels: Record<string, string> = {
  repair: 'Réparation',
  exchange: 'Échange',
  refund: 'Remboursement',
  complaint: 'Réclamation',
  delivery: 'Livraison',
  account: 'Compte',
  other: 'Autre demande',
};
export function formatDate(value?: string | null, withTime = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Non renseignée';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
  }).format(new Date(value));
}
export function isClosed(status: string) {
  return ['resolved', 'cancelled', 'delivered', 'refunded'].includes(status);
}
