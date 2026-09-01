export const CONTACT_RECIPIENT = 'mohammed.elmesbahi31@gmail.com';

export const DEFAULT_CONTACT_SUBJECT = 'Demande SAV / service client';
export const DEFAULT_CONTACT_MESSAGE = `Bonjour,

Je souhaite être accompagné par le SAV ou le service client.

Ma demande :
[Décrivez votre besoin ici]

Merci.`;

export type ContactDraft = {
  subject: string;
  message: string;
};

export type ContactEmail = {
  recipient: string;
  subject: string;
  body: string;
};

export type ContactClientLinks = {
  defaultApp: string;
  gmailApp: string;
  gmailWeb: string;
  outlookApp: string;
  outlookWeb: string;
};

function oneLine(value: string) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateContactDraft(draft: ContactDraft): ContactDraft {
  const subject = oneLine(draft.subject);
  const message = draft.message.replace(/\r\n?/g, '\n').trim();

  if (subject.length < 3 || subject.length > 120)
    throw new Error('L’objet doit contenir entre 3 et 120 caractères.');
  if (message.length < 10 || message.length > 3000)
    throw new Error('Le message doit contenir entre 10 et 3 000 caractères.');

  return { subject, message };
}

export function buildContactEmail(draft: ContactDraft): ContactEmail {
  const clean = validateContactDraft(draft);
  return {
    recipient: CONTACT_RECIPIENT,
    subject: `[SAV SC Assistant AI] ${clean.subject}`,
    body: `${clean.message}\n\n— Message préparé depuis SAV SC Assistant AI`,
  };
}

function query(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

export function buildContactClientLinks(draft: ContactDraft): ContactClientLinks {
  const email = buildContactEmail(draft);
  const standardParams = query({ subject: email.subject, body: email.body });
  const providerParams = query({
    to: email.recipient,
    subject: email.subject,
    body: email.body,
  });

  return {
    defaultApp: `mailto:${email.recipient}?${standardParams}`,
    gmailApp: `googlegmail://co?${providerParams}`,
    gmailWeb: `https://mail.google.com/mail/?${query({
      view: 'cm',
      fs: '1',
      to: email.recipient,
      su: email.subject,
      body: email.body,
    })}`,
    outlookApp: `ms-outlook://compose?${providerParams}`,
    outlookWeb: `https://outlook.office.com/mail/deeplink/compose?${providerParams}`,
  };
}

export function buildContactMailto(draft: ContactDraft) {
  return buildContactClientLinks(draft).defaultApp;
}
