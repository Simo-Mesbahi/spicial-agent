import type { CaseFacts } from './case-adapter';
import { localizedStatusLabel, type ConversationLanguage } from './conversation-intelligence';

export function renderCaseFacts(facts: CaseFacts, language: ConversationLanguage) {
  const labels = {
    fr: [
      'Dossier vérifié',
      'État enregistré',
      'Produit',
      'Devis enregistré',
      'Remboursement enregistré',
      'Estimation, non confirmée',
      'Aucune date confirmée',
      'Dernière mise à jour',
      'Garantie enregistrée',
    ],
    en: [
      'Verified case',
      'Recorded status',
      'Product',
      'Recorded quote',
      'Recorded refund',
      'Estimate, not confirmed',
      'No confirmed date',
      'Last update',
      'Recorded warranty',
    ],
    de: [
      'Verifizierter Vorgang',
      'Erfasster Status',
      'Produkt',
      'Erfasster Kostenvoranschlag',
      'Erfasste Erstattung',
      'Schätzung, nicht bestätigt',
      'Kein bestätigtes Datum',
      'Letzte Aktualisierung',
      'Erfasste Garantie',
    ],
    es: [
      'Expediente verificado',
      'Estado registrado',
      'Producto',
      'Presupuesto registrado',
      'Reembolso registrado',
      'Estimación, no confirmada',
      'Sin fecha confirmada',
      'Última actualización',
      'Garantía registrada',
    ],
    ar: [
      'الملف الموثق',
      'الحالة المسجلة',
      'المنتج',
      'عرض السعر المسجل',
      'الاسترداد المسجل',
      'تقدير غير مؤكد',
      'لا يوجد تاريخ مؤكد',
      'آخر تحديث',
      'الضمان المسجل',
    ],
  }[language];
  const locale = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE', es: 'es-ES', ar: 'ar' }[language];
  const money = (amount: { cents: number; currency: string }) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: amount.currency }).format(
      amount.cents / 100,
    );
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(value),
    );
  return [
    `${labels[0]} : ${facts.reference}`,
    `${labels[1]} : ${localizedStatusLabel(language, facts.status)}`,
    facts.product ? `${labels[2]} : ${facts.product}` : '',
    facts.quote ? `${labels[3]} : ${money(facts.quote)}` : '',
    facts.refund ? `${labels[4]} : ${money(facts.refund)}` : '',
    facts.warranty.label ? `${labels[8]} : ${facts.warranty.label}` : '',
    facts.estimatedAt ? `${labels[5]} : ${date(facts.estimatedAt)}` : labels[6],
    `${labels[7]} : ${date(facts.updatedAt)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
