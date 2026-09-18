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
  /(?:je\s+(?:veux|souhaite|voudrais|prefere)\s+(?:un\s+|une\s+|le\s+|la\s+)?(?:conseiller|humaine?|agent|contact))|(?:je\s+(?:veux|souhaite|voudrais|prefere)|puis[ -]?je|comment)\s+(?:etre\s+)?(?:mis(?:e)?\s+en\s+relation\s+avec|parler\s+(?:a|avec)|echanger\s+avec|joindre|contacter|avoir)\s+(?:un\s+|le\s+|la\s+)?(?:conseiller|humain|agent|sav|service\s+client)|(?:parler|echanger|joindre|contacter|contact)\s+(?:a|avec|du|le|un|la)?\s*(?:conseiller|humain|agent|sav|service\s+client)|(?:conseiller|humain)\s+(?:svp|s il vous plait)|(?:i\s+(?:want|need|would like)|can i|how do i).{0,35}(?:advisor|adviser|agent|human|customer service)|(?:speak|talk|contact).{0,20}(?:advisor|adviser|agent|human)|(?:ich\s+(?:mochte|möchte|will)|kann ich).{0,35}(?:berater|mitarbeiter|menschen)|(?:mit|zu).{0,20}(?:berater|mitarbeiter).{0,20}(?:sprechen|kontakt)|(?:quiero|quisiera|necesito|puedo).{0,35}(?:asesor|agente|persona|atencion al cliente|atención al cliente)|(?:hablar|contactar).{0,20}(?:asesor|agente|persona)|(?:أريد|اريد|أحتاج|احتاج).{0,20}(?:موظف|مستشار|شخص|خدمة العملاء)|(?:التحدث|اتحدث|أتحدث).{0,20}(?:موظف|مستشار|شخص)/u;

const confirmedContact =
  /continuer\s+avec\s+un\s+conseiller|je\s+confirme.{0,24}(?:conseiller|contact|humain)|(?:oui|d accord).{0,20}(?:conseiller|contact|humain)|(?:malgre\s+tout|quand\s+meme).{0,30}(?:conseiller|contact|humain)|(?:yes|i confirm|continue).{0,24}(?:advisor|adviser|agent|human)|(?:ja|ich bestatige|ich bestätige|weiter).{0,24}(?:berater|mitarbeiter|mensch)|(?:si|sí|confirmo|continuar).{0,24}(?:asesor|agente|persona)|(?:نعم|أؤكد|اؤكد|متابعة).{0,24}(?:موظف|مستشار|شخص)/u;

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

export function supportQuickReplies(
  c: CaseContext | null,
  language: 'fr' | 'en' | 'de' | 'es' | 'ar' = 'fr',
) {
  const replies = {
    fr: {
      general: ['Comment suivre une réparation ?', 'Que faire pour un retour ?', 'Continuer avec un conseiller'],
      quote: ['Quel est le montant du devis ?', 'Quelle est la prise en charge ?', 'Continuer avec un conseiller'],
      delivery: ['Où en est ma livraison ?', 'Une date est-elle confirmée ?', 'Continuer avec un conseiller'],
      complaint: ['Où en est ma réclamation ?', 'Quelle est la prochaine étape ?', 'Continuer avec un conseiller'],
      dossier: ['Où en est mon dossier ?', 'Quelle est la prochaine étape ?', 'Continuer avec un conseiller'],
    },
    en: {
      general: ['How can I track a repair?', 'How does a return work?', 'Continue with an advisor'],
      quote: ['What is the quote amount?', 'What is covered?', 'Continue with an advisor'],
      delivery: ['Where is my delivery?', 'Is a date confirmed?', 'Continue with an advisor'],
      complaint: ['What is the status of my complaint?', 'What is the next step?', 'Continue with an advisor'],
      dossier: ['What is the status of my case?', 'What is the next step?', 'Continue with an advisor'],
    },
    de: {
      general: ['Wie kann ich eine Reparatur verfolgen?', 'Wie funktioniert eine Rückgabe?', 'Mit einem Berater fortfahren'],
      quote: ['Wie hoch ist der Kostenvoranschlag?', 'Was wird übernommen?', 'Mit einem Berater fortfahren'],
      delivery: ['Wo ist meine Lieferung?', 'Ist ein Datum bestätigt?', 'Mit einem Berater fortfahren'],
      complaint: ['Wie ist der Stand meiner Reklamation?', 'Was ist der nächste Schritt?', 'Mit einem Berater fortfahren'],
      dossier: ['Wie ist der Stand meines Vorgangs?', 'Was ist der nächste Schritt?', 'Mit einem Berater fortfahren'],
    },
    es: {
      general: ['¿Cómo sigo una reparación?', '¿Cómo funciona una devolución?', 'Continuar con un asesor'],
      quote: ['¿Cuál es el importe del presupuesto?', '¿Qué está cubierto?', 'Continuar con un asesor'],
      delivery: ['¿Dónde está mi entrega?', '¿Hay una fecha confirmada?', 'Continuar con un asesor'],
      complaint: ['¿Cuál es el estado de mi reclamación?', '¿Cuál es el siguiente paso?', 'Continuar con un asesor'],
      dossier: ['¿Cuál es el estado de mi expediente?', '¿Cuál es el siguiente paso?', 'Continuar con un asesor'],
    },
    ar: {
      general: ['كيف أتابع عملية إصلاح؟', 'كيف تتم عملية الإرجاع؟', 'المتابعة مع مستشار'],
      quote: ['ما قيمة عرض السعر؟', 'ما الذي يشمله الضمان؟', 'المتابعة مع مستشار'],
      delivery: ['أين طلبي؟', 'هل يوجد تاريخ مؤكد؟', 'المتابعة مع مستشار'],
      complaint: ['ما حالة شكواي؟', 'ما الخطوة التالية؟', 'المتابعة مع مستشار'],
      dossier: ['ما حالة ملفي؟', 'ما الخطوة التالية؟', 'المتابعة مع مستشار'],
    },
  } as const;

  const selected = replies[language];
  if (!c) return [...selected.general];
  if (c.status === 'quote_pending') return [...selected.quote];
  if (c.kind === 'delivery') return [...selected.delivery];
  if (c.kind === 'complaint') return [...selected.complaint];
  return [...selected.dossier];
}
