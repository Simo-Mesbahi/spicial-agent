'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Archive,
  BookOpenCheck,
  CheckCircle2,
  FileClock,
  FilePlus2,
  History,
  Library,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { productionRequest as request, ProductionRequestError } from '@/lib/atlas/production-client';
import type { KnowledgeStatus } from '@/lib/atlas/knowledge-control';

type DocumentSummary = {
  id: string;
  series_id: string;
  revision: number;
  lock_version: number;
  title: string;
  category: string;
  version: string;
  summary: string | null;
  locale: string;
  market: string;
  tags: string[];
  source_url: string | null;
  effective_from: string | null;
  effective_until: string | null;
  status: KnowledgeStatus;
  published_at: string | null;
  archived_at: string | null;
  updated_at: string;
  chunk_count: number;
};

type DocumentDetail = DocumentSummary & {
  content: string;
  checksum: string;
  supersedes_id: string | null;
};

type KnowledgeList = {
  items: DocumentSummary[];
  total: number;
  counts: { draft: number; review: number; published: number; archived: number; expired: number };
  permissions: { canEdit: boolean; canPublish: boolean };
};

type Draft = {
  title: string;
  category: string;
  version: string;
  summary: string;
  content: string;
  locale: string;
  market: string;
  tags: string;
  sourceUrl: string;
  effectiveFrom: string;
  effectiveUntil: string;
};

const emptyDraft: Draft = {
  title: '',
  category: 'SAV',
  version: '1.0',
  summary: '',
  content: '',
  locale: 'fr-FR',
  market: 'GLOBAL',
  tags: '',
  sourceUrl: '',
  effectiveFrom: '',
  effectiveUntil: '',
};

const labels: Record<KnowledgeStatus, string> = {
  draft: 'Brouillon',
  review: 'À valider',
  published: 'Publié',
  archived: 'Archivé',
};

function toPayload(draft: Draft) {
  return {
    title: draft.title.trim(),
    category: draft.category.trim(),
    version: draft.version.trim(),
    summary: draft.summary.trim(),
    content: draft.content.trim(),
    locale: draft.locale.trim(),
    market: draft.market.trim().toUpperCase(),
    tags: [...new Set(draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean))],
    sourceUrl: draft.sourceUrl.trim(),
    effectiveFrom: draft.effectiveFrom || null,
    effectiveUntil: draft.effectiveUntil || null,
  };
}

function fromDocument(document: DocumentDetail): Draft {
  return {
    title: document.title,
    category: document.category,
    version: document.version,
    summary: document.summary ?? '',
    content: document.content,
    locale: document.locale,
    market: document.market,
    tags: document.tags.join(', '),
    sourceUrl: document.source_url ?? '',
    effectiveFrom: document.effective_from ?? '',
    effectiveUntil: document.effective_until ?? '',
  };
}

export default function KnowledgePage() {
  const [organization, setOrganization] = useState('');
  const [data, setData] = useState<KnowledgeList | null>(null);
  const [selected, setSelected] = useState<DocumentDetail | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<'all' | KnowledgeStatus>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('Comment fonctionne la garantie ?');
  const [preview, setPreview] = useState<{ title: string; version: string; content: string; rank: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const dirty = useMemo(
    () => !!selected && JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(fromDocument(selected))),
    [draft, selected],
  );

  const handleError = useCallback((cause: unknown) => {
    if (
      cause instanceof ProductionRequestError &&
      (cause.status === 401 || cause.code === 'mfa_required')
    ) {
      setNeedsLogin(true);
      setData(null);
      setSelected(null);
    }
    setError(cause instanceof Error ? cause.message : 'Le service documentaire est indisponible.');
  }, []);

  const load = useCallback(
    async (org: string, nextStatus = status, nextSearch = search) => {
      const params = new URLSearchParams({ organizationId: org, limit: '100' });
      if (nextStatus !== 'all') params.set('status', nextStatus);
      if (nextSearch.trim()) params.set('search', nextSearch.trim());
      const result = await request<KnowledgeList>(`/admin/operations/knowledge?${params}`);
      setData(result);
      return result;
    },
    [search, status],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const deployment = await request<{ organizationId: string }>('/admin/operations/deployment');
        if (!active) return;
        setOrganization(deployment.organizationId);
        await load(deployment.organizationId, 'all', '');
      } catch (cause) {
        if (active) handleError(cause);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [handleError, load]);

  async function refresh() {
    if (!organization || dirty) return;
    setBusy(true);
    setError('');
    try {
      await load(organization);
      if (selected) await openDocument(selected.id);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(id: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await request<{ document: DocumentDetail }>(
        `/admin/operations/knowledge/document?organizationId=${encodeURIComponent(organization)}&documentId=${encodeURIComponent(id)}`,
      );
      setSelected(result.document);
      setDraft(fromDocument(result.document));
      setCreating(false);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  function newDocument() {
    setSelected(null);
    setDraft(emptyDraft);
    setCreating(true);
    setError('');
    setSuccess('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organization || !data?.permissions.canEdit) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (creating) {
        const result = await request<{ id: string }>('/admin/operations/knowledge/create', {
          method: 'POST',
          body: JSON.stringify({ organizationId: organization, document: toPayload(draft) }),
        });
        await load(organization);
        await openDocument(result.id);
        setSuccess('Brouillon créé. Relisez-le avant de demander sa validation.');
      } else if (selected) {
        await request('/admin/operations/knowledge/update', {
          method: 'POST',
          body: JSON.stringify({
            organizationId: organization,
            documentId: selected.id,
            expectedLockVersion: selected.lock_version,
            document: toPayload(draft),
          }),
        });
        await load(organization);
        await openDocument(selected.id);
        setSuccess('Brouillon enregistré. Toute modification repasse volontairement le document en brouillon.');
      }
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function workflow(action: 'review' | 'publish' | 'archive') {
    if (!selected) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await request<{ chunks?: number }>(`/admin/operations/knowledge/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          organizationId: organization,
          documentId: selected.id,
          expectedLockVersion: selected.lock_version,
        }),
      });
      await load(organization);
      await openDocument(selected.id);
      setSuccess(
        action === 'review'
          ? 'Document envoyé en validation.'
          : action === 'publish'
            ? `Version publiée et indexée en ${result.chunks ?? 'plusieurs'} segment(s).`
            : 'Document archivé. Il ne sera plus proposé au RAG.',
      );
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function createRevision() {
    if (!selected) return;
    const next = window.prompt('Nouvelle version métier (ex. 2.0)', selected.version);
    if (!next?.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ id: string }>('/admin/operations/knowledge/revision', {
        method: 'POST',
        body: JSON.stringify({ organizationId: organization, documentId: selected.id, version: next.trim() }),
      });
      await load(organization);
      await openDocument(result.id);
      setSuccess('Nouvelle révision créée en brouillon. La version publiée reste inchangée jusqu’à validation.');
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function testSearch() {
    if (!query.trim() || !organization) return;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const result = await request<{ results: { title: string; version: string; content: string; rank: number }[] }>(
        '/admin/operations/knowledge/search',
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId: organization,
            query: query.trim(),
            limit: 5,
            locale: null,
            market: null,
          }),
        },
      );
      setPreview(result.results);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return <main className="admin-loading"><RefreshCw className="spin" />Chargement de la base de connaissances…</main>;

  if (needsLogin)
    return (
      <main className="admin-control-page">
        <section className="admin-control-card">
          <ShieldCheck />
          <h1>Connexion administrateur requise</h1>
          <p>La base documentaire exige une session MFA active.</p>
          <Link href="/admin">Ouvrir la connexion sécurisée</Link>
        </section>
      </main>
    );

  return (
    <main className="admin-control-page knowledge-page">
      <header className="admin-control-heading">
        <div>
          <p className="admin-eyebrow">KNOWLEDGE CONTROL PLANE</p>
          <h1>Base de connaissances</h1>
          <p>Créer, faire valider, publier et versionner les procédures utilisées par l’assistant.</p>
        </div>
        <div className="knowledge-heading-actions">
          <button disabled={busy || dirty} onClick={() => void refresh()}><RefreshCw size={17} className={busy ? 'spin' : ''}/>Actualiser</button>
          {data?.permissions.canEdit && <button className="knowledge-primary" onClick={newDocument}><FilePlus2 size={17}/>Nouvelle procédure</button>}
        </div>
      </header>

      {error && <p className="admin-control-alert" role="alert"><X size={18}/>{error}</p>}
      {success && <p className="admin-control-success" role="status"><CheckCircle2 size={18}/>{success}</p>}

      <section className="knowledge-metrics">
        {[
          ['Publiés', data?.counts.published ?? 0, <BookOpenCheck key="a" size={18}/>],
          ['À valider', data?.counts.review ?? 0, <FileClock key="b" size={18}/>],
          ['Brouillons', data?.counts.draft ?? 0, <History key="c" size={18}/>],
          ['Expirés', data?.counts.expired ?? 0, <Archive key="d" size={18}/>],
        ].map(([label,value,icon]) => <article className="admin-control-card" key={String(label)}><span className="knowledge-metric-icon">{icon}</span><small>{label}</small><strong>{value}</strong></article>)}
      </section>

      <section className="knowledge-workspace">
        <aside className="admin-control-card knowledge-list">
          <div className="knowledge-list-title"><Library size={19}/><div><strong>Procédures</strong><small>{data?.total ?? 0} résultat(s)</small></div></div>
          <div className="knowledge-filters">
            <label><Search size={15}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Rechercher…"/></label>
            <select value={status} onChange={(e)=>setStatus(e.target.value as typeof status)}>
              <option value="all">Tous les statuts</option>
              <option value="draft">Brouillons</option>
              <option value="review">À valider</option>
              <option value="published">Publiés</option>
              <option value="archived">Archivés</option>
            </select>
            <button disabled={busy || dirty} onClick={()=>void load(organization)}>Filtrer</button>
          </div>
          <div className="knowledge-items">
            {data?.items.map((item) => (
              <button key={item.id} className={selected?.id===item.id ? 'active' : ''} onClick={()=>void openDocument(item.id)} disabled={busy || (dirty && selected?.id!==item.id)}>
                <span><strong>{item.title}</strong><small>{item.category} · v{item.version} · {item.locale}/{item.market}</small></span>
                <span className={`knowledge-status ${item.status}`}>{labels[item.status]}</span>
              </button>
            ))}
            {!data?.items.length && <p className="knowledge-empty">Aucun document pour ce filtre.</p>}
          </div>
        </aside>

        <section className="admin-control-card knowledge-editor">
          {!selected && !creating ? (
            <div className="knowledge-empty-state"><Sparkles size={28}/><h2>Sélectionnez une procédure</h2><p>Les versions publiées sont immuables. Une évolution crée une nouvelle révision contrôlée.</p></div>
          ) : (
            <form onSubmit={save}>
              <div className="knowledge-editor-heading">
                <div>
                  <p className="admin-eyebrow">{creating ? 'NOUVEAU BROUILLON' : `RÉVISION ${selected?.revision} · ${selected ? labels[selected.status] : ''}`}</p>
                  <h2>{creating ? 'Nouvelle procédure' : selected?.title}</h2>
                  {selected && <small>Verrou optimiste #{selected.lock_version} · {selected.chunk_count} segment(s) indexé(s)</small>}
                </div>
                {!creating && selected?.status === 'published' && data?.permissions.canEdit && <button type="button" onClick={()=>void createRevision()}><FilePlus2 size={16}/>Nouvelle version</button>}
              </div>

              <fieldset disabled={busy || (!creating && !!selected && ['published','archived'].includes(selected.status)) || !data?.permissions.canEdit}>
                <div className="knowledge-grid">
                  <label>Titre<input required maxLength={240} value={draft.title} onChange={(e)=>setDraft({...draft,title:e.target.value})}/></label>
                  <label>Catégorie<input required maxLength={120} value={draft.category} onChange={(e)=>setDraft({...draft,category:e.target.value})}/></label>
                  <label>Version métier<input required maxLength={80} value={draft.version} onChange={(e)=>setDraft({...draft,version:e.target.value})}/></label>
                  <label>Langue<input required pattern="[a-z]{2}(-[A-Z]{2})?" value={draft.locale} onChange={(e)=>setDraft({...draft,locale:e.target.value})}/></label>
                  <label>Marché<input required maxLength={16} value={draft.market} onChange={(e)=>setDraft({...draft,market:e.target.value.toUpperCase()})}/></label>
                  <label>Tags<input maxLength={1200} value={draft.tags} onChange={(e)=>setDraft({...draft,tags:e.target.value})} placeholder="garantie, sav, diagnostic"/></label>
                  <label>Application à partir du<input type="date" value={draft.effectiveFrom} onChange={(e)=>setDraft({...draft,effectiveFrom:e.target.value})}/></label>
                  <label>Fin d’application<input type="date" value={draft.effectiveUntil} onChange={(e)=>setDraft({...draft,effectiveUntil:e.target.value})}/></label>
                </div>
                <label>Résumé<textarea rows={3} maxLength={1000} value={draft.summary} onChange={(e)=>setDraft({...draft,summary:e.target.value})}/></label>
                <label>Contenu de la procédure<textarea className="knowledge-content" required minLength={20} maxLength={120000} value={draft.content} onChange={(e)=>setDraft({...draft,content:e.target.value})}/></label>
                <label>Source de référence<input type="url" maxLength={2000} value={draft.sourceUrl} onChange={(e)=>setDraft({...draft,sourceUrl:e.target.value})} placeholder="https://…"/></label>
              </fieldset>

              <div className="knowledge-actions">
                {(creating || (selected && ['draft','review'].includes(selected.status))) && data?.permissions.canEdit && <button className="knowledge-primary" disabled={busy || (!creating && !dirty)} type="submit">{busy ? 'Enregistrement…' : creating ? 'Créer le brouillon' : 'Enregistrer'}</button>}
                {selected?.status === 'draft' && data?.permissions.canEdit && !dirty && <button type="button" onClick={()=>void workflow('review')}><Send size={16}/>Demander validation</button>}
                {selected?.status === 'review' && data?.permissions.canPublish && !dirty && <button className="knowledge-primary" type="button" onClick={()=>void workflow('publish')}><BookOpenCheck size={16}/>Publier & indexer</button>}
                {selected && selected.status !== 'archived' && data?.permissions.canPublish && !dirty && <button className="knowledge-danger" type="button" onClick={()=>void workflow('archive')}><Archive size={16}/>Archiver</button>}
              </div>
            </form>
          )}
        </section>
      </section>

      <section className="admin-control-card knowledge-rag-test">
        <div><p className="admin-eyebrow">RAG VALIDATION</p><h2>Tester la recherche publiée</h2><p>Seules les versions publiées, en vigueur et autorisées pour l’organisation sont interrogées.</p></div>
        <div className="knowledge-search-row"><input maxLength={500} value={query} onChange={(e)=>setQuery(e.target.value)}/><button disabled={busy || query.trim().length<2} onClick={()=>void testSearch()}><Search size={16}/>Tester</button></div>
        {preview && <div className="knowledge-preview">{preview.length ? preview.map((item,index)=><details key={`${item.title}-${index}`}><summary>{item.title} · v{item.version} · score {item.rank.toFixed(3)}</summary><p>{item.content}</p></details>) : <p>Aucune procédure publiée pertinente.</p>}</div>}
      </section>
    </main>
  );
}
