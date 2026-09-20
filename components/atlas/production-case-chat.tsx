'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { productionRequest, ProductionRequestError } from '@/lib/atlas/production-client';

type Message = { id: string; role: string; content: string; metadata?: { action?: string | null } };
export function ProductionCaseChat({
  onExpired,
  onChangeCase,
}: {
  onExpired: () => void;
  onChangeCase: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const retry = useRef<{ message: string; requestId: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    void productionRequest<{ csrf: string; messages: Message[] }>('/chat', { signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted) {
          setCsrf(result.csrf);
          setMessages(result.messages);
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          if (cause instanceof ProductionRequestError && cause.status === 401) onExpired();
          else setError(cause instanceof Error ? cause.message : 'Chargement impossible.');
        }
      });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, [onExpired]);
  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || !csrf || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    const request =
      retry.current?.message === message
        ? retry.current
        : { message, requestId: crypto.randomUUID() };
    retry.current = request;
    try {
      const reply = await productionRequest<Message>(
        '/chat',
        {
          method: 'POST',
          headers: { 'x-atlas-csrf': csrf },
          body: JSON.stringify(request),
          signal: abort.signal,
        },
        55000,
      );
      if (abort.signal.aborted) return;
      setMessages((previous) =>
        previous.some((row) => row.id === reply.id)
          ? previous
          : [...previous, { id: request.requestId, role: 'user', content: message }, reply],
      );
      setInput('');
      retry.current = null;
    } catch (cause) {
      if (abort.signal.aborted) return;
      if (cause instanceof ProductionRequestError && cause.status === 401) onExpired();
      else setError(cause instanceof Error ? cause.message : 'Réponse indisponible.');
    } finally {
      inFlight.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="production-case-chat" aria-labelledby="case-chat-heading">
      <h2 id="case-chat-heading">Parlons de votre dossier</h2>
      <p>
        Posez votre question naturellement. Les informations du dossier sont vérifiées avant de vous
        répondre.
      </p>
      <div
        className="case-chat-messages"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
      >
        {messages.map((message) => (
          <article
            key={message.id}
            className={`case-chat-message ${message.role === 'user' ? 'from-user' : ''}`}
          >
            <strong>{message.role === 'user' ? 'Vous' : 'Assistant'}</strong>
            <p>{message.content}</p>
            {message.metadata?.action === 'switch_case' && (
              <button type="button" onClick={onChangeCase} disabled={busy}>
                Vérifier un autre dossier
              </button>
            )}
          </article>
        ))}
        {busy && <p role="status">Je vérifie les informations utiles…</p>}
      </div>
      {error && (
        <p role="alert" className="case-chat-error">
          {error}
        </p>
      )}
      <form onSubmit={send}>
        <label htmlFor="case-chat-question">Votre question</label>
        <textarea
          id="case-chat-question"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={1500}
          rows={3}
          disabled={!csrf || busy}
          placeholder="Par exemple : où en est ma réparation ?"
        />
        <button type="submit" disabled={!csrf || busy || !input.trim()}>
          {busy ? 'Réponse en cours…' : 'Envoyer'}
        </button>
      </form>
      <button
        type="button"
        className="case-chat-contact"
        onClick={() => {
          const contact = document.getElementById('tracking-contact');
          contact?.setAttribute('open', '');
          contact?.scrollIntoView({ block: 'nearest' });
          contact?.querySelector('summary')?.focus();
        }}
      >
        Contacter un conseiller
      </button>
    </section>
  );
}
