import type { CaseRow } from './api';
import { caseBrief } from './case-brief';
import { nextStep, normalized } from './domain';
import { localizedStatusLabel, type ConversationLanguage } from './conversation-intelligence';

export function requestedResponseDetails(message: string) {
  const text = normalized(message);
  return {
    languages: /\b(langues?|languages?|sprachen|idiomas?)\b|لغات|اللغات/u.test(text),
    table: /\b(tableau[x]?|table|tabelle|tabla)\b|جدول/u.test(text),
  };
}

const copy: Record<
  ConversationLanguage,
  {
    languages: string;
    table: string;
    headers: string[];
    current: string;
    planned: string;
    unavailable: string;
    timing: string;
    decision: string;
    advisor: string;
  }
> = {
  fr: {
    languages:
      'Je peux vous répondre en français, anglais, allemand, espagnol et arabe. Vous pouvez me demander de changer de langue.',
    table:
      'Oui, je peux présenter la réponse sous forme de tableau. Voici l’état actuel et les étapes suivantes du parcours simulé : les étapes prévues ne sont pas encore réalisées et ne constituent pas une date garantie.',
    headers: ['Étape', 'Situation'],
    current: 'État actuel enregistré',
    planned: 'Suite prévue dans la démonstration, pas encore réalisée',
    unavailable: 'Aucune étape suivante enregistrée.',
    timing: 'Aucun délai confirmé enregistré.',
    decision:
      'La suite dépend de votre décision explicite sur le devis. Aucune réparation n’est lancée par cette réponse.',
    advisor: 'La suite est à convenir avec un conseiller.',
  },
  en: {
    languages:
      'I can answer in French, English, German, Spanish and Arabic. You can ask me to change language.',
    table:
      'Yes, I can use a table. Here is the recorded status and the next stages in the simulated process. Planned stages have not happened yet and are not a guaranteed date.',
    headers: ['Stage', 'Situation'],
    current: 'Current recorded status',
    planned: 'Planned in the demo, not completed',
    unavailable: 'No next stage is recorded.',
    timing: 'No confirmed time is recorded.',
    decision:
      'The next step requires your explicit quote decision. This reply does not start a repair.',
    advisor: 'The next step must be agreed with an advisor.',
  },
  de: {
    languages:
      'Ich kann auf Französisch, Englisch, Deutsch, Spanisch und Arabisch antworten. Sie können mich bitten, die Sprache zu wechseln.',
    table:
      'Ja, ich kann eine Tabelle verwenden. Sie zeigt den erfassten Status und die nächsten Schritte im simulierten Ablauf. Geplante Schritte sind noch nicht erfolgt und garantieren kein Datum.',
    headers: ['Schritt', 'Situation'],
    current: 'Aktuell erfasster Status',
    planned: 'In der Demo geplant, noch nicht erfolgt',
    unavailable: 'Kein weiterer Schritt ist erfasst.',
    timing: 'Kein bestätigter Termin ist erfasst.',
    decision:
      'Die Fortsetzung erfordert Ihre ausdrückliche Entscheidung zum Kostenvoranschlag. Diese Antwort startet keine Reparatur.',
    advisor: 'Der nächste Schritt ist mit einem Berater zu vereinbaren.',
  },
  es: {
    languages:
      'Puedo responder en francés, inglés, alemán, español y árabe. Puede pedirme que cambie de idioma.',
    table:
      'Sí, puedo usar una tabla. Muestra el estado registrado y las siguientes etapas del proceso simulado. Las etapas previstas aún no se han realizado y no garantizan una fecha.',
    headers: ['Etapa', 'Situación'],
    current: 'Estado actual registrado',
    planned: 'Prevista en la demostración, aún no realizada',
    unavailable: 'No hay otra etapa registrada.',
    timing: 'No hay un plazo confirmado registrado.',
    decision:
      'La siguiente etapa requiere su decisión explícita sobre el presupuesto. Esta respuesta no inicia una reparación.',
    advisor: 'La siguiente etapa debe acordarse con un asesor.',
  },
  ar: {
    languages:
      'يمكنني الرد بالفرنسية والإنجليزية والألمانية والإسبانية والعربية. يمكنك أن تطلب مني تغيير اللغة.',
    table:
      'نعم، يمكنني عرض الإجابة في جدول. يعرض الحالة المسجلة والمراحل التالية في المسار التجريبي. المراحل المخططة لم تُنفذ بعد ولا تضمن موعدًا.',
    headers: ['المرحلة', 'الحالة'],
    current: 'الحالة الحالية المسجلة',
    planned: 'مخططة في العرض التجريبي ولم تُنفذ بعد',
    unavailable: 'لا توجد مرحلة تالية مسجلة.',
    timing: 'لا يوجد موعد مؤكد مسجل.',
    decision: 'المرحلة التالية تتطلب قرارك الصريح بشأن عرض السعر. هذه الإجابة لا تبدأ إصلاحًا.',
    advisor: 'يجب الاتفاق على المرحلة التالية مع مستشار.',
  },
};

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

/** Presentation uses only an already-authorized case and authored app capabilities.
 * It never copies model statements into verified status, timing or actions. */
export function completeRequestedDetails(
  message: string,
  content: string,
  currentCase: CaseRow | null,
  language: ConversationLanguage,
) {
  const requested = requestedResponseDetails(message);
  const text = copy[language];
  const sections = [content];
  if (requested.languages) sections.push(text.languages);
  if (requested.table && currentCase) {
    const rows = [[localizedStatusLabel(language, currentCase.status), text.current]];
    const seen = new Set([currentCase.status]);
    let status = nextStep(currentCase.kind, currentCase.status);
    while (status && !seen.has(status) && rows.length < 12) {
      seen.add(status);
      rows.push([localizedStatusLabel(language, status), text.planned]);
      status = nextStep(currentCase.kind, status);
    }
    sections.push(text.table);
    sections.push(
      [
        `| ${text.headers.map(cell).join(' | ')} |`,
        '| --- | --- |',
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ].join('\n'),
    );
    if (currentCase.status === 'quote_pending') sections.push(text.decision);
    else if (currentCase.status === 'declined') sections.push(text.advisor);
    else if (rows.length === 1) sections.push(text.unavailable);
    if (!currentCase.estimate) sections.push(text.timing);
    if (language === 'fr') sections.push(caseBrief(currentCase).customerStep);
  }
  return sections.join('\n\n');
}

export type ResponseBlock =
  { kind: 'text'; text: string } | { kind: 'table'; headers: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((value) => value.trim().replace(/\\\|/g, '|'));

/** Bounded Markdown table support. HTML and links remain literal text. */
export function responseBlocks(content: string): ResponseBlock[] {
  const lines = content.split('\n');
  const blocks: ResponseBlock[] = [];
  let prose: string[] = [];
  const flush = () => {
    const text = prose.join('\n').trim();
    if (text) blocks.push({ kind: 'text', text });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const headers = cells(lines[i]);
    const separator = cells(lines[i + 1] ?? '');
    if (
      lines[i].includes('|') &&
      headers.length >= 2 &&
      headers.length <= 12 &&
      separator.length === headers.length &&
      separator.every((value) => /^:?-{3,}:?$/.test(value))
    ) {
      const rows: string[][] = [];
      let end = i + 2;
      while (end < lines.length && lines[end].includes('|')) {
        rows.push(cells(lines[end++]));
      }
      if (
        rows.length > 0 &&
        rows.length <= 60 &&
        rows.every((row) => row.length === headers.length)
      ) {
        flush();
        blocks.push({ kind: 'table', headers, rows });
        i = end - 1;
        continue;
      }
    }
    prose.push(lines[i]);
  }
  flush();
  return blocks;
}
