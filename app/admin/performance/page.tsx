'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, CheckCircle2, History, RefreshCw, Save, Search, ShieldCheck } from 'lucide-react';
import { productionRequest as request, ProductionRequestError } from '@/lib/atlas/production-client';
import type { RuntimeConfig } from '@/lib/atlas/runtime-settings';

type Settings = { effectiveProvider: string; providerWarning: string | null; environment: string; canEdit: boolean; revision: number; config: RuntimeConfig; budget: string; scope: string;
  providers: {provider: string; model: string; label: string; available: boolean; reason: string | null}[];
  history: {revision: number; actor: string; createdAt: number; config: RuntimeConfig}[] };
type Overview = { generated_at: string; performance: {requests_24h: number; error_rate_24h: number | null; p95_latency_ms_24h: number | null; rate_limited_24h: number}; routes: {route: string; requests: number; errors: number; avg_ms: number | null}[] };
type ReleaseOverview = {
  metrics: {
    generated_at: string;
    period_hours: number;
    events: number;
    release_modes: Record<string, number>;
    canary: { selected: number; attempted: number; released: number; blocked: number; release_rate: number | null };
    quality: { invariant_violations: number; generation_failed: number; validation_failed: number; evidence_invalidated: number; invalid_candidate: number; configuration_blocked: number };
    latency: { p50_ms: number | null; p95_ms: number | null };
    usage: { provider_calls: number; input_tokens: number | null; output_tokens: number | null };
    by_reason: Record<string, number>;
    by_plan: Record<string, number>;
  };
  configuration: {
    environment: string;
    mode: 'off' | 'shadow' | 'canary' | 'on';
    ready: boolean;
    canaryPercent: number;
    modelConfigured: boolean;
    embeddingConfigured: boolean;
    issues: string[];
  };
};
type Document = { id: string; title: string; body: string; version: string; effective: string };

export default function PerformancePage() {
  const [organization, setOrganization] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<RuntimeConfig | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [releaseOverview, setReleaseOverview] = useState<ReleaseOverview | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [tab, setTab] = useState<'metrics' | 'settings'>('metrics');
  const [confirmation, setConfirmation] = useState(false);
  const [query, setQuery] = useState('Comment fonctionne la garantie ?');
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const dirty = !!settings && !!draft && JSON.stringify(draft) !== JSON.stringify(settings.config);
  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof ProductionRequestError && (cause.status === 401 || cause.code === 'mfa_required')) { setNeedsLogin(true); setSettings(null); setDraft(null); setOverview(null); setReleaseOverview(null); }
    setError(cause instanceof Error ? cause.message : 'Le service est indisponible. Réessayez.');
  }, []);
  const load = useCallback(async (org: string) => {
    const suffix = `?organizationId=${encodeURIComponent(org)}`;
    const [configResult, metricsResult, releaseResult] = await Promise.allSettled([
      request<Settings>(`/admin/operations/settings${suffix}`),
      request<{overview: Overview}>(`/admin/operations/overview${suffix}`),
      request<ReleaseOverview>(`/admin/p1-release${suffix}&hours=24`),
    ]);
    // An authentication failure must clear all data, including fulfilled siblings.
    const denied = [configResult, metricsResult, releaseResult].find(result => result.status === 'rejected' && result.reason instanceof ProductionRequestError && (result.reason.status === 401 || result.reason.code === 'mfa_required'));
    if (denied?.status === 'rejected') throw denied.reason;
    if (configResult.status === 'fulfilled') { setSettings(configResult.value); setDraft(configResult.value.config); setConfirmation(false); } else handleError(configResult.reason);
    if (metricsResult.status === 'fulfilled') setOverview(metricsResult.value.overview); else handleError(metricsResult.reason);
    if (releaseResult.status === 'fulfilled') setReleaseOverview(releaseResult.value); else handleError(releaseResult.reason);
  }, [handleError]);
  useEffect(() => { let active = true; void (async () => {
    try {
      const deployment = await request<{organizationId: string}>('/admin/operations/deployment');
      if (!active) return;
      const org = deployment.organizationId;
      setOrganization(org); await load(org);
    } catch (cause) { if (active) handleError(cause); }
    finally { if (active) setLoading(false); }
  })(); return () => { active = false; }; }, [load, handleError]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function refresh() { setBusy(true); setError(''); try { await load(organization); } catch (cause) { handleError(cause); } finally { setBusy(false); } }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || !settings || !confirmation) return;
    setBusy(true); setError(''); setSuccess('');
    try { await request(`/admin/operations/settings?organizationId=${encodeURIComponent(organization)}`, {method:'POST', body:JSON.stringify({revision:settings.revision,config:draft,confirmEnvironment:settings.environment})});
      await load(organization); setSuccess('Réglages enregistrés. Ils s’appliquent aux prochaines requêtes du chat.');
    } catch (cause) { handleError(cause); } finally { setBusy(false); }
  }
  async function preview() {
    if (!draft) return; setBusy(true); setError(''); setDocuments(null);
    try { const result = await request<{documents: Document[]}>(`/admin/operations/settings/preview?organizationId=${encodeURIComponent(organization)}`, {method:'POST',body:JSON.stringify({query,ragResults:draft.ragResults,ragMinAnchors:draft.ragMinAnchors})}); setDocuments(result.documents); }
    catch (cause) { handleError(cause); } finally { setBusy(false); }
  }
  function update<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]) { setDraft(current => current ? {...current,[key]:value} : current); setConfirmation(false); setSuccess(''); setDocuments(null); }
  if (loading) return <main className="admin-loading"><RefreshCw className="spin"/>Chargement du pilotage…</main>;
  if (needsLogin) return <main className="admin-control-page"><section className="admin-control-card"><ShieldCheck/><h1>Connectez-vous à l’administration</h1><p>Votre compte et la double authentification protègent les réglages.</p><Link href="/admin">Ouvrir la connexion sécurisée</Link></section></main>;
  return <main className="admin-control-page">
    <header className="admin-control-heading"><div><p className="admin-eyebrow">PILOTAGE DU SERVICE</p><h1>Performance</h1><p>Mesurer le service et ajuster l’assistant depuis le même espace.</p></div><button disabled={busy || dirty} onClick={() => void refresh()}><RefreshCw size={17} className={busy ? 'spin' : ''}/>Actualiser</button></header>
    {error && <p className="admin-control-alert" role="alert"><AlertTriangle size={18}/>{error}</p>}
    {success && <p className="admin-control-success" role="status"><CheckCircle2 size={18}/>{success}</p>}
    <div className="admin-control-tabs" role="group" aria-label="Vue performance"><button aria-pressed={tab==='metrics'} onClick={()=>setTab('metrics')}>Indicateurs</button><button aria-pressed={tab==='settings'} onClick={()=>setTab('settings')}>Réglages de l’assistant {dirty && '· non enregistrés'}</button></div>
    {tab === 'metrics' ? <>
      <section className="admin-control-metrics" aria-label="Performances sur 24 heures">{[
        ['Requêtes observées', overview?.performance.requests_24h], ['Latence P95', overview?.performance.p95_latency_ms_24h, ' ms'],
        ['Taux d’erreur', overview?.performance.error_rate_24h, ' %'], ['Requêtes limitées', overview?.performance.rate_limited_24h],
      ].map(([label,value,suffix]) => <article className="admin-control-card" key={String(label)}><span>{label}</span><strong>{value == null ? '—' : `${value}${suffix ?? ''}`}</strong><small>24 dernières heures</small></article>)}</section>
      <section className="admin-control-card">
        <h2><ShieldCheck size={19}/>Déploiement P1.7</h2>
        <p>
          Mode runtime : <strong>{releaseOverview?.configuration.mode.toUpperCase() ?? '—'}</strong>
          {releaseOverview?.configuration.mode === 'canary' ? ` · ${releaseOverview.configuration.canaryPercent}%` : ''}
          {' · '}Configuration runtime : <strong>{releaseOverview?.configuration.ready ? 'complète' : 'non armée'}</strong>
        </p>
        <p>Ces indicateurs ne contiennent ni message client, ni réponse générée, ni identifiant de dossier. La progression du canary reste manuelle et la qualification live/humaine reste obligatoire.</p>
        <section className="admin-control-metrics" aria-label="Observabilité du déploiement P1.7">{[
          ['Échantillon canary', releaseOverview?.metrics.canary.selected],
          ['Tentatives naturelles', releaseOverview?.metrics.canary.attempted],
          ['Réponses libérées', releaseOverview?.metrics.canary.released],
          ['Violations d’invariant', releaseOverview?.metrics.quality.invariant_violations],
        ].map(([label,value]) => <article className="admin-control-card" key={String(label)}><span>{label}</span><strong>{value == null ? '—' : String(value)}</strong><small>{releaseOverview ? `${releaseOverview.metrics.period_hours} dernières heures` : '24 dernières heures'}</small></article>)}</section>
        <div className="admin-control-table"><table><thead><tr><th>Signal</th><th>Valeur</th></tr></thead><tbody>
          <tr><th>Taux de libération canary</th><td>{releaseOverview?.metrics.canary.release_rate == null ? '—' : `${releaseOverview.metrics.canary.release_rate} %`}</td></tr>
          <tr><th>Replis après validation</th><td>{releaseOverview?.metrics.quality.validation_failed ?? '—'}</td></tr>
          <tr><th>Preuves invalidées / indisponibles</th><td>{releaseOverview?.metrics.quality.evidence_invalidated ?? '—'}</td></tr>
          <tr><th>Échecs de génération</th><td>{releaseOverview?.metrics.quality.generation_failed ?? '—'}</td></tr>
          <tr><th>Latence P95 observée</th><td>{releaseOverview?.metrics.latency.p95_ms == null ? '—' : `${releaseOverview.metrics.latency.p95_ms} ms`}</td></tr>
          <tr><th>Appels fournisseur</th><td>{releaseOverview?.metrics.usage.provider_calls ?? '—'}</td></tr>
        </tbody></table></div>
        {!!releaseOverview?.configuration.issues.length && <details><summary>Configuration à compléter</summary>{releaseOverview.configuration.issues.map(issue=><p key={issue}>{issue}</p>)}</details>}
      </section>
      <section className="admin-control-card"><h2><Activity size={19}/>Performance par service</h2><p>{overview ? `Actualisé le ${new Date(overview.generated_at).toLocaleString('fr-FR')}` : 'Aucune mesure disponible.'}</p><div className="admin-control-table"><table><thead><tr><th>Service</th><th>Requêtes</th><th>Erreurs</th><th>Latence moyenne</th></tr></thead><tbody>{overview?.routes.map(route=><tr key={route.route}><th>{route.route}</th><td>{route.requests}</td><td>{route.errors}</td><td>{route.avg_ms == null ? '—' : `${route.avg_ms} ms`}</td></tr>)}</tbody></table></div>{!overview?.routes.length && <p>Aucune requête mesurée sur cette période. Les valeurs apparaîtront avec l’activité.</p>}</section>
    </> : settings && draft ? <>
      <section className="admin-control-scope"><ShieldCheck size={20}/><div><strong>{settings.scope}</strong><p>Ces réglages ne connectent pas le chat aux dossiers Supabase. Les clés et la politique de budget restent gérées côté serveur.</p></div><span>Budget : {settings.budget}</span></section>
      {!settings.canEdit && <p>Votre rôle permet de consulter les réglages. Leur modification est réservée au super-administrateur.</p>}
      <form onSubmit={save} className="admin-control-form">
        <fieldset disabled={!settings.canEdit || busy} className="admin-control-card"><legend>Modèle et consommation</legend>
          <p>Mode effectif : <strong>{settings.effectiveProvider}</strong>.{settings.providerWarning && ` Repli documentaire : ${settings.providerWarning}`}</p>
          <label>Modèle connecté<select value={`${draft.provider}|${draft.model}`} onChange={event=>{const [provider,model]=event.target.value.split('|');setDraft({...draft,provider:provider as RuntimeConfig['provider'],model});setConfirmation(false);setSuccess('');}}>
            {!settings.providers.some(item=>item.provider===draft.provider && item.model===draft.model) && <option value={`${draft.provider}|${draft.model}`}>{draft.provider} · réglage serveur actuel</option>}
            {settings.providers.map(item=><option key={`${item.provider}|${item.model}`} value={`${item.provider}|${item.model}`} disabled={!item.available}>{item.label}{!item.available ? ' · indisponible' : ''}</option>)}
          </select></label>
          <details><summary>Disponibilité des fournisseurs</summary>{settings.providers.filter(item=>!item.available).map(item=><p key={item.model}>{item.label} : {item.reason}</p>)}<p>Disponible signifie configuré, pas testé en direct avec le fournisseur.</p></details>
          <label>Conversations IA maximum par 24 heures<input type="number" min={0} max={10000} required value={draft.dailyLimit} onChange={event=>update('dailyLimit',event.target.valueAsNumber)}/></label><p>0 suspend les appels au modèle. Les réponses documentaires restent disponibles. Ce quota partagé n’est pas un plafond de facturation.</p>
        </fieldset>
        <fieldset disabled={!settings.canEdit || busy} className="admin-control-card"><legend>Recherche documentaire</legend>
          <label>Documents proposés au modèle<select value={draft.ragResults} onChange={event=>update('ragResults',Number(event.target.value))}><option value={1}>1 · contexte ciblé</option><option value={2}>2 · contexte intermédiaire</option><option value={3}>3 · contexte élargi</option></select></label>
          <label>Précision de la recherche<select value={draft.ragMinAnchors} onChange={event=>update('ragMinAnchors',Number(event.target.value))}><option value={1}>Standard · au moins un mot pertinent</option><option value={2}>Stricte · au moins deux mots pertinents</option><option value={3}>Très stricte · au moins trois mots pertinents</option></select></label><p>Une recherche plus stricte peut écarter les questions courtes. Les réponses restent limitées aux informations vérifiées.</p>
          <label>Question d’essai<input maxLength={1000} value={query} onChange={event=>{setQuery(event.target.value);setDocuments(null);}}/></label><button type="button" disabled={query.trim().length<3} onClick={()=>void preview()}><Search size={16}/>Tester la recherche</button>
          {documents && <div aria-live="polite">{documents.length ? documents.map(document=><details key={document.id}><summary>{document.title} · v{document.version}</summary><p>{document.body}</p><small>Application : {document.effective}</small></details>) : <p>Aucune source retenue. Essayez une formulation plus précise ou une recherche moins stricte.</p>}</div>}
        </fieldset>
        {settings.canEdit && <section className="admin-control-save"><div><strong>{dirty ? 'Modifications à enregistrer' : `Configuration enregistrée · version ${settings.revision}`}</strong><label className="admin-control-confirm"><input type="checkbox" checked={confirmation} disabled={!dirty || busy || settings.environment==='NON CONFIGURÉ'} onChange={event=>setConfirmation(event.target.checked)}/>Je confirme l’application sur {settings.environment}.</label></div><button type="button" disabled={!dirty || busy} onClick={()=>{setDraft(settings.config);setConfirmation(false);setDocuments(null);}}>Annuler les modifications</button><button type="submit" disabled={!dirty || !confirmation || busy}><Save size={16}/>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></section>}
      </form>
      <section className="admin-control-card"><h2><History size={19}/>Historique des réglages</h2><p>Les 10 dernières versions de cet environnement. Reprendre une version prépare les valeurs sans les appliquer.</p>{settings.history.length ? <ol className="admin-control-history">{settings.history.map(item=><li key={item.revision}><div><strong>Version {item.revision} · {item.config.provider}</strong><span>{new Date(item.createdAt).toLocaleString('fr-FR')}</span><small>Administrateur : {item.actor}</small></div>{settings.canEdit && <button disabled={busy || item.revision===settings.revision} onClick={()=>{setDraft(item.config);setConfirmation(false);setDocuments(null);setSuccess('Version reprise dans le formulaire. Vérifiez puis confirmez son enregistrement.');}}>Reprendre</button>}</li>)}</ol> : <p>Aucune modification. Les paramètres du serveur sont utilisés.</p>}</section>
    </> : <section className="admin-control-card"><h2>Réglages indisponibles</h2><p>Consultez le message ci-dessus, puis actualisez après correction.</p></section>}
  </main>;
}
