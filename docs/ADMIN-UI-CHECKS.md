# Admin browser regression checks

Run `npm run test:admin-ui` after `npm ci`. The check uses installed Google Chrome
and `playwright-core`; it does not download a second browser. Set
`ADMIN_UI_BROWSER_CHANNEL` only to select another installed Chromium channel.
GitHub Actions runs this check on its Ubuntu runner after the existing gates.

The Vite server runs on `127.0.0.1:4177` with a zero LLM budget and P1 off.
The browser intercepts every production API request with synthetic fixtures and
blocks external HTTP requests. Unexpected API routes or settings writes fail the
check. No provider keys, production accounts, or customer records are needed.

Covered behavior:

- 65 dossiers across three pages, applied search state and status filtering;
- keyboard pagination and confirmation before losing an edited dossier;
- desktop/mobile layout without horizontal overflow at 1440/390 pixels;
- published RAG provenance, disabled demo-only precision control;
- explicit embedding consent, visible degraded search, unavailable search;
- no configuration mutation while testing a question.

`outputs/admin-ui` contains screenshots, the Vite log and a JSON report with
browser version and individual check durations. CI uploads this evidence for
seven days even when the browser check fails. Durations include development
compilation and browser scheduling: they are not production latency benchmarks.

These checks complement API authorization, database and search tests. The mocked
browser transport cannot qualify authentication, live indexing, provider quality,
P1.7, business integrations, or real production capacity. Those remain separate
qualification requirements.
