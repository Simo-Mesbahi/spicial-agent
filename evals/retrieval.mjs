// Independent authored relevance labels for the repository's published seed corpus.
//
// The customer utterance remains multilingual, but production structured orchestration
// rewrites knowledge searches into a short standalone French query for the current
// fr-FR corpus. This evaluator therefore exercises the exact retrieval boundary used
// in production instead of bypassing query rewriting with raw foreign-language text.
//
// Multiple expected titles are allowed only when the published corpus contains
// independently reviewed procedures that are materially relevant to the same request.
const languages = ['fr', 'en', 'de', 'es', 'ar'];

const topics = [
  {
    topic: 'repair',
    expectedTitles: [
      'Attente de pièce ou pièce indisponible',
      'Comprendre le suivi de réparation',
    ],
    sourceQueries: [
      'ma pièce n’est toujours pas arrivée, comment se déroule la réparation ?',
      'The repair is waiting for a spare part. What does that stage mean?',
      'Das Ersatzteil fehlt noch. Was bedeutet dieser Reparaturschritt?',
      'La reparación espera un repuesto, ¿qué significa esa etapa?',
      'الإصلاح ينتظر قطعة غيار، ماذا تعني هذه المرحلة؟',
    ],
    retrievalQueries: [
      'ma pièce n’est toujours pas arrivée, comment se déroule la réparation ?',
      'la réparation attend une pièce de rechange, que signifie cette étape ?',
      'la pièce de rechange manque encore, que signifie cette étape de réparation ?',
      'la réparation est en attente d’une pièce de rechange, que signifie cette étape ?',
      'la réparation attend une pièce de rechange, que signifie cette étape ?',
    ],
  },
  {
    topic: 'return',
    expectedTitles: ['Demander un retour ou un échange'],
    sourceQueries: [
      'j’ai plus la boîte, comment demander un retour ?',
      'I no longer have the box, how can I request a return?',
      'Ich habe den Karton nicht mehr. Wie beantrage ich eine Rückgabe?',
      'Ya no tengo la caja, ¿cómo solicito una devolución?',
      'لم يعد عندي الصندوق، كيف أطلب إرجاع المنتج؟',
    ],
    retrievalQueries: [
      'je n’ai plus la boîte, comment demander un retour ?',
      'je n’ai plus la boîte, comment demander un retour produit ?',
      'je n’ai plus l’emballage, comment demander un retour ?',
      'je n’ai plus la boîte, comment effectuer un retour ?',
      'je n’ai plus l’emballage, comment demander le retour du produit ?',
    ],
  },
  {
    topic: 'incomplete',
    expectedTitles: [
      'Commande expédiée ou livrée partiellement',
      'Colis incomplet ou endommagé',
    ],
    sourceQueries: [
      'wsh j’ai reçu que la moitié de ma commande je fais quoi',
      'Only half my order arrived. What should I do?',
      'Meine Bestellung kam nur teilweise an. Was soll ich tun?',
      'Solo recibí la mitad de mi pedido, ¿qué hago?',
      'وصلني نصف الطلب فقط، ماذا أفعل؟',
    ],
    retrievalQueries: [
      'je n’ai reçu que la moitié de ma commande, que dois-je faire ?',
      'ma commande est arrivée seulement en partie, que dois-je faire ?',
      'ma commande a été livrée partiellement, que dois-je faire ?',
      'je n’ai reçu qu’une partie de ma commande, que dois-je faire ?',
      'il manque une partie de ma commande reçue, que dois-je faire ?',
    ],
  },
  {
    topic: 'refund',
    expectedTitles: ['Suivre un remboursement'],
    sourceQueries: [
      'Comment suivre un remboursement sans inventer le délai bancaire ?',
      'How can I track my refund without guessing the bank processing time?',
      'Wie kann ich meine Erstattung verfolgen, ohne eine Bankfrist zu erraten?',
      '¿Cómo se sigue un reembolso sin inventar el plazo bancario?',
      'كيف أتابع استرداد المبلغ دون تخمين مدة المعالجة البنكية؟',
    ],
    retrievalQueries: [
      'comment suivre un remboursement sans inventer le délai bancaire ?',
      'comment suivre mon remboursement sans supposer le délai de la banque ?',
      'comment vérifier l’état d’un remboursement sans inventer le délai bancaire ?',
      'comment suivre un remboursement sans annoncer un faux délai bancaire ?',
      'comment suivre le remboursement sans deviner le délai de traitement bancaire ?',
    ],
  },
];

export const retrievalScenarios = topics.flatMap(
  ({ topic, expectedTitles, sourceQueries, retrievalQueries }) =>
    sourceQueries.map((query, i) => ({
      id: `retrieval-${topic}-${languages[i]}`,
      language: languages[i],
      query,
      retrievalQuery: retrievalQueries[i],
      expectedTitles,
    })),
);
