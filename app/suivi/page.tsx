'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  FileText,
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
  events: { id: string; status: string; label: string; details: Record<string, unknown>; occurred_at: string }[];
};

class RequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/production${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null;
    throw new RequestError(typeof error === 'string' ? error : 'Le service est temporairement indisponible.', response.status);
  }
  return body as T;
}

const statusLabels: Record<string, string> = {
  opened: 'Demande ouverte', deposited: 'Produit déposé', received: 'Reçu par le SAV',
  diagnosis: 'Diagnostic en cours', waiting_part: 'Pièce en attente', quote_pending: 'Votre accord est attendu',
  repairing: 'Réparation en cours', repaired: 'Réparation terminée', exchanged: 'Échange effectué',
  shipping: 'Expédition en préparation', transit: 'En cours de transport', ready: 'Disponible au retrait',
  delivered: 'Dossier livré', refund_pending: 'Remboursement en cours', refunded: 'Remboursement effectué',
  complaint_review: 'Réclamation en cours d’analyse', resolved: 'Dossier résolu', cancelled: 'Dossier annulé',
  delayed: 'Retard signalé',
};

function formatDate(value: string | null, withTime = false) {
  if (!value) return 'Non communiquée';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Non communiquée';
  return new Intl.DateTimeFormat('fr-FR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'long' }).format(date);
}

function money(cents: number | null, currency: string) {
  if (cents === null) return null;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

function Brand() {
  return <div className="tracking-brand"><span><Sparkles size={18} /></span><strong>SAV SC Assistant <sup>AI</sup></strong></div>;
}

export default function TrackingPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [caseData, setCaseData] = useState<CaseSnapshot | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void request<{ configured: boolean }>('/config')
      .then(async (config) => {
        if (!active) return;
        setConfigured(config.configured);
        if (!config.configured) return;
        try {
          const current = await request<{ case: CaseSnapshot; expiresAt: string }>('/cases/current');
          if (active) { setCaseData(current.case); setExpiresAt(current.expiresAt); }
        } catch (cause) {
          if (active && cause instanceof RequestError && cause.status >= 500) setError(cause.message);
        }
      })
      .catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ case: CaseSnapshot; expiresAt: string }>('/cases/verify', {
        method: 'POST', body: JSON.stringify({ reference, code }),
      });
      setCaseData(result.case);
      setExpiresAt(result.expiresAt);
      setCode('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vérification impossible.');
    } finally { setBusy(false); }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      const current = await request<{ case: CaseSnapshot; expiresAt: string }>('/cases/current');
      setCaseData(current.case);
      setExpiresAt(current.expiresAt);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Actualisation impossible.'); }
    finally { setRefreshing(false); }
  }

  async function close() {
    setBusy(true);
    await request('/cases/current', { method: 'DELETE', body: '{}' }).catch(() => undefined);
    setCaseData(null); setExpiresAt(null); setReference(''); setCode(''); setError(''); setBusy(false);
  }

  if (configured === null) return <main className="tracking-loading"><LoaderCircle className="spin" /><span>Ouverture du service sécurisé…</span></main>;

  return (
    <main className="tracking-page">
      <header className="tracking-nav"><Brand /><div><span><ShieldCheck size={14} /> Connexion sécurisée</span><Link href="/">Assistant <ChevronRight size={14} /></Link></div></header>
      {!caseData ? (
        <section className="tracking-entry">
          <div className="tracking-intro">
            <span className="tracking-kicker"><i /> SUIVI SAV & SERVICE CLIENT</span>
            <h1>Votre dossier.<br /><em>Sans créer de compte.</em></h1>
            <p>Renseignez les deux éléments transmis par le magasin. Votre code est vérifié côté serveur et n’est jamais envoyé au modèle d’IA.</p>
            <div className="tracking-trust"><span><LockKeyhole /><strong>Accès limité</strong><small>À ce dossier uniquement</small></span><span><Clock3 /><strong>Session temporaire</strong><small>Expiration automatique</small></span><span><ShieldCheck /><strong>Code protégé</strong><small>Jamais conservé en clair</small></span></div>
          </div>
          <form className="tracking-form-card" onSubmit={verify} aria-labelledby="tracking-form-title">
            <span className="tracking-form-icon"><FileText /></span>
            <p className="tracking-eyebrow">ACCÉDER À MON SUIVI</p>
            <h2 id="tracking-form-title">Retrouvez votre dossier</h2>
            <p>Ces informations figurent sur votre ticket ou votre document de prise en charge.</p>
            <label>Référence du dossier<input value={reference} onChange={(event) => setReference(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 64))} autoComplete="off" placeholder="Ex. SAV-2026-1042" minLength={6} maxLength={64} required /></label>
            <label>Code confidentiel<input className="tracking-code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 12))} type="password" inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" pattern="[0-9]{6,12}" minLength={6} maxLength={12} required /></label>
            {error && <div className="tracking-error" role="alert"><AlertTriangle size={16} />{error}</div>}
            {!configured && <div className="tracking-config-note"><Wrench size={17} /><span><strong>Préproduction en cours de connexion</strong>La base sécurisée doit encore recevoir ses clés serveur.</span></div>}
            <button className="tracking-primary" disabled={busy || !configured || reference.length < 6 || code.length < 6}>{busy ? <LoaderCircle className="spin" /> : <LockKeyhole />}Vérifier et consulter<ArrowRight /></button>
            <small className="tracking-form-foot"><ShieldCheck size={13} /> Une erreur neutre protège l’existence de votre dossier.</small>
          </form>
        </section>
      ) : (
        <section className="tracking-workspace">
          <div className="tracking-heading"><div><span className="tracking-kicker"><i /> ACCÈS VÉRIFIÉ</span><h1>{caseData.product?.name ?? caseData.title}</h1><p>{caseData.reference} · Mise à jour {formatDate(caseData.updated_at, true)}</p></div><div><button onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} />Actualiser</button><button className="tracking-close" onClick={() => void close()} disabled={busy}><X />Fermer l’accès</button></div></div>
          {error && <div className="tracking-error tracking-error-wide" role="alert"><AlertTriangle size={16} />{error}</div>}
          <div className="tracking-grid">
            <article className="tracking-status-card">
              <div className="tracking-status-top"><span className="tracking-product-icon"><Package /></span><span className="tracking-status-pill"><i />{statusLabels[caseData.status] ?? caseData.status}</span></div>
              <p className="tracking-eyebrow">SITUATION ACTUELLE</p><h2>{statusLabels[caseData.status] ?? caseData.status}</h2><p className="tracking-description">{caseData.description}</p>
              <div className="tracking-facts"><div><ShieldCheck /><span>Prise en charge<strong>{caseData.warranty_label ?? caseData.warranty_status}</strong></span></div><div><Store /><span>Restitution<strong>{caseData.delivery_mode ?? 'À confirmer'}</strong></span></div><div><CalendarClock /><span>Date estimée<strong>{formatDate(caseData.estimated_at)}</strong></span></div>{caseData.quote_cents !== null && <div><FileText /><span>Devis enregistré<strong>{money(caseData.quote_cents, caseData.currency)}</strong></span></div>}</div>
              <footer><LockKeyhole size={14} />Accès valable jusqu’au {formatDate(expiresAt, true)}</footer>
            </article>
            <article className="tracking-timeline-card"><header><div><p className="tracking-eyebrow">HISTORIQUE</p><h2>Les étapes de votre dossier</h2></div><span>{caseData.events.length}</span></header><div className="tracking-timeline">{caseData.events.map((event, index) => <div className={index === 0 ? 'current' : ''} key={event.id}><span>{index === 0 ? <Clock3 /> : <Check />}</span><div><strong>{event.label}</strong><small>{formatDate(event.occurred_at, true)}</small>{typeof event.details.detail === 'string' && <p>{event.details.detail}</p>}</div></div>)}</div></article>
          </div>
          <div className="tracking-next"><Sparkles /><div><strong>Besoin d’une explication ?</strong><p>Retrouvez l’assistant pour être accompagné dans la suite de votre démarche.</p></div><Link href="/">Ouvrir l’assistant <ArrowRight /></Link></div>
        </section>
      )}
      <footer className="tracking-footer"><span>SAV SC Assistant AI</span><span>Confidentialité · Accès temporaire · Aucun compte client requis</span></footer>
    </main>
  );
}
