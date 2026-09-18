import type { CaseRow } from './api';

export type ConversationLanguage = 'fr' | 'en' | 'de' | 'es' | 'ar';
export type CasualIntent = 'greeting' | 'wellbeing' | 'thanks' | 'farewell' | 'help' | null;

const scores: Record<Exclude<ConversationLanguage, 'ar'>, RegExp[]> = {
  fr: [
    /\b(bonjour|bonsoir|salut|merci|svp|s'il vous plait|comment|pourquoi|retour|reparation|remboursement|livraison|colis|dossier|garantie|devis|conseiller|mon|ma|mes|vous|je)\b/i,
    /\b(ca va|ça va|cv)\b/i,
  ],
  en: [
    /\b(hello|hi|hey|thanks|thank you|please|how|why|return|repair|refund|delivery|package|parcel|case|warranty|quote|advisor|agent|my|your|can you|where is)\b/i,
  ],
  de: [
    /\b(hallo|guten tag|danke|bitte|wie|warum|ruckgabe|rückgabe|reparatur|erstattung|lieferung|paket|fall|garantie|kostenvoranschlag|berater|mein|meine|wo ist)\b/i,
  ],
  es: [
    /\b(hola|buenas|gracias|por favor|como|cómo|porque|por qué|devolucion|devolución|reparacion|reparación|reembolso|entrega|paquete|pedido|garantia|garantía|presupuesto|asesor|mi|donde|dónde)\b/i,
  ],
};

function scoreLanguage(text: string, patterns: RegExp[]) {
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

export function detectConversationLanguage(
  message: string,
  previousUserMessages: string[] = [],
): ConversationLanguage {
  const text = message.trim();
  if (/\p{Script=Arabic}/u.test(text)) return 'ar';

  const ranked = (Object.keys(scores) as (keyof typeof scores)[])
    .map((language) => ({ language, score: scoreLanguage(text, scores[language]) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score ?? 0))
    return ranked[0].language;

  for (const previous of [...previousUserMessages].reverse()) {
    if (/\p{Script=Arabic}/u.test(previous)) return 'ar';
    const prior = (Object.keys(scores) as (keyof typeof scores)[])
      .map((language) => ({ language, score: scoreLanguage(previous, scores[language]) }))
      .sort((a, b) => b.score - a.score);
    if (prior[0]?.score > 0 && prior[0].score > (prior[1]?.score ?? 0)) return prior[0].language;
  }

  return 'fr';
}

export function casualIntent(message: string): CasualIntent {
  const text = message.trim().toLowerCase();

  if (
    /^(cv|cv\s*\?|ça va|ca va|tu vas bien|vous allez bien|how are you|how's it going|hows it going|wie geht'?s|wie geht es dir|wie geht es ihnen|como estas|cómo estás|que tal|qué tal|كيف حالك|كيفك)[ !?.،؟]*$/iu.test(
      text,
    )
  )
    return 'wellbeing';

  if (
    /^(bonjour|bonsoir|salut|hello|hi|hey|hallo|guten tag|hola|buenas|مرحبا|السلام عليكم)[ !?.،؟]*$/iu.test(
      text,
    )
  )
    return 'greeting';

  if (
    /^(merci|merci beaucoup|thanks|thank you|danke|vielen dank|gracias|muchas gracias|شكرا|شكرًا)[ !?.،؟]*$/iu.test(
      text,
    )
  )
    return 'thanks';

  if (
    /^(au revoir|a bientot|à bientôt|bye|goodbye|see you|tschuss|tschüss|auf wiedersehen|adios|adiós|hasta luego|مع السلامة|الى اللقاء|إلى اللقاء)[ !?.،؟]*$/iu.test(
      text,
    )
  )
    return 'farewell';

  if (
    /^(tu peux faire quoi|vous pouvez faire quoi|comment peux tu m aider|comment pouvez vous m aider|what can you do|how can you help me|was kannst du|wie konnen sie mir helfen|wie können sie mir helfen|que puedes hacer|qué puedes hacer|como puedes ayudarme|cómo puedes ayudarme|ماذا يمكنك أن تفعل|كيف يمكنك مساعدتي)[ !?.،؟]*$/iu.test(
      text,
    )
  )
    return 'help';

  return null;
}

const replies: Record<
  ConversationLanguage,
  Record<Exclude<CasualIntent, null>, { general: string; withCase: (reference: string) => string }>
> = {
  fr: {
    greeting: {
      general:
        'Bonjour ! Je suis là pour vous aider, vous renseigner et vous accompagner pour le SAV, vos commandes, retours, livraisons ou toute autre question de service client. Que puis-je faire pour vous ?',
      withCase: (reference) =>
        `Bonjour ! Je suis là pour vous aider. Votre dossier ${reference} est déjà vérifié : vous pouvez me demander son avancement, la prochaine étape ou toute précision utile.`,
    },
    wellbeing: {
      general:
        'Ça va bien, merci 😊 Et vous ? Je suis là pour vous aider, vous renseigner et vous accompagner. Dites-moi simplement ce dont vous avez besoin.',
      withCase: (reference) =>
        `Ça va bien, merci 😊 Et vous ? Je suis là pour vous accompagner. Votre dossier ${reference} est déjà vérifié si vous souhaitez qu’on regarde son avancement.`,
    },
    thanks: {
      general: 'Avec plaisir ! Si vous avez une autre question, je suis là pour vous aider.',
      withCase: () => 'Avec plaisir ! Si vous avez une autre question sur votre dossier, je suis là.',
    },
    farewell: {
      general: 'À bientôt ! N’hésitez pas à revenir si vous avez besoin d’aide.',
      withCase: () => 'À bientôt ! Vous pourrez reprendre votre suivi tant que votre session reste active.',
    },
    help: {
      general:
        'Je peux répondre à vos questions SAV et service client, expliquer un retour ou une livraison, vous aider à comprendre une garantie ou un remboursement, et consulter un dossier après vérification sécurisée. Parlez-moi naturellement.',
      withCase: (reference) =>
        `Je peux vous aider à comprendre et suivre le dossier ${reference}, expliquer son statut, la prochaine étape, un devis, une garantie ou préparer un relais vers un conseiller si nécessaire. Parlez-moi naturellement.`,
    },
  },
  en: {
    greeting: {
      general:
        'Hello! I’m here to help, answer your questions, and guide you with repairs, orders, returns, deliveries, or other customer-service needs. How can I help?',
      withCase: (reference) =>
        `Hello! I’m here to help. Your case ${reference} is already verified, so you can ask me about its status, next step, or anything else you need.`,
    },
    wellbeing: {
      general:
        'I’m doing well, thank you 😊 How are you? I’m here to help, answer your questions, and guide you. Just tell me what you need.',
      withCase: (reference) =>
        `I’m doing well, thank you 😊 How are you? I’m here to help. Your case ${reference} is already verified if you’d like to check its progress.`,
    },
    thanks: {
      general: 'You’re very welcome! If you have another question, I’m here to help.',
      withCase: () => 'You’re very welcome! If you have another question about your case, I’m here.',
    },
    farewell: {
      general: 'See you soon! Feel free to come back whenever you need help.',
      withCase: () => 'See you soon! You can continue tracking your case while your session remains active.',
    },
    help: {
      general:
        'I can help with repair and customer-service questions, returns, deliveries, warranties, refunds, and verified case tracking. You can speak to me naturally.',
      withCase: (reference) =>
        `I can help you understand and track case ${reference}, explain its status or next step, discuss a quote or warranty, and prepare a handoff to an advisor when needed. You can speak to me naturally.`,
    },
  },
  de: {
    greeting: {
      general:
        'Hallo! Ich bin hier, um Ihnen zu helfen und Sie bei Reparaturen, Bestellungen, Rückgaben, Lieferungen oder anderen Servicefragen zu begleiten. Wie kann ich Ihnen helfen?',
      withCase: (reference) =>
        `Hallo! Ich helfe Ihnen gern. Ihr Vorgang ${reference} ist bereits verifiziert. Sie können mich nach dem Status, dem nächsten Schritt oder weiteren Details fragen.`,
    },
    wellbeing: {
      general:
        'Mir geht es gut, danke 😊 Und Ihnen? Ich bin hier, um Ihnen zu helfen und Sie zu begleiten. Sagen Sie mir einfach, was Sie brauchen.',
      withCase: (reference) =>
        `Mir geht es gut, danke 😊 Und Ihnen? Ihr Vorgang ${reference} ist bereits verifiziert, falls Sie den aktuellen Stand prüfen möchten.`,
    },
    thanks: {
      general: 'Sehr gern! Wenn Sie noch eine Frage haben, helfe ich Ihnen weiter.',
      withCase: () => 'Sehr gern! Wenn Sie noch eine Frage zu Ihrem Vorgang haben, bin ich für Sie da.',
    },
    farewell: {
      general: 'Bis bald! Melden Sie sich jederzeit wieder, wenn Sie Hilfe brauchen.',
      withCase: () => 'Bis bald! Sie können Ihren Vorgang weiter verfolgen, solange Ihre Sitzung aktiv ist.',
    },
    help: {
      general:
        'Ich kann bei Reparatur- und Servicefragen, Rückgaben, Lieferungen, Garantien, Erstattungen und der sicheren Vorgangsverfolgung helfen. Schreiben Sie einfach ganz natürlich.',
      withCase: (reference) =>
        `Ich kann Ihnen beim Vorgang ${reference} helfen, den Status oder nächsten Schritt erklären und bei Bedarf einen Kontakt zu einem Berater vorbereiten. Schreiben Sie einfach ganz natürlich.`,
    },
  },
  es: {
    greeting: {
      general:
        '¡Hola! Estoy aquí para ayudarle, responder a sus preguntas y acompañarle con reparaciones, pedidos, devoluciones, entregas u otras consultas de atención al cliente. ¿En qué puedo ayudarle?',
      withCase: (reference) =>
        `¡Hola! Estoy aquí para ayudarle. Su expediente ${reference} ya está verificado; puede preguntarme por su estado, el siguiente paso o cualquier detalle que necesite.`,
    },
    wellbeing: {
      general:
        'Estoy bien, gracias 😊 ¿Y usted? Estoy aquí para ayudarle, informarle y acompañarle. Dígame simplemente qué necesita.',
      withCase: (reference) =>
        `Estoy bien, gracias 😊 ¿Y usted? Su expediente ${reference} ya está verificado si quiere consultar su progreso.`,
    },
    thanks: {
      general: '¡Con mucho gusto! Si tiene otra pregunta, estoy aquí para ayudarle.',
      withCase: () => '¡Con mucho gusto! Si tiene otra pregunta sobre su expediente, estoy aquí.',
    },
    farewell: {
      general: '¡Hasta pronto! Vuelva cuando necesite ayuda.',
      withCase: () => '¡Hasta pronto! Podrá seguir consultando su expediente mientras la sesión siga activa.',
    },
    help: {
      general:
        'Puedo ayudarle con reparaciones y atención al cliente, devoluciones, entregas, garantías, reembolsos y seguimiento seguro de expedientes. Puede hablarme de forma natural.',
      withCase: (reference) =>
        `Puedo ayudarle a entender y seguir el expediente ${reference}, explicar su estado o siguiente paso y preparar un contacto con un asesor si hace falta. Puede hablarme de forma natural.`,
    },
  },
  ar: {
    greeting: {
      general:
        'مرحبًا! أنا هنا لمساعدتك والإجابة عن أسئلتك ومرافقتك في ما يخص الإصلاحات والطلبات والإرجاع والتوصيل وخدمة العملاء. كيف يمكنني مساعدتك؟',
      withCase: (reference) =>
        `مرحبًا! أنا هنا لمساعدتك. ملفك ${reference} تم التحقق منه بالفعل، ويمكنك سؤالي عن حالته أو الخطوة التالية أو أي تفاصيل تحتاجها.`,
    },
    wellbeing: {
      general:
        'أنا بخير، شكرًا 😊 وأنت؟ أنا هنا لمساعدتك والإجابة عن أسئلتك ومرافقتك. أخبرني فقط بما تحتاجه.',
      withCase: (reference) =>
        `أنا بخير، شكرًا 😊 وأنت؟ ملفك ${reference} تم التحقق منه إذا أردت معرفة آخر مستجداته.`,
    },
    thanks: {
      general: 'على الرحب والسعة! إذا كان لديك سؤال آخر فأنا هنا لمساعدتك.',
      withCase: () => 'على الرحب والسعة! إذا كان لديك سؤال آخر عن ملفك فأنا هنا.',
    },
    farewell: {
      general: 'إلى اللقاء! يمكنك العودة في أي وقت تحتاج فيه إلى المساعدة.',
      withCase: () => 'إلى اللقاء! يمكنك متابعة ملفك ما دامت جلستك نشطة.',
    },
    help: {
      general:
        'يمكنني مساعدتك في أسئلة الإصلاح وخدمة العملاء والإرجاع والتوصيل والضمان والاسترداد ومتابعة الملفات بعد التحقق الآمن. يمكنك التحدث معي بشكل طبيعي.',
      withCase: (reference) =>
        `يمكنني مساعدتك في فهم ومتابعة الملف ${reference} وشرح حالته أو الخطوة التالية وتجهيز التحويل إلى مستشار عند الحاجة. تحدث معي بشكل طبيعي.`,
    },
  },
};

export function casualReply(
  language: ConversationLanguage,
  intent: Exclude<CasualIntent, null>,
  currentCase: Pick<CaseRow, 'reference'> | null,
) {
  const reply = replies[language][intent];
  return currentCase ? reply.withCase(currentCase.reference) : reply.general;
}

const retrievalIntents: { query: string; patterns: RegExp[] }[] = [
  {
    query: 'suivi réparation',
    patterns: [
      /\b(repair|repair status|track.*repair|where.*repair)\b/i,
      /\b(reparatur|reparaturstatus|reparatur verfolgen)\b/i,
      /\b(reparacion|reparación|seguimiento.*repar)\b/i,
      /إصلاح|تصليح|متابعة.*إصلاح/u,
    ],
  },
  {
    query: 'retour échange',
    patterns: [
      /\b(return|exchange|send.*back)\b/i,
      /\b(ruckgabe|rückgabe|umtausch)\b/i,
      /\b(devolucion|devolución|cambio)\b/i,
      /إرجاع|استبدال/u,
    ],
  },
  {
    query: 'colis incomplet endommagé',
    patterns: [
      /\b(package|parcel).*(incomplete|missing|damaged)|\bmissing item\b/i,
      /\b(paket).*(unvollstandig|unvollständig|beschadigt|beschädigt|fehlt)\b/i,
      /\b(paquete).*(incompleto|falta|danado|dañado)\b/i,
      /طرد.*ناقص|شحنة.*ناقصة|تالف/u,
    ],
  },
  {
    query: 'remboursement',
    patterns: [
      /\b(refund|refunded|money back)\b/i,
      /\b(erstattung|ruckerstattung|rückerstattung)\b/i,
      /\b(reembolso)\b/i,
      /استرداد|إرجاع المال/u,
    ],
  },
  {
    query: 'livraison retard incident',
    patterns: [
      /\b(delivery|shipment|shipping|late delivery|delayed)\b/i,
      /\b(lieferung|versand|verspatet|verspätet)\b/i,
      /\b(entrega|envio|envío|retraso)\b/i,
      /توصيل|شحن|تأخر/u,
    ],
  },
  {
    query: 'garantie prise en charge',
    patterns: [
      /\b(warranty|covered|coverage)\b/i,
      /\b(garantie|gewahrleistung|gewährleistung)\b/i,
      /\b(garantia|garantía|cobertura)\b/i,
      /ضمان|تغطية/u,
    ],
  },
  {
    query: 'devis réparation',
    patterns: [
      /\b(quote|estimate|repair cost)\b/i,
      /\b(kostenvoranschlag|reparaturkosten)\b/i,
      /\b(presupuesto|coste.*repar)\b/i,
      /عرض سعر|تكلفة.*إصلاح/u,
    ],
  },
  {
    query: 'attente pièce indisponible',
    patterns: [
      /\b(waiting.*part|replacement part|part unavailable|spare part)\b/i,
      /\b(ersatzteil|teil.*nicht verfugbar|teil.*nicht verfügbar)\b/i,
      /\b(pieza.*espera|pieza.*no disponible|repuesto)\b/i,
      /قطعة.*غيار|انتظار.*قطعة/u,
    ],
  },
  {
    query: 'paiement débit anomalie transaction',
    patterns: [
      /\b(payment|charged|debited|double charge|card declined)\b/i,
      /\b(zahlung|abgebucht|doppelt belastet|karte abgelehnt)\b/i,
      /\b(pago|cobrado|cargo doble|tarjeta rechazada)\b/i,
      /دفع|خصم|سحب|عملية.*مكررة/u,
    ],
  },
  {
    query: 'facture ticket justificatif achat',
    patterns: [
      /\b(invoice|receipt|proof of purchase)\b/i,
      /\b(rechnung|kassenbon|kaufbeleg)\b/i,
      /\b(factura|recibo|comprobante de compra)\b/i,
      /فاتورة|إيصال|إثبات الشراء/u,
    ],
  },
];

export function retrievalQuery(message: string): string {
  const text = message.trim();
  for (const intent of retrievalIntents)
    if (intent.patterns.some((pattern) => pattern.test(text))) return intent.query;
  return text;
}


export function asksAboutCurrentCase(message: string): boolean {
  const text = message.trim();
  return (
    /\b(mon|ma|mes)\b.{0,50}\b(dossier|reparation|réparation|commande|livraison|remboursement|retour|colis|devis)\b/i.test(text) ||
    /\b(ou en est|où en est|statut|prochaine etape|prochaine étape)\b/i.test(text) ||
    /\b(my|mine)\b.{0,50}\b(case|repair|order|delivery|refund|return|package|parcel|quote)\b/i.test(text) ||
    /\b(where is my|what is the status of my|what's the status of my|whats the status of my)\b/i.test(text) ||
    /\b(mein|meine|meinen)\b.{0,50}\b(vorgang|fall|reparatur|bestellung|lieferung|erstattung|ruckgabe|rückgabe|paket)\b/i.test(text) ||
    /\b(wo ist mein|wie ist der status)\b/i.test(text) ||
    /\b(mi|mis)\b.{0,50}\b(expediente|caso|reparacion|reparación|pedido|entrega|reembolso|devolucion|devolución|paquete)\b/i.test(text) ||
    /\b(donde esta mi|dónde está mi|cual es el estado|cuál es el estado)\b/i.test(text) ||
    /(?:ملفي|طلبي|إصلاحي|شحن(?:تي)?|استردادي|طلبيتي)/u.test(text)
  );
}
