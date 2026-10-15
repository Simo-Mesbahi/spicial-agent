'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Library, Plus, RefreshCw, Search } from 'lucide-react';
import AdminEntityEditor, {
  entityLabels,
  entityName,
} from '@/components/atlas/admin-entity-editor';
import { type EntityKind, type EntityList, type EntityRecord } from '@/lib/atlas/admin-business';
import { productionRequest, ProductionRequestError } from '@/lib/atlas/production-client';

export default function RecordsPage() {
  const [organization, setOrganization] = useState('');
  const [kind, setKind] = useState<EntityKind>('customer');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<EntityList | null>(null);
  const [selected, setSelected] = useState<EntityRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [denied, setDenied] = useState(false);
  const revision = useRef(0);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ProductionRequestError && [401, 403].includes(cause.status)) {
      setDenied(true);
      setData(null);
      setSelected(null);
    }
    setError(cause instanceof Error ? cause.message : 'Service indisponible.');
  }, []);
  const load = useCallback(
    async (org: string, type: EntityKind, query: string, page: number) => {
      const sequence = ++revision.current;
      setBusy(true);
      setError('');
      try {
        const result = await productionRequest<EntityList>(
          `/admin/operations/business/entities?${new URLSearchParams({ organizationId: org, kind: type, search: query, offset: String(page) })}`,
        );
        if (sequence === revision.current) {
          setData(result);
          setDenied(false);
        }
      } catch (cause) {
        if (sequence === revision.current) fail(cause);
      } finally {
        if (sequence === revision.current) setBusy(false);
      }
    },
    [fail],
  );
  useEffect(() => {
    let active = true;
    void productionRequest<{ organizationId: string }>('/admin/operations/deployment')
      .then((result) => {
        if (active) setOrganization(result.organizationId);
      })
      .catch((cause) => {
        if (active) fail(cause);
      });
    return () => {
      active = false;
    };
  }, [fail]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (organization) void load(organization, kind, appliedSearch, offset);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      invalidate();
    };
  }, [organization, kind, appliedSearch, offset, load, invalidate]);
  function searchRecords(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setAppliedSearch(search.trim());
    setOffset(0);
    if (search.trim() === appliedSearch && offset === 0)
      void load(organization, kind, appliedSearch, 0);
  }
  if (denied)
    return (
      <main className="admin-control-page">
        <section className="admin-control-card">
          <h1>Accès aux référentiels requis</h1>
          <p>
            Les fiches clients et produits sont réservées aux responsables autorisés. La gestion des
            magasins est réservée au super-administrateur.
          </p>
          <Link href="/admin">Revenir à l’administration</Link>
        </section>
      </main>
    );
  return (
    <main className="admin-control-page admin-business-page">
      <header className="admin-control-heading">
        <div>
          <p className="admin-eyebrow">FICHES MÉTIER</p>
          <h1>Clients, produits et magasins</h1>
          <p>Corrigez les données à leur source et réutilisez les fiches dans vos dossiers.</p>
        </div>
        <button
          disabled={busy || creating || !!selected || !organization}
          onClick={() => void load(organization, kind, appliedSearch, offset)}
        >
          <RefreshCw size={17} />
          Actualiser
        </button>
      </header>
      <div className="admin-control-tabs" role="group" aria-label="Type de fiche">
        {(['customer', 'product', 'store'] as const).map((type) => (
          <button
            key={type}
            aria-pressed={kind === type}
            disabled={creating || !!selected}
            onClick={() => {
              setKind(type);
              setData(null);
              setOffset(0);
              setSearch('');
              setAppliedSearch('');
              setSuccess('');
            }}
          >
            {entityLabels[type]}s
          </button>
        ))}
      </div>
      {error && (
        <p className="admin-control-alert" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="admin-control-success" role="status">
          {success}
        </p>
      )}
      <section className="admin-business-grid">
        <div className="admin-control-card">
          <div className="admin-business-list-heading">
            <h2>
              <Library size={19} />
              {entityLabels[kind]}s <small>{data?.total ?? '—'}</small>
            </h2>
            {data?.canCreate && (
              <button
                disabled={busy || creating || !!selected}
                onClick={() => {
                  setCreating(true);
                  setSuccess('');
                }}
              >
                <Plus size={16} />
                Nouvelle fiche
              </button>
            )}
          </div>
          <form className="admin-business-search" onSubmit={searchRecords}>
            <label>
              <Search size={16} />
              <input
                aria-label="Rechercher une fiche"
                maxLength={120}
                placeholder="Nom, référence, coordonnées…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button disabled={busy || creating || !!selected}>Rechercher</button>
          </form>
          <div className="admin-business-list" aria-busy={busy}>
            {data?.items.map((item) => (
              <button
                key={item.id}
                disabled={creating || !!selected}
                onClick={() => {
                  setSelected(item);
                  setSuccess('');
                }}
              >
                <strong>{entityName(item)}</strong>
                <span>
                  {String(
                    item.data.email ||
                      item.data.sku ||
                      item.data.code ||
                      item.data.external_id ||
                      'Sans référence externe',
                  )}
                </span>
                <small>
                  {item.linkedCases} dossier(s) · version {item.revision}
                  {item.kind === 'store' && item.data.active === false ? ' · inactif' : ''}
                </small>
              </button>
            ))}
            {data && !data.items.length && (
              <p className="admin-business-empty">Aucune fiche pour cette recherche.</p>
            )}
          </div>
          <nav className="admin-business-pagination" aria-label="Pages des fiches">
            <span>
              {data?.total
                ? `${offset + 1}–${offset + (data?.items.length ?? 0)} sur ${data.total}`
                : '0 résultat'}
            </span>
            <button
              disabled={busy || creating || !!selected || offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 30))}
            >
              Précédent
            </button>
            <button
              disabled={
                busy || creating || !!selected || !data || offset + data.items.length >= data.total
              }
              onClick={() => setOffset((value) => value + 30)}
            >
              Suivant
            </button>
          </nav>
        </div>
        <div className="admin-control-card">
          {creating || selected ? (
            <AdminEntityEditor
              key={`${kind}:${selected?.id ?? 'new'}:${selected?.revision ?? 0}`}
              organizationId={organization}
              kind={kind}
              record={selected}
              onCancel={() => {
                setSelected(null);
                setCreating(false);
              }}
              onSaved={(value) => {
                setSelected(null);
                setCreating(false);
                setSuccess(
                  `${entityLabels[value.kind]} enregistré. Les corrections sont auditées.`,
                );
                void load(organization, kind, appliedSearch, offset);
              }}
            />
          ) : (
            <div className="admin-business-empty">
              <Library size={30} />
              <h2>Une fiche, plusieurs dossiers</h2>
              <p>
                Sélectionnez une fiche ou créez-en une nouvelle. Les modifications partagées
                demandent une confirmation.
              </p>
              <p>
                Les fiches liées à plusieurs services nécessitent un super-administrateur pour leur
                correction.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
