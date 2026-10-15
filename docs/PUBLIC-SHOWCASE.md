# Public product showcase

## Purpose

The public root route is a lightweight commercial presentation of SAV SC Assistant AI. It is intentionally separated from the interactive demonstration, real customer tracking, administration and P1 release qualification.

## Enterprise presentation

The presentation combines an ivory/forest-green identity, separate customer and administrator explanations, four native scenario selectors (repair, quote, delivery and return), scoped personalization, an implementation outline and a keyboard-operable FAQ. The guided trial follows the same visual system and retains the confirmed, visitor-controlled email flow.

The scenario selectors use native radio inputs and CSS; they and the FAQ work without JavaScript. Examples are explicitly illustrative. They do not execute business actions or call an AI provider. Customer-facing copy explains qualification and controlled opening without internal release identifiers.

`public/showcase/client-workspace.png` and `admin-reports.png` are exact product screenshots captured by `scripts/smoke-client-ui.mjs` (source `794ab634bf686de61ada91069a4d0566adec4c6d`) and `scripts/smoke-admin-business.mjs` (source `f6ba517c561f43e8b8c8121f925d87b52313511e`). The browser runs used synthetic API fixtures with external traffic blocked. These are product illustrations, not live customer data, live operational metrics or customer testimonials. Each is labeled, dimensioned, lazy-loaded, and can be opened at full size without exposing an admin route. Each PNG is limited to 250 KiB.

The local SVG sprite contains a Lucide subset with its license. It avoids repeating icon path data and loads from the same origin; no font, analytics or illustration service is added.

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

After `npm run build`, `scripts/smoke-public-showcase.mjs` launches the **production build** with external providers disabled and release mode off. It blocks all external browser traffic and verifies:

- the root performs no `/api/` or third-party request on first view;
- the uncompressed root HTML remains below a 128 KiB regression budget;
- the public internal destinations exposed by the root respond successfully;
- the root and all four scenarios have no horizontal overflow at 320, 390, 640, 768, 1024 and 1440 px;
- the first keyboard stop exposes the skip link and primary CTA routes remain focusable;
- scenario selection and FAQ expansion work using the keyboard and with JavaScript disabled;
- navigation/CTA/scenario/FAQ targets meet minimum touch dimensions, image dimensions match the actual assets, and section links resolve uniquely;
- reduced-motion preference removes transitions;
- `/trial` exposes only the explicitly confirmed commercial recipient;
- the browser reports no page errors.

The 128 KiB raw-HTML ceiling is a production regression guard, not a compressed transfer-size claim. Measuring the built route avoids counting development-only React component stacks and debug records, whose size changes with source layout and component count. The ceiling is unchanged. Navigation transfer metrics are captured separately immediately after loading `/` and are diagnostic evidence only; they do not establish field Core Web Vitals or conversion rates.

## Evidence workflow

`.github/workflows/showcase-evidence.yml` runs for relevant pull-request changes, relevant pushes to `main`, and manual dispatch. This means the specialized browser evidence is recreated after merge rather than relying only on pre-merge evidence.

Artifacts are named with the source branch head SHA on pull requests, or the push SHA on `main`, and retained for seven days. Each artifact contains:

- full-page and first-screen captures for desktop, compact mobile, mobile, tablet and laptop;
- full-page and first-screen captures for the trial page on desktop and mobile;
- `report.json`
- `server.log`

The workflow pins external GitHub Actions by commit SHA, disables checkout credential persistence, uses `LLM_PROVIDER=demo`, `LLM_BUDGET_MODE=zero` and `P1_RELEASE_MODE=off`, and does not make live provider qualification calls.

## Accessibility and responsive checks

The showcase provides a skip link, semantic headings/sections, keyboard-focusable navigation, real route destinations and reduced-motion handling.

Browser automation verifies the first keyboard focus stop, explicit focusability of the main demonstration CTA, successful internal route destinations, and horizontal-overflow boundaries across compact mobile, mobile, tablet and desktop layouts.

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

## Repository governance

The repository must still use GitHub branch protection or a repository ruleset to make required checks mandatory on `main`. CI files can generate evidence but cannot substitute for repository-level enforcement. The intended required baseline is the standard `Quality checks` workflow; showcase-specific browser evidence additionally runs whenever its path filters apply.

## Rollout

1. Review the desktop and mobile evidence artifacts.
2. Verify the standard repository Quality checks and Public showcase evidence workflow are green on the exact final PR head.
3. Merge without changing P1 release flags.
4. Verify the post-merge `main` Quality checks.
5. For showcase-related changes, also verify the post-merge `main` Public showcase evidence artifact bound to the source/push SHA.
6. Publish the showcase independently of P1 customer-release activation.

## Rollback

No database migration or external configuration is introduced. Reverting the showcase commit restores the previous root route. The demonstration, customer tracking, admin routes and P1 runtime remain otherwise unchanged.
