export const ADMIN_IDLE_TIMEOUT_MS = 15 * 60_000;
export const ADMIN_IDLE_WARNING_MS = 2 * 60_000;

export const ADMIN_LAST_ACTIVITY_KEY = 'savsc_admin_last_activity_v1';
export const ADMIN_FORCE_LOCK_KEY = 'savsc_admin_force_lock_v1';
export const ADMIN_LOGOUT_EVENT = 'savsc:admin-logout';
export const ADMIN_SESSION_STATE_EVENT = 'savsc:admin-session-state';

export type AdminIdleSnapshot = {
  status: 'active' | 'warning' | 'expired';
  remainingMs: number;
};

export function adminIdleSnapshot(lastActivityMs: number, nowMs = Date.now()): AdminIdleSnapshot {
  if (!Number.isFinite(lastActivityMs) || lastActivityMs <= 0 || !Number.isFinite(nowMs)) {
    return { status: 'expired', remainingMs: 0 };
  }
  const elapsed = Math.max(0, nowMs - lastActivityMs);
  const remainingMs = Math.max(0, ADMIN_IDLE_TIMEOUT_MS - elapsed);
  if (remainingMs <= 0) return { status: 'expired', remainingMs: 0 };
  if (remainingMs <= ADMIN_IDLE_WARNING_MS) return { status: 'warning', remainingMs };
  return { status: 'active', remainingMs };
}

export function formatAdminIdleCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
