# Enrollment presentation contract

The reported error originates in the Auth enrollment response validator, before QR rendering. That validator required a nonempty QR image (at most 200000 characters) and URI even though the client supports canonical URI reconstruction from the TOTP secret. Reproduced this contract defect with synthetic upstream responses; the exact live response was not available, so its failing field is not claimed verified.

Presentation fields now default to empty strings when absent, null, wrongly typed or oversized. UUID and Base32 TOTP secret remain mandatory. The frontend generates its QR using the established local fallback. Invalid credential responses are still rejected and safe error messages distinguish factor ID from TOTP data. No raw response values are logged or returned in errors. Login, AAL2 enforcement, cookies, RBAC and organization isolation unchanged.

Seven new API tests cover absent/null/empty/oversized presentation data, invalid or missing secrets and invalid factor IDs. Accepted responses generate local QR geometry, are resumable and do not create duplicate factors. Existing mocked login/challenge/verify/AAL2 tests remain. This is not a live phone scan or real Supabase account login.

TypeScript checks on main's app/admin/page.tsx do not reproduce editor TS2304 at line 524. Compare any local/unsaved changes and restart the editor TypeScript server after installing dependencies; do not overwrite local work blindly.
