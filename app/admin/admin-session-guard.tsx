'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Clock3, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import {
  productionRequest,
  ProductionRequestError,
} from '@/lib/atlas/production-client';
import {
  ADMIN_FORCE_LOCK_KEY,
  ADMIN_IDLE_TIMEOUT_MS,
  ADMIN_LAST_ACTIVITY_KEY,
  ADMIN_LOGOUT_EVENT,
  ADMIN_SESSION_STATE_EVENT,
  adminIdleSnapshot,
  formatAdminIdleCountdown,
} from '@/lib/atlas/admin-session';

type LockReason = 'idle' | 'manual' | 'expired' | 'network' | null;

const PROBE_WHEN_SIGNED_OUT_MS = 10_000;
const SESSION_HEALTHCHECK_MS = 60_000;
const ACTIVITY_WRITE_THROTTLE_MS = 1_000;
const SERVER_ACTIVITY_THROTTLE_MS = 30_000;
const SERVER_ACTIVITY_HEADER = 'X-SAVSC-Admin-Activity';

function emitSessionState(active: boolean) {
  window.dispatchEvent(new CustomEvent(ADMIN_SESSION_STATE_EVENT, { detail: { active } }));
}

export default function AdminSessionGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [warning, setWarning] = useState(false);
  const [remainingMs, setRemainingMs] = useState(ADMIN_IDLE_TIMEOUT_MS);
  const [lockReason, setLockReason] = useState<LockReason>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const logoutInFlight = useRef(false);
  const lastWrite = useRef(0);
  const lastProbe = useRef(0);
  const lastServerActivity = useRef(0);

  const readLastActivity = useCallback(() => {
    try {
      const value = Number(localStorage.getItem(ADMIN_LAST_ACTIVITY_KEY));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }, []);

  const expireLocally = useCallback((reason: Exclude<LockReason, null>, broadcast = true) => {
    setAuthenticated(false);
    setWarning(false);
    setLockReason(reason);
    emitSessionState(false);
    try {
      localStorage.removeItem(ADMIN_LAST_ACTIVITY_KEY);
      if (broadcast) localStorage.setItem(ADMIN_FORCE_LOCK_KEY, `${Date.now()}:${reason}`);
    } catch {}
  }, []);

  const handleServerAuthFailure = useCallback((cause: unknown) => {
    if (!(cause instanceof ProductionRequestError) || (cause.status !== 401 && cause.status !== 403))
      return false;
    expireLocally('expired');
    router.replace('/admin?reason=expired');
    return true;
  }, [expireLocally, router]);

  const recordActivity = useCallback(() => {
    if (!authenticated || lockReason) return;
    const now = Date.now();
    if (now - lastWrite.current < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastWrite.current = now;
    try {
      localStorage.setItem(ADMIN_LAST_ACTIVITY_KEY, String(now));
    } catch {
      // The current tab still keeps its in-memory countdown if storage is unavailable.
    }
    setRemainingMs(ADMIN_IDLE_TIMEOUT_MS);
    setWarning(false);

    if (now - lastServerActivity.current < SERVER_ACTIVITY_THROTTLE_MS) return;
    lastServerActivity.current = now;
    void productionRequest(
      '/admin/session',
      { headers: { [SERVER_ACTIVITY_HEADER]: '1' } },
      12_000,
    ).catch((cause) => {
      lastServerActivity.current = 0;
      if (!handleServerAuthFailure(cause))
        setMessage('Votre activité locale est conservée, mais la vérification serveur est momentanément indisponible.');
    });
  }, [authenticated, handleServerAuthFailure, lockReason]);

  const probeSession = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastProbe.current < PROBE_WHEN_SIGNED_OUT_MS) return authenticated;
    lastProbe.current = now;
    try {
      await productionRequest('/admin/session', {}, 12_000);
      if (!authenticated) {
        setAuthenticated(true);
        emitSessionState(true);
      }
      setLockReason(null);
      setMessage('');
      if (!readLastActivity()) {
        try { localStorage.setItem(ADMIN_LAST_ACTIVITY_KEY, String(now)); } catch {}
        lastWrite.current = now;
      }
      return true;
    } catch (cause) {
      if (cause instanceof ProductionRequestError && (cause.status === 401 || cause.status === 403)) {
        if (authenticated) emitSessionState(false);
        setAuthenticated(false);
        setWarning(false);
        setLockReason(null);
        try { localStorage.removeItem(ADMIN_LAST_ACTIVITY_KEY); } catch {}
        return false;
      }
      return authenticated;
    }
  }, [authenticated, readLastActivity]);

  const logout = useCallback(async (reason: 'idle' | 'manual' | 'expired') => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setWorking(true);
    setMessage('');
    expireLocally(reason);
    try {
      await productionRequest('/admin/logout', { method: 'POST', body: '{}', keepalive: true }, 12_000);
      router.replace(`/admin?reason=${encodeURIComponent(reason)}`);
    } catch {
      setLockReason('network');
      setMessage('La session est verrouillée sur cet appareil, mais le serveur n’a pas confirmé la fermeture. Reconnectez le réseau puis réessayez la déconnexion.');
    } finally {
      logoutInFlight.current = false;
      setWorking(false);
    }
  }, [expireLocally, router]);

  const continueSession = useCallback(async () => {
    if (working) return;
    setWorking(true);
    setMessage('');
    try {
      await productionRequest(
        '/admin/session',
        { headers: { [SERVER_ACTIVITY_HEADER]: '1' } },
        12_000,
      );
      const now = Date.now();
      lastServerActivity.current = now;
      if (!authenticated) {
        setAuthenticated(true);
        emitSessionState(true);
      }
      try { localStorage.setItem(ADMIN_LAST_ACTIVITY_KEY, String(now)); } catch {}
      lastWrite.current = now;
      setRemainingMs(ADMIN_IDLE_TIMEOUT_MS);
      setWarning(false);
      setLockReason(null);
    } catch (cause) {
      if (!handleServerAuthFailure(cause))
        setMessage('Impossible de prolonger la session. Vérifiez votre connexion ou déconnectez-vous.');
    } finally {
      setWorking(false);
    }
  }, [authenticated, handleServerAuthFailure, working]);

  useEffect(() => {
    const timer = window.setTimeout(() => void probeSession(true), 0);
    return () => clearTimeout(timer);
  }, [probeSession]);

  useEffect(() => {
    const onActivity = () => {
      if (authenticated) recordActivity();
      else void probeSession();
    };
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    for (const event of events) document.addEventListener(event, onActivity, { passive: true });
    return () => {
      for (const event of events) document.removeEventListener(event, onActivity);
    };
  }, [authenticated, probeSession, recordActivity]);

  useEffect(() => {
    if (!authenticated || lockReason) return;
    const tick = () => {
      const snapshot = adminIdleSnapshot(readLastActivity());
      setRemainingMs(snapshot.remainingMs);
      setWarning(snapshot.status === 'warning');
      if (snapshot.status === 'expired') void logout('idle');
    };
    const timer = window.setInterval(tick, 1_000);
    const health = window.setInterval(() => void probeSession(true), SESSION_HEALTHCHECK_MS);
    const initial = window.setTimeout(tick, 0);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        tick();
        void probeSession(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      clearInterval(health);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [authenticated, lockReason, logout, probeSession, readLastActivity]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === ADMIN_LAST_ACTIVITY_KEY && event.newValue && authenticated) {
        const snapshot = adminIdleSnapshot(Number(event.newValue));
        setRemainingMs(snapshot.remainingMs);
        setWarning(snapshot.status === 'warning');
      }
      if (event.key === ADMIN_FORCE_LOCK_KEY && event.newValue) {
        expireLocally('manual', false);
        window.setTimeout(() => router.replace('/admin?reason=logout'), 400);
      }
    };
    const onLogoutRequest = () => void logout('manual');
    window.addEventListener('storage', onStorage);
    window.addEventListener(ADMIN_LOGOUT_EVENT, onLogoutRequest);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ADMIN_LOGOUT_EVENT, onLogoutRequest);
    };
  }, [authenticated, expireLocally, logout, router]);

  if (lockReason) {
    const networkFailure = lockReason === 'network';
    return (
      <div className="admin-session-lock" role="alert" aria-live="assertive">
        <div className="admin-session-dialog">
          <span className="admin-session-icon"><LockKeyhole size={24} /></span>
          <p className="admin-eyebrow">SESSION VERROUILLÉE</p>
          <h2>Les données administratives sont masquées.</h2>
          <p>{message || (lockReason === 'idle'
            ? 'La session a été fermée après 15 minutes sans activité.'
            : 'L’accès administrateur est fermé sur cet appareil.')}</p>
          {networkFailure ? (
            <button type="button" className="admin-session-primary" disabled={working} onClick={() => void logout('manual')}>
              <LogOut size={17} /> {working ? 'Fermeture…' : 'Réessayer la déconnexion'}
            </button>
          ) : (
            <button type="button" className="admin-session-primary" onClick={() => router.replace('/admin')}>
              <ShieldCheck size={17} /> Revenir à la connexion
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {authenticated && warning && (
        <div className="admin-session-lock" role="dialog" aria-modal="true" aria-labelledby="admin-idle-title">
          <div className="admin-session-dialog">
            <span className="admin-session-icon"><ShieldCheck size={24} /></span>
            <p className="admin-eyebrow">SÉCURITÉ DE SESSION</p>
            <h2 id="admin-idle-title">Votre session va être verrouillée.</h2>
            <p>Après 15 minutes sans activité, l’accès administrateur est fermé automatiquement sur cet appareil, y compris côté serveur.</p>
            <div className="admin-session-countdown"><Clock3 size={18} /><strong>{formatAdminIdleCountdown(remainingMs)}</strong><span>avant déconnexion</span></div>
            {message && <p className="admin-session-error">{message}</p>}
            <div className="admin-session-actions">
              <button type="button" className="admin-session-primary" disabled={working} onClick={() => void continueSession()}>
                <ShieldCheck size={17} /> {working ? 'Vérification…' : 'Rester connecté'}
              </button>
              <button type="button" className="admin-session-secondary" disabled={working} onClick={() => void logout('manual')}>
                <LogOut size={17} /> Se déconnecter
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
