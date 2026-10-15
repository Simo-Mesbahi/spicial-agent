'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Save, X } from 'lucide-react';
import { productionRequest } from '@/lib/atlas/production-client';
import { entitySaveSchema, type EntityKind, type EntityRecord } from '@/lib/atlas/admin-business';
import { useAdminLifetime } from './use-admin-lifetime';

export const entityLabels: Record<EntityKind, string> = {
  customer: 'Client',
  product: 'Produit',
  store: 'Magasin',
};
export const entityFields: Record<
  EntityKind,
  { key: string; label: string; max: number; required?: boolean; type?: string }[]
> = {
  customer: [
    { key: 'first_name', label: 'Prénom', max: 160 },
    { key: 'last_name', label: 'Nom', max: 160 },
    { key: 'email', label: 'Email', max: 320, type: 'email' },
    { key: 'phone', label: 'Téléphone', max: 80, type: 'tel' },
    { key: 'external_id', label: 'Référence client externe', max: 160 },
  ],
  product: [
    { key: 'name', label: 'Nom du produit', max: 240, required: true },
    { key: 'sku', label: 'SKU / référence article', max: 120 },
    { key: 'category', label: 'Catégorie', max: 160 },
    { key: 'serial_number', label: 'Numéro de série', max: 160 },
    { key: 'external_id', label: 'Référence produit externe', max: 160 },
  ],
  store: [
    { key: 'code', label: 'Code du magasin', max: 80, required: true },
    { key: 'name', label: 'Nom du magasin', max: 240, required: true },
    { key: 'city', label: 'Ville', max: 160 },
    { key: 'address', label: 'Adresse', max: 1000 },
  ],
};
export function entityName(record: EntityRecord) {
  return String(
    record.data.name ||
      [record.data.first_name, record.data.last_name].filter(Boolean).join(' ') ||
      record.data.email ||
      record.data.external_id ||
      'Client sans nom',
  );
}

export default function AdminEntityEditor({
  organizationId,
  kind,
  record,
  onSaved,
  onCancel,
}: {
  organizationId: string;
  kind: EntityKind;
  record: EntityRecord | null;
  onSaved: (value: EntityRecord) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string | boolean | null>>(() => ({
    ...Object.fromEntries(
      entityFields[kind].map((field) => [field.key, record?.data[field.key] ?? '']),
    ),
    ...(kind === 'store' ? { active: record?.data.active ?? true } : {}),
  }));
  const active = useAdminLifetime();
  const [initial] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const command = useRef<{ fingerprint: string; id: string } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const shared = (record?.linkedCases ?? 0) > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || (shared && !confirmed)) return;
    const data = Object.fromEntries(
      Object.entries(draft).map(([key, value]) => [
        key,
        typeof value === 'string' ? value.trim() || null : value,
      ]),
    );
    const fingerprint = JSON.stringify({
      organizationId,
      kind,
      id: record?.id,
      revision: record?.revision,
      data,
    });
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: crypto.randomUUID() };
    const payload = entitySaveSchema.safeParse({
      organizationId,
      kind,
      id: record?.id ?? null,
      expectedRevision: record?.revision ?? 0,
      data,
      requestId: command.current.id,
    });
    if (!payload.success) {
      setError('Vérifiez les champs obligatoires, les longueurs et l’adresse email.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await productionRequest<EntityRecord>(
        '/admin/operations/business/entity/save',
        {
          method: 'POST',
          body: JSON.stringify(payload.data),
        },
      );
      if (!active.current) return;
      onSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="admin-business-form" onSubmit={save}>
      <header>
        <div>
          <p className="admin-eyebrow">
            {record ? `FICHE · VERSION ${record.revision}` : 'NOUVELLE FICHE'}
          </p>
          <h2>{record ? entityName(record) : `Créer un ${entityLabels[kind].toLowerCase()}`}</h2>
        </div>
      </header>
      {record && (
        <p className="admin-business-help">
          {record.linkedCases} dossier(s) lié(s). Dernière mise à jour :{' '}
          {new Date(record.updatedAt).toLocaleString('fr-FR')}.
        </p>
      )}
      {record && !record.canEdit && (
        <p className="admin-control-alert" role="status">
          {kind === 'store'
            ? 'La modification des magasins est réservée au super-administrateur.'
            : 'Cette fiche est partagée avec un autre service. Sa correction nécessite un super-administrateur.'}
        </p>
      )}
      {error && (
        <p className="admin-control-alert" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy || (!!record && !record.canEdit)}>
        <div className="admin-business-fields">
          {entityFields[kind].map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                type={field.type ?? 'text'}
                required={field.required}
                maxLength={field.max}
                value={String(draft[field.key] ?? '')}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }));
                  setConfirmed(false);
                }}
              />
            </label>
          ))}
        </div>
        {kind === 'store' && (
          <label className="admin-business-check">
            <input
              type="checkbox"
              checked={Boolean(draft.active)}
              onChange={(event) => {
                setDraft((current) => ({ ...current, active: event.target.checked }));
                setConfirmed(false);
              }}
            />
            Magasin actif pour les nouveaux dossiers
          </label>
        )}
        {kind === 'store' && (
          <p className="admin-business-help">
            Un magasin lié à des dossiers non archivés doit rester actif. Les anciennes associations sont
            conservées.
          </p>
        )}
        {kind === 'customer' && (
          <p className="admin-business-help">
            Renseignez au moins un nom, une référence ou un moyen de contact.
          </p>
        )}
        {shared && (
          <label className="admin-business-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Je confirme la correction de cette fiche partagée par {record?.linkedCases} dossier(s).
          </label>
        )}
      </fieldset>
      <div className="admin-business-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm('Abandonner les modifications de cette fiche ?'))
              onCancel();
          }}
        >
          <X size={16} />
          Fermer
        </button>
        {(!record || record.canEdit) && (
          <button
            className="admin-business-primary"
            disabled={busy || (record ? !dirty : false) || (shared && !confirmed)}
          >
            {busy ? <CheckCircle2 size={16} /> : <Save size={16} />}{' '}
            {busy ? 'Enregistrement…' : 'Enregistrer la fiche'}
          </button>
        )}
      </div>
    </form>
  );
}
