# MFA QR locally generated — 16 September 2026

The LOCAL screenshot still showed the manual fallback after PR #10. The exact failed upstream image payload/browser rejection is unavailable, so its underlying image failure is not claimed as diagnosed. This patch removes that dependency entirely: generate a QR from the Auth-issued TOTP URI using pinned qrcode-generator 2.0.4 and render numeric SVG geometry with React. No remote QR service, image data URL or untrusted HTML injection. The URI secret must match the enrollment secret; invalid input retains the manual fallback. A four-module quiet zone, black/white contrast and responsive 280px display are retained. Login, MFA enrollment/verification, cookies, RBAC and organization isolation are unchanged.

Validation:
- 147 application tests passed, including independent jsQR decoding of the generated geometry back to the exact Auth URI (ASCII and Unicode account labels), determinism and invalid input rejection.
- TypeScript, application lint, production build and 10 render/component tests passed.
- Browser visual check: QR visible and manual fallback expandable in a temporary static fixture using the exact page SVG template, actual CSS and synthetic credentials only. Fixture removed before commit. This is a component visual check, not an authenticated end-to-end test.
- Real account enrollment, phone scan and AAL2 admin access cannot be claimed verified: no live account credentials/session were used. No real factor was altered.

The key shown in the user's screenshot should be replaced before activation. Existing enrollment expiry/replacement must be used; a simple refresh while the ten-minute enrollment cache remains valid reuses that key.
