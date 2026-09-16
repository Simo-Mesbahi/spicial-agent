# QR diagnostics v3

The user still reports a manual fallback after PR #11. Their screenshot does not identify the executing bundle or Auth URI, so the live cause remains unconfirmed. Do not claim this change fixes that unobserved cause.

Replace silent null results with a safe discriminated result: invalid_secret, generation_failed. The UI shows only that code on failure and a QR local v3 marker to distinguish stale code. No URI, token or secret is logged or included in diagnostics. Preserve the newer main-branch canonical URI recovery (commits d9c42e0/1d42cd4). Existing manual fallback and all Auth/RBAC/cookie behavior remain unchanged.

Validation: 149 application tests plus 10 render/component tests passed; typecheck, lint and production build passed. New regression test bundles for the browser with minification and independently decodes the resulting QR; safe diagnostic payloads are asserted. Actual Chrome browser generated and displayed the QR by executing that browser bundle with synthetic credentials. Temporary fixture removed before commit. No real user enrollment or AAL2 session was exercised.

Next live check: after updating and restarting, look for QR local v3. If unavailable, the older frontend is still loaded. If present but no QR, report only the diagnostic code, never the secret/URI/QR.
