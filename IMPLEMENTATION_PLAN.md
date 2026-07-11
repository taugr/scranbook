# Scranbook Implementation Plan

Status: implemented and locally verified; production release in progress
Last updated: 2026-07-12

## 1. Product goal

Scranbook is a mobile-first, installable food diary. A user takes or selects a
photo, asks a configurable vision model to identify the meal and estimate its
ingredients and portions, corrects the result, and saves it locally.

The product should feel like a warm personal cookbook or kitchen notebook, not
a clinical calorie tracker. It must remain useful for manual diary entry when no
model is configured or the model is unavailable.

## 2. MVP principles

- No accounts, cookies, analytics, telemetry, or server-side diary storage.
- Diary entries, photos, settings, and model credentials stay on the device.
- A photo is sent to a model only after the user explicitly chooses to analyse
  it.
- A remote model endpoint necessarily receives the analysed image. The app must
  explain this before the first request and must not describe that configuration
  as fully offline.
- AI results are suggestions. Every inferred field is editable before and after
  saving, and uncertain fields are visibly marked.
- The first release estimates ingredients and portions, not calories, macros,
  allergies, or medical suitability.
- The installed app can browse, add, edit, export, and delete diary entries
  offline. AI analysis requires a reachable model endpoint.

## 3. Technical direction

Follow the structure and operating conventions of
`/Users/tomauger/projects/ayeride`:

- Next.js App Router, React, and TypeScript.
- pnpm with a single-package workspace.
- Cloudflare Workers deployment through `@opennextjs/cloudflare`.
- Vitest for unit and integration tests.
- Playwright for mobile, desktop, offline, and PWA browser coverage.
- oxlint and oxfmt for linting and formatting.
- GitHub Actions for the quality gate.
- A web manifest, app icons, Apple PWA metadata, and a service worker.

Apply the `typescript-project-scaffold` workflow where appropriate:

- Complete package metadata and repository links.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and MIT `LICENSE`.
- Renovate configuration.
- Husky, lint-staged, and guarded `prepare` script.
- Explicit pnpm supply-chain policy, including the one-day release-age gate.
- Typecheck, test, lint, format, build, and browser-test scripts.

Scranbook will not initially expose application API routes. Cloudflare serves
the app shell and assets; diary operations and model requests happen in the
browser. This keeps meal data out of the Worker and leaves room to add server
features later without changing frameworks.

## 4. Local data architecture

Use IndexedDB through a small typed wrapper such as `idb`. Do not store images
or diary records in `localStorage`.

Suggested stores:

### `entries`

- `id`: UUID
- `capturedAt`: ISO timestamp
- `eatenAt`: ISO timestamp
- `mealType`: optional breakfast, lunch, dinner, snack, or other
- `title`: editable dish name
- `notes`: free-form user notes
- `classification`: meal, recipe card, packaged food, or unclear
- `servings`: optional estimated number of servings
- `portionSummary`: editable plain-language estimate
- `ingredients`: ordered ingredient estimates
- `photoId`: reference to the processed image
- `analysis`: model name, endpoint origin, prompt/schema version, confidence,
  and analysis timestamp; never an API key
- `createdAt` and `updatedAt`

### `photos`

- `id`: UUID
- Processed image blob
- MIME type, width, height, and byte size
- Creation timestamp

### `settings`

- OpenAI-compatible base URL
- Model ID
- Optional API key
- Optional headers
- Structured-output compatibility mode
- Image-size and retention preferences
- Privacy acknowledgement version

### `meta`

- Database schema version
- Migration markers
- Export format version

Image ingestion should:

1. Accept the rear camera or photo library.
2. Correct orientation in the browser.
3. Resize large phone images to a sensible inference/storage maximum.
4. Re-encode to JPEG or WebP and remove EXIF metadata, including location.
5. Show the processed preview before analysis.
6. Delete orphaned blobs if the user cancels or removes an entry.

After the first saved entry, request persistent browser storage where supported.
Show estimated storage usage in settings. Provide a versioned export/import
archive containing entries and photos but excluding model credentials by
default. Provide separate actions to clear the diary and clear credentials.

## 5. AI provider contract

Implement a browser-direct OpenAI-compatible vision adapter using `fetch`
rather than tying the domain layer to one SDK or vendor.

Configurable fields:

- Base URL, defaulting in development to `http://127.0.0.1:1234/v1`.
- Model ID.
- Optional bearer token.
- Optional additional request headers.
- Request timeout.
- Response mode: JSON Schema, JSON object, or tolerant text extraction.

The provider client must support:

- A connection/model test that distinguishes unreachable endpoint, CORS or
  local-network denial, authentication failure, missing model, timeout, invalid
  response, and unsupported vision input.
- `AbortController` cancellation.
- Image data URLs in OpenAI-compatible multimodal messages.
- Runtime validation of parsed output.
- Compatibility fallback when an endpoint does not support strict structured
  output.
- No automatic retries that could unknowingly resend a private photo. A retry
  must be initiated or clearly approved by the user.
- No logging of image data, authorization headers, or raw credentials.

Suggested inference result:

```ts
interface MealAnalysis {
  classification: 'meal' | 'recipe_card' | 'packaged_food' | 'unclear';
  dishName: string;
  servings: number | null;
  portionSummary: string;
  ingredients: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    preparation: string | null;
    confidence: 'low' | 'medium' | 'high';
  }>;
  overallConfidence: 'low' | 'medium' | 'high';
  uncertaintyNotes: string[];
}
```

Prompt requirements:

- Describe only visible or reasonably inferable food.
- Separate observation from estimation.
- Avoid inventing hidden ingredients with high confidence.
- Use grams or millilitres when defensible, while allowing household measures.
- Treat printed recipe quantities as recipe context, not proof of the amount
  consumed.
- Return `unclear` when the image is not usable.
- Never make health, allergy, or medical claims.

## 6. LM Studio development profile

The local LM Studio server was verified on 2026-07-12:

- Base URL: `http://127.0.0.1:1234/v1`
- Primary fast development model: `google/gemma-4-e4b`
- Optional quality comparison model: `google/gemma-4-12b-qat`
- Other exposed models: `google/gemma-4-12b` and
  `text-embedding-nomic-embed-text-v1.5`

Use `google/gemma-4-e4b` for the normal capture-and-review loop so local tests
remain responsive. Use the larger QAT model only for explicit quality comparison
when the smaller model's result needs investigation.

The app remains generic: LM Studio is one development profile, not a product
dependency or brand promise.

Live-model evaluation should be opt-in and excluded from the default CI suite.
It should:

1. Confirm the configured model is available from `/v1/models`.
2. Analyse one image at a time with conservative timeouts.
3. Record latency and validated structured output without persisting image data
   or credentials in logs.
4. Exercise ordinary plated meals, mixed plates, packaged foods, poor lighting,
   ambiguous portions, non-food images, and printed recipe cards.
5. Report qualitative errors rather than treating one expected ingredient list
   as exact ground truth.

The local folder `/Users/tomauger/projects/recipe-generation/recipes` may be
used by an opt-in evaluation command. It must not be imported wholesale into
the repository or used as the only test corpus. In particular,
`IMG_20210703_184219.jpg` is a phone photo of a printed recipe card and should
verify classification and uncertainty handling rather than ordinary meal-photo
recognition.

## 7. User experience

### Mobile navigation

- **Diary**: entries grouped by date, with the most recent first.
- **Add**: central camera action.
- **Settings**: model, storage, privacy, export, import, and deletion.

### Add-meal flow

1. Take a photo, choose from the library, or enter a meal manually.
2. Preview, rotate, replace, or remove the photo.
3. Analyse only after explicit confirmation.
4. Show progressive status with a cancel action.
5. Review dish name, portion, ingredients, confidence, and uncertainty.
6. Edit every field and save to the diary.

### Diary and entry flow

- Timeline cards show photo, time, title, and compact portion summary.
- Entry detail supports editing, re-analysis, duplication, and deletion.
- Re-analysis creates a draft and does not overwrite the accepted entry until
  the user confirms it.
- Model failure keeps the photo and manual edits intact.

### Desktop layout

Use a two-column kitchen-journal composition: diary navigation and timeline on
the left, selected entry or add-meal workspace on the right. Do not merely
stretch the mobile cards across the viewport.

## 8. Visual direction

Create a friendly, comforting, humanist culinary style:

- Warm oat-paper background.
- Tomato, sage, aubergine, butter, and charcoal semantic colours.
- Expressive editorial serif for headings and a highly readable humanist sans
  serif for controls and body text.
- Softly irregular cards, subtle paper texture, restrained hand-drawn culinary
  motifs, and generous rounded controls.
- Self-hosted build-time fonts; no runtime font requests.
- Minimum 44 px touch targets, accessible contrast, visible focus states,
  reduced-motion support, and safe-area padding.
- Warm, factual language without guilt, scoring, or diet-culture framing.

## 9. PWA and offline behaviour

- Installable manifest with maskable 192 px and 512 px icons and an Apple touch
  icon.
- Standalone display mode and correct theme/background colours.
- Service worker caches only the application shell and versioned static assets.
- Diary reads and writes continue offline through IndexedDB.
- Model requests are never cached by the service worker.
- Offline or unconfigured analysis presents a clear manual-entry path.
- Service-worker updates do not silently discard an in-progress meal draft.
- Camera/gallery behaviour is tested in installed-PWA-like mobile viewports
  where browser automation allows it.

## 10. Security and privacy controls

- Content Security Policy and other standard security headers.
- Explicit handling for configurable `connect-src` destinations without routing
  model traffic through Cloudflare.
- Sanitize and validate imported archives before writing to IndexedDB.
- Validate image MIME type, dimensions, and size before decoding.
- Never render model-produced HTML.
- Do not include credentials in exports, URLs, analytics, error messages, or
  source-controlled fixtures.
- Explain that locally stored API keys remain accessible to code running under
  the Scranbook origin; offer session-only credentials as an option.
- Include a concise privacy page and data-deletion instructions.

## 11. Testing strategy

### Fast default suite

- Data schema and migration tests.
- IndexedDB repository tests using a browser-compatible test database.
- Image resize, orientation, metadata-removal, and cleanup tests.
- Prompt construction and redaction tests.
- Structured, partial, malformed, fenced, and plain-text response parsing.
- Provider error classification and cancellation.
- Export/import round trips and incompatible archive rejection.
- Diary sorting, editing, deletion, and re-analysis draft behaviour.

### Browser suite

- Primary mobile viewport around 390 by 844.
- At least one narrower phone and one modern desktop viewport.
- Camera/gallery file selection using committed, small, purpose-built fixtures.
- Mocked model success, uncertainty, timeout, CORS-like failure, and malformed
  output.
- Reload persistence, offline diary use, service-worker registration, manifest,
  installability metadata, and storage clearing.
- Accessibility checks for keyboard navigation, labels, contrast-sensitive
  states, focus, and reduced motion.

### Opt-in live suite

- LM Studio connection against `google/gemma-4-e4b`.
- Representative local image evaluation.
- Schema-validity, latency, cancellation, and correction-flow verification.
- Optional comparison against `google/gemma-4-12b-qat` when useful.
- Results clearly labelled as model-quality observations, not deterministic CI
  assertions.

## 12. Dependency and quality policy

At implementation time, query the registry again and install the newest
mutually compatible releases. The 2026-07-12 planning snapshot was:

- Next.js `16.2.10`
- React and React DOM `19.2.7`
- `@opennextjs/cloudflare` `1.20.1` (temporarily held at `1.20.0` because the
  `1.20.1` dependency tree requested an unpublished AWS SDK version on
  2026-07-12; the install also pins the last published compatible AWS SDK S3
  middleware and multi-region signature packages)
- Wrangler `4.110.0`
- TypeScript `7.0.2` (held at the latest 6.x, `6.0.3`, because Next.js
  `16.2.10` failed its production build worker with TypeScript 7 even though
  standalone typechecking passed)
- Vitest `4.1.10`
- Playwright `1.61.1`
- oxlint `1.73.0`
- oxfmt `0.58.0`
- `idb` `8.0.3`
- Zod `4.4.3`

The local pnpm launcher advertised `11.12.0`, but pinning that version caused
pnpm's version switcher to fail before installation because the release
integrity metadata was unavailable. Keep the known-working `11.9.0` project pin
until that release can be installed and verified normally.

Do not force a new major if a required tool has an incompatible peer range or
fails the real quality gates. Check majors independently, run `pnpm peers
check`, and document any temporary hold. Keep the scaffold's one-day release
age policy unless an explicit, reviewed exception is needed.

Required local gate:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
pnpm run cloudflare:preview
```

## 13. Delivery phases

### Phase 1: Scaffold and specification

- Create the Next.js/TypeScript project and apply the TypeScript scaffold.
- Add package policy, CI, documentation, tests, and Cloudflare/OpenNext config.
- Commit the domain schema and privacy/model contracts.

### Phase 2: Local diary foundation

- Implement IndexedDB stores and migrations.
- Implement image ingestion and cleanup.
- Build manual add, diary timeline, entry detail, edit, and delete flows.
- Add export/import and storage management.

### Phase 3: Configurable vision analysis

- Implement settings and connection diagnostics.
- Implement the OpenAI-compatible adapter and validated result parser.
- Add editable review, uncertainty, cancellation, and re-analysis drafts.
- Validate locally with LM Studio and `google/gemma-4-e4b`.

### Phase 4: Design and PWA completion

- Apply the culinary visual system.
- Complete mobile and desktop responsive layouts.
- Add icons, manifest, offline shell, safe areas, and update handling.
- Perform rendered visual and accessibility review.

### Phase 5: Release

- Pass the complete quality gate and Cloudflare preview.
- Create the private GitHub repository `taugr/scranbook`.
- Commit using conventional commit messages and push `main`.
- Deploy the `scranbook` Worker and bind `scranbook.labs.tau.gr`.
- Configure Cloudflare Workers Builds from the private GitHub repository, like
  AyeRide.
- Verify the live shell, PWA metadata, mobile/desktop layouts, local diary,
  offline behaviour, data deletion, and graceful no-model state.

Production will not include an AI secret or proxy. The deployed app is complete
when it works as a local diary and clearly guides the user to configure a model;
live production AI is not a release gate.

## 14. MVP acceptance criteria

- A phone user can take or select a photo, manually describe it, and save it.
- With LM Studio configured, a user can analyse a photo with
  `google/gemma-4-e4b`, edit the returned ingredients and portions, and save the
  accepted result.
- A recipe-card photo is not silently presented as the consumed portion.
- Reloading or going offline retains diary entries and processed images.
- No diary or photo request is sent to Scranbook's Cloudflare Worker.
- The UI clearly identifies when a model endpoint will receive a photo.
- Export/import round-trips entries and photos without exporting credentials.
- Users can delete individual entries, all diary data, and credentials.
- The app is usable at phone and desktop sizes and is installable as a PWA.
- Unit, browser, build, and Cloudflare preview gates pass.
- The private GitHub repository is pushed and `scranbook.labs.tau.gr` serves the
  verified application shell.

## 15. Deferred work

- Calories, macro- and micronutrients, allergens, or medical guidance.
- Accounts, cross-device sync, sharing, social features, or server backups.
- On-device WebGPU inference bundled into the PWA.
- Barcode databases, nutrition-provider integrations, or restaurant menus.
- Multi-photo or video analysis.
- Native iOS or Android applications.
- Automated meal scoring, targets, streaks, or weight-loss features.
