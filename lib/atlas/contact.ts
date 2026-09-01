export const CONTACT_RECIPIENT = 'mohammed.elmesbahi31@gmail.com';

export type ContactDraft = {
  email: string;
  subject: string;
  message: string;
};

function oneLine(value: string) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateContactDraft(draft: ContactDraft): ContactDraft {
  const email = oneLine(draft.email).toLowerCase();
  const subject = oneLine(draft.subject);
  const message = draft.message.replace(/\r\n?/g, '\n').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error('Saisissez une adresse email valide.');
  if (subject.length < 3 || subject.length > 120)
    throw new Error('L’objet doit contenir entre 3 et 120 caractères.');
  if (message.length < 10 || message.length > 3000)
    throw new Error('Le message doit contenir entre 10 et 3 000 caractères.');

  return { email, subject, message };
}

export function buildContactMailto(draft: ContactDraft) {
  const clean = validateContactDraft(draft);
  const params = new URLSearchParams({
    subject: `[SAV SC Assistant AI] ${clean.subject}`,
    body: `Adresse de réponse : ${clean.email}\n\n${clean.message}\n\n— Message préparé depuis SAV SC Assistant AI`,
  });
  return `mailto:${CONTACT_RECIPIENT}?${params.toString()}`;
}
