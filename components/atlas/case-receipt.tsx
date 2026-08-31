'use client';

import { ArrowRight, Check, Clock3, FileCheck2, RefreshCw } from 'lucide-react';
import { dateTime, money, finished } from '@/lib/atlas/domain';
import { briefFreshness, type CaseBrief } from '@/lib/atlas/case-brief';

type Props = {
  brief: CaseBrief;
  current: { id: string; verified: boolean; version: number } | null;
  compact?: boolean;
  busy?: boolean;
  onRefresh?: () => void;
  onQuote?: () => void;
};

export function CaseReceipt({ brief, current, compact, busy, onRefresh, onQuote }: Props) {
  const freshness = briefFreshness(brief, current);
  const outdated = freshness === 'outdated';
  if (freshness === 'unavailable') return null;
  if (compact)
    return (
      <div className="receipt-history">
        <FileCheck2 size={13} aria-hidden="true" />
        État consulté : {brief.statusLabel} · v{brief.version}
        {outdated && <span> · Historique</span>}
      </div>
    );
  return (
    <section className="case-receipt" aria-label={'Synthèse du dossier ' + brief.reference}>
      <div className="receipt-heading">
        <span>
          <FileCheck2 size={14} aria-hidden="true" /> LE DOSSIER EN CLAIR
        </span>
        <span className="mono">{brief.reference}</span>
      </div>
      <div className="receipt-current">
        <span className="receipt-marker" aria-hidden="true">
          <Check size={20} />
        </span>
        <div>
          <small>{outdated ? 'ÉTAT LORS DE CETTE RÉPONSE' : 'ÉTAT CONSULTÉ'}</small>
          <h3>{brief.statusLabel}</h3>
          <p>{brief.explanation}</p>
        </div>
      </div>
      <dl className="receipt-facts">
        <div>
          <dt>La suite prévue</dt>
          <dd>
            {brief.nextLabel}
            {brief.nextLabel !== 'Aucune autre étape enregistrée' && (
              <small>Selon le parcours simulé, pas une étape déjà réalisée.</small>
            )}
          </dd>
        </div>
        <div>
          <dt>De votre côté</dt>
          <dd>{brief.customerStep}</dd>
        </div>
      </dl>
      {brief.amount && (
        <div className="receipt-amount">
          <span>{brief.amount.label}</span>
          <strong>{money(brief.amount.cents)}</strong>
          {brief.status === 'quote_pending' && freshness === 'current' && onQuote && (
            <button className="text-button" disabled={busy} onClick={onQuote}>
              Examiner <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
      {!finished(brief.status) && (
        <div className="receipt-date">
          <Clock3 size={15} aria-hidden="true" />
          <div>
            <strong>
              {brief.estimate ? 'Estimation enregistrée' : 'Aucun délai confirmé enregistré'}
            </strong>
            {brief.estimate && <p>{brief.estimate} — estimation, pas une garantie.</p>}
          </div>
        </div>
      )}
      <footer className="receipt-footer">
        <span>Dossier fictif · v{brief.version}</span>
        <span>Mise à jour : {dateTime(brief.updatedAt)}</span>
      </footer>
      {outdated && (
        <div className="receipt-update" role="status">
          <RefreshCw size={17} aria-hidden="true" />
          <div>
            <strong>Votre dossier a évolué depuis cette réponse.</strong>
            <p>Consultez-le à nouveau pour lire le nouvel état.</p>
          </div>
          {onRefresh && (
            <button className="button secondary" disabled={busy} onClick={onRefresh}>
              Actualiser le suivi
            </button>
          )}
        </div>
      )}
      {freshness === 'unknown' && (
        <p className="receipt-history">
          Actualisez les dossiers pour vérifier la fraîcheur de cet état.
        </p>
      )}
    </section>
  );
}
