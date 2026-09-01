'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  FileCheck2,
  Globe2,
  Mail,
  MessageSquareText,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  buildContactClientLinks,
  buildContactEmail,
  CONTACT_RECIPIENT,
  DEFAULT_CONTACT_MESSAGE,
  DEFAULT_CONTACT_SUBJECT,
} from '@/lib/atlas/contact';

export type ContactPrefill = {
  id: string;
  subject: string;
  message: string;
  contextLabel?: string;
};

type ContactPageProps = {
  initialDraft?: ContactPrefill | null;
  onContinue?: () => void;
};

export function ContactPage({ initialDraft, onContinue }: ContactPageProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  const [openedClient, setOpenedClient] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px), (pointer: coarse)');
    const update = () => setIsMobile(mobileQuery.matches);
    update();
    mobileQuery.addEventListener?.('change', update);
    return () => mobileQuery.removeEventListener?.('change', update);
  }, []);

  const draft = {
    subject: initialDraft?.subject ?? DEFAULT_CONTACT_SUBJECT,
    message: initialDraft?.message ?? DEFAULT_CONTACT_MESSAGE,
  };
  const email = buildContactEmail(draft);
  const links = buildContactClientLinks(draft);

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const helper = document.createElement('textarea');
      helper.value = value;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand('copy');
      helper.remove();
      return copied;
    }
  }

  async function copyAddress() {
    setError('');
    if (await copyText(CONTACT_RECIPIENT)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } else {
      setError(`Copiez cette adresse : ${CONTACT_RECIPIENT}`);
    }
  }

  async function copyPreparedMessage() {
    setError('');
    const value = `À : ${email.recipient}\nObjet : ${email.subject}\n\n${email.body}`;
    if (await copyText(value)) {
      setMessageCopied(true);
      window.setTimeout(() => setMessageCopied(false), 2500);
    } else {
      setError('La copie automatique est indisponible sur ce navigateur.');
    }
  }

  function markOpened(client: string) {
    setOpenedClient(client);
    setError('');
  }

  return (
    <>
      <div className="page-heading contact-heading">
        <div>
          <span className="eyebrow">CONTACT & ACCOMPAGNEMENT</span>
          <h1>
            Votre demande est prête<span className="teal">.</span>
          </h1>
          <p>
            Choisissez votre messagerie. Le destinataire, l’objet et le contexte sont préremplis.
          </p>
        </div>
        <span className="contact-availability">
          <i /> Contact sans formulaire
        </span>
      </div>

      <div className="contact-layout">
        <section className="contact-promise" aria-labelledby="contact-promise-title">
          <span className="contact-promise-icon">
            <Sparkles size={25} />
          </span>
          <span className="eyebrow">UN CONTACT SIMPLE ET SÛR</span>
          <h2 id="contact-promise-title">Gardez le contrôle jusqu’à l’envoi.</h2>
          <p>
            Votre message s’ouvre directement dans la messagerie choisie. Vous pouvez le relire, le
            compléter et décider de l’envoyer.
          </p>
          <div className="contact-benefits">
            <span>
              <Check size={16} /> Aucun compte supplémentaire
            </span>
            <span>
              <Check size={16} /> Message et contexte préremplis
            </span>
            <span>
              <Check size={16} /> Aucune donnée stockée par cette page
            </span>
          </div>
          <div className="contact-address-card">
            <Mail size={19} />
            <div>
              <small>Destinataire vérifié</small>
              <strong>{CONTACT_RECIPIENT}</strong>
            </div>
            <button type="button" onClick={() => void copyAddress()}>
              {copied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}
              {copied ? 'Copiée' : 'Copier'}
            </button>
          </div>
        </section>

        <section className="contact-clients-card" aria-labelledby="contact-clients-title">
          <div className="contact-form-title">
            <span>
              <MonitorSmartphone size={20} />
            </span>
            <div>
              <h2 id="contact-clients-title">Où souhaitez-vous écrire ?</h2>
              <p>Sur téléphone, privilégiez votre application déjà installée.</p>
            </div>
          </div>

          {initialDraft?.contextLabel && (
            <div className="contact-context-ready" role="status">
              <FileCheck2 size={18} />
              <div>
                <strong>Contexte de votre demande repris</strong>
                <span>{initialDraft.contextLabel}</span>
              </div>
            </div>
          )}

          <div className="contact-email-preview">
            <div className="contact-preview-heading">
              <span>
                <FileCheck2 size={18} />
              </span>
              <div>
                <small>OBJET PRÉREMPLI</small>
                <strong>{email.subject}</strong>
              </div>
            </div>
            <details>
              <summary>
                Voir le message préparé <ChevronDown size={16} />
              </summary>
              <p>{email.body}</p>
            </details>
          </div>

          <div className="contact-client-list" aria-label="Choisir une messagerie">
            <a
              className="contact-client-card recommended"
              href={links.defaultApp}
              onClick={() => markOpened('votre application email')}
            >
              <span className="contact-client-badge default-mail">
                <Mail size={22} />
              </span>
              <span className="contact-client-copy">
                <span className="contact-recommended-label">RECOMMANDÉ</span>
                <strong>Application email du téléphone</strong>
                <small>Mail, Gmail, Outlook ou l’application définie par défaut</small>
              </span>
              <span className="contact-client-action">
                Ouvrir <ArrowRight size={16} />
              </span>
            </a>

            <div className="contact-client-card-group">
              <a
                className="contact-client-card"
                href={isMobile ? links.gmailApp : links.gmailWeb}
                target={isMobile ? undefined : '_blank'}
                rel={isMobile ? undefined : 'noreferrer'}
                onClick={() => markOpened('Gmail')}
              >
                <span className="contact-client-badge gmail">G</span>
                <span className="contact-client-copy">
                  <strong>Gmail</strong>
                  <small>
                    {isMobile ? 'Ouvrir l’application Gmail' : 'Composer dans Gmail Web'}
                  </small>
                </span>
                <span className="contact-client-action">
                  Ouvrir <ArrowRight size={16} />
                </span>
              </a>
              {isMobile && (
                <a
                  className="contact-web-fallback"
                  href={links.gmailWeb}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Globe2 size={14} /> Gmail sur le web
                </a>
              )}
            </div>

            <div className="contact-client-card-group">
              <a
                className="contact-client-card"
                href={isMobile ? links.outlookApp : links.outlookWeb}
                target={isMobile ? undefined : '_blank'}
                rel={isMobile ? undefined : 'noreferrer'}
                onClick={() => markOpened('Outlook')}
              >
                <span className="contact-client-badge outlook">O</span>
                <span className="contact-client-copy">
                  <strong>Outlook</strong>
                  <small>
                    {isMobile ? 'Ouvrir l’application Outlook' : 'Composer dans Outlook Web'}
                  </small>
                </span>
                <span className="contact-client-action">
                  Ouvrir <ArrowRight size={16} />
                </span>
              </a>
              {isMobile && (
                <a
                  className="contact-web-fallback"
                  href={links.outlookWeb}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Globe2 size={14} /> Outlook sur le web
                </a>
              )}
            </div>
          </div>

          {openedClient && (
            <p className="contact-success" role="status">
              <CheckCircle2 size={17} /> {openedClient} va s’ouvrir avec votre message. Vérifiez-le
              puis confirmez l’envoi.
            </p>
          )}
          {error && (
            <p className="contact-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="button secondary contact-copy-message"
            type="button"
            onClick={() => void copyPreparedMessage()}
          >
            {messageCopied ? <CheckCircle2 size={17} /> : <Clipboard size={17} />}
            {messageCopied ? 'Message copié' : 'Copier les informations de contact'}
          </button>

          {onContinue && (
            <button className="contact-assistant-link" type="button" onClick={onContinue}>
              <MessageSquareText size={17} />
              <span>
                <strong>Vous préférez continuer ici ?</strong>
                L’assistant peut encore vous guider immédiatement.
              </span>
              <ArrowRight size={17} />
            </button>
          )}

          <p className="contact-privacy">
            <ShieldCheck size={15} /> Rien n’est envoyé ni enregistré sur cette page. Ne joignez
            jamais de mot de passe, de code de vérification ou de données bancaires.
          </p>
        </section>
      </div>
    </>
  );
}
