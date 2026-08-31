import { boundedJson } from './bounded-json';

// getRandomValues also works in HTTP previews, unlike crypto.randomUUID.
export function newRequestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** The deadline includes the response body, not just the arrival of headers. */
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const value = await boundedJson(response, 2 * 1024 * 1024, controller.signal).catch(() => {
      if (controller.signal.aborted)
        throw new ApiRequestError(
          'Le service met trop de temps à répondre. Votre question peut déjà être enregistrée. Réessayez sans la modifier.',
        );
      throw new ApiRequestError(
        'Le service est momentanément indisponible. Réessayez dans un instant.',
        response.status,
      );
    });
    if (!response.ok) {
      const message =
        value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
          ? value.error
          : 'Une erreur est survenue. Réessayez dans un instant.';
      throw new ApiRequestError(message, response.status);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ApiRequestError('La réponse du service est invalide. Réessayez dans un instant.');
    return value as T;
  } catch (e) {
    if (e instanceof ApiRequestError) throw e;
    throw new ApiRequestError(
      controller.signal.aborted
        ? 'Le service met trop de temps à répondre. Réessayez dans un instant.'
        : 'La connexion au service a échoué. Vérifiez votre connexion et réessayez.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export function mergeMessages<T extends { id: string; created_at: number }>(
  existing: T[],
  received: T[],
): T[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of received) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at).slice(-100);
}
