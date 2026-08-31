export type CaseKind = 'repair' | 'delivery' | 'return' | 'refund' | 'exchange' | 'complaint';
export const labels: Record<string, string> = {
  deposited: 'Déposé en magasin',
  received: 'Reçu au SAV',
  diagnosis: 'Diagnostic en cours',
  waiting_part: 'En attente de pièce',
  quote_pending: 'Devis à valider',
  repairing: 'En réparation',
  repaired: 'Réparation terminée',
  replacement: 'Échange validé',
  shipping: 'Retour en transport',
  ready: 'Disponible au retrait',
  delivered: 'Livré',
  preparing: 'En préparation',
  transit: 'En livraison',
  delayed: 'Livraison retardée',
  return_requested: 'Retour demandé',
  return_approved: 'Retour autorisé',
  return_received: 'Retour réceptionné',
  refund_pending: 'Remboursement en traitement',
  refunded: 'Remboursé',
  open: 'Réclamation ouverte',
  reviewing: 'En cours d’examen',
  resolved: 'Réclamation résolue',
  declined: 'Devis refusé',
};
export const flows: Record<CaseKind, string[]> = {
  repair: [
    'deposited',
    'received',
    'diagnosis',
    'waiting_part',
    'repairing',
    'repaired',
    'shipping',
    'ready',
  ],
  delivery: ['preparing', 'transit', 'delayed', 'transit', 'delivered'],
  return: ['return_requested', 'return_approved', 'return_received', 'refund_pending', 'refunded'],
  refund: ['return_received', 'refund_pending', 'refunded'],
  exchange: ['received', 'diagnosis', 'replacement', 'shipping', 'ready'],
  complaint: ['open', 'reviewing', 'resolved'],
};
export const kindLabels: Record<CaseKind, string> = {
  repair: 'Réparation',
  delivery: 'Livraison',
  return: 'Retour',
  refund: 'Remboursement',
  exchange: 'Échange',
  complaint: 'Réclamation',
};
export const nextStep = (kind: CaseKind, status: string): string | null => {
  if (status === 'quote_pending' || status === 'declined') return null;
  if (kind === 'delivery' && status === 'delayed') return 'delivered';
  if (
    status === 'delivered' ||
    status === 'ready' ||
    status === 'refunded' ||
    status === 'resolved'
  )
    return null;
  const flow = flows[kind];
  const at = flow?.indexOf(status) ?? -1;
  return at >= 0 ? (flow[at + 1] ?? null) : null;
};
export function transition(kind: CaseKind, status: string, action: string): string | null {
  if (action === 'advance') return nextStep(kind, status);
  if (action === 'accept_quote' && status === 'quote_pending') return 'repairing';
  if (action === 'decline_quote' && status === 'quote_pending') return 'declined';
  if (action === 'delay' && ['transit', 'preparing'].includes(status) && kind === 'delivery')
    return 'delayed';
  return null;
}
export const money = (cents: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
export const dateTime = (ms: number) =>
  new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(ms);
export const finished = (status: string) =>
  ['ready', 'delivered', 'refunded', 'resolved', 'declined'].includes(status);
export const normalized = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
export const redacted = (s: string) =>
  s
    .replace(/\b\d{6}\b/g, '[code masqué]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email masqué]')
    .replace(/\b(?:sk-|gsk_)[\w-]+/g, '[secret masqué]')
    .replace(/\bAIza[\w-]{20,}\b/g, '[secret masqué]');
export type Scenario = {
  reference: string;
  kind: CaseKind;
  title: string;
  product: string;
  category: string;
  price: number;
  description: string;
  status: string;
  warranty: string;
  quote: number | null;
  refund: number | null;
  customer: string;
  city: string;
  delivery: string;
  age: number;
};
export const scenarios: Scenario[] = [
  {
    reference: 'SAV-2026-1042',
    kind: 'repair',
    title: 'Un lave-linge en réparation',
    product: 'Lave-linge Atlas Wash 8',
    category: 'Électroménager',
    price: 49900,
    description: 'Le tambour ne tourne plus. Pièce moteur commandée auprès du fournisseur.',
    status: 'waiting_part',
    warranty: 'Prise en charge validée',
    quote: null,
    refund: null,
    customer: 'Camille Martin',
    city: 'Lille',
    delivery: 'Retrait au magasin',
    age: 4,
  },
  {
    reference: 'CMD-2026-2086',
    kind: 'delivery',
    title: 'Une livraison en retard',
    product: 'Canapé Oslo 3 places',
    category: 'Maison',
    price: 74900,
    description: 'Le transporteur signale un retard sur la tournée. Nouvelle date non confirmée.',
    status: 'delayed',
    warranty: 'Sans objet',
    quote: null,
    refund: null,
    customer: 'Sofia Bernard',
    city: 'Dunkerque',
    delivery: 'Livraison à domicile',
    age: 3,
  },
  {
    reference: 'SAV-2026-1048',
    kind: 'repair',
    title: 'Un devis à confirmer',
    product: 'Machine à café Barista',
    category: 'Petit électroménager',
    price: 22900,
    description:
      'Remplacement de la pompe proposé. Diagnostic réalisé ; accord client nécessaire avant intervention.',
    status: 'quote_pending',
    warranty: 'Hors prise en charge — décision fictive',
    quote: 8900,
    refund: null,
    customer: 'Alex Moreau',
    city: 'Metz',
    delivery: 'Retrait au magasin',
    age: 2,
  },
  {
    reference: 'RET-2026-3012',
    kind: 'return',
    title: 'Un retour à organiser',
    product: 'Aspirateur Air Compact',
    category: 'Entretien',
    price: 15900,
    description: 'Demande de retour pour un produit ne correspondant pas au besoin du client.',
    status: 'return_requested',
    warranty: 'Sans objet',
    quote: null,
    refund: 15900,
    customer: 'Camille Martin',
    city: 'Lille',
    delivery: 'Retour en magasin',
    age: 1,
  },
  {
    reference: 'REM-2026-4017',
    kind: 'refund',
    title: 'Un remboursement à suivre',
    product: 'Casque Audio Studio',
    category: 'Multimédia',
    price: 7900,
    description: 'Retour contrôlé et accepté. Remboursement enregistré en traitement.',
    status: 'refund_pending',
    warranty: 'Sans objet',
    quote: null,
    refund: 7900,
    customer: 'Sofia Bernard',
    city: 'Dunkerque',
    delivery: 'Moyen de paiement initial',
    age: 2,
  },
  {
    reference: 'SAV-2026-1053',
    kind: 'exchange',
    title: 'Un échange en préparation',
    product: 'Téléviseur Vision 55',
    category: 'Multimédia',
    price: 59900,
    description:
      'Échange approuvé après diagnostic. Le produit de remplacement est en préparation.',
    status: 'replacement',
    warranty: 'Prise en charge validée',
    quote: null,
    refund: null,
    customer: 'Alex Moreau',
    city: 'Metz',
    delivery: 'Retrait au magasin',
    age: 5,
  },
  {
    reference: 'SC-2026-5021',
    kind: 'complaint',
    title: 'Un article manquant',
    product: 'Lot de cuisine Essentiel',
    category: 'Cuisine',
    price: 6900,
    description:
      'Une poêle manque au colis. Le service client doit contrôler la préparation de commande.',
    status: 'open',
    warranty: 'Sans objet',
    quote: null,
    refund: null,
    customer: 'Camille Martin',
    city: 'Lille',
    delivery: 'Livraison à domicile',
    age: 1,
  },
  {
    reference: 'SAV-2026-1060',
    kind: 'repair',
    title: 'Un produit prêt au retrait',
    product: 'Robot Cuisine Mix',
    category: 'Petit électroménager',
    price: 29900,
    description: 'Réparation et contrôle qualité terminés. Produit reçu au magasin de Lille.',
    status: 'ready',
    warranty: 'Prise en charge validée',
    quote: null,
    refund: null,
    customer: 'Sofia Bernard',
    city: 'Lille',
    delivery: 'Retrait au magasin',
    age: 8,
  },
];
export type Article = {
  id: string;
  title: string;
  category: string;
  version: string;
  effective: string;
  tags: string;
  body: string;
};
export const articles: Article[] = [
  {
    id: 'sav-suivi',
    title: 'Comprendre le suivi de réparation',
    category: 'SAV',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'reparation panne sav technicien diagnostic piece atelier suivi',
    body: 'Le suivi distingue le dépôt, la réception à l’atelier, le diagnostic, l’attente de pièce, la réparation, le contrôle et le retour. Une réparation terminée ne signifie pas que le produit est disponible au magasin. Les dates de retour sont estimatives tant que la réception n’est pas confirmée.',
  },
  {
    id: 'sav-garantie',
    title: 'Garantie et prise en charge',
    category: 'SAV',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'garantie gratuit payer couverture prise charge',
    body: 'Dans cette enseigne fictive, la décision de prise en charge est enregistrée dans le dossier après contrôle des justificatifs et du diagnostic. L’assistant explique cette décision, mais ne détermine pas les droits légaux et ne promet pas une gratuité. En cas de désaccord, un conseiller doit examiner le dossier.',
  },
  {
    id: 'sav-devis',
    title: 'Accepter ou refuser un devis',
    category: 'SAV',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'devis accepter refuser prix cout montant reparation',
    body: 'Un devis en attente nécessite une confirmation explicite du client. Le montant présenté est celui du dossier actuel. L’intervention ne commence pas avant acceptation. En cas de refus, un conseiller organise la restitution ; aucun paiement réel n’est déclenché dans cette démonstration.',
  },
  {
    id: 'sav-retrait',
    title: 'Récupérer un produit réparé',
    category: 'SAV',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'retrait recuperer chercher magasin repare disponible',
    body: 'Le retrait est possible lorsque le dossier indique « Disponible au retrait ». Préparez la référence du dossier et le justificatif de dépôt. Un produit encore en transport n’est pas disponible. Pour un changement de magasin ou une livraison à domicile, un conseiller vérifie la faisabilité.',
  },
  {
    id: 'sc-livraison',
    title: 'Retard ou incident de livraison',
    category: 'Service client',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'livraison retard colis transporteur date commande arriver',
    body: 'Le statut et l’estimation proviennent du suivi enregistré. Une estimation ne constitue pas une date garantie. Si la date n’est pas communiquée ou si le colis est signalé perdu, une demande de contact peut être créée pour le service client. La démonstration n’envoie aucun SMS ni email réel.',
  },
  {
    id: 'sc-incomplet',
    title: 'Colis incomplet ou endommagé',
    category: 'Service client',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'manquant incomplet casse abime endommage article colis',
    body: 'Précisez la référence de commande et les articles concernés. Conservez l’emballage et les justificatifs disponibles. Le conseiller vérifie s’il existe un envoi séparé ou ouvre une réclamation. Aucun remboursement ni échange n’est promis avant examen du dossier.',
  },
  {
    id: 'sc-retour',
    title: 'Demander un retour ou un échange',
    category: 'Service client',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'retour retourner echange changer produit delai',
    body: 'Les possibilités de retour dépendent du produit, du mode d’achat et de la politique applicable. Dans la démonstration, les retours autorisés sont identifiés dans le dossier. Un retour réceptionné doit être contrôlé avant la validation du remboursement. Les situations non documentées sont transmises à un conseiller.',
  },
  {
    id: 'sc-remboursement',
    title: 'Suivre un remboursement',
    category: 'Service client',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'remboursement rembourse argent paiement banque montant',
    body: 'Le dossier distingue remboursement en traitement et remboursement effectué. L’assistant communique le montant et l’état enregistrés sans inventer de délai bancaire. Un montant contesté nécessite l’examen du service client. Aucun mouvement financier réel n’a lieu sur cette plateforme.',
  },
  {
    id: 'sc-compte',
    title: 'Compte, fidélité et facture',
    category: 'Service client',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'compte fidelite points facture ticket paiement mot passe',
    body: 'Un conseiller peut examiner une demande liée au compte, aux points de fidélité ou à une facture. La plateforme de démonstration ne dispose pas de connecteur de paiement ou de programme de fidélité réel. Ne communiquez jamais de mot de passe, code bancaire ou numéro de carte dans la conversation.',
  },
  {
    id: 'produit-securite',
    title: 'Un appareil présente un danger',
    category: 'Sécurité',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'danger fumee brule electrique etincelle odeur fuite securite feu',
    body: 'En cas de fumée, odeur de brûlé ou étincelles, cessez d’utiliser l’appareil et éloignez-vous du danger. Ne démontez pas l’appareil. Contactez un professionnel ; en cas de danger immédiat, contactez les secours locaux. L’assistant ne propose pas de réparation électrique à réaliser soi-même.',
  },
  {
    id: 'produit-conseil',
    title: 'Conseil et disponibilité produit',
    category: 'Produits',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'produit stock disponibilite compatible conseil caracteristique acheter',
    body: 'Le catalogue de démonstration présente des produits fictifs. Le stock et la compatibilité technique ne sont pas reliés à un inventaire réel. Pour une caractéristique absente de la notice, l’assistant doit préciser qu’il ne peut pas la vérifier et proposer un conseiller.',
  },
  {
    id: 'magasin-contact',
    title: 'Contacter un conseiller',
    category: 'Service client',
    version: '1.0',
    effective: '2026-08-01',
    tags: 'conseiller humain contact reclamation magasin horaires telephone adresse',
    body: 'Une demande de contact rassemble la référence du dossier, le statut et le résumé du problème. Elle apparaît dans l’espace de gestion. Le relais est simulé : aucun conseiller réel, appel, email ou SMS n’est déclenché. Les horaires des magasins ne sont pas disponibles dans cette version.',
  },
];
const stop = new Set([
  'les',
  'des',
  'une',
  'est',
  'mon',
  'mes',
  'pour',
  'dans',
  'avec',
  'vous',
  'bonjour',
  'veux',
  'savoir',
  'sur',
  'que',
  'qui',
  'pas',
  'plus',
  'comment',
  'puis',
  'elle',
  'son',
  'aux',
  'cette',
]);
export function retrieve(query: string, limit = 3): Article[] {
  const words = [
    ...new Set(
      normalized(query)
        .split(/\W+/)
        .filter((w) => w.length > 2 && !stop.has(w)),
    ),
  ];
  return articles
    .map((a) => {
      const text = normalized(a.title + ' ' + a.tags + ' ' + a.body);
      const tags = normalized(a.tags);
      return {
        a,
        score: words.reduce((s, w) => s + (tags.includes(w) ? 3 : text.includes(w) ? 1 : 0), 0),
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.a);
}
