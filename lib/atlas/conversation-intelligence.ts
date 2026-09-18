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
  const raw = message.trim().toLowerCase();
  const text = raw
    .replace(/[’']/g, "'")
    .replace(/^(?:cc|coucou|slt|salut|hey|yo)\s*[,;:!.-]?\s+(?=\S)/iu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    /^(cv|cv\s*\?|ça va|ca va|sa va|tu vas bien|vous allez bien|tout va bien|how are you|how's it going|hows it going|you good|wie geht'?s|wie geht es dir|wie geht es ihnen|como estas|cómo estás|que tal|qué tal|كيف حالك|كيفك)[ !?.،؟]*$/iu.test(
      text,
    )
  )
    return 'wellbeing';

  if (
    /^(cc|coucou|slt|bonjour|bonsoir|salut|hello|hi|hey|yo|hallo|guten tag|hola|buenas|مرحبا|السلام عليكم)[ !?.،؟]*$/iu.test(
      raw,
    )
  )
    return 'greeting';

  if (
    /^(merci|merci beaucoup|thanks|thank you|thx|danke|vielen dank|gracias|muchas gracias|شكرا|شكرًا)[ !?.،؟]*$/iu.test(
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
    /^(tu peux faire quoi|vous pouvez faire quoi|comment peux tu m aider|comment pouvez vous m aider|aide moi|aidez moi|what can you do|how can you help me|help me|was kannst du|wie konnen sie mir helfen|wie können sie mir helfen|que puedes hacer|qué puedes hacer|como puedes ayudarme|cómo puedes ayudarme|ماذا يمكنك أن تفعل|كيف يمكنك مساعدتي)[ !?.،؟]*$/iu.test(
      text,
    )
  )
    return 'help';

  return null;
}

export function wantsAnotherCase(message: string): boolean {
  const text = message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return (
    /\b(autre|different|nouveau)\b.{0,30}\b(dossier|sav|commande|retour|reclamation)\b/.test(text) ||
    /\b(dossier|sav|commande|retour|reclamation)\b.{0,30}\b(autre|different|nouveau)\b/.test(text) ||
    /\b(pas|non)\b.{0,20}\b(ce|cet|celui|dossier)\b/.test(text) ||
    /\b(changer|change|consulter|voir|renseigner|renseignement).{0,35}\b(dossier|autre dossier)\b/.test(text) ||
    /\b(another|different|other|new)\b.{0,25}\b(case|order|repair|return)\b/i.test(message) ||
    /\b(not|no)\b.{0,15}\b(this|that)\b.{0,15}\b(case|order|repair|return)\b/i.test(message) ||
    (/\b(anderen|anderer|anderes|neuen)\b.{0,25}\b(vorgang|fall|bestellung|reparatur)\b/i.test(message) ||
      /\b(vorgang|fall|bestellung|reparatur)\b.{0,30}\b(anderen|anderer|anderes|neuen)\b/i.test(message) ||
      /\b(nicht|kein)\b.{0,20}\b(diesen|dieser|diese)\b.{0,20}\b(vorgang|fall|bestellung|reparatur)\b/i.test(message)) ||
    /\b(otro|otra|distinto|diferente|nuevo)\b.{0,25}\b(expediente|caso|pedido|reparacion|reparación)\b/i.test(message) ||
    /(?:ملف|طلب).{0,12}(?:آخر|اخر)|(?:ليس|مو|مش).{0,12}(?:هذا|هاذا).{0,12}(?:الملف|الطلب)/u.test(message)
  );
}

export function anotherCaseReply(
  language: ConversationLanguage,
  currentReference?: string | null,
): string {
  const reference = currentReference ? ` ${currentReference}` : '';
  const replies: Record<ConversationLanguage, string> = {
    fr: `Bien sûr. Je ne vais pas utiliser le dossier${reference} pour cette demande. Choisissez l’autre dossier que vous souhaitez consulter ; s’il n’est pas encore vérifié, l’application vous demandera sa référence et son code d’accès sécurisé.`,
    en: `Of course. I won’t use case${reference} for this request. Choose the other case you want to view; if it has not been verified yet, the app will ask for its reference and secure access code.`,
    de: `Natürlich. Für diese Anfrage verwende ich den Vorgang${reference} nicht. Wählen Sie den anderen Vorgang aus; falls er noch nicht verifiziert ist, fragt die Anwendung nach Referenz und sicherem Zugangscode.`,
    es: `Claro. No utilizaré el expediente${reference} para esta consulta. Elija el otro expediente que quiere consultar; si aún no está verificado, la aplicación pedirá su referencia y código de acceso seguro.`,
    ar: `بالتأكيد. لن أستخدم الملف${reference} لهذا الطلب. اختر الملف الآخر الذي تريد الاطلاع عليه، وإذا لم يكن موثقًا بعد فسيطلب التطبيق مرجعه ورمز الدخول الآمن.`,
  };
  return replies[language];
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
  if (intent === 'help' && currentCase) return reply.withCase(currentCase.reference);
  return reply.general;
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
  const language = detectConversationLanguage(text);
  if (language === 'fr') return text;
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


const serviceIntentPatterns: { query: string; patterns: RegExp[] }[] = [
  {
    query: 'suivi réparation',
    patterns: [
      /\b(suiv(?:re|i)|avancement|statut).{0,35}\b(reparation|réparation|sav)\b/i,
      /\b(reparation|réparation|sav)\b.{0,35}\b(suiv(?:re|i)|avancement|statut)\b/i,
      /\b(repair|repair status|track.*repair|where.*repair)\b/i,
      /\b(reparatur|reparaturstatus|reparatur verfolgen)\b/i,
      /\b(reparacion|reparación|seguimiento.*repar)\b/i,
      /إصلاح|تصليح|متابعة.*إصلاح/u,
    ],
  },
  {
    query: 'retour échange',
    patterns: [
      /\b(retour|retourner|échange|echanger|échanger)\b/i,
      /\b(return|exchange|send.*back)\b/i,
      /\b(ruckgabe|rückgabe|umtausch)\b/i,
      /\b(devolucion|devolución|cambio)\b/i,
      /إرجاع|استبدال/u,
    ],
  },
  {
    query: 'colis incomplet endommagé',
    patterns: [
      /\b(colis|commande).{0,30}\b(incomplet|manquant|endommag|abim|abîm)\w*\b/i,
      /\b(package|parcel).*(incomplete|missing|damaged)|\bmissing item\b/i,
      /\b(paket).*(unvollstandig|unvollständig|beschadigt|beschädigt|fehlt)\b/i,
      /\b(paquete).*(incompleto|falta|danado|dañado)\b/i,
      /طرد.*ناقص|شحنة.*ناقصة|تالف/u,
    ],
  },
  {
    query: 'remboursement',
    patterns: [
      /\b(remboursement|rembours|rembourser)\w*\b/i,
      /\b(refund|refunded|money back)\b/i,
      /\b(erstattung|ruckerstattung|rückerstattung)\b/i,
      /\b(reembolso)\b/i,
      /استرداد|إرجاع المال/u,
    ],
  },
  {
    query: 'livraison retard incident',
    patterns: [
      /\b(livraison|livrer|transport|expedition|expédition).{0,30}\b(retard|incident|bloqu|perdu|date|suivi)\w*\b/i,
      /\b(delivery|shipment|shipping|late delivery|delayed)\b/i,
      /\b(lieferung|versand|verspatet|verspätet)\b/i,
      /\b(entrega|envio|envío|retraso)\b/i,
      /توصيل|شحن|تأخر/u,
    ],
  },
  {
    query: 'garantie prise en charge',
    patterns: [
      /\b(garantie|prise en charge|couvert|couverture)\b/i,
      /\b(warranty|covered|coverage)\b/i,
      /\b(garantie|gewahrleistung|gewährleistung)\b/i,
      /\b(garantia|garantía|cobertura)\b/i,
      /ضمان|تغطية/u,
    ],
  },
  {
    query: 'devis réparation',
    patterns: [
      /\b(devis|cout de reparation|coût de réparation|prix de reparation|prix de réparation)\b/i,
      /\b(quote|estimate|repair cost)\b/i,
      /\b(kostenvoranschlag|reparaturkosten)\b/i,
      /\b(presupuesto|coste.*repar)\b/i,
      /عرض سعر|تكلفة.*إصلاح/u,
    ],
  },
  {
    query: 'attente pièce indisponible',
    patterns: [
      /\b(piece|pièce|pieces|pièces).{0,30}\b(attente|indisponible|command|rupture|arriv)\w*\b/i,
      /\b(attente|attend|attendre).{0,30}\b(piece|pièce)\b/i,
      /\b(waiting.*part|replacement part|part unavailable|spare part)\b/i,
      /\b(ersatzteil|teil.*nicht verfugbar|teil.*nicht verfügbar)\b/i,
      /\b(pieza.*espera|pieza.*no disponible|repuesto)\b/i,
      /قطعة.*غيار|انتظار.*قطعة/u,
    ],
  },
  {
    query: 'paiement débit anomalie transaction',
    patterns: [
      /\b(paiement|debit|débit|carte|transaction).{0,30}\b(refus|double|debite|débité|anomal|bloqu)\w*\b/i,
      /\b(payment|charged|debited|double charge|card declined)\b/i,
      /\b(zahlung|abgebucht|doppelt belastet|karte abgelehnt)\b/i,
      /\b(pago|cobrado|cargo doble|tarjeta rechazada)\b/i,
      /دفع|خصم|سحب|عملية.*مكررة/u,
    ],
  },
  {
    query: 'facture ticket justificatif achat',
    patterns: [
      /\b(facture|ticket|justificatif|preuve d'achat|preuve d’achat|duplicata)\b/i,
      /\b(invoice|receipt|proof of purchase)\b/i,
      /\b(rechnung|kassenbon|kaufbeleg)\b/i,
      /\b(factura|recibo|comprobante de compra)\b/i,
      /فاتورة|إيصال|إثبات الشراء/u,
    ],
  },
];

export function serviceIntentQuery(message: string): string | null {
  const text = message.trim();
  const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const intent of serviceIntentPatterns)
    if (intent.patterns.some((pattern) => pattern.test(text) || pattern.test(plain)))
      return intent.query;
  return null;
}

const contextualFollowUp =
  /^(?:et\b|et ça|et ca|du coup|alors|ensuite|après|apres|combien de temps|quand|pourquoi|comment ça|comment ca|what about|and then|how long|when|why|und dann|wie lange|wann|y luego|cuanto tarda|cuánto tarda|cuando|cuándo|وماذا|ثم|كم يستغرق|متى)/iu;

export function contextualRetrievalQuery(
  message: string,
  previousUserMessages: string[] = [],
): string {
  const direct = serviceIntentQuery(message);
  if (direct) return direct;
  const text = message.trim();
  if (text.length <= 120 && contextualFollowUp.test(text)) {
    for (const previous of [...previousUserMessages].reverse()) {
      const priorIntent = serviceIntentQuery(previous);
      if (priorIntent) return `${priorIntent} ${text}`.slice(0, 500);
    }
  }
  return retrievalQuery(message);
}

export type ConversationRoute = 'small_talk' | 'switch_case' | 'business' | 'open';

const broadBusinessVocabulary =
  /\b(sav|dossier|commande|produit|article|reparation|réparation|retour|échange|echange|livraison|colis|remboursement|garantie|devis|paiement|facture|ticket|magasin|conseiller|réclamation|reclamation|repair|case|order|product|return|exchange|delivery|package|parcel|refund|warranty|quote|payment|invoice|advisor|complaint|reparatur|vorgang|bestellung|ruckgabe|rückgabe|lieferung|paket|erstattung|kostenvoranschlag|berater|reklamation|reparacion|reparación|expediente|pedido|devolucion|devolución|entrega|paquete|reembolso|garantía|garantia|presupuesto|asesor|reclamacion|reclamación)\b/i;

export function conversationRoute(
  message: string,
  previousUserMessages: string[] = [],
): ConversationRoute {
  if (wantsAnotherCase(message)) return 'switch_case';
  if (casualIntent(message)) return 'small_talk';
  if (
    asksAboutCurrentCase(message) ||
    serviceIntentQuery(message) ||
    broadBusinessVocabulary.test(message) ||
    /(?:إصلاح|طلب|منتج|إرجاع|استبدال|توصيل|شحن|استرداد|ضمان|فاتورة|مستشار|شكوى|ملف)/u.test(message)
  )
    return 'business';

  if (message.trim().length <= 120 && contextualFollowUp.test(message.trim())) {
    for (const previous of [...previousUserMessages].reverse())
      if (serviceIntentQuery(previous) || broadBusinessVocabulary.test(previous)) return 'business';
  }
  return 'open';
}


const statusLabels: Record<ConversationLanguage, Record<string, string>> = {
  fr: {
    deposited: 'Déposé en magasin', received: 'Reçu au SAV', diagnosis: 'Diagnostic en cours',
    waiting_part: 'En attente de pièce', quote_pending: 'Devis à valider', repairing: 'En réparation',
    repaired: 'Réparation terminée', replacement: 'Échange validé', shipping: 'Retour en transport',
    ready: 'Disponible au retrait', delivered: 'Livré', preparing: 'En préparation',
    transit: 'En livraison', delayed: 'Livraison retardée', return_requested: 'Retour demandé',
    return_approved: 'Retour autorisé', return_received: 'Retour réceptionné',
    refund_pending: 'Remboursement en traitement', refunded: 'Remboursé', open: 'Réclamation ouverte',
    reviewing: 'En cours d’examen', resolved: 'Réclamation résolue', declined: 'Devis refusé',
  },
  en: {
    deposited: 'Dropped off in store', received: 'Received by after-sales service', diagnosis: 'Diagnosis in progress',
    waiting_part: 'Waiting for a part', quote_pending: 'Quote awaiting approval', repairing: 'Being repaired',
    repaired: 'Repair completed', replacement: 'Replacement approved', shipping: 'Return shipment in progress',
    ready: 'Ready for pickup', delivered: 'Delivered', preparing: 'Being prepared',
    transit: 'Out for delivery', delayed: 'Delivery delayed', return_requested: 'Return requested',
    return_approved: 'Return approved', return_received: 'Return received',
    refund_pending: 'Refund being processed', refunded: 'Refunded', open: 'Complaint open',
    reviewing: 'Under review', resolved: 'Complaint resolved', declined: 'Quote declined',
  },
  de: {
    deposited: 'Im Geschäft abgegeben', received: 'Beim Kundendienst eingegangen', diagnosis: 'Diagnose läuft',
    waiting_part: 'Warten auf ein Ersatzteil', quote_pending: 'Kostenvoranschlag wartet auf Freigabe', repairing: 'In Reparatur',
    repaired: 'Reparatur abgeschlossen', replacement: 'Austausch bestätigt', shipping: 'Rücktransport läuft',
    ready: 'Abholbereit', delivered: 'Geliefert', preparing: 'In Vorbereitung',
    transit: 'In Zustellung', delayed: 'Lieferung verspätet', return_requested: 'Rückgabe angefordert',
    return_approved: 'Rückgabe genehmigt', return_received: 'Rückgabe eingegangen',
    refund_pending: 'Erstattung wird bearbeitet', refunded: 'Erstattet', open: 'Reklamation offen',
    reviewing: 'In Prüfung', resolved: 'Reklamation abgeschlossen', declined: 'Kostenvoranschlag abgelehnt',
  },
  es: {
    deposited: 'Depositado en tienda', received: 'Recibido por posventa', diagnosis: 'Diagnóstico en curso',
    waiting_part: 'En espera de una pieza', quote_pending: 'Presupuesto pendiente de aprobación', repairing: 'En reparación',
    repaired: 'Reparación terminada', replacement: 'Cambio aprobado', shipping: 'Transporte de retorno en curso',
    ready: 'Listo para recoger', delivered: 'Entregado', preparing: 'En preparación',
    transit: 'En reparto', delayed: 'Entrega retrasada', return_requested: 'Devolución solicitada',
    return_approved: 'Devolución autorizada', return_received: 'Devolución recibida',
    refund_pending: 'Reembolso en proceso', refunded: 'Reembolsado', open: 'Reclamación abierta',
    reviewing: 'En revisión', resolved: 'Reclamación resuelta', declined: 'Presupuesto rechazado',
  },
  ar: {
    deposited: 'تم الإيداع في المتجر', received: 'تم الاستلام لدى خدمة ما بعد البيع', diagnosis: 'التشخيص جارٍ',
    waiting_part: 'في انتظار قطعة غيار', quote_pending: 'عرض السعر بانتظار الموافقة', repairing: 'قيد الإصلاح',
    repaired: 'اكتمل الإصلاح', replacement: 'تمت الموافقة على الاستبدال', shipping: 'الإرجاع قيد النقل',
    ready: 'جاهز للاستلام', delivered: 'تم التوصيل', preparing: 'قيد التجهيز',
    transit: 'قيد التوصيل', delayed: 'التوصيل متأخر', return_requested: 'تم طلب الإرجاع',
    return_approved: 'تمت الموافقة على الإرجاع', return_received: 'تم استلام المرتجع',
    refund_pending: 'الاسترداد قيد المعالجة', refunded: 'تم الاسترداد', open: 'الشكوى مفتوحة',
    reviewing: 'قيد المراجعة', resolved: 'تم حل الشكوى', declined: 'تم رفض عرض السعر',
  },
};

function formatMoney(cents: number, language: ConversationLanguage) {
  const locale = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE', es: 'es-ES', ar: 'ar' }[language];
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export function localizedCaseReply(
  language: ConversationLanguage,
  currentCase: Pick<
    CaseRow,
    'reference' | 'product' | 'status' | 'quote_cents' | 'refund_cents' | 'store' | 'updated_at'
  >,
): string {
  const status = statusLabels[language][currentCase.status] ?? currentCase.status;
  const amount =
    currentCase.status === 'quote_pending' && Number.isSafeInteger(currentCase.quote_cents) && currentCase.quote_cents! >= 0
      ? formatMoney(currentCase.quote_cents!, language)
      : (currentCase.status === 'refund_pending' || currentCase.status === 'refunded') &&
          Number.isSafeInteger(currentCase.refund_cents) && currentCase.refund_cents! >= 0
        ? formatMoney(currentCase.refund_cents!, language)
        : null;

  if (language === 'en') {
    let text = `Your verified case ${currentCase.reference} for ${currentCase.product} is currently “${status}”.`;
    if (currentCase.status === 'waiting_part') text += ' The repair is waiting for the required part; I will not invent a delivery date if none is recorded.';
    if (currentCase.status === 'quote_pending') text += amount ? ` The recorded quote is ${amount} and is awaiting your decision.` : ' The quote amount is not recorded.';
    if (currentCase.status === 'ready') text += ` The item is recorded as ready for pickup at ${currentCase.store}.`;
    if (currentCase.status === 'delayed') text += ' The delivery is recorded as delayed; no new confirmed date should be assumed unless it appears in the case.';
    if (currentCase.status === 'refund_pending') text += amount ? ` The recorded refund amount is ${amount} and the refund is still being processed.` : ' The refund is still being processed.';
    if (currentCase.status === 'refunded') text += amount ? ` The case records a refund of ${amount} as completed.` : ' The case records the refund as completed.';
    return text;
  }
  if (language === 'de') {
    let text = `Ihr verifizierter Vorgang ${currentCase.reference} für ${currentCase.product} hat aktuell den Status „${status}“.`;
    if (currentCase.status === 'waiting_part') text += ' Die Reparatur wartet auf das benötigte Ersatzteil; ohne bestätigte Angabe nenne ich kein Lieferdatum.';
    if (currentCase.status === 'quote_pending') text += amount ? ` Der hinterlegte Kostenvoranschlag beträgt ${amount} und wartet auf Ihre Entscheidung.` : ' Der Betrag des Kostenvoranschlags ist nicht hinterlegt.';
    if (currentCase.status === 'ready') text += ` Der Artikel ist zur Abholung bei ${currentCase.store} vorgemerkt.`;
    if (currentCase.status === 'delayed') text += ' Die Lieferung ist als verspätet erfasst; ein neues Datum wird nur genannt, wenn es bestätigt im Vorgang steht.';
    return text;
  }
  if (language === 'es') {
    let text = `Su expediente verificado ${currentCase.reference} para ${currentCase.product} está actualmente en estado «${status}».`;
    if (currentCase.status === 'waiting_part') text += ' La reparación está esperando la pieza necesaria; no indicaré una fecha si no está confirmada en el expediente.';
    if (currentCase.status === 'quote_pending') text += amount ? ` El presupuesto registrado es de ${amount} y está pendiente de su decisión.` : ' El importe del presupuesto no está registrado.';
    if (currentCase.status === 'ready') text += ` El producto figura como listo para recoger en ${currentCase.store}.`;
    if (currentCase.status === 'delayed') text += ' La entrega figura como retrasada; no se debe suponer una nueva fecha si no está confirmada.';
    return text;
  }
  if (language === 'ar') {
    let text = `حالة ملفك الموثق ${currentCase.reference} الخاص بـ ${currentCase.product} هي حاليًا «${status}».`;
    if (currentCase.status === 'waiting_part') text += ' الإصلاح ينتظر قطعة الغيار المطلوبة، ولن أذكر تاريخًا غير مؤكد.';
    if (currentCase.status === 'quote_pending') text += amount ? ` عرض السعر المسجل هو ${amount} وينتظر قرارك.` : ' قيمة عرض السعر غير مسجلة.';
    if (currentCase.status === 'ready') text += ` المنتج مسجل كجاهز للاستلام من ${currentCase.store}.`;
    if (currentCase.status === 'delayed') text += ' التوصيل مسجل كمتأخر، ولن أفترض موعدًا جديدًا ما لم يكن مؤكدًا في الملف.';
    return text;
  }

  return `Votre dossier vérifié ${currentCase.reference} (${currentCase.product}) est à l’étape « ${status} ».`;
}

const procedureSummaries: Record<string, Record<Exclude<ConversationLanguage, 'fr'>, string>> = {
  'suivi réparation': {
    en: 'To track a repair, use the verified case status and its latest recorded update. If no date is recorded, no date should be guessed.',
    de: 'Für die Reparaturverfolgung wird der verifizierte Vorgangsstatus mit der letzten gespeicherten Aktualisierung verwendet. Fehlt ein Datum, wird keines erfunden.',
    es: 'Para seguir una reparación se utiliza el estado verificado del expediente y su última actualización registrada. Si no hay fecha, no se inventa ninguna.',
    ar: 'لمتابعة الإصلاح يتم الاعتماد على حالة الملف الموثق وآخر تحديث مسجل. إذا لم يوجد تاريخ مؤكد فلن يتم اختراع تاريخ.',
  },
  'retour échange': {
    en: 'A return or exchange must follow the published procedure applicable to the order and product. If eligibility cannot be confirmed, the case should be handed to an advisor rather than guessed.',
    de: 'Eine Rückgabe oder ein Umtausch richtet sich nach der veröffentlichten, für Bestellung und Produkt geltenden Regel. Wenn die Berechtigung nicht bestätigt werden kann, erfolgt eine Weiterleitung an einen Berater.',
    es: 'Una devolución o cambio debe seguir el procedimiento publicado aplicable al pedido y al producto. Si no se puede confirmar la elegibilidad, se deriva a un asesor.',
    ar: 'يجب أن يتبع الإرجاع أو الاستبدال الإجراء المنشور المطبق على الطلب والمنتج. إذا تعذر تأكيد الأهلية، يتم التحويل إلى مستشار بدل التخمين.',
  },
  'colis incomplet endommagé': {
    en: 'For an incomplete or damaged package, first identify what is missing or damaged and verify the order details. Any replacement, refund, or commercial decision must be confirmed by the authorized process.',
    de: 'Bei einem unvollständigen oder beschädigten Paket wird zuerst geklärt, was fehlt oder beschädigt ist, und die Bestellung geprüft. Ersatz, Erstattung oder Kulanz müssen über den autorisierten Prozess bestätigt werden.',
    es: 'Si un paquete está incompleto o dañado, primero se identifica qué falta o está dañado y se verifican los datos del pedido. Cualquier sustitución o reembolso debe confirmarse por el proceso autorizado.',
    ar: 'إذا كانت الشحنة ناقصة أو تالفة، يتم أولًا تحديد ما هو مفقود أو تالف والتحقق من بيانات الطلب. أي استبدال أو استرداد يجب أن يؤكده المسار المعتمد.',
  },
  remboursement: {
    en: 'Refund tracking distinguishes between a refund being requested, approved, issued, or completed. Only the amount and timing actually recorded in the case should be stated.',
    de: 'Bei der Erstattungsverfolgung wird zwischen beantragt, bestätigt, ausgeführt und abgeschlossen unterschieden. Betrag und Zeitpunkt werden nur genannt, wenn sie im Vorgang gespeichert sind.',
    es: 'El seguimiento del reembolso distingue entre solicitado, aprobado, emitido y completado. Solo se indican el importe y los plazos realmente registrados.',
    ar: 'تتبع الاسترداد يميز بين الطلب والموافقة والإصدار والإتمام. لا يتم ذكر مبلغ أو موعد إلا إذا كان مسجلًا فعليًا.',
  },
  'livraison retard incident': {
    en: 'Delivery information is based on the latest recorded tracking event. A date is only presented as confirmed when the source explicitly confirms it; otherwise it remains an estimate or unavailable.',
    de: 'Lieferinformationen beruhen auf dem letzten gespeicherten Tracking-Ereignis. Ein Datum gilt nur dann als bestätigt, wenn die Quelle es ausdrücklich bestätigt.',
    es: 'La información de entrega se basa en el último evento de seguimiento registrado. Una fecha solo se presenta como confirmada cuando la fuente la confirma expresamente.',
    ar: 'تعتمد معلومات التوصيل على آخر حدث تتبع مسجل. لا يُذكر أي موعد على أنه مؤكد إلا إذا أكدته المصدر صراحة.',
  },
  'garantie prise en charge': {
    en: 'Warranty and coverage answers must come from the recorded case decision and the applicable published procedure. No coverage, free repair, refund, or legal right should be invented.',
    de: 'Aussagen zu Garantie und Kostenübernahme müssen aus der gespeicherten Vorgangsentscheidung und der geltenden veröffentlichten Regel stammen. Es werden keine Ansprüche oder Leistungen erfunden.',
    es: 'Las respuestas sobre garantía y cobertura deben proceder de la decisión registrada en el expediente y del procedimiento publicado aplicable. No se inventan coberturas ni derechos.',
    ar: 'يجب أن تعتمد إجابات الضمان والتغطية على القرار المسجل في الملف والإجراء المنشور المطبق. لا يتم اختراع أي تغطية أو حق.',
  },
  'devis réparation': {
    en: 'A repair quote must use the amount actually recorded in the case. No paid repair should be presented as started before the customer’s explicit confirmation.',
    de: 'Ein Reparaturkostenvoranschlag darf nur den tatsächlich gespeicherten Betrag verwenden. Eine kostenpflichtige Reparatur wird nicht vor ausdrücklicher Zustimmung als gestartet dargestellt.',
    es: 'Un presupuesto de reparación debe utilizar el importe realmente registrado. No se presenta una reparación de pago como iniciada antes de la confirmación explícita del cliente.',
    ar: 'يجب أن يعتمد عرض سعر الإصلاح على المبلغ المسجل فعليًا. لا يتم اعتبار الإصلاح المدفوع قد بدأ قبل موافقة العميل الصريحة.',
  },
  'attente pièce indisponible': {
    en: 'When a repair is waiting for a part, the intervention remains blocked until the required part is received. A supply date is only stated if it is actually recorded.',
    de: 'Wenn eine Reparatur auf ein Ersatzteil wartet, bleibt die Arbeit bis zum Eingang des benötigten Teils blockiert. Ein Lieferdatum wird nur genannt, wenn es tatsächlich gespeichert ist.',
    es: 'Cuando una reparación espera una pieza, la intervención queda bloqueada hasta recibirla. Solo se indica una fecha de suministro si está realmente registrada.',
    ar: 'عندما ينتظر الإصلاح قطعة غيار، يبقى التدخل متوقفًا حتى وصول القطعة المطلوبة. لا يُذكر تاريخ التوريد إلا إذا كان مسجلًا.',
  },
  'paiement débit anomalie transaction': {
    en: 'For a payment anomaly, first distinguish between a declined payment, pending authorization, confirmed debit, or duplicate charge. Never share or request full card details, PINs, or banking passwords.',
    de: 'Bei einer Zahlungsabweichung wird zuerst zwischen Ablehnung, ausstehender Autorisierung, bestätigter Abbuchung oder Doppelbelastung unterschieden. Vollständige Kartendaten, PIN oder Banking-Passwörter werden nie angefordert.',
    es: 'Ante una anomalía de pago, primero se distingue entre pago rechazado, autorización pendiente, débito confirmado o cargo duplicado. Nunca se solicitan datos completos de tarjeta, PIN o contraseñas bancarias.',
    ar: 'عند وجود مشكلة في الدفع، يتم أولًا التمييز بين الرفض أو التفويض المعلق أو الخصم المؤكد أو الخصم المكرر. لا يتم طلب بيانات البطاقة الكاملة أو الرقم السري أو كلمات مرور البنك.',
  },
  'facture ticket justificatif achat': {
    en: 'For an invoice, receipt, or proof of purchase, the system should first verify whether the document actually exists. If it is unavailable, an advisor may need to check whether a duplicate can be issued.',
    de: 'Bei Rechnung, Kassenbon oder Kaufbeleg wird zuerst geprüft, ob das Dokument tatsächlich vorhanden ist. Falls nicht, kann ein Berater die Möglichkeit eines Duplikats prüfen.',
    es: 'Para una factura, recibo o justificante de compra, primero se verifica si el documento existe realmente. Si no está disponible, un asesor puede comprobar si es posible emitir un duplicado.',
    ar: 'بالنسبة للفاتورة أو الإيصال أو إثبات الشراء، يتم أولًا التحقق مما إذا كان المستند موجودًا فعليًا. وإذا لم يكن متاحًا فقد يحتاج المستشار إلى التحقق من إمكانية إصدار نسخة.',
  },
};

export function localizedProcedureReply(
  language: ConversationLanguage,
  canonicalQuery: string,
  fallbackFrench: string,
): string {
  if (language === 'fr') return fallbackFrench;
  return procedureSummaries[canonicalQuery]?.[language] ??
    ({
      en: 'I found a published procedure related to your question. I can use it to guide you, but I will not invent any detail that is not supported by the procedure or your verified case.',
      de: 'Ich habe eine veröffentlichte Regel gefunden, die zu Ihrer Frage passt. Ich kann Sie damit unterstützen, ohne nicht belegte Details zu erfinden.',
      es: 'He encontrado un procedimiento publicado relacionado con su pregunta. Puedo utilizarlo para orientarle sin inventar detalles que no estén respaldados.',
      ar: 'وجدت إجراءً منشورًا مرتبطًا بسؤالك ويمكنني استخدامه لإرشادك دون اختراع أي تفاصيل غير مدعومة.',
    } as const)[language];
}

export function localizedWarrantyReply(
  language: ConversationLanguage,
  currentCase: Pick<CaseRow, 'reference' | 'warranty'>,
  procedureText: string,
): string {
  if (language === 'fr') return `Décision enregistrée pour ${currentCase.reference} : ${currentCase.warranty}.\n\n${procedureText}`;
  const warranty = currentCase.warranty === 'Prise en charge validée'
    ? { en: 'coverage approved', de: 'Kostenübernahme bestätigt', es: 'cobertura aprobada', ar: 'تمت الموافقة على التغطية' }[language]
    : currentCase.warranty === 'Sans objet'
      ? { en: 'not applicable', de: 'nicht anwendbar', es: 'no aplicable', ar: 'غير منطبق' }[language]
      : { en: 'not covered', de: 'nicht übernommen', es: 'no cubierto', ar: 'غير مشمول' }[language];
  const intro = {
    en: `The recorded warranty decision for case ${currentCase.reference} is: ${warranty}.`,
    de: `Die gespeicherte Garantieentscheidung für Vorgang ${currentCase.reference} lautet: ${warranty}.`,
    es: `La decisión de garantía registrada para el expediente ${currentCase.reference} es: ${warranty}.`,
    ar: `قرار الضمان المسجل للملف ${currentCase.reference} هو: ${warranty}.`,
  } as const;
  return intro[language] + ' ' + localizedProcedureReply(language, 'garantie prise en charge', procedureText);
}
