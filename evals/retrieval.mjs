// Independent authored relevance labels for the repository's published seed corpus.
// A deployment with different procedures must supply and review its own gold labels.
const topics = [
  [
    'repair',
    'Comprendre le suivi de réparation',
    [
      'ma pièce n’est toujours pas arrivée, comment se déroule la réparation ?',
      'The repair is waiting for a spare part. What does that stage mean?',
      'Das Ersatzteil fehlt noch. Was bedeutet dieser Reparaturschritt?',
      'La reparación espera un repuesto, ¿qué significa esa etapa?',
      'الإصلاح ينتظر قطعة غيار، ماذا تعني هذه المرحلة؟',
    ],
  ],
  [
    'return',
    'Demander un retour ou un échange',
    [
      'j’ai plus la boîte, comment demander un retour ?',
      'I no longer have the box, how can I request a return?',
      'Ich habe den Karton nicht mehr. Wie beantrage ich eine Rückgabe?',
      'Ya no tengo la caja, ¿cómo solicito una devolución?',
      'لم يعد عندي الصندوق، كيف أطلب إرجاع المنتج؟',
    ],
  ],
  [
    'incomplete',
    'Colis incomplet ou endommagé',
    [
      'wsh j’ai reçu que la moitié de ma commande je fais quoi',
      'Only half my order arrived. What should I do?',
      'Meine Bestellung kam nur teilweise an. Was soll ich tun?',
      'Solo recibí la mitad de mi pedido, ¿qué hago?',
      'وصلني نصف الطلب فقط، ماذا أفعل؟',
    ],
  ],
  [
    'refund',
    'Suivre un remboursement',
    [
      'Comment suivre un remboursement sans inventer le délai bancaire ?',
      'How can I track my refund without guessing the bank processing time?',
      'Wie kann ich meine Erstattung verfolgen, ohne eine Bankfrist zu erraten?',
      '¿Cómo se sigue un reembolso sin inventar el plazo bancario?',
      'كيف أتابع استرداد المبلغ دون تخمين مدة المعالجة البنكية؟',
    ],
  ],
];
export const retrievalScenarios = topics.flatMap(([topic, title, queries]) =>
  queries.map((query, i) => ({
    id: `retrieval-${topic}-${['fr', 'en', 'de', 'es', 'ar'][i]}`,
    language: ['fr', 'en', 'de', 'es', 'ar'][i],
    query,
    expectedTitles: [title],
  })),
);
