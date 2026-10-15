'use client';

import { useRef, useState } from 'react';
import { CheckSquare, Download } from 'lucide-react';
import { productionRequest } from '@/lib/atlas/production-client';
import {
  allowedNextStatuses,
  canManageCase,
  caseStatusLabels,
  type AdminRole,
  type CaseServiceType,
  type CaseStatus,
} from '@/lib/atlas/case-management';
import { useAdminLifetime } from './use-admin-lifetime';

export function downloadText(filename: string, value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminCaseBatch({
  organizationId,
  role,
  cases,
  filters,
  onChanged,
  beforeApply,
}: {
  organizationId: string;
  role: AdminRole | undefined;
  cases: {
    id: string;
    reference: string;
    version: number;
    service_type: CaseServiceType;
    status: CaseStatus;
    archived_at: string | null;
  }[];
  filters: { search: string; service: string; status: string; archive: string };
  onChanged: () => Promise<void>;
  beforeApply: () => boolean;
}) {
  const active = useAdminLifetime();
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<'transition' | 'note' | 'deadline'>('note');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [date, setDate] = useState('');
  const [visible, setVisible] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const command = useRef<{ fingerprint: string; id: string } | null>(null);
  const manageable = cases.filter(
    (item) => !item.archived_at && canManageCase(role, item.service_type),
  );
  const chosen = manageable.filter((item) => selected.includes(item.id));
  const statuses = chosen.length
    ? allowedNextStatuses(chosen[0].service_type, chosen[0].status).filter((value) =>
        chosen.every((item) => allowedNextStatuses(item.service_type, item.status).includes(value)),
      )
    : [];
  async function exportCases() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await productionRequest<{ csv: string; count: number }>(
        '/admin/operations/business/cases/export',
        {
          method: 'POST',
          body: JSON.stringify({ organizationId, ...filters }),
        },
      );
      if (!active.current) return;
      downloadText(`dossiers-${new Date().toISOString().slice(0, 10)}.csv`, result.csv);
      setSuccess(`${result.count} dossier(s) exporté(s), selon les filtres appliqués.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export impossible.');
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (busy || !confirmed || !chosen.length || !beforeApply()) return;
    setBusy(true);
    setError('');
    setSuccess('');
    const payload =
      action === 'transition'
        ? { status, note, visible }
        : action === 'note'
          ? { note, visible }
          : { estimatedAt: date ? new Date(date).toISOString() : null };
    const items = chosen.map((item) => ({ id: item.id, version: item.version }));
    const fingerprint = JSON.stringify({ organizationId, action, items, ...payload });
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await productionRequest<{ count: number }>(
        '/admin/operations/business/cases/batch',
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            action,
            items,
            requestId: command.current.id,
            ...payload,
          }),
        },
      );
      if (!active.current) return;
      setSelected([]);
      setConfirmed(false);
      setSuccess(`${result.count} dossier(s) mis à jour et audités.`);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action groupée impossible.');
    } finally {
      setBusy(false);
    }
  }
  const valid =
    chosen.length > 0 &&
    chosen.length <= 25 &&
    (action === 'transition'
      ? statuses.includes(status as CaseStatus)
      : action === 'note'
        ? note.trim().length >= 3
        : !date || !Number.isNaN(new Date(date).getTime()));
  return (
    <section className="admin-business-batch">
      <div className="admin-business-actions">
        <button disabled={busy || !organizationId} onClick={() => void exportCases()}>
          <Download size={16} />
          Exporter les dossiers filtrés
        </button>
      </div>
      <p className="admin-business-help">
        Export CSV compatible Excel, limité à 1 000 dossiers. Affinez les filtres pour un volume
        supérieur.
      </p>
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
      {!!manageable.length && (
        <details>
          <summary>
            <CheckSquare size={17} />
            Actions groupées sur cette page
          </summary>
          <fieldset disabled={busy}>
            <p>
              25 dossiers maximum. Toutes les modifications sont appliquées ensemble ; un conflit
              annule l’ensemble.
            </p>
            <div className="admin-business-batch-list">
              {manageable.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    disabled={busy || (!selected.includes(item.id) && selected.length >= 25)}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      );
                      setConfirmed(false);
                      setStatus('');
                    }}
                  />
                  <strong>{item.reference}</strong>
                  <span>{caseStatusLabels[item.status]}</span>
                </label>
              ))}
            </div>
            <label>
              Action
              <select
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as typeof action);
                  setConfirmed(false);
                }}
              >
                <option value="note">Ajouter une note</option>
                <option value="deadline">Modifier l’échéance</option>
                <option value="transition">Changer le statut</option>
              </select>
            </label>
            {action === 'transition' && (
              <label>
                Statut compatible avec tous les dossiers sélectionnés
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as CaseStatus);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Choisir un statut</option>
                  {statuses.map((value) => (
                    <option key={value} value={value}>
                      {caseStatusLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {action === 'deadline' ? (
              <label>
                Nouvelle échéance
                <input
                  type="datetime-local"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setConfirmed(false);
                  }}
                />
                <small>Laisser vide retire l’échéance.</small>
              </label>
            ) : (
              <>
                <label>
                  {action === 'note' ? 'Note à ajouter' : 'Précision facultative'}
                  <textarea
                    value={note}
                    maxLength={action === 'note' ? 4000 : 2000}
                    onChange={(event) => {
                      setNote(event.target.value);
                      setConfirmed(false);
                    }}
                  />
                </label>
                <label className="admin-business-check">
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={(event) => {
                      setVisible(event.target.checked);
                      setConfirmed(false);
                    }}
                  />
                  Visible par le client
                </label>
              </>
            )}
            <label className="admin-business-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!valid || busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Je confirme l’action sur {chosen.length} dossier(s).
            </label>
            <button
              className="admin-business-primary"
              disabled={busy || !valid || !confirmed}
              onClick={() => void apply()}
            >
              Appliquer aux dossiers sélectionnés
            </button>
          </fieldset>
        </details>
      )}
    </section>
  );
}
