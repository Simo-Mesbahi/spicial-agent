'use client';

import { useRouter } from 'next/navigation';
import { productionRequest, ProductionRequestError as RequestError } from '@/lib/atlas/production-client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, Clock3, FileSearch,
  FileText, History, LoaderCircle, MessageSquareText, RefreshCw, Search, Send,
  ShieldCheck, UserCheck, Users,
} from 'lucide-react';

type Role = 'super_admin' | 'sav_manager' | 'sc_manager' | 'adviser' | 'analyst';
type Membership = { organizationId: string; organizationName: string; role: Role; displayName: string | null };
type Admin = { userId: string; email: string; aal: 'aal1' | 'aal2'; memberships: Membership[] };
type Overview = {
  generated_at: string; period_days: number;
  cases: { total: number; open: number; overdue: number; without_eta: number; stale: number; resolved: number; avg_resolution_hours: number | null };
  by_status: Record<string, number>;
  trend: { day: string; opened: number; closed: number }[];
  performance: { requests_24h: number; error_rate_24h: number | null; avg_latency_ms_24h: number | null; p95_latency_ms_24h: number | null; denied_24h: number; rate_limited_24h: number };
  routes: { route: string; requests: number; errors: number; avg_ms: number | null }[];
  documents: { total: number; published: number; review: number; expired: number };
  assistant: { messages_24h: number; conversations: number };
  handoffs: { open: number; unassigned: number };
};
type Priority = { id: string; reference: string; title: string; status: string; estimated_at: string | null; updated_at: string };
type Handoff = { id: string; case_id: string | null; reference: string | null; summary: string; status: string; assigned_to: string | null; updated_at: string; created_at: string };
type Queue = { priorities: Priority[]; handoffs: Handoff[] };
type AdminCase = { id: string; reference: string; kind: string; title: string; status: string; warranty_status: string; product: string | null; store: string | null; customer: string | null; estimated_at: string | null; updated_at: string; version: number };
type CaseDetail = {
  id: string; reference: string; title: string; description: string; kind: string; status: string; version: number;
  updated_at: string; estimated_at: string | null; created_at: string; closed_at: string | null; source_system: string | null;
  source_updated_at: string | null; warranty_label: string | null; quote_cents: number | null; refund_cents: number | null;
  currency: string; product: string | null; store: string | null; customer: string | null;
  events: { id: string; label: string; detail: string | null; customer_visible: boolean; occurred_at: string; source: string }[];
};
type Audit = { items: { id: string; action: string; outcome: string; entity_type: string | null; entity_id: string | null; actor_user_id: string | null; created_at: string }[]; total: number };

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return productionRequest<T>(path.replace(/^\/api\/production/, ''), init);
}

const roleLabels: Record<Role, string> = {
  super_admin: 'Super-administrateur', sav_manager: 'Responsable SAV', sc_manager: 'Responsable service client', adviser: 'Conseiller', analyst: 'Analyste',
};
const statusLabels: Record<string, string> = {
  opened: 'Ouvert', deposited: 'Déposé', received: 'Reçu au SAV', diagnosis: 'Diagnostic', waiting_part: 'Pièce attendue', quote_pending: 'Devis à confirmer',
  repairing: 'En réparation', repaired: 'Réparé', exchanged: 'Échangé', shipping: 'Expédition', transit: 'En transit', ready: 'Disponible', delivered: 'Livré',
  refund_pending: 'Remboursement en cours', refunded: 'Remboursé', complaint_review: 'Réclamation analysée', resolved: 'Résolu', cancelled: 'Annulé', delayed: 'Retard signalé',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatMetric(value: number | null, suffix = '') {
  return value === null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}
function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <article className="admin-ops-metric"><span>{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}

export default function AdminOperationsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [queue, setQueue] = useState<Queue>({ priorities: [], handoffs: [] });
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [caseTotal, setCaseTotal] = useState(0);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [noteVisible, setNoteVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const membership = useMemo(() => admin?.memberships.find((item) => item.organizationId === organizationId) ?? null, [admin, organizationId]);
  const canAudit = membership?.role === 'super_admin' || membership?.role === 'analyst';
  const canOverrideHandoff = membership?.role === 'super_admin' || membership?.role === 'sav_manager' || membership?.role === 'sc_manager';

  const handleAuthError = useCallback((cause: unknown) => {
    if (cause instanceof RequestError && (cause.status === 401 || (cause.status === 403 && cause.code === 'mfa_required'))) {
      setAdmin(null); setOverview(null); setSelectedCase(null); setCases([]); setAudit(null);
      router.replace('/admin');
      return true;
    }
    return false;
  }, [router]);

  const loadCase = useCallback(async (caseId: string, orgId: string) => {
    if (!caseId || !orgId) return;
    const params = new URLSearchParams({ organizationId: orgId, caseId });
    const result = await request<{ case: CaseDetail }>(`/api/production/admin/operations/case?${params}`);
    setSelectedCase(result.case);
  }, []);

  const loadAll = useCallback(async (orgId: string, role?: Role) => {
    if (!orgId) return;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ organizationId: orgId });
      const [overviewResult, queueResult, caseResult] = await Promise.all([
        request<{ overview: Overview }>(`/api/production/admin/operations/overview?${params}`),
        request<{ queue: Queue }>(`/api/production/admin/operations/queue?${params}`),
        request<{ items: AdminCase[]; total: number }>(`/api/production/admin/cases?${params}&limit=20`),
      ]);
      setOverview(overviewResult.overview); setQueue(queueResult.queue); setCases(caseResult.items); setCaseTotal(caseResult.total); setSelectedCase(null);
      if (role === 'super_admin' || role === 'analyst') {
        const auditResult = await request<{ audit: Audit }>(`/api/production/admin/operations/audit?${params}`);
        setAudit(auditResult.audit);
      } else setAudit(null);
    } catch (cause) {
      if (!handleAuthError(cause)) setError(cause instanceof Error ? cause.message : 'Chargement opérationnel impossible.');
    } finally { setBusy(false); }
  }, [handleAuthError]);

  useEffect(() => {
    let active = true;
    void request<{ admin: Admin }>('/api/production/admin/session')
      .then(async (result) => {
        if (!active) return;
        const first = result.admin.memberships[0];
        if (!first) throw new RequestError('Aucune organisation autorisée.', 403, 'organization_denied');
        setAdmin(result.admin); setOrganizationId(first.organizationId);
        await loadAll(first.organizationId, first.role);
      })
      .catch((cause) => { if (active && !handleAuthError(cause)) setError(cause instanceof Error ? cause.message : 'Ouverture impossible.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [handleAuthError, loadAll]);

  async function openCase(caseId: string) {
    setBusy(true); setError(''); setSuccess('');
    try { await loadCase(caseId, organizationId); }
    catch (cause) { if (!handleAuthError(cause)) setError(cause instanceof Error ? cause.message : 'Détail du dossier indisponible.'); }
    finally { setBusy(false); }
  }

  async function applySearch(event: FormEvent) {
    event.preventDefault(); if (!organizationId) return;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ organizationId, search, limit: '30' });
      const result = await request<{ items: AdminCase[]; total: number }>(`/api/production/admin/cases?${params}`);
      setCases(result.items); setCaseTotal(result.total); setSelectedCase(null);
    } catch (cause) { if (!handleAuthError(cause)) setError(cause instanceof Error ? cause.message : 'Recherche impossible.'); }
    finally { setBusy(false); }
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault(); if (!selectedCase || note.trim().length < 3) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const caseId = selectedCase.id;
      await request('/api/production/admin/operations/case/note', { method: 'POST', body: JSON.stringify({
        organizationId, caseId, version: selectedCase.version, note: note.trim(), visible: noteVisible, requestId: crypto.randomUUID(),
      }) });
      setNote(''); setSuccess(noteVisible ? 'Message client enregistré et audité.' : 'Note interne enregistrée et auditée.');
      await loadAll(organizationId, membership?.role);
      await loadCase(caseId, organizationId);
    } catch (cause) { if (!handleAuthError(cause)) setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.'); }
    finally { setBusy(false); }
  }

  async function manageHandoff(item: Handoff, status: 'assigned' | 'resolved') {
    setBusy(true); setError(''); setSuccess('');
    try {
      await request('/api/production/admin/operations/handoff', { method: 'POST', body: JSON.stringify({ organizationId, handoffId: item.id, status, expectedUpdatedAt: item.updated_at }) });
      setSuccess(status === 'assigned' ? 'Relais pris en charge.' : 'Relais clôturé.');
      await loadAll(organizationId, membership?.role);
    } catch (cause) { if (!handleAuthError(cause)) setError(cause instanceof Error ? cause.message : 'Mise à jour du relais impossible.'); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="admin-ops-loading"><LoaderCircle className="spin" /><span>Ouverture du centre opérationnel…</span></main>;

  if (!admin || !overview) return <main className="admin-ops-page">
    <header className="admin-ops-topbar"><a href="/admin"><ArrowLeft size={17} /> Connexion administrateur</a></header>
    <div className="admin-ops-content">
      <h1>Centre opérationnel indisponible</h1>
      <div className="admin-ops-alert error" role="alert"><AlertTriangle size={18} /><span>{error || 'Connectez-vous pour accéder à votre organisation.'}</span></div>
      <p>Aucun indicateur ne peut être affiché tant que la connexion et le chargement ne sont pas validés.</p>
      {admin && <button disabled={busy} onClick={() => void loadAll(organizationId, membership?.role)}>Réessayer</button>}
    </div>
  </main>;

  return <main className="admin-ops-page">
    <header className="admin-ops-topbar">
      <a href="/admin"><ArrowLeft size={17} /> Tableau de bord</a>
      <div>
        {admin && admin.memberships.length > 1 && <select aria-label="Organisation" value={organizationId} onChange={(event) => {
          const value = event.target.value; setOrganizationId(value); const role = admin.memberships.find((item) => item.organizationId === value)?.role; void loadAll(value, role);
        }}>{admin.memberships.map((item) => <option value={item.organizationId} key={item.organizationId}>{item.organizationName}</option>)}</select>}
        <button disabled={busy} onClick={() => void loadAll(organizationId, membership?.role)}><RefreshCw className={busy ? 'spin' : ''} size={16} /> Actualiser</button>
      </div>
    </header>

    <div className="admin-ops-content">
      <section className="admin-ops-heading">
        <div><span><Activity size={15} /> CENTRE OPÉRATIONNEL</span><h1>Agir sur ce qui compte maintenant.</h1><p>Priorités, relais conseillers, dossiers et audit sur des données réellement enregistrées.</p></div>
        <aside><ShieldCheck size={18} /><div><strong>MFA AAL2</strong><small>{membership ? `${membership.organizationName} · ${roleLabels[membership.role]}` : 'Accès sécurisé'}</small></div></aside>
      </section>

      {error && <div className="admin-ops-alert error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}
      {success && <div className="admin-ops-alert success" role="status"><CheckCircle2 size={18} /><span>{success}</span></div>}

      <section className="admin-ops-metrics" aria-label="Indicateurs opérationnels">
        <Metric label="Dossiers ouverts" value={String(overview?.cases.open ?? 0)} detail={`${overview?.cases.total ?? 0} au total`} icon={<FileText />} />
        <Metric label="Échéances dépassées" value={String(overview?.cases.overdue ?? 0)} detail={`${overview?.cases.without_eta ?? 0} sans échéance`} icon={<Clock3 />} />
        <Metric label="Dossiers stagnants" value={String(overview?.cases.stale ?? 0)} detail="Sans mise à jour depuis 3 jours" icon={<AlertTriangle />} />
        <Metric label="Relais ouverts" value={String(overview?.handoffs.open ?? 0)} detail={`${overview?.handoffs.unassigned ?? 0} non assignés`} icon={<Users />} />
        <Metric label="P95 API · 24 h" value={formatMetric(overview?.performance.p95_latency_ms_24h ?? null, ' ms')} detail={`${overview?.performance.requests_24h ?? 0} requêtes observées`} icon={<BarChart3 />} />
        <Metric label="Taux d’erreur · 24 h" value={formatMetric(overview?.performance.error_rate_24h ?? null, ' %')} detail={`${overview?.performance.rate_limited_24h ?? 0} limitations`} icon={<ShieldCheck />} />
      </section>

      <section className="admin-ops-grid">
        <article className="admin-ops-panel"><header><div><p>PRIORITÉS</p><h2>Dossiers à traiter</h2></div><span>{queue.priorities.length}</span></header><div className="admin-ops-list">
          {queue.priorities.length ? queue.priorities.map((item) => <button key={item.id} onClick={() => void openCase(item.id)} className="admin-ops-priority"><span><strong>{item.reference}</strong><small>{item.title}</small></span><span><b>{statusLabels[item.status] ?? item.status}</b><small>{item.estimated_at ? `Échéance ${formatDate(item.estimated_at)}` : 'Sans échéance'}</small></span></button>) : <div className="admin-ops-empty"><CheckCircle2 /><strong>Aucune priorité critique</strong><span>La file ne contient aucun dossier en retard ou bloqué.</span></div>}
        </div></article>

        <article className="admin-ops-panel"><header><div><p>RELAIS CONSEILLERS</p><h2>Interventions humaines</h2></div><span>{queue.handoffs.length}</span></header><div className="admin-ops-list">
          {queue.handoffs.length ? queue.handoffs.map((item) => {
            const mine = item.assigned_to === admin?.userId; const canResolve = mine || canOverrideHandoff;
            return <div className="admin-ops-handoff" key={item.id}><div><strong>{item.reference ?? 'Sans dossier lié'}</strong><small>{item.summary}</small><em>{item.assigned_to ? (mine ? 'Assigné à vous' : 'Déjà assigné') : 'Non assigné'} · {formatDate(item.created_at)}</em></div><div>
              {!item.assigned_to && <button disabled={busy} onClick={() => void manageHandoff(item, 'assigned')}><UserCheck size={15} /> Prendre</button>}
              {item.assigned_to && canResolve && <button disabled={busy} onClick={() => void manageHandoff(item, 'resolved')}><CheckCircle2 size={15} /> Résoudre</button>}
              {item.case_id && <button className="ghost" onClick={() => void openCase(item.case_id!)}><FileSearch size={15} /> Dossier</button>}
            </div></div>;
          }) : <div className="admin-ops-empty"><CheckCircle2 /><strong>Aucun relais en attente</strong><span>Aucune intervention humaine ouverte ou assignée.</span></div>}
        </div></article>
      </section>

      <section className="admin-ops-case-grid">
        <article className="admin-ops-panel"><header><div><p>DOSSIERS</p><h2>Recherche opérationnelle</h2></div><span>{caseTotal}</span></header>
          <form onSubmit={applySearch} className="admin-ops-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Référence, produit…" maxLength={120} aria-label="Rechercher un dossier" /><button disabled={busy}>Rechercher</button></form>
          <div className="admin-ops-case-results">{cases.map((item) => <button className={selectedCase?.id === item.id ? 'active' : ''} key={item.id} onClick={() => void openCase(item.id)}><span><strong>{item.reference}</strong><small>{item.product ?? item.title}</small></span><span><b>{statusLabels[item.status] ?? item.status}</b><small>{formatDate(item.updated_at)}</small></span></button>)}{!cases.length && <div className="admin-ops-empty"><FileSearch /><strong>Aucun dossier trouvé</strong><span>Modifiez votre recherche puis réessayez.</span></div>}</div>
        </article>

        <article className="admin-ops-panel"><header><div><p>DÉTAIL DOSSIER</p><h2>{selectedCase ? selectedCase.reference : 'Sélectionnez un dossier'}</h2></div>{selectedCase && <span>{statusLabels[selectedCase.status] ?? selectedCase.status}</span>}</header>
          {selectedCase ? <div className="admin-ops-detail">
            <div className="admin-ops-detail-facts"><div><small>Demande</small><strong>{selectedCase.product ?? selectedCase.title}</strong><span>{selectedCase.description}</span></div><div><small>Client</small><strong>{selectedCase.customer || '—'}</strong><span>{selectedCase.store || 'Magasin non renseigné'}</span></div><div><small>Échéance</small><strong>{formatDate(selectedCase.estimated_at)}</strong><span>Version {selectedCase.version} · mise à jour {formatDate(selectedCase.updated_at)}</span></div></div>
            <form className="admin-ops-note" onSubmit={submitNote}><label>Ajouter une note<textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={3} maxLength={4000} placeholder="Écrivez une information utile et factuelle…" /></label><div><label className="admin-ops-check"><input type="checkbox" checked={noteVisible} onChange={(event) => setNoteVisible(event.target.checked)} /><span>{noteVisible ? 'Visible par le client' : 'Note interne uniquement'}</span></label><button disabled={busy || note.trim().length < 3}><Send size={15} /> Enregistrer</button></div></form>
            <div className="admin-ops-timeline"><h3><History size={16} /> Historique récent</h3>{selectedCase.events.map((event) => <div key={event.id}><i className={event.customer_visible ? 'visible' : ''} /><span><strong>{event.label}</strong>{event.detail && <small>{event.detail}</small>}<em>{formatDate(event.occurred_at)} · {event.customer_visible ? 'client' : 'interne'}</em></span></div>)}{!selectedCase.events.length && <p>Aucun événement enregistré.</p>}</div>
          </div> : <div className="admin-ops-empty detail"><FileText /><strong>Aucun dossier sélectionné</strong><span>Choisissez une priorité ou un résultat de recherche pour consulter son historique et agir.</span></div>}
        </article>
      </section>

      <section className="admin-ops-grid admin-ops-bottom-grid">
        <article className="admin-ops-panel"><header><div><p>PERFORMANCE</p><h2>Routes les plus sollicitées</h2></div><Activity size={18} /></header><div className="admin-ops-routes">{(overview?.routes ?? []).map((route) => <div key={route.route}><code>{route.route}</code><span><strong>{route.requests}</strong> req · {route.errors} err · {formatMetric(route.avg_ms, ' ms')}</span></div>)}{!overview?.routes.length && <div className="admin-ops-empty compact"><Activity /><strong>Pas encore de trafic</strong><span>Les mesures apparaîtront après les premières requêtes.</span></div>}</div></article>
        <article className="admin-ops-panel"><header><div><p>AUDIT</p><h2>Actions sensibles récentes</h2></div><History size={18} /></header>{canAudit ? <div className="admin-ops-audit">{(audit?.items ?? []).map((item) => <div key={item.id}><span><strong>{item.action}</strong><small>{item.entity_type ?? 'événement'}{item.entity_id ? ` · ${item.entity_id.slice(0, 8)}…` : ''}</small></span><span><b>{item.outcome}</b><small>{formatDate(item.created_at)}</small></span></div>)}{!audit?.items.length && <div className="admin-ops-empty compact"><History /><strong>Aucun événement d’audit</strong><span>Les actions sensibles apparaîtront ici.</span></div>}{audit && <p>{audit.total} événement{audit.total > 1 ? 's' : ''} au total</p>}</div> : <div className="admin-ops-empty"><ShieldCheck /><strong>Accès restreint</strong><span>Le journal détaillé est réservé aux super-administrateurs et analystes.</span></div>}</article>
      </section>

      <footer className="admin-ops-footer"><span>SAV SC Assistant AI · Centre opérationnel</span><span><MessageSquareText size={14} /> Actions métier contrôlées et auditées</span></footer>
    </div>
  </main>;
}
