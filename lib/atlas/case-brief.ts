import { labels, nextStep, validAmount, type CaseKind } from './domain';

type BriefSource = {
  id: string;
  reference: string;
  product: string;
  kind: CaseKind;
  status: string;
  version: number;
  updated_at: number;
  quote_cents: number | null;
  refund_cents: number | null;
  estimate: string | null;
};

/** A small, server-authored snapshot. Never copy a database row or model output here. */
export type CaseBrief = {
  schema: 1;
  caseId: string;
  reference: string;
  product: string;
  status: string;
  statusLabel: string;
  version: number;
  updatedAt: number;
  explanation: string;
  nextLabel: string;
  customerStep: string;
  estimate: string | null;
  amount: { label: string; cents: number } | null;
};

const explanations: Record<string, string> = {
  deposited: 'Le dépôt est enregistré. Le produit n’est pas encore signalé comme reçu au SAV.',
  received: 'Le SAV a enregistré la réception du produit.',
  diagnosis: 'Le diagnostic est en cours. La solution n’est pas encore confirmée.',
  waiting_part: 'Une pièce est attendue avant de poursuivre la réparation.',
  quote_pending: 'La réparation attend votre décision sur le devis.',
  repairing: 'L’intervention est en cours. Le produit n’est pas encore prêt au retrait.',
  repaired: 'La réparation est terminée. Le retour du produit reste à suivre.',
  replacement: 'Un échange est validé. Le produit de remplacement est en préparation.',
  shipping: 'Le produit est en transport retour. Le retrait n’est pas encore confirmé.',
  ready: 'Le dossier indique que le produit est disponible au retrait.',
  delivered: 'Le dossier indique une livraison effectuée.',
  preparing: 'La commande est en préparation, pas encore signalée comme livrée.',
  transit: 'La livraison est en cours. La remise au client n’est pas encore enregistrée.',
  delayed: 'Un retard est signalé. Aucune nouvelle date confirmée n’est enregistrée.',
  return_requested: 'La demande de retour est enregistrée. Son autorisation reste à confirmer.',
  return_approved: 'Le retour est autorisé. La réception du produit reste à confirmer.',
  return_received: 'Le retour a été réceptionné. Cela ne confirme pas encore un remboursement.',
  refund_pending: 'Le remboursement est en traitement. Aucun délai bancaire n’est communiqué.',
  refunded: 'Le dossier indique un remboursement effectué, sans vérification du compte bancaire.',
  open: 'La réclamation est enregistrée. Aucune résolution n’est encore confirmée.',
  reviewing: 'Le service client examine la réclamation.',
  resolved: 'Le dossier est marqué comme résolu. Vous pouvez demander un relais si nécessaire.',
  declined: 'Le devis a été refusé. Aucune réparation n’est lancée sur cet accord.',
};

export function caseBrief(c: BriefSource): CaseBrief {
  const next = nextStep(c.kind, c.status);
  const quote = c.status === 'quote_pending';
  const refund = c.kind === 'refund' || ['refund_pending', 'refunded'].includes(c.status);
  const cents = quote ? c.quote_cents : refund ? c.refund_cents : null;
  return {
    schema: 1,
    caseId: c.id,
    reference: c.reference,
    product: c.product,
    status: c.status,
    statusLabel: labels[c.status] ?? 'État à vérifier',
    version: c.version,
    updatedAt: c.updated_at,
    explanation: explanations[c.status] ?? 'Demandez un conseiller pour clarifier cet état.',
    nextLabel: quote
      ? 'Votre décision sur le devis'
      : c.status === 'declined'
        ? 'Suite à convenir avec un conseiller'
        : next
          ? labels[next]
          : 'Aucune autre étape enregistrée',
    customerStep: quote
      ? validAmount(cents)
        ? 'Examinez le montant, puis acceptez ou refusez explicitement. Aucun paiement réel.'
        : 'Le montant du devis est à confirmer avec un conseiller. N’acceptez aucun montant inconnu.'
      : c.status === 'ready'
        ? 'Préparez votre justificatif de dépôt avant le retrait en magasin.'
        : c.status === 'return_approved'
          ? 'Consultez la procédure de retour pour préparer le produit et ses justificatifs.'
          : c.status === 'declined'
            ? 'Demandez un conseiller pour organiser la suite. Le relais est simulé.'
            : 'Aucune action client supplémentaire n’est indiquée à cette étape.',
    estimate: c.estimate,
    amount: validAmount(cents)
      ? { label: quote ? 'Devis à examiner' : 'Montant enregistré', cents }
      : null,
  };
}

export function briefFreshness(
  brief: CaseBrief,
  current: { id: string; verified: boolean; version: number } | null,
) {
  if (!current?.verified || current.id !== brief.caseId) return 'unavailable';
  if (current.version > brief.version) return 'outdated';
  if (current.version === brief.version) return 'current';
  return 'unknown';
}
