'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ContactPage } from '@/components/atlas/contact-page';
import {
  productionRequest as request,
  ProductionRequestError as RequestError,
  statusLabels,
  formatDate,
  isClosed,
} from '@/lib/atlas/production-client';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Wrench,
  X,
} from 'lucide-react';

type CaseSnapshot = {
  id: string;
  reference: string;
  kind: string;
  title: string;
  description: string;
  status: string;
  warranty_status: string;
  warranty_label: string | null;
  quote_cents: number | null;
  refund_cents: number | null;
  currency: string;
  delivery_mode: string | null;
  estimated_at: string | null;
  version: number;
  updated_at: string;
  product: { name: string; category: string | null; sku: string | null } | null;
  store: { name: string; city: string | null } | null;
  events: {
    id: string;
    status: string;
    label: string;
    details: Record<string, unknown>;
    occurred_at: string;
  }[];
};

const warrantyLabels: Record<string, string> = {
  covered: 'Sous garantie',
  not_covered: 'Hors garantie',
  expired: 'Garantie expirée',
  pending: 'À confirmer',
  unknown: 'À confirmer',
};

function money(cents: number | null, currency: string) {
  if (cents === null) return null;
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function Brand() {
  return (
    <div className="tracking-brand">
      <span>
        <Sparkles size={18} />
      </span>
      <strong>
        SAV SC Assistant <sup>AI</sup>
      </strong>
    </div>
  );
}

export default function TrackingPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [caseData, setCaseData] = useState<CaseSnapshot | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const invalidate = () => {
      requestId.current++;
    };
    let active = true;
    void request<{ configured: boolean }>('/config', { signal: controller.signal })
      .then(async (config) => {
        if (!active) return;
        if (!config.configured) {
          setConfigured(false);
          return;
        }
        try {
          const current = await request<{ case: CaseSnapshot; expiresAt: string }>(
            '/cases/current',
            { signal: controller.signal },
          );
          if (active) {
            setCaseData(current.case);
            setExpiresAt(current.expiresAt);
          }
        } catch (cause) {
          if (active && cause instanceof RequestError && cause.status !== 401)
            setError(cause.message);
        } finally {
          if (active) setConfigured(true);
        }
      })
      .catch(() => {
        if (active) {
          setConfigured(false);
          setError('Connexion indisponible. Rechargez la page pour réessayer.');
        }
      });
    return () => {
      active = false;
      controller.abort();
      invalidate();
    };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const expire = () => {
      requestId.current++;
      setCaseData(null);
      setExpiresAt(null);
      setCode('');
      setRefreshing(false);
      setBusy(false);
      setError('Votre accès a expiré. Saisissez à nouveau votre référence et votre code.');
    };
    const remaining = Date.parse(expiresAt) - Date.now();
    const timer = window.setTimeout(
      expire,
      Number.isFinite(remaining) ? Math.max(0, remaining) : 0,
    );
    // Mobile browsers can suspend timers while the email application is open.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= Date.parse(expiresAt)) expire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [expiresAt]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const id = ++requestId.current;
    try {
      const result = await request<{ case: CaseSnapshot; expiresAt: string }>('/cases/verify', {
        method: 'POST',
        body: JSON.stringify({ reference, code }),
      });
      if (id !== requestId.current) return;
      setCaseData(result.case);
      setExpiresAt(result.expiresAt);
      setCode('');
    } catch (cause) {
      if (id === requestId.current)
        setError(cause instanceof Error ? cause.message : 'Vérification impossible.');
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  async function refresh() {
    if (refreshing || busy) return;
    setRefreshing(true);
    setError('');
    const id = ++requestId.current;
    try {
      const current = await request<{ case: CaseSnapshot; expiresAt: string }>('/cases/current');
      if (id !== requestId.current) return;
      setCaseData(current.case);
      setExpiresAt(current.expiresAt);
    } catch (cause) {
      if (id !== requestId.current) return;
      if (cause instanceof RequestError && cause.status === 401) {
        setCaseData(null);
        setExpiresAt(null);
        setCode('');
      }
      setError(cause instanceof Error ? cause.message : 'Actualisation impossible.');
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }

  async function close() {
    if (busy) return;
    const id = ++requestId.current;
    setBusy(true);
    setRefreshing(false);
    try {
      await request('/cases/current', { method: 'DELETE', body: '{}' });
      if (id !== requestId.current) return;
      setCaseData(null);
      setExpiresAt(null);
      setReference('');
      setCode('');
      setError('');
    } catch {
      if (id === requestId.current)
        setError(
          'La fermeture n’a pas pu être confirmée. Réessayez avant de quitter un appareil partagé.',
        );
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  return (
    <main className="tracking-page">
      <a className="skip-link" href="#tracking-content">
        Aller au suivi
      </a>
      <header className="tracking-nav">
        <Link href="/" aria-label="SAV SC Assistant AI, accueil"><Brand /></Link>
        <div>
          <span>
            <ShieldCheck size={14} /> Accès confidentiel
          </span>
          <Link href="/">
            Accueil <ChevronRight size={14} />
          </Link>
        </div>
      </header>
      {!caseData ? (
        <section id="tracking-content" className="tracking-entry">
          <div className="tracking-intro">
            <span className="tracking-kicker">
              <i /> SUIVI SAV & SERVICE CLIENT
            </span>
            <h1>
              Votre dossier.
              <br />
              <em>Sans créer de compte.</em>
            </h1>
            <p>
              Où en est votre réparation, votre échange ou votre demande ? Retrouvez les dernières
              informations du magasin avec votre référence et votre code confidentiel.
            </p>
            <div className="tracking-trust">
              <span>
                <LockKeyhole />
                <strong>Accès limité</strong>
                <small>À ce dossier uniquement</small>
              </span>
              <span>
                <Clock3 />
                <strong>Session temporaire</strong>
                <small>Expiration automatique</small>
              </span>
              <span>
                <ShieldCheck />
                <strong>Code protégé</strong>
                <small>Jamais conservé en clair</small>
              </span>
            </div>
          </div>
          <form
            className="tracking-form-card"
            onSubmit={verify}
            aria-labelledby="tracking-form-title"
          >
            <span className="tracking-form-icon">
              <FileText />
            </span>
            <p className="tracking-eyebrow">ACCÉDER À MON SUIVI</p>
            <h2 id="tracking-form-title">Retrouvez votre dossier</h2>
            <p>Ces informations figurent sur votre ticket ou votre document de prise en charge.</p>
            <label>
              Référence du dossier
              <input
                value={reference}
                onChange={(event) =>
                  setReference(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9-]/g, '')
                      .slice(0, 64),
                  )
                }
                aria-label="Référence du dossier"
                autoCapitalize="characters"
                spellCheck={false}
                autoComplete="off"
                placeholder="Ex. SAV-2026-1042"
                minLength={6}
                maxLength={64}
                required
              />
            </label>
            <label>
              Code confidentiel
              <span className="tracking-code-control">
              <input
                aria-label="Code confidentiel"
                className="tracking-code-input"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 12))}
                type={showCode ? "text" : "password"}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                pattern="[0-9]{6,12}"
                minLength={6}
                maxLength={12}
                required
              />
              <button type="button" aria-label={showCode ? 'Masquer le code' : 'Afficher le code'} aria-pressed={showCode} onClick={() => setShowCode(value => !value)}>
                {showCode ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
              </span>
            </label>
            {error && (
              <div className="tracking-error" role="alert">
                <AlertTriangle size={16} />
                {error}
              </div>
            )}
            {configured === false && (
              <div className="tracking-config-note">
                <Wrench size={17} />
                <span>
                  <strong>Le suivi est momentanément indisponible</strong>Réessayez un peu plus tard
                  ou contactez votre magasin.
                </span>
              </div>
            )}
            <button
              className="tracking-primary"
              disabled={busy || !configured || reference.length < 6 || code.length < 6}
            >
              {busy || configured === null ? <LoaderCircle className="spin" /> : <LockKeyhole />}{configured === null ? "Connexion au suivi…" : busy ? "Vérification…" : "Consulter mon dossier"}
              <ArrowRight />
            </button>
            <details className="tracking-access-help">
              <summary>Où trouver ma référence et mon code ?</summary>
              <p>Consultez le document remis par votre magasin lors de la prise en charge. La référence identifie votre dossier ; le code confidentiel en protège l’accès.</p>
              <p>Vous ne les retrouvez pas ? Demandez-les à votre magasin. Ne communiquez jamais votre code par email.</p>
              <Link href="/contact">Contacter un conseiller <ArrowRight size={15} /></Link>
            </details>
            <small className="tracking-form-foot">
              <ShieldCheck size={13} /> Votre code reste confidentiel. Aucun compte à créer.
            </small>
          </form>
        </section>
      ) : (
        <section id="tracking-content" className="tracking-workspace">
          <div className="tracking-heading">
            <div>
              <span className="tracking-kicker">
                <i /> ACCÈS VÉRIFIÉ
              </span>
              <h1>{caseData.product?.name ?? caseData.title}</h1>
              <p>
                {caseData.reference} · Mise à jour {formatDate(caseData.updated_at, true)}
              </p>
            </div>
            <div>
              <button onClick={() => void refresh()} disabled={refreshing || busy}>
                <RefreshCw className={refreshing ? 'spin' : ''} />
                Actualiser
              </button>
              <button className="tracking-close" onClick={() => void close()} disabled={busy}>
                <X />
                {busy ? 'Fermeture…' : 'Fermer l’accès'}
              </button>
            </div>
          </div>
          {error && (
            <div className="tracking-error tracking-error-wide" role="alert">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          <div className="tracking-grid">
            <article className="tracking-status-card">
              <div className="tracking-status-top">
                <span className="tracking-product-icon">
                  <Package />
                </span>
                <span className="tracking-status-pill">
                  <i />
                  {statusLabels[caseData.status] ?? caseData.status}
                </span>
              </div>
              <p className="tracking-eyebrow">SITUATION ACTUELLE</p>
              <h2>{statusLabels[caseData.status] ?? caseData.status}</h2>
              <p className="tracking-description">{caseData.description}</p>
              <div className="tracking-facts">
                <div>
                  <ShieldCheck />
                  <span>
                    Prise en charge
                    <strong>
                      {caseData.warranty_label ??
                        warrantyLabels[caseData.warranty_status] ??
                        'À confirmer'}
                    </strong>
                  </span>
                </div>
                <div>
                  <Store />
                  <span>
                    Restitution<strong>{caseData.delivery_mode ?? 'À confirmer'}</strong>
                  </span>
                </div>
                {!isClosed(caseData.status) && (
                  <div>
                    <CalendarClock />
                    <span>
                      Date estimée · à confirmer
                      <strong>{formatDate(caseData.estimated_at, false)}</strong>
                    </span>
                  </div>
                )}
                {caseData.quote_cents !== null && (
                  <div>
                    <FileText />
                    <span>
                      Devis enregistré
                      <strong>{money(caseData.quote_cents, caseData.currency)}</strong>
                    </span>
                  </div>
                )}
                {caseData.refund_cents !== null && (
                  <div>
                    <FileText />
                    <span>
                      Montant du remboursement
                      <strong>{money(caseData.refund_cents, caseData.currency)}</strong>
                    </span>
                  </div>
                )}
              </div>
              <footer>
                <LockKeyhole size={14} />
                Accès valable jusqu’au {formatDate(expiresAt, true)}
              </footer>
            </article>
            <article className="tracking-timeline-card">
              <header>
                <div>
                  <p className="tracking-eyebrow">HISTORIQUE</p>
                  <h2>Les étapes de votre dossier</h2>
                </div>
                <span>{caseData.events.length}</span>
              </header>
              <div className="tracking-timeline">
                {!caseData.events.length && (
                  <p>Le magasin n’a pas encore communiqué d’étape détaillée.</p>
                )}
                {caseData.events.map((event, index) => (
                  <div className={index === 0 ? 'current' : ''} key={event.id}>
                    <span>{index === 0 ? <Clock3 /> : <Check />}</span>
                    <div>
                      <strong>{event.label}</strong>
                      <small>{formatDate(event.occurred_at, true)}</small>
                      {typeof event.details.detail === 'string' && <p>{event.details.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>
          <div className="tracking-next">
            <Sparkles />
            <div>
              <strong>
                {caseData.status === 'quote_pending'
                  ? 'Votre accord est attendu'
                  : isClosed(caseData.status)
                    ? 'Une question sur votre dossier terminé ?'
                    : 'Besoin de précisions ?'}
              </strong>
              <p>
                {caseData.status === 'quote_pending'
                  ? 'Contactez votre magasin pour vérifier le devis et les conditions avant de donner votre accord.'
                  : 'Un conseiller pourra confirmer les délais ou vous accompagner. Préparez votre email ci-dessous ; votre code n’y sera jamais inclus.'}
              </p>
            </div>
          </div>
          <details className="tracking-contact">
            <summary>
              Contacter un conseiller à propos de ce dossier <ArrowRight size={17} />
            </summary>
            <div>
              <ContactPage
                initialDraft={{
                  id: caseData.id,
                  subject: `Suivi ${caseData.reference}`,
                  message: `Bonjour,\n\nJe vous contacte au sujet du dossier ${caseData.reference}.\n\nMa demande :\n[Précisez votre question ici]\n\nMerci.`,
                  contextLabel: `Dossier ${caseData.reference}`,
                }}
              />
            </div>
          </details>
        </section>
      )}
      <footer className="tracking-footer">
        <span>SAV SC Assistant AI</span>
        <span>Confidentialité · Accès temporaire · Aucun compte client requis</span>
      </footer>
    </main>
  );
}
