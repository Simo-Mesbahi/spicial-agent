'use client';

import { useRef, useState } from 'react';
import { History, Mail, Pencil, RotateCcw, Search } from 'lucide-react';
import AdminEntityEditor, { entityName } from './admin-entity-editor';
import { productionRequest } from '@/lib/atlas/production-client';
import { type EntityRecord } from '@/lib/atlas/admin-business';
import { useAdminLifetime } from './use-admin-lifetime';

const base = '/admin/operations/business';
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  conversationId: string;
};
type Messages = {
  items: Message[];
  hasMore: boolean;
  nextCursor: { createdAt: string; id: string } | null;
};

export function AdminEntitySelector({
  organizationId,
  kind,
  value,
  initialLabel,
  onChange,
}: {
  organizationId: string;
  kind: 'customer' | 'product';
  value: string;
  initialLabel: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const active = useAdminLifetime();
  const [items, setItems] = useState<
    { id: string; name?: string; display_name?: string; email?: string; external_id?: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState(initialLabel);
  async function search() {
    if (query.trim().length < 3 || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await productionRequest<{ items: typeof items }>(
        `/admin/operations/case/entities?${new URLSearchParams({ organizationId, type: kind, q: query.trim() })}`,
      );
      if (active.current) setItems(result.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recherche impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-business-selector">
      <strong>{kind === 'customer' ? 'Client associé' : 'Produit associé'}</strong>
      <p>{value ? label : 'Aucune fiche associée'}</p>
      <div className="admin-business-search">
        <input
          disabled={busy}
          aria-label={
            kind === 'customer' ? 'Rechercher un autre client' : 'Rechercher un autre produit'
          }
          maxLength={80}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Au moins 3 caractères…"
        />
        <button
          type="button"
          disabled={busy || query.trim().length < 3}
          onClick={() => void search()}
        >
          <Search size={16} />
          Chercher
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="admin-business-selector-results">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onChange(item.id);
              setLabel(
                item.display_name ||
                  item.name ||
                  item.email ||
                  item.external_id ||
                  'Fiche sélectionnée',
              );
              setItems([]);
              setQuery('');
            }}
          >
            Associer{' '}
            {item.display_name || item.name || item.email || item.external_id || 'cette fiche'}
          </button>
        ))}
      </div>
      {value && (
        <button
          type="button"
          className="admin-business-link"
          onClick={() => {
            onChange('');
            setLabel('');
          }}
        >
          Retirer l’association
        </button>
      )}
    </div>
  );
}

export default function AdminCaseBusiness({
  organizationId,
  caseId,
  reference,
  version,
  archived,
  canManage,
  customerId,
  productId,
  customerEmail,
  onChanged,
}: {
  organizationId: string;
  caseId: string;
  reference: string;
  version: number;
  archived: boolean;
  canManage: boolean;
  customerId: string | null;
  productId: string | null;
  customerEmail: string | null;
  onChanged: (message?: string) => Promise<void>;
}) {
  const active = useAdminLifetime();
  const [record, setRecord] = useState<EntityRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [messages, setMessages] = useState<Messages | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const restoreCommand = useRef<{ fingerprint: string; id: string } | null>(null);
  async function edit(kind: 'customer' | 'product', id: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await productionRequest<EntityRecord>(
        `${base}/entity?${new URLSearchParams({ organizationId, kind, id })}`,
      );
      if (active.current) setRecord(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fiche indisponible.');
    } finally {
      setBusy(false);
    }
  }
  async function loadMessages(older = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    const params = new URLSearchParams({ organizationId, caseId });
    if (older && messages?.nextCursor) {
      params.set('beforeTime', messages.nextCursor.createdAt);
      params.set('beforeId', messages.nextCursor.id);
    }
    try {
      const result = await productionRequest<Messages>(`${base}/messages?${params}`);
      if (!active.current) return;
      setMessages((current) =>
        older && current ? { ...result, items: [...result.items, ...current.items] } : result,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Historique indisponible.');
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (busy || !confirmed || reason.trim().length < 3) return;
    setBusy(true);
    setError('');
    const fingerprint = JSON.stringify({ organizationId, caseId, version, reason: reason.trim() });
    if (restoreCommand.current?.fingerprint !== fingerprint)
      restoreCommand.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await productionRequest(`${base}/case/restore`, {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          caseId,
          expectedVersion: version,
          reason: reason.trim(),
          requestId: restoreCommand.current.id,
        }),
      });
      if (!active.current) return;
      setSuccess('Dossier restauré. Renouvelez le code pour ouvrir un nouvel accès client.');
      await onChanged('Dossier restauré. Renouvelez le code pour ouvrir un nouvel accès client.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Restauration impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-business-case">
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
      {canManage && !archived && (
        <div className="admin-business-actions">
          {customerId && (
            <button disabled={busy || !!record} onClick={() => void edit('customer', customerId)}>
              <Pencil size={16} />
              Corriger la fiche client
            </button>
          )}
          {productId && (
            <button disabled={busy || !!record} onClick={() => void edit('product', productId)}>
              <Pencil size={16} />
              Corriger la fiche produit
            </button>
          )}
          {customerEmail && (
            <a
              href={`mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(`Suivi de votre dossier ${reference}`)}`}
            >
              <Mail size={16} />
              Préparer un email
            </a>
          )}
        </div>
      )}
      {record && (
        <div className="admin-control-card">
          <AdminEntityEditor
            key={`${record.id}:${record.revision}`}
            organizationId={organizationId}
            kind={record.kind}
            record={record}
            onCancel={() => setRecord(null)}
            onSaved={(value) => {
              setRecord(null);
              setSuccess(`${entityName(value)} : correction enregistrée.`);
              void onChanged(`${entityName(value)} : correction enregistrée et auditée.`);
            }}
          />
        </div>
      )}
      {archived && canManage && (
        <div className="admin-business-restore">
          <h3>
            <RotateCcw size={17} />
            Restaurer ce dossier
          </h3>
          <p>
            La restauration conserve le statut et l’historique. Les anciens codes et sessions
            restent révoqués.
          </p>
          <label>
            Motif de restauration
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={1000}
            />
          </label>
          <label className="admin-business-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Je confirme la restauration du dossier {reference}.
          </label>
          <button
            disabled={busy || !confirmed || reason.trim().length < 3}
            onClick={() => void restore()}
          >
            <RotateCcw size={16} />
            Restaurer le dossier
          </button>
        </div>
      )}
      <details
        className="admin-business-messages"
        onToggle={(event) => {
          if (event.currentTarget.open && !messages) void loadMessages();
        }}
      >
        <summary>
          <History size={17} />
          Historique des échanges enregistrés
        </summary>
        <p className="admin-business-help">
          Messages client et assistant enregistrés pour ce dossier. Les nouvelles informations du
          conseiller s’ajoutent via une note visible par le client.
        </p>
        <div className="admin-business-actions">
          <button type="button" disabled={busy} onClick={() => void loadMessages()}>
            Actualiser les échanges
          </button>
          {messages?.hasMore && (
            <button type="button" disabled={busy} onClick={() => void loadMessages(true)}>
              Charger les échanges précédents
            </button>
          )}
        </div>
        {busy && !messages && <p role="status">Chargement des échanges…</p>}
        {messages?.items.map((item) => (
          <article key={item.id}>
            <header>
              <strong>{item.role === 'user' ? 'Client' : 'Assistant'}</strong>
              <time>{new Date(item.createdAt).toLocaleString('fr-FR')}</time>
            </header>
            <p dir="auto">{item.content}</p>
          </article>
        ))}
        {messages && !messages.items.length && (
          <p>Aucun échange enregistré dans cette source pour ce dossier.</p>
        )}
      </details>
    </section>
  );
}
