'use client';

import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Mail,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { buildContactMailto, CONTACT_RECIPIENT } from '@/lib/atlas/contact';

export function ContactPage() {
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [copied, setCopied] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPrepared(false);
    try {
      const destination = buildContactMailto({ email, subject, message });
      setPrepared(true);
      window.location.href = destination;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vérifiez les informations saisies.');
    }
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(CONTACT_RECIPIENT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(`Copiez cette adresse : ${CONTACT_RECIPIENT}`);
    }
  }

  return (
    <>
      <div className="page-heading contact-heading">
        <div>
          <span className="eyebrow">CONTACT & ACCOMPAGNEMENT</span>
          <h1>
            Une question mérite une vraie réponse<span className="teal">.</span>
          </h1>
          <p>Expliquez votre besoin. Votre message reste sous votre contrôle jusqu’à l’envoi.</p>
        </div>
        <span className="contact-availability">
          <i /> Contact par email
        </span>
      </div>

      <div className="contact-layout">
        <section className="contact-promise" aria-labelledby="contact-promise-title">
          <span className="contact-promise-icon">
            <Sparkles size={25} />
          </span>
          <span className="eyebrow">PARLONS DE VOTRE BESOIN</span>
          <h2 id="contact-promise-title">Nous sommes à votre écoute.</h2>
          <p>
            Une difficulté, une suggestion ou une question sur la démonstration ? Préparez un
            message clair en quelques instants.
          </p>
          <div className="contact-benefits">
            <span>
              <Check size={16} /> Aucun compte à créer
            </span>
            <span>
              <Check size={16} /> Message relisible avant envoi
            </span>
            <span>
              <Check size={16} /> Aucune donnée stockée par ce formulaire
            </span>
          </div>
          <div className="contact-address-card">
            <Mail size={19} />
            <div>
              <small>Adresse de destination</small>
              <strong>{CONTACT_RECIPIENT}</strong>
            </div>
            <button type="button" onClick={() => void copyAddress()}>
              {copied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}
              {copied ? 'Copiée' : 'Copier'}
            </button>
          </div>
        </section>

        <section className="contact-form-card" aria-labelledby="contact-form-title">
          <div className="contact-form-title">
            <span>
              <MessageSquareText size={20} />
            </span>
            <div>
              <h2 id="contact-form-title">Écrivez votre message</h2>
              <p>Les trois champs sont nécessaires.</p>
            </div>
          </div>
          <form className="contact-form" onSubmit={submit} noValidate>
            <label htmlFor="contact-email">
              Votre adresse email
              <input
                id="contact-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                required
                placeholder="vous@exemple.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label htmlFor="contact-subject">
              Objet
              <input
                id="contact-subject"
                name="subject"
                type="text"
                autoComplete="off"
                minLength={3}
                maxLength={120}
                required
                placeholder="Ex. Question sur mon expérience"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
            <label htmlFor="contact-message">
              Votre message
              <textarea
                id="contact-message"
                name="message"
                minLength={10}
                maxLength={3000}
                required
                rows={7}
                placeholder="Décrivez votre demande avec les éléments utiles…"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <span className="contact-counter">{message.length} / 3 000</span>
            </label>
            {error && (
              <p className="contact-error" role="alert">
                {error}
              </p>
            )}
            {prepared && (
              <p className="contact-success" role="status">
                <CheckCircle2 size={17} /> Votre email est prêt. Relisez-le puis appuyez sur «
                Envoyer » dans votre application mail.
              </p>
            )}
            <button className="button primary contact-submit" type="submit">
              Ouvrir mon application email <ArrowRight size={17} />
            </button>
            <p className="contact-privacy">
              <ShieldCheck size={15} /> Ce bouton ouvre un email prérempli. Rien n’est envoyé sans
              votre confirmation dans l’application mail.
            </p>
          </form>
        </section>
      </div>
    </>
  );
}
