# Scranbook

<p align="center">
  <img src="./public/icon.svg" alt="Scranbook app icon" width="140" />
  <br />
  <a href="https://scranbook.labs.tau.gr">
    <img src="https://img.shields.io/badge/live-Cloudflare%20Static%20Assets-f59e0b" alt="live app" />
  </a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license" />
  <img src="https://img.shields.io/badge/PWA-local--first-718067" alt="local-first PWA" />
  <br />
  A warm, private food diary with editable vision-model estimates.
</p>

## Overview

Scranbook is a mobile-first Next.js PWA exported as static files and deployed with Cloudflare
Workers Static Assets. Meal entries and processed photos live in IndexedDB on the user's device.
There are no accounts, analytics, Worker code, or server-side diary APIs.

When the user explicitly chooses to analyse a photo, the browser sends it directly to their
configured OpenAI-compatible endpoint. LM Studio with `google/gemma-4-e4b` is the default local
development profile, but the provider is configurable.

## Features

- Camera or gallery capture with browser-side resize and metadata removal.
- Manual diary entry that works without an AI model.
- Editable dish, portion, ingredient, confidence, and uncertainty fields.
- Editable calorie and macro estimates calculated locally from bundled official
  food-composition data.
- Local IndexedDB persistence with export, import, deletion, and storage visibility.
- Configurable model URL, model ID, API key, headers, timeout, and response mode.
- Mobile diary/add/settings navigation and a two-column desktop journal.
- Installable offline PWA shell with local diary access.
- No external nutrition API and no medical, allergy, or food-safety claims.

## Requirements

- Node.js 22.13+
- pnpm 11.9+
- Optional: an OpenAI-compatible vision endpoint such as LM Studio

## Setup

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Model configuration is stored through the Settings screen, not an
environment file.

For the verified LM Studio profile, start the loopback-only server with browser access enabled:

```sh
lms server start --port 1234 --bind 127.0.0.1 --cors
```

Then use:

```text
Base URL: http://127.0.0.1:1234/v1
Model: google/gemma-4-e4b
Response mode: Strict JSON schema
```

The endpoint must allow browser requests. A deployed HTTPS app may encounter browser-specific
local-network restrictions, especially in Safari; running Scranbook locally is the most dependable
way to use a plain-HTTP local endpoint.

## Commands

```sh
pnpm dev
pnpm build
pnpm start
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm test:e2e
pnpm test:live -- --image /path/to/meal.jpg
pnpm nutrition:data
pnpm cloudflare:preview
pnpm cloudflare:deploy
```

`test:live` is opt-in and never runs in CI. Pass a local image with `--image` or set
`SCRANBOOK_TEST_IMAGE`; the command resizes it before inference and prints validated output plus
latency without logging image bytes or credentials.

`nutrition:data` reproducibly downloads the pinned USDA FoodData Central and UK CoFID releases and
rebuilds the committed browser index. Production never downloads those upstream datasets or calls a
nutrition API at runtime. See [docs/nutrition-data.md](./docs/nutrition-data.md) and
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Privacy

Scranbook has no diary backend. Cloudflare serves the application files, while entries, photos,
settings, and saved credentials stay in browser storage. A photo leaves the device only when the
user chooses to analyse it, and then travels directly to the configured endpoint.

See the in-app `/privacy` page and [SECURITY.md](./SECURITY.md).

## Deployment

Production is served from `https://scranbook.labs.tau.gr` using Cloudflare Workers Static Assets.
Static asset requests are served without invoking Worker code. The production build contains no AI
key or AI proxy; a model is configured locally by each browser.

Cloudflare Workers Builds should connect to the `taugr/scranbook` repository:

- Production branch: `main`
- Root directory: `/`
- Build command: `pnpm test && pnpm typecheck && pnpm lint && pnpm format`
- Deploy command: `pnpm cloudflare:deploy`
- Build output: `out`

## Project structure

```text
src/app/                 Next.js routes, metadata, privacy page, and styling
src/components/          Diary, capture, review, and settings interface
src/lib/                 schemas, IndexedDB, images, nutrition, archives, and model provider
tests/                   Vitest coverage
tests/e2e/               Playwright mobile, desktop, PWA, and accessibility coverage
scripts/                 setup, dataset generation, and opt-in live-model evaluation
public/                  PWA assets and the bundled local nutrition index
docs/                    product specification and supporting technical notes
```

## Quality gate

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
pnpm cloudflare:preview
```
