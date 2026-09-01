import { normalized, type CaseKind } from './domain';

export type SupportPath = 'assist_first' | 'human_required' | 'human_confirmed';

export type SupportDecision = {
  path: SupportPath;
  reason: string | null;
};

type CaseContext = {
  kind: CaseKind;
  status: string;
  quote_cents?: number | null;
};

type HistoryEntry = {
  role: string;
  content: string;
  metadata?: string | Record<string, unknown>;
};

const contactRequest =
  /(?:je\s+(?:veux|souhaite|voudrais|prefere)\s+(?:un\s+|une\s+|le\s+|la\s+)?(?:conseiller|humaine?|agent|contact))|(?:je\s+(?:veux|souhaite|voudrais|prefere)|puis[ -]?je|comment)\s+(?:etre\s+)?(?:mis(?:e)?\s+en\s+relation\s+avec|parler\s+(?:a|avec)|echanger\s+avec|joindre|contacter|avoir)\s+(?:un\s+|le\s+|la\s+)?(?:conseiller|humain|agent|sav|service\s+client)|(?:parler|echanger|joindre|contacter|contact)\s+(?:a|avec|du|le|un|la)?\s*(?:conseiller|humain|agent|sav|service\s+client)|(?:conseiller|humain)\s+(?:svp|s il vous plait)/;

const confirmedContact =
  /continuer\s+avec\s+un\s+conseiller|je\s+confirme.{0,24}(?:conseiller|contact|humain)|(?:oui|d accord).{0,20}(?:conseiller|contact|humain)|(?:malgre\s+tout|quand\s+meme).{0,30}(?:conseiller|contact|humain)/;

const humanOnlyRules = [
  {
    pattern:
      /(?:changer|modifier|corriger|mettre\s+a\s+jour).{0,48}(?:adresse|magasin|telephone|e-?mail|coordonnees|identite|commande)|(?:adresse|magasin|telephone|e-?mail|coordonnees).{0,48}(?:changer|modifier|corriger)/,
    reason: 'modifier une donnée personnelle, une commande ou un point de retrait',
  },
  {
    pattern:
      /(?:annuler|bloquer).{0,40}(?:commande|livraison|paiement)|(?:declencher|effectuer|faire).{0,40}(?:remboursement|paiement)|(?:remboursez|annulez)\s+(?:moi|ma|mon)/,
    reason: 'exécuter une opération qui modifie une commande, un paiement ou un remboursement',
  },
  {
    pattern:
      /compte\s+(?:est\s+)?bloque|mot\s+de\s+passe|compte\s+(?:est\s+)?pirate|fraude|carte\s+bancaire|coordonnees\s+bancaires|prelevement\s+inconnu/,
    reason: 'traiter une situation sensible liée au compte ou au paiement',
  },
  {
    pattern: /contest|desaccord|litige|refus\s+de\s+garantie|mise\s+en\s+demeure/,
    reason: 'examiner une contestation ou une décision qui exige une intervention humaine',
  },
] as const;

function metadata(entry: HistoryEntry) {
  if (!entry.metadata) return null;
  if (typeof entry.metadata === 'object') return entry.metadata;
  try {
    const value: unknown = JSON.parse(entry.metadata);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hasRecentAssistOffer(history: HistoryEntry[]) {
  return history
    .filter((entry) => entry.role === 'assistant')
    .slice(-3)
    .some((entry) => metadata(entry)?.supportPath === 'assist_first');
}

export function supportDecision(
  message: string,
  c: CaseContext | null,
  history: HistoryEntry[] = [],
): SupportDecision | null {
  const query = normalized(message);

  if (
    c?.status === 'quote_pending' &&
    (!Number.isSafeInteger(c.quote_cents) || Number(c.quote_cents) < 0) &&
    /devis|montant|prix|combien/.test(query)
  )
    return {
      path: 'human_required',
      reason: 'vérifier un devis dont le montant n’est pas renseigné',
    };

  const humanOnly = humanOnlyRules.find((rule) => rule.pattern.test(query));
  if (humanOnly) return { path: 'human_required', reason: humanOnly.reason };

  const previousOffer = hasRecentAssistOffer(history);
  if (
    confirmedContact.test(query) ||
    (previousOffer &&
      (contactRequest.test(query) || /^(?:oui|d accord|je confirme|continuer)[ !.,]*$/.test(query)))
  )
    return { path: 'human_confirmed', reason: null };

  if (contactRequest.test(query)) return { path: 'assist_first', reason: null };
  return null;
}

export function supportQuickReplies(c: CaseContext | null) {
  if (!c)
    return [
      'Comment suivre une réparation ?',
      'Que faire pour un retour ?',
      'Continuer avec un conseiller',
    ];
  if (c.status === 'quote_pending')
    return [
      'Quel est le montant du devis ?',
      'Quelle est la prise en charge ?',
      'Continuer avec un conseiller',
    ];
  if (c.kind === 'delivery')
    return [
      'Où en est ma livraison ?',
      'Une date est-elle confirmée ?',
      'Continuer avec un conseiller',
    ];
  if (c.kind === 'complaint')
    return [
      'Où en est ma réclamation ?',
      'Quelle est la prochaine étape ?',
      'Continuer avec un conseiller',
    ];
  return [
    'Où en est mon dossier ?',
    'Quelle est la prochaine étape ?',
    'Continuer avec un conseiller',
  ];
}
