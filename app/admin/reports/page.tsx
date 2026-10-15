'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Download, Printer, RefreshCw } from 'lucide-react';
import { csv } from '@/lib/atlas/admin-business';
import { caseStatusLabels } from '@/lib/atlas/case-management';
import { productionRequest, ProductionRequestError } from '@/lib/atlas/production-client';
import { downloadText } from '@/components/atlas/admin-case-batch';

type Overview = {
  generated_at: string;
  period_days: number;
  cases: {
    total: number;
    open: number;
    overdue: number;
    without_eta: number;
    stale: number;
    resolved: number;
    avg_resolution_hours: number | null;
  };
  by_status: Record<string, number>;
  trend: { day: string; opened: number; closed: number }[];
  assistant: { messages_24h: number; conversations: number };
  handoffs: { open: number; unassigned: number };
};
export default function ReportsPage() {
  const [organization, setOrganization] = useState('');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const revision = useRef(0);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ProductionRequestError && [401, 403].includes(cause.status)) {
      setDenied(true);
      setOverview(null);
    }
    setError(cause instanceof Error ? cause.message : 'Rapport indisponible.');
  }, []);
  const load = useCallback(
    async (org: string, period: number) => {
      const sequence = ++revision.current;
      setBusy(true);
      setError('');
      setOverview(null);
      try {
        const result = await productionRequest<{ overview: Overview }>(
          `/admin/operations/overview?${new URLSearchParams({ organizationId: org, days: String(period) })}`,
        );
        if (sequence === revision.current) {
          setOverview(result.overview);
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
      .then((value) => {
        if (active) setOrganization(value.organizationId);
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
      if (organization) void load(organization, days);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      invalidate();
    };
  }, [organization, days, load, invalidate]);
  function exportReport() {
    if (!overview) return;
    downloadText(
      `rapport-service-${new Date().toISOString().slice(0, 10)}.csv`,
      csv([
        ['Rapport SAV SC', 'Valeur'],
        ['Actualisé le', overview.generated_at],
        ['Période (jours)', overview.period_days],
        ['Dossiers enregistrés', overview.cases.total],
        ['Dossiers ouverts', overview.cases.open],
        ['Échéances dépassées', overview.cases.overdue],
        ['Dossiers sans échéance', overview.cases.without_eta],
        ['Dossiers stagnants', overview.cases.stale],
        ['Dossiers résolus dans la période', overview.cases.resolved],
        ['Durée moyenne de résolution (heures)', overview.cases.avg_resolution_hours],
        ['Relais ouverts', overview.handoffs.open],
        ['Relais non assignés', overview.handoffs.unassigned],
        [],
        ['Date', 'Ouvertures', 'Clôtures'],
        ...overview.trend.map((item) => [item.day, item.opened, item.closed]),
        [],
        ['Statut', 'Nombre'],
        ...Object.entries(overview.by_status).map(([status, count]) => [
          caseStatusLabels[status as keyof typeof caseStatusLabels] ?? status,
          count,
        ]),
      ]),
    );
  }
  if (denied)
    return (
      <main className="admin-control-page">
        <section className="admin-control-card">
          <h1>Connexion administrateur requise</h1>
          <p>Les rapports suivent les droits de votre organisation.</p>
          <Link href="/admin">Ouvrir la connexion</Link>
        </section>
      </main>
    );
  return (
    <main className="admin-control-page admin-business-report">
      <header className="admin-control-heading">
        <div>
          <p className="admin-eyebrow">REPORTING MÉTIER</p>
          <h1>Rapport d’activité</h1>
          <p>Une synthèse des données enregistrées, exportable et imprimable.</p>
        </div>
        <div className="admin-business-actions">
          <button disabled={busy || !organization} onClick={() => void load(organization, days)}>
            <RefreshCw size={16} />
            Actualiser
          </button>
          <button disabled={busy || !overview} onClick={exportReport}>
            <Download size={16} />
            Exporter le rapport CSV
          </button>
          <button disabled={busy || !overview} onClick={() => window.print()}>
            <Printer size={16} />
            Imprimer / PDF
          </button>
        </div>
      </header>
      <label className="admin-business-period">
        Période d’analyse
        <select
          aria-label="Période d’analyse"
          disabled={busy}
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
        >
          <option value={7}>7 jours</option>
          <option value={30}>30 jours</option>
          <option value={90}>90 jours</option>
        </select>
      </label>
      {error && (
        <p className="admin-control-alert" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Préparation du rapport…</p>}
      {overview && (
        <>
          <p className="admin-business-help">
            Actualisé le {new Date(overview.generated_at).toLocaleString('fr-FR')} · historique sur{' '}
            {overview.period_days} jours. Les compteurs de dossiers reflètent l’état actuel.
          </p>
          <section className="admin-control-metrics">
            {[
              ['Dossiers ouverts', overview.cases.open],
              ['Échéances dépassées', overview.cases.overdue],
              ['Sans échéance', overview.cases.without_eta],
              ['Dossiers stagnants', overview.cases.stale],
              ['Résolus dans la période', overview.cases.resolved],
              ['Résolution moyenne (h)', overview.cases.avg_resolution_hours],
            ].map(([label, value]) => (
              <article className="admin-control-card" key={String(label)}>
                <span>{label}</span>
                <strong>
                  {value == null
                    ? '—'
                    : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(
                        Number(value),
                      )}
                </strong>
              </article>
            ))}
          </section>
          <section className="admin-business-grid">
            <article className="admin-control-card">
              <h2>
                <BarChart3 size={19} />
                Ouvertures et clôtures
              </h2>
              <div className="admin-control-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Ouvertures</th>
                      <th>Clôtures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.trend.map((item) => (
                      <tr key={item.day}>
                        <th>{new Date(`${item.day}T12:00:00Z`).toLocaleDateString('fr-FR')}</th>
                        <td>{item.opened}</td>
                        <td>{item.closed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="admin-control-card">
              <h2>État actuel des dossiers</h2>
              <div className="admin-control-table">
                <table>
                  <thead>
                    <tr>
                      <th>Statut</th>
                      <th>Nombre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(overview.by_status).map(([status, count]) => (
                      <tr key={status}>
                        <th>
                          {caseStatusLabels[status as keyof typeof caseStatusLabels] ?? status}
                        </th>
                        <td>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                {overview.handoffs.open} relais ouvert(s), dont {overview.handoffs.unassigned} non
                assigné(s).
              </p>
              <p>{overview.assistant.messages_24h} message(s) sur les dernières 24 heures.</p>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
