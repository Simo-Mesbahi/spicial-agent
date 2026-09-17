# Foundation security baseline

Last reviewed: 17 September 2026.

This document records the security invariants expected before AI/LLM features are expanded. It is an engineering baseline, not a claim that software can never fail and not a substitute for an independent security audit.

## Administrator access

- Password authentication is handled by Supabase Auth.
- Administration requires a valid application membership and AAL2 MFA before privileged data can be read.
- Pre-authentication cookies are short lived and distinct from administrator cookies.
- Administrator cookies are `HttpOnly`, `SameSite=Strict`, path-scoped to the application, and `Secure` on HTTPS.
- The application enforces 15 minutes of administrator inactivity at both the UI and Cloudflare Worker boundary.
- Background health polling never extends the server inactivity deadline. Only explicit user interaction emits the bounded activity heartbeat.
- An administrator session has a 12-hour absolute application lifetime even when activity continues.
- Server session markers contain only a SHA-256-derived identifier of the refresh credential; the raw refresh token is never persisted in D1.
- Expired, logged-out and rotated credentials remain as fail-closed tombstones. A missing or expired server marker is rejected and cannot bootstrap a privileged session.
- Explicit logout attempts Supabase logout, clears all administrator/pre-auth cookies and tombstones the application session even if the upstream logout request is temporarily unavailable.
- Refresh-token rotation carries the original creation time and current inactivity deadline to the new credential while tombstoning the old credential.
- Cross-site mutations are rejected and privileged API responses use `no-store` security headers.

Operational consequence: deployment of this baseline intentionally requires previously authenticated administrators without a server marker to authenticate again. Security takes precedence over preserving a legacy browser session.

## Customer dossier access

- Customer dossier access does not require an account.
- Reference + confidential code verification happens server-side.
- Access codes are stored as password hashes, not plaintext.
- A successful verification generates 32 random bytes represented as a 64-character token. Only its SHA-256 digest is stored in the database.
- Dossier sessions expire after at most 30 minutes and can be shorter when the access code expires sooner.
- Every dossier snapshot rechecks session expiry, revocation, organization state and access-code validity.
- Closing dossier access revokes the server-side session and clears the browser cookie.
- Changing/revoking a dossier access code invalidates the related sessions.
- Invalid credentials receive a neutral response and do not reveal whether the reference or code was wrong.

## Supabase data boundary

- Row Level Security is enabled on application tables.
- Sensitive service-only tables such as `case_access_codes`, `case_sessions` and `case_commands` intentionally expose no authenticated-user RLS policy; access is mediated by server-only RPC/service-role paths.
- Customer RPCs are granted only to the server role and validate their inputs before accessing dossier data.
- Administrator RPCs derive identity from the authenticated user and application memberships; organization authorization is checked server-side.
- Security-definer customer functions use explicit `search_path` settings.
- Production migrations are versioned in `supabase/migrations` and regression-tested against the linked SQL contract.

## Fail-safe behavior

- Missing administrator session marker: deny and require re-authentication.
- Expired administrator marker: deny, clear browser credentials, keep the tombstone.
- D1/session-state loss: deny privileged administrator access rather than silently reconstructing it from a browser credential.
- Failed customer dossier revocation: do not report a successful close to the customer.
- Invalid/malformed upstream responses: reject rather than guessing a successful state.
- Network interruption: mutations are not automatically replayed.
- Secrets and session credentials must never be logged, included in diagnostics or returned by public APIs.

## Required quality gate

Every merge affecting this baseline must pass the repository CI gate:

1. dependency installation from the lockfile;
2. TypeScript type checking;
3. application linting;
4. application/security regression tests;
5. production build;
6. rendered HTML/component tests.

Security-sensitive session changes additionally require regression coverage for expiry, explicit activity, token rotation, logout/revocation, cookie clearing and fail-closed behavior.

## Remaining external control

Supabase Security Advisor currently reports that leaked-password protection is disabled. Enable compromised-password checking in Supabase Auth before treating the authentication configuration as the final production baseline. This is an account/project Auth setting and is intentionally not emulated in application code.

## Final manual acceptance before production deployment

Use a fresh administrator MFA factor and verify on a real device: password login → TOTP → AAL2 admin access → activity warning → continued session → automatic inactivity lock → re-authentication. Also verify a synthetic customer dossier: valid access → refresh → explicit close → reuse denied, plus invalid-code denial. Never use real customer records for this acceptance test.
