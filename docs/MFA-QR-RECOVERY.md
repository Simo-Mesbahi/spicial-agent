# MFA QR recovery strategy

The admin TOTP enrollment UI renders the QR code locally. It never sends an enrollment secret or `otpauth://` URI to a third-party QR service.

Supabase Auth returns both a TOTP secret and an `otpauth://` URI. The application first validates and preserves that URI when it is structurally valid and contains the same Base32 secret. If the URI is missing, malformed, uses the wrong factor type, contains a different secret, or otherwise cannot be trusted, the UI builds a canonical local TOTP URI from the validated enrollment secret with the standard SHA-1 / 6-digit / 30-second parameters used by authenticator applications.

This makes the QR a presentation-layer convenience rather than a single point of failure. The manual enrollment key remains available as a fallback. A missing or invalid TOTP secret still fails closed and no QR is produced.

The generated QR geometry is rendered as React SVG primitives; no raw upstream SVG is injected into the DOM.

Security note: enrollment secrets are credentials. Never log them, commit them, paste them into issues, or include them in screenshots. If a secret is exposed, abandon that unverified factor and create a fresh enrollment before activation.
