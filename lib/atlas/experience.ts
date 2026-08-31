import { type CaseKind } from './domain';

export const discoveryScenarios = [
  {
    reference: 'SAV-2026-1042',
    label: 'Une réparation',
    category: 'SUIVI SAV',
    question: 'Où en est la réparation de mon lave-linge ?',
    answer: 'Votre lave-linge est au SAV. Une pièce moteur est attendue avant la réparation.',
    note: 'Prise en charge validée. Aucune date de restitution confirmée.',
    next: 'La pièce est arrivée. Votre lave-linge passe en réparation.',
    nextStatus: 'En réparation',
    outcome: 'Comprendre où en est votre produit, et ce qui vient ensuite.',
  },
  {
    reference: 'CMD-2026-2086',
    label: 'Une livraison',
    category: 'SERVICE CLIENT',
    question: 'Mon canapé est en retard. Est-ce que vous avez une date ?',
    answer:
      'Le transporteur a signalé un retard. Aucune nouvelle date confirmée n’est enregistrée.',
    note: 'Une estimation n’est pas une promesse de livraison.',
    next: 'Le dossier indique maintenant que votre canapé a été livré. Le suivi a été actualisé.',
    nextStatus: 'Livré',
    outcome: 'Obtenir une information claire, même quand une date manque.',
  },
  {
    reference: 'SAV-2026-1048',
    label: 'Un devis',
    category: 'VOTRE DÉCISION',
    question: 'Combien coûte la réparation de ma machine à café ?',
    answer: 'Le devis est de 89 €. Le remplacement de la pompe attend votre accord.',
    note: 'Aucune intervention avant votre confirmation. Aucun paiement dans cette démo.',
    next: 'Le devis reste en attente : seul votre accord explicite peut lancer la suite.',
    nextStatus: 'Votre accord est nécessaire',
    outcome: 'Voir le montant et garder la main sur chaque décision.',
  },
] as const;

export function suggestedQuestions(c: { kind: CaseKind; status: string } | null) {
  if (!c)
    return [
      'Comment suivre une réparation ?',
      'Comment fonctionne un retour ?',
      'Que faire si un colis est incomplet ?',
    ];
  if (c.status === 'quote_pending')
    return [
      'Quel est le montant du devis ?',
      'Quelle est la prise en charge ?',
      'Je souhaite un conseiller',
    ];
  if (c.kind === 'delivery')
    return [
      'Où en est ma livraison ?',
      'Une date est-elle confirmée ?',
      'Je souhaite un conseiller',
    ];
  if (c.kind === 'refund')
    return [
      'Où en est mon remboursement ?',
      'Quel montant est enregistré ?',
      'Je souhaite un conseiller',
    ];
  if (c.kind === 'return')
    return ['Où en est mon retour ?', 'Comment préparer un retour ?', 'Je souhaite un conseiller'];
  if (c.kind === 'complaint')
    return [
      'Où en est ma réclamation ?',
      'Quelle est la prochaine étape ?',
      'Je souhaite un conseiller',
    ];
  if (c.kind === 'exchange')
    return [
      'Où en est mon échange ?',
      'Quelle est la prochaine étape ?',
      'Quelle est la prise en charge ?',
    ];
  if (c.status === 'ready')
    return [
      'Où récupérer mon produit ?',
      'Quels documents faut-il pour le retrait ?',
      'Je souhaite un conseiller',
    ];
  return [
    'Où en est mon dossier ?',
    'Quelle est la prochaine étape ?',
    'Quelle est la prise en charge ?',
  ];
}

export function guideStage(
  verified: boolean,
  version: number,
  answerVersion: number | null | undefined,
  hasAnswer: boolean,
) {
  if (!verified) return 'verify';
  if (!hasAnswer) return 'ask';
  if (version > 0 && answerVersion === version) return 'done';
  if (answerVersion !== undefined && answerVersion !== null && answerVersion < version)
    return 'refresh';
  return 'advance';
}
