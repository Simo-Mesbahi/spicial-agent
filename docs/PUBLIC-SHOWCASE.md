# Public product showcase

## Purpose

The public root route is a lightweight commercial presentation of SAV SC Assistant AI. It is intentionally separated from the interactive demonstration, real customer tracking, administration and P1 release qualification.

## Route boundaries

- `/` — static commercial showcase. No client component, session bootstrap, Supabase request or LLM/provider request is needed to render the first page.
- `/demo` — the pre-existing interactive demonstration, preserved on fictitious data.
- `/file` — customer case access path. Its existing authorization boundary is unchanged by this work.
- `/admin` and its sub-routes — existing protected administration. Unchanged by this work.
- `/trial` — guided-trial explanation and contact path using the explicitly confirmed commercial recipient. It opens the visitor's mail client and does not claim that a message was sent automatically.

The original interactive root application was copied to `/demo` by reusing its exact Git blob before the root route was replaced. This avoids a manual copy/rewrite of the interactive application.

## Commercial claims

The showcase must not imply that:

- fictitious integrations are connected to real client systems;
- a human handoff is executed when only the need for handoff has been identified;
- P1/P1.7 is authorized for customer release before qualification, human review and rollout gates are complete;
- certifications, client logos, testimonials or performance figures exist without evidence;
- customization is instantaneous or included without implementation work.

Customization is described as a scoped service that can cover brand identity, customer journeys, knowledge governance and integrations after technical/security review.

## Performance and provider isolation

The showcase is rendered as a server component and contains no direct `/api/`, `fetch`, Supabase or provider bootstrap. `tests/atlas-public-showcase.test.mjs` enforces this source boundary.

`scripts/smoke-public-showcase.mjs` launches the application with external providers disabled, blocks all external browser traffic, checks that `/` performs no `/api/` request, captures navigation timing and stores desktop/mobile screenshots.

The browser evidence workflow uploads:

- `showcase-desktop.png`
- `showcase-mobile.png`
- `trial-mobile.png`
- `report.json`
- `server.log`

These development-server timings are comparative diagnostics, not production latency claims.

## Accessibility and responsive checks

The showcase provides a skip link, semantic headings/sections, keyboard-focusable navigation, real route destinations, reduced-motion handling and automated horizontal-overflow checks at desktop and 390 px mobile widths.

Browser automation verifies keyboard focus on the main demonstration CTA and checks both the root and trial routes for horizontal overflow.

## Commercial contact

The commercial recipient is explicitly confirmed as `Mohammed.elmesbahi@outlook.com`.

`/trial` uses a standard `mailto:` action with a prefilled subject/body. This intentionally avoids introducing a server-side form, database write, anti-spam service or third-party delivery dependency solely for the showcase. The page states that nothing is sent automatically and that the visitor can edit the message before sending it from their own mail client.

Source and browser regression tests pin the exact confirmed recipient and reject the previously supplied typo domain.

## Qualification boundary

A green showcase CI proves source/build/browser integrity for the public presentation. It does **not** qualify:

- live Supabase authentication/MFA/RLS;
- large-volume SQL or remote index performance;
- live LLM/embedding quota or availability;
- P1.7 generated-answer quality;
- production customer release.

Those gates remain independent and must not be weakened to publish the showcase.

## Rollout

1. Review the desktop and mobile evidence artifacts.
2. Verify the standard repository Quality checks and Public showcase evidence workflow are green on the exact final PR head.
3. Mark the PR ready for review only after the confirmed commercial contact is covered by source and browser tests.
4. Merge without changing P1 release flags.
5. Verify the post-merge `main` Quality checks.
6. Publish the showcase independently of P1 customer-release activation.

## Rollback

No database migration or external configuration is introduced. Reverting the showcase commits restores the previous root route. The demonstration, customer tracking, admin routes and P1 runtime remain otherwise unchanged.
