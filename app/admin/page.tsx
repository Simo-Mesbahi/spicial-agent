'use client';

import { productionRequest as request, ProductionRequestError as RequestError } from '@/lib/atlas/production-client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileText,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

type Membership = {
  organizationId: string;
  organizationName: string;
  role: 'super_admin' | 'sav_manager' | 'sc_manager' | 'adviser' | 'analyst';
  displayName: string | null;
};

type Admin = {
  userId: string;
  email: string;
  aal: 'aal1' | 'aal2';
  memberships: Membership[];
};

type Dashboard = {
  generated_at: string;
  cases: { total: number; open: number; overdue: number; resolved_30d: number };
  handoffs: { open: number };
  assistant: { messages_24h: number; conversations_30d: number };
  performance: { requests_24h: number; error_rate_24h: number; avg_latency_ms_24h: number };
  by_status: Record<string, number>;
  by_kind: Record<string, number>;
};

type AdminCase = {
  id: string;
  reference: string;
  kind: string;
  title: string;
  status: string;
  warranty_status: string;
  product: string | null;
  store: string | null;
  customer: string | null;
  estimated_at: string | null;
  updated_at: string;
  version: number;
};

type LoginResult =
  | { status: 'authenticated'; admin: Admin }
  | {
      status: 'mfa_required';
      admin: Admin;
      factors: { id: string; friendlyName: string }[];
      enrollmentRequired: boolean;
    };

const roleLabels: Record<Membership['role'], string> = {
  super_admin: 'Super-administrateur',
  sav_manager: 'Responsable SAV',
  sc_manager: 'Responsable service client',
  adviser: 'Conseiller',
  analyst: 'Analyste',
};

const statusLabels: Record<string, string> = {
  opened: 'Ouvert',
  deposited: 'Déposé',
  received: 'Reçu au SAV',
  diagnosis: 'Diagnostic',
  waiting_part: 'Pièce attendue',
  quote_pending: 'Devis à confirmer',
  repairing: 'En réparation',
  repaired: 'Réparé',
  exchanged: 'Échangé',
  shipping: 'Expédition',
  transit: 'En transit',
  ready: 'Disponible',
  delivered: 'Livré',
  refund_pending: 'Remboursement en cours',
  refunded: 'Remboursé',
  complaint_review: 'Réclamation analysée',
  resolved: 'Résolu',
  cancelled: 'Annulé',
  delayed: 'Retard signalé',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function Brand() {
  return (
    <div className="admin-brand">
      <span><Sparkles size={18} /></span>
      <strong>SAV SC Assistant <sup>AI</sup></strong>
    </div>
  );
}

function SignIn({ onAuthenticated }: { onAuthenticated: (admin: Admin) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mfa, setMfa] = useState<Extract<LoginResult, { status: 'mfa_required' }> | null>(null);
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    totp: { qr_code: string; secret: string; uri: string };
  } | null>(null);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<LoginResult>('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setPassword('');
      if (result.status === 'authenticated') onAuthenticated(result.admin);
      else {
        setMfa(result);
        setFactorId(result.factors[0]?.id ?? '');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{
        factorId: string;
        totp: { qr_code: string; secret: string; uri: string };
      }>('/admin/mfa/enroll', { method: 'POST', body: '{}' });
      setEnrollment(result);
      setFactorId(result.factorId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Configuration impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy || !factorId) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ status: 'authenticated'; admin: Admin }>('/admin/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ factorId, code }),
      });
      setCode('');
      onAuthenticated(result.admin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vérification impossible.');
    } finally {
      setBusy(false);
    }
  }

  const qrCode = enrollment?.totp.qr_code;
  const qrSource = qrCode?.startsWith('data:image/svg+xml')
    ? qrCode
    : qrCode?.trim().startsWith('<svg')
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCode)}`
      : null;

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-story">
        <Brand />
        <div>
          <span className="admin-kicker"><ShieldCheck size={15} /> ESPACE SÉCURISÉ</span>
          <h1>Pilotez le service.<br /><em>Gardez le contrôle.</em></h1>
          <p>Suivez les dossiers, les délais et la qualité de service depuis un environnement réservé aux équipes autorisées.</p>
        </div>
        <ul>
          <li><CheckCircle2 size={17} /> Données isolées par organisation</li>
          <li><CheckCircle2 size={17} /> Double authentification obligatoire</li>
          <li><CheckCircle2 size={17} /> Accès et actions journalisés</li>
        </ul>
      </section>
      <section className="admin-auth-panel" aria-labelledby="admin-login-title">
        <div className="admin-auth-card">
          <span className="admin-lock"><LockKeyhole size={23} /></span>
          {!mfa ? (
            <>
              <p className="admin-eyebrow">ADMINISTRATION</p>
              <h2 id="admin-login-title">Connexion</h2>
              <p className="admin-muted">Utilisez uniquement le compte invité par le propriétaire de la plateforme.</p>
              <form onSubmit={login} className="admin-form">
                <label>
                  Adresse email
                  <input
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="prenom@entreprise.fr"
                    required
                    maxLength={320}
                  />
                </label>
                <label>
                  Mot de passe
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={8}
                    maxLength={1024}
                  />
                </label>
                {error && <div className="admin-error" role="alert"><AlertTriangle size={16} />{error}</div>}
                <button className="admin-primary" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
                  Se connecter
                  <ArrowRight size={18} />
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="admin-eyebrow">VÉRIFICATION DE SÉCURITÉ</p>
              <h2 id="admin-login-title">Confirmez votre identité</h2>
              <p className="admin-muted">La consultation des données nécessite un second facteur.</p>
              {mfa.enrollmentRequired && !enrollment ? (
                <button className="admin-primary" disabled={busy} onClick={() => void enroll()}>
                  {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
                  Configurer mon authentificateur
                </button>
              ) : (
                <form onSubmit={verify} className="admin-form admin-mfa-form">
                  {qrSource && (
                    <div className="admin-qr-wrap">
                      {/* The QR payload is issued directly by Supabase Auth. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrSource} alt="QR code à scanner avec votre application d’authentification" />
                      <p>Scannez ce code avec votre application d’authentification.</p>
                    </div>
                  )}
                  {enrollment && (
                    <details className="admin-secret-fallback">
                      <summary>Saisie manuelle</summary>
                      <code>{enrollment.totp.secret}</code>
                    </details>
                  )}
                  {!enrollment && mfa.factors.length > 1 && (
                    <label>
                      Méthode de vérification
                      <select value={factorId} onChange={(event) => setFactorId(event.target.value)}>
                        {mfa.factors.map((factor) => <option value={factor.id} key={factor.id}>{factor.friendlyName}</option>)}
                      </select>
                    </label>
                  )}
                  <label>
                    Code à 6 chiffres
                    <input
                      className="admin-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      required
                    />
                  </label>
                  {error && <div className="admin-error" role="alert"><AlertTriangle size={16} />{error}</div>}
                  <button className="admin-primary" disabled={busy || code.length !== 6 || !factorId}>
                    {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
                    Vérifier et ouvrir
                    <ArrowRight size={18} />
                  </button>
                </form>
              )}
            </>
          )}
          <p className="admin-security-note"><LockKeyhole size={14} /> Vos identifiants ne sont jamais enregistrés dans l’application.</p>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <article className="admin-metric"><span>{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}

export default function AdminPage() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [organizationId, setOrganizationId] = useState('');
  const [search, setSearch] = useState('');

  const membership = useMemo(
    () => admin?.memberships.find((item) => item.organizationId === organizationId) ?? admin?.memberships[0] ?? null,
    [admin, organizationId],
  );

  const fetchData = useCallback(async (selectedOrganizationId: string) => {
    const params = new URLSearchParams({ organizationId: selectedOrganizationId });
    const [dashboardResult, caseResult] = await Promise.all([
      request<{ dashboard: Dashboard }>(`/admin/dashboard?${params}`),
      request<{ items: AdminCase[]; total: number }>(`/admin/cases?${params}&limit=50`),
    ]);
    return { dashboard: dashboardResult.dashboard, cases: caseResult.items, total: caseResult.total };
  }, []);

  const loadData = useCallback(async (selectedOrganizationId: string) => {
    if (!selectedOrganizationId) return;
    setBusy(true);
    setError('');
    try {
      const result = await fetchData(selectedOrganizationId);
      setDashboard(result.dashboard);
      setCases(result.cases);
      setTotalCases(result.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.');
    } finally {
      setBusy(false);
    }
  }, [fetchData]);

  useEffect(() => {
    let active = true;
    void request<{ admin: Admin }>('/admin/session')
      .then((result) => {
        if (!active) return;
        setAdmin(result.admin);
        setOrganizationId(result.admin.memberships[0]?.organizationId ?? '');
      })
      .catch((cause) => {
        if (active && cause instanceof RequestError && cause.status >= 500) setError(cause.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (organizationId) {
      void fetchData(organizationId)
        .then((result) => {
          if (!active) return;
          setDashboard(result.dashboard);
          setCases(result.cases);
          setTotalCases(result.total);
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : 'Chargement impossible.');
        });
    }
    return () => { active = false; };
  }, [organizationId, fetchData]);

  async function applySearch(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ organizationId, search, limit: '50' });
      const result = await request<{ items: AdminCase[]; total: number }>(`/admin/cases?${params}`);
      setCases(result.items);
      setTotalCases(result.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recherche impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    await request('/admin/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
    setAdmin(null);
    setDashboard(null);
    setCases([]);
    setBusy(false);
  }

  if (loading) return <main className="admin-loading"><LoaderCircle className="spin" /><span>Ouverture de l’espace sécurisé…</span></main>;
  if (!admin) return <SignIn onAuthenticated={(value) => { setAdmin(value); setOrganizationId(value.memberships[0]?.organizationId ?? ''); }} />;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand />
        <div className="admin-organization">
          <span className="admin-avatar">{(membership?.organizationName ?? 'A').slice(0, 1)}</span>
          <div><strong>{membership?.organizationName}</strong><small>{membership ? roleLabels[membership.role] : 'Administration'}</small></div>
        </div>
        <nav aria-label="Navigation de l’administration">
          <a className="active" href="#overview"><LayoutDashboard size={18} />Vue d’ensemble</a>
          <a href="#cases"><FileText size={18} />Dossiers <span>{totalCases}</span></a>
          <a href="#quality"><BarChart3 size={18} />Qualité de service</a>
        </nav>
        <div className="admin-sidebar-foot">
          <div><ShieldCheck size={17} /><span><strong>Session protégée</strong><small>MFA · Niveau AAL2</small></span></div>
          <button onClick={() => void logout()} disabled={busy}><LogOut size={17} />Déconnexion</button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div><p>Administration</p><strong>{admin.email}</strong></div>
          <div className="admin-top-actions">
            {admin.memberships.length > 1 && <select aria-label="Organisation" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{admin.memberships.map((item) => <option value={item.organizationId} key={item.organizationId}>{item.organizationName}</option>)}</select>}
            <button onClick={() => void loadData(organizationId)} disabled={busy}><RefreshCw className={busy ? 'spin' : ''} size={17} />Actualiser</button>
          </div>
        </header>
        <div className="admin-content">
          <section className="admin-heading" id="overview">
            <div><span className="admin-kicker"><Activity size={15} /> PILOTAGE OPÉRATIONNEL</span><h1>La situation, en un regard.</h1><p>Des indicateurs observés sur les données enregistrées, sans score inventé.</p></div>
            <span className="admin-live"><i />Données actualisées</span>
          </section>
          {error && <div className="admin-banner-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button onClick={() => void loadData(organizationId)}>Réessayer</button></div>}
          <section className="admin-metrics" aria-label="Indicateurs principaux">
            <Metric label="Dossiers ouverts" value={String(dashboard?.cases.open ?? 0)} detail={`${dashboard?.cases.total ?? 0} dossiers au total`} icon={<FileText />} />
            <Metric label="Échéances dépassées" value={String(dashboard?.cases.overdue ?? 0)} detail="Nécessitent une attention" icon={<Clock3 />} />
            <Metric label="Relais conseillers" value={String(dashboard?.handoffs.open ?? 0)} detail="Ouverts ou assignés" icon={<Users />} />
            <Metric label="Messages sur 24 h" value={String(dashboard?.assistant.messages_24h ?? 0)} detail={`${dashboard?.assistant.conversations_30d ?? 0} conversations sur 30 j`} icon={<MessageSquareText />} />
          </section>
          <section className="admin-quality-grid" id="quality">
            <article className="admin-panel admin-status-panel">
              <header><div><p className="admin-eyebrow">RÉPARTITION</p><h2>État des dossiers</h2></div><span>{dashboard?.cases.total ?? 0}</span></header>
              <div className="admin-status-list">
                {Object.entries(dashboard?.by_status ?? {}).length ? Object.entries(dashboard?.by_status ?? {}).sort((a, b) => b[1] - a[1]).map(([status, count]) => <div key={status}><span><i data-status={status} />{statusLabels[status] ?? status}</span><strong>{count}</strong></div>) : <p className="admin-empty">Aucun dossier enregistré.</p>}
              </div>
            </article>
            <article className="admin-panel admin-performance-panel">
              <p className="admin-eyebrow">FIABILITÉ</p><h2>Performance du service</h2>
              <div><span>Latence moyenne · 24 h</span><strong>{dashboard?.performance.avg_latency_ms_24h ?? 0} ms</strong></div>
              <div><span>Taux d’erreur · 24 h</span><strong>{dashboard?.performance.error_rate_24h ?? 0} %</strong></div>
              <div><span>Requêtes observées · 24 h</span><strong>{dashboard?.performance.requests_24h ?? 0}</strong></div>
              <p className="admin-observation"><ShieldCheck size={15} />Mesures issues des requêtes réellement enregistrées.</p>
            </article>
          </section>
          <section className="admin-panel admin-cases" id="cases">
            <header><div><p className="admin-eyebrow">DOSSIERS SAV & SC</p><h2>Activité récente</h2></div><form onSubmit={applySearch}><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Référence, produit…" maxLength={120} aria-label="Rechercher un dossier" /><button>Rechercher</button></form></header>
            <div className="admin-table-wrap">
              <table><thead><tr><th>Référence</th><th>Demande</th><th>Client</th><th>État</th><th>Échéance</th><th>Mise à jour</th></tr></thead>
                <tbody>{cases.length ? cases.map((item) => <tr key={item.id}><td><strong>{item.reference}</strong><small>{item.kind.toUpperCase()}</small></td><td><strong>{item.product ?? item.title}</strong><small>{item.store ?? 'Magasin non renseigné'}</small></td><td>{item.customer || '—'}</td><td><span className="admin-case-status"><i data-status={item.status} />{statusLabels[item.status] ?? item.status}</span></td><td>{formatDate(item.estimated_at)}</td><td>{formatDate(item.updated_at)}</td></tr>) : <tr><td colSpan={6}><div className="admin-table-empty"><FileText size={25} /><strong>Aucun dossier trouvé</strong><span>Les dossiers correspondant à votre recherche apparaîtront ici.</span></div></td></tr>}</tbody>
              </table>
            </div>
          </section>
          <footer className="admin-footer"><span>SAV SC Assistant AI · Administration</span><span>Accès contrôlé · Actions auditées</span></footer>
        </div>
      </main>
    </div>
  );
}
