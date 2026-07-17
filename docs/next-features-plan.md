# Scranbook Next Features Implementation Plan

Status: implemented locally; awaiting user review and release
Last updated: 2026-07-18

The separate follow-on plan for scanning packaged-food nutrition panels is in
[nutrition-label-scanner-plan.md](./nutrition-label-scanner-plan.md).

## 1. Purpose

This document turns the post-MVP product review into an implementation plan for
Scranbook's next development cycle. It covers the changes that are worth making
now, their delivery order, the expected data and interface contracts, and the
tests required before each change is considered complete.

The plan deliberately strengthens Scranbook as a private, local-first kitchen
notebook. It does not introduce accounts, a diary backend, diet scoring, or a
new nutrition service.

## 2. Intended outcome

After this work, a regular Scranbook user should be able to:

- Recognize one consistent Scranbook brand mark in the repository, browser,
  installed PWA, loading state, and application header.
- Use photo and archive pickers with a keyboard as well as touch or a pointer.
- Leave or reload an unfinished meal and recover it without losing its photo or
  edits.
- Find an older meal quickly by text, date, meal type, or image kind.
- Log a previously eaten meal again without copying stale timestamps, model
  metadata, notes, or a misleading old photo.
- Review an automatic nutrition database match, select a better local record,
  or exclude an ingredient from the calculation.
- Understand that manual entry needs no model and configure an optional vision
  endpoint through a friendlier setup path.
- See a gentle reminder to create a local backup when the diary has become
  valuable and has not been exported recently.

## 3. Delivery principles

All phases must preserve these existing product contracts:

- The production application remains a Next.js static export served by
  Cloudflare Workers Static Assets with no Worker script or diary API.
- Diary entries, draft data, photos, settings, and backup metadata remain in the
  browser's IndexedDB or session storage.
- Search queries and filters are not placed in URLs, logs, analytics, or remote
  requests.
- No photo or meal content leaves the device unless the user explicitly asks a
  configured model to analyse a photo.
- Manual meal entry, browsing, editing, search, nutrition calculation, export,
  and deletion continue to work offline.
- AI output and nutrition values remain editable estimates rather than health
  advice or authoritative facts.
- Existing entries and version 1 Scranbook archives remain readable.
- Credentials remain excluded from diary archives.
- Mobile remains the primary layout, while the current two-column desktop
  composition remains fully supported.
- New controls meet the existing 44 px target-size, visible-focus,
  reduced-motion, and warm-language conventions.

## 4. Current implementation baseline

The plan is based on these current code contracts:

- `ScranbookApp` owns diary, editor, settings, draft, busy, notice, and connection
  state in one client component.
- Entries and photos are stored in IndexedDB version 1. The database already has
  `entries`, `photos`, `settings`, and `meta` stores.
- Entries have a `by-eaten-at` index and are loaded into memory in reverse date
  order.
- The active editor draft and its pending photo currently exist only in React
  state.
- The current Duplicate action clones an entry into the editor but is not a
  purpose-built repeat-meal workflow.
- Nutrition matching already computes several ranked candidates internally, but
  the interface only exposes the selected automatic match.
- The model settings form exposes the full provider contract directly, including
  advanced configuration.
- Export and import use a validated version 1 ZIP archive containing entries and
  processed photos.
- The README, web manifest, metadata, and installed PWA use `public/icon.svg` and
  its raster derivatives. The in-app header and loading screen instead render a
  Lucide utensils glyph.
- File inputs for choosing, replacing, and importing files are currently hidden
  with `display: none` inside labels, leaving a keyboard-access risk.

## 5. Scope and priority

| Order | Work package                         | User value                         | Relative size | Main risk                                     |
| ----- | ------------------------------------ | ---------------------------------- | ------------- | --------------------------------------------- |
| 0     | Brand and file-picker accessibility  | Immediate consistency and access   | Small         | Responsive visual regression                  |
| 1     | Draft autosave and recovery          | Prevents loss of user work         | Medium        | Draft/photo lifecycle correctness             |
| 2     | Diary search, filters, and Log again | Improves repeat daily use          | Medium        | Mobile information density                    |
| 3     | Nutrition match review               | Improves estimate transparency     | Medium/large  | Preserving manual choices on recalculation    |
| 4     | Guided model setup                   | Reduces optional-AI setup friction | Medium        | Endpoint differences and browser restrictions |
| 5     | Backup reassurance                   | Protects a local-only diary        | Small/medium  | Reminder fatigue and misleading backup status |

Each package is independently releasable. The packages were implemented in the
order below and passed the full local quality gate together. Deployment remains
deliberately pending until the local build has been reviewed.

## 6. Work package 0: brand consistency and file-picker accessibility

### 6.1 Product behavior

- Use the illustrated bowl-and-spoon icon as the canonical Scranbook brand mark.
- Show that mark in the application header and loading state.
- Retain Lucide icons for actions such as Add, Settings, Rotate, Delete, and
  nutrition controls; those are interface symbols rather than brand marks.
- Keep the existing wordmark text and kitchen-notebook subtitle.
- Make Choose photo, Replace photo, and Import archive reachable and operable by
  keyboard without changing their touch behavior.

### 6.2 Implementation

- Add a small reusable `BrandMark` component backed by `/icon.svg`.
- Render the image as decorative inside the already labelled Open diary button.
  The loading state also has adjacent text, so it should not announce a duplicate
  image description.
- Size the source asset directly at the existing 47 px desktop and 41 px mobile
  header slots. Do not place the complete app icon inside the current tomato
  circle or layer a second background behind it.
- Adjust `.brand-mark` styling to remove assumptions that its child is a stroked
  Lucide SVG. Preserve its current alignment and avoid moving the wordmark.
- Replace `display: none` file inputs with a shared visually-hidden control
  pattern that remains in the tab order.
- Give the visible label/button treatment a focus outline when its nested input
  receives `:focus-visible`, for example with `:has(input:focus-visible)`.
- Apply the same pattern to the empty photo picker, photo replacement action,
  and archive import action.
- Do not regenerate the SVG or raster PWA assets in this package; they already
  represent the canonical mark.

### 6.3 Tests and acceptance criteria

- The README icon, browser icon, installed-app icon, loading mark, and header mark
  visibly represent the same bowl-and-spoon design.
- The wordmark remains correctly aligned at 390 x 844, the narrow mobile project,
  and desktop width.
- Tabbing from the page reaches Choose photo, Replace, and Import archive in a
  logical order and shows a visible focus indicator.
- Pressing Enter or Space on each focused file control opens its file chooser in
  browsers where that interaction is supported.
- Pointer and touch file selection still work.
- Existing accessible names remain concise and are not duplicated by the icon.
- Axe reports no new serious or critical violations.
- Updated visual-review captures cover the mobile empty state, mobile add flow,
  settings, and the desktop header.

## 7. Work package 1: draft autosave and recovery

### 7.1 Product behavior

- Starting a new meal, editing an entry, or logging a meal again creates an
  active draft.
- Changes are saved locally after a short debounce and immediately after
  expensive steps such as photo processing, rotation, or model analysis.
- Returning to the diary does not discard the draft.
- Reloading or reopening the PWA presents a clear Continue draft and Discard
  draft choice.
- Continue returns to the correct editor state with all fields and the processed
  photo restored.
- Discard removes the draft and its draft-only photo without changing a saved
  entry.
- A successful Save to this device clears the active draft only after the entry
  and photo transaction completes.
- Starting another new meal while a draft exists first offers Continue or
  Discard; it must not silently replace the existing draft.
- Importing an archive or deleting the entire diary explicitly explains that an
  active draft will also be discarded.

### 7.2 Draft contract

Add a versioned draft schema similar to:

```ts
interface MealDraft {
  format: 'scranbook-draft';
  version: 1;
  mode: 'new' | 'edit' | 'repeat';
  sourceEntryId: string | null;
  entry: MealEntry;
  photo: StoredPhoto | null;
  savedAt: string;
}
```

The stored draft includes its current processed photo blob. Keeping the blob in
the draft record avoids creating orphaned records in the permanent `photos`
store when a user repeatedly replaces or abandons a photo.

### 7.3 IndexedDB behavior

- Store the active draft in the existing `meta` object store under a stable key
  such as `active-draft`.
- Add typed `loadActiveDraft`, `saveActiveDraft`, and `clearActiveDraft`
  repository functions.
- Validate the entry and photo metadata when loading. An invalid or unsupported
  draft should be rejected safely and offered for deletion rather than crashing
  application initialization.
- Keep IndexedDB at version 1 because the existing `meta` store can hold this
  value; no object-store migration is required.
- Do not include an active draft in the diary archive. An archive represents
  accepted diary records, not unsaved work.
- Clear draft metadata as part of Clear diary.
- Clear an active draft only after a successful archive replacement during
  import, so a failed validation does not destroy current work.

### 7.4 Application state and lifecycle

- Load settings, entries, storage, and the active draft together during
  initialization.
- Keep a draft status separate from transient success and error toasts.
- Use a 500-750 ms debounce for ordinary text and numeric changes.
- Flush immediately after photo preparation, photo rotation, analysis, and local
  nutrition calculation.
- Avoid unload-only persistence as the primary mechanism; mobile browsers do not
  reliably deliver lifecycle events before suspension.
- Suppress autosave while a draft is being restored or immediately after it is
  cleared to prevent recreation from stale component state.
- Surface storage/quota failures without blocking an explicit final save.
- Revoke object URLs whenever a restored or replaced photo is no longer active.

### 7.5 Interface

- On the diary, show a compact warm-paper draft card above recent entries.
- Include its title when available, last-saved time, Continue, and Discard.
- On mobile, the central Add action should open the active draft choice instead
  of resetting it.
- In the editor, show a quiet Saved on this device state after autosave and a
  clear local-save warning if persistence fails.
- Use a dedicated in-app confirmation surface for discarding; do not add another
  browser `confirm()` dependency for this routine action.

### 7.6 Tests and acceptance criteria

- Unit tests cover draft schema defaults and invalid records.
- Database tests cover save/load/replace/clear, including a Blob photo.
- A browser test creates a partial meal, reloads, continues it, and verifies all
  fields remain.
- A browser test restores a processed photo and can subsequently save it as a
  permanent entry.
- A browser test confirms Back to diary retains a draft.
- A browser test confirms Discard leaves an edited source entry untouched.
- A browser test confirms successful save removes the draft and failed save does
  not.
- Archive import validation failure preserves the active draft.
- Clear diary and successful archive replacement remove the active draft.
- Offline reload restores the draft without network access.
- Service-worker updates do not silently discard the draft.

## 8. Work package 2: diary search, filters, and Log again

### 8.1 Search behavior

- Add one search field to the diary surface.
- Search case-insensitively across:
  - entry title;
  - portion summary;
  - kitchen notes;
  - ingredient name and preparation;
  - selected nutrition food name.
- Add filters for date range, meal type, and image kind.
- Combine filters with AND semantics while matching any searchable text field.
- Keep search and filter state in memory only. Do not encode potentially private
  terms in a URL or persist them outside the current app session.
- Preserve reverse chronological ordering.
- Show a specific no-results state with a Clear filters action, distinct from the
  first-use empty-diary state.
- Display the result count when any search or filter is active.

### 8.2 Search implementation

- Keep the initial implementation client-side over the existing `entries`
  collection. A personal diary does not yet justify extra IndexedDB indexes or a
  search library.
- Add a small pure search-normalization and predicate module so behavior is easy
  to unit test.
- Normalize case, punctuation, repeated whitespace, and common apostrophe forms.
  Do not introduce fuzzy matching in the first release; predictable substring
  matching is easier to explain.
- Derive filtered entries with `useMemo` rather than changing the database query
  contract.
- Test the derived filtering surface with a synthetic collection large enough to
  catch accidental quadratic work. Revisit database-side searching only if the
  UI becomes visibly slow at several thousand entries.

### 8.3 Search interface

- On desktop, place search and compact filters at the top of the diary rail.
- On mobile, place search at the top of the diary screen and keep filters in a
  compact expandable row or sheet so they do not crowd the entry list.
- Use real labels, a visible Clear search action when populated, and announced
  result counts.
- Keep entry selection stable when filters change. If the selected entry becomes
  hidden, select the first visible result without changing or deleting data.

### 8.4 Log again behavior

- Replace the ambiguous Duplicate label with Log again.
- Create a fresh draft using a pure helper rather than cloning the complete
  persisted record inline.
- Copy the accepted meal identity and quantities:
  - title;
  - classification;
  - servings;
  - portion summary;
  - ingredients and their accepted nutrition selections;
  - nutrition totals, marked stale until recalculated.
- Generate a new entry ID and set `capturedAt`, `eatenAt`, `createdAt`, and
  `updatedAt` to now.
- Infer the default meal type from the current time.
- Clear the prior entry's notes, photo reference, and analysis metadata. An old
  photo should not represent a newly eaten meal, and prior model metadata should
  not imply a new analysis occurred.
- Open the result as a recoverable `repeat` draft so the user can adjust portions,
  add a current photo, recalculate nutrition, and save.
- Do not mutate the source entry or source photo.

### 8.5 Tests and acceptance criteria

- Unit tests cover search normalization and all filter combinations.
- Search matches title, notes, ingredients, preparation, and nutrition match
  names.
- Search terms never appear in the URL.
- Mobile and desktop controls do not obscure existing entry actions.
- Keyboard users can reach, change, clear, and reset every search control.
- A Log again unit test verifies fresh IDs and timestamps and verifies that the
  source object remains unchanged.
- Log again copies accepted meal fields while clearing notes, photo, and analysis.
- The copied nutrition state clearly requests recalculation rather than implying
  a new calculation happened.
- A repeated meal survives draft recovery and saves as a separate entry.

## 9. Work package 3: nutrition match review

### 9.1 Product behavior

- Show a Review match action next to each automatically matched ingredient.
- Also show Find a match when an ingredient with a gram estimate was not matched.
- Open an accessible match picker showing ranked records from the bundled USDA
  and UK CoFID database.
- Let the user search the bundled records, choose one, return to automatic
  matching, or exclude the ingredient from nutrition.
- Show food name, source, category, and the available per-100-g energy and macro
  values before selection.
- Mark a selected record as Automatic match or Chosen by you.
- Recalculate the full meal immediately after a choice changes so displayed
  totals and notes cannot disagree with the ingredient rows.
- Keep the existing rough-estimate disclaimer.

### 9.2 Schema compatibility

Extend the current schemas backward-compatibly:

- Add `selectedBy: 'automatic' | 'user'` to `NutritionMatch`, defaulting to
  `automatic` when older entries are parsed.
- Add `nutritionExcluded: boolean` to `Ingredient`, defaulting to `false`.
- Preserve the defaults through archive import so existing version 1 archives
  remain valid.
- Keep archive format version 1 because these are optional/defaulted entry fields,
  not a structural archive change.

The version should only increase if implementation reveals that old archives can
no longer be interpreted unambiguously.

### 9.3 Calculation behavior

- Export a public local-database search function using the existing ranking
  logic.
- When an ingredient has a user-selected match, resolve that food ID from the
  current bundled database and preserve it during recalculation.
- When an ingredient is excluded, omit it from totals and add a plain-language
  note.
- If a previously selected food ID no longer exists in a future database, clear
  the manual selection, mark nutrition stale, and explain that the match needs
  review.
- Changing an ingredient's name or preparation resets an existing manual match
  and exclusion because its identity changed.
- Changing only amount, unit, or estimated grams preserves the selected food but
  marks totals stale until recalculation.
- Do not describe user selection as higher scientific confidence. `selectedBy`
  expresses provenance; confidence continues to describe automatic matching.

### 9.4 Match-picker interface

- Use an accessible modal or mobile sheet with a labelled heading, initial focus,
  Escape/Close behavior, and focus restoration.
- Start with the current query and ranked candidates rather than an empty search.
- Limit rendered candidates to a small result set and provide a clear search
  field; do not render all 8,000-plus records at once.
- Distinguish USDA and UK CoFID in text, not color alone.
- Keep Choose, Exclude, Use automatic match, and Cancel actions unambiguous.

### 9.5 Tests and acceptance criteria

- Nutrition unit tests verify automatic, manual, excluded, and missing-food
  behavior.
- Recalculation preserves a manual match when only grams change.
- Editing ingredient identity clears the manual match.
- Existing entries and old archives parse with automatic/default selections.
- Export/import round-trips manual and excluded choices.
- Browser tests choose an alternative match and verify the total changes.
- Browser tests exclude and restore an ingredient.
- The picker is keyboard operable and restores focus to Review match when closed.
- Axe reports no new serious or critical violations with the picker open.

## 10. Work package 4: guided model setup

### 10.1 Product behavior

- Lead with the fact that Scranbook works manually without a model.
- Present two simple setup routes:
  - LM Studio on this device;
  - Custom OpenAI-compatible endpoint.
- The LM Studio route fills the known local defaults and explains that the local
  server must allow browser requests.
- The custom route exposes base URL, model ID, and optional API key.
- Keep credential storage, response mode, timeout, image quality, and additional
  headers under Advanced settings.
- Keep Test connection available before and after save.
- After a successful model-list request, show the models reported by the endpoint
  and let the user select one without retyping its ID.
- Label loopback and private-network addresses as appearing local, and clearly
  explain that photos sent to a remote address leave the device. Treat this as a
  best-effort privacy cue rather than a security guarantee.
- Show checking, connected, and specific failure states using the existing
  provider error classification.
- Never automatically test an endpoint or send a photo.
- Keep a clear Manual entry works without a model path in both settings and the
  add-meal flow.

### 10.2 State and compatibility

- Continue storing the actual provider contract in `ModelSettings`; do not create
  a second source of truth.
- Treat the LM Studio choice as a UI preset that fills the existing fields.
- Keep connection success as current-session state. If a last-checked timestamp
  is later stored in `meta`, label it Last checked rather than Connected because
  endpoint availability can change.
- Preserve existing saved settings and credentials exactly during the interface
  migration.
- Do not infer that a prefilled default endpoint is reachable.

### 10.3 Settings organization

- Keep Your local diary and Privacy controls visible as first-class settings; do
  not make users understand the model form to export or delete their diary.
- On mobile, show three clear settings sections:
  - Vision assistance;
  - Local diary and backup;
  - Privacy controls.
- Put model status and the primary Configure/Test action in the collapsed summary.
- Reveal advanced values only when requested.
- Preserve the Back to meal editor behavior and in-progress draft.

### 10.4 Tests and acceptance criteria

- Manual meal creation remains complete with an unreachable or unconfigured
  endpoint.
- Choosing the LM Studio preset fills the expected values without making a
  network request.
- Custom configuration persists through reload.
- Connection tests still distinguish unreachable, CORS/local-network,
  authentication, missing model, timeout, malformed response, and unsupported
  vision states.
- No test connection sends an image.
- Model discovery does not claim vision support; actual image capability is only
  exercised after the user explicitly chooses Analyse.
- Credentials remain excluded from export and error text.
- Settings remain usable at narrow mobile and desktop widths.
- Returning from settings restores the same draft and scroll context where
  practical.

## 11. Work package 5: backup reassurance

### 11.1 Product behavior

- Record when Scranbook successfully creates an export archive and how many
  entries existed at that moment.
- Use the wording Archive created rather than Backup saved because the browser
  cannot prove where the user stored the downloaded file.
- Show a gentle backup card only when:
  - the diary has at least five entries and has never been exported; or
  - the last archive is at least 30 days old and at least five entries have been
    added or updated since it was created.
- Let the user create an archive immediately or dismiss the reminder for seven
  days.
- Show the last archive-created date in Settings even when no reminder is due.
- Do not use notifications, streaks, warnings, guilt language, or background
  downloads.

### 11.2 Metadata

Store a versioned record in the existing `meta` store, for example:

```ts
interface BackupState {
  version: 1;
  lastArchiveCreatedAt: string | null;
  entryCountAtArchive: number;
  latestEntryUpdatedAtAtArchive: string | null;
  reminderDismissedUntil: string | null;
}
```

- Update archive metadata only after ZIP creation and download initiation both
  succeed.
- Do not include reminder state in the archive.
- Clear backup reminder metadata when the entire diary is deleted so a future
  new diary starts with an honest state.
- After import, treat the selected file as the most recent known archive: record
  its manifest `exportedAt`, imported entry count, and latest imported
  `updatedAt`, then clear any reminder dismissal. Label this value Most recent
  known archive so it does not imply that this browser created another copy.

### 11.3 Tests and acceptance criteria

- Unit tests cover never-exported, recently exported, changed, unchanged,
  dismissed, and due states.
- Export failure does not update the metadata.
- The reminder never appears below the five-entry threshold.
- Dismissal lasts seven days and does not affect manual export.
- Clear diary removes the reminder state.
- No diary contents or export metadata leave the browser.
- Reminder copy remains factual and neutral.

## 12. Component and module structure

The current main component is large, but this plan should not begin with a broad
rewrite. Extract components as their feature package needs them while keeping
screen orchestration in `ScranbookApp`.

Expected additions or extractions include:

- `src/components/brand-mark.tsx`
- `src/components/draft-card.tsx`
- `src/components/diary-controls.tsx`
- `src/components/nutrition-match-picker.tsx`
- `src/components/model-setup.tsx`
- `src/lib/draft.ts` for draft construction and repeat-meal helpers if those
  concerns do not fit cleanly in `schema.ts`
- `src/lib/diary-search.ts` for pure search/filter behavior
- typed draft and backup repository functions in `src/lib/db.ts`

Avoid moving existing components merely to satisfy a target file size. Each
extraction should have a clear ownership boundary and should ship with the
feature that uses it.

## 13. Data and migration strategy

### 13.1 IndexedDB

- Keep database version 1 while using the existing `meta` store for draft and
  backup records.
- Introduce a database version bump only if a new index or object store becomes
  necessary after performance testing.
- Every `meta` value added by this plan must have its own format/version marker
  and runtime validation.
- Database initialization must tolerate missing, older, invalid, or partially
  written metadata records.

### 13.2 Entries

- New nutrition fields use schema defaults so existing stored entries migrate on
  read without a destructive rewrite.
- Saving an older parsed entry writes the normalized current shape.
- Search and Log again do not require entry schema changes.

### 13.3 Archives

- Keep archive version 1 for defaulted entry fields.
- Continue excluding credentials, active draft state, search state, connection
  status, and reminder-dismissal state.
- Continue validating photo paths, sizes, entry references, and manifest shape
  before replacing the diary.
- Add old-shape fixtures to prevent a future schema extension from accidentally
  rejecting released archives.

## 14. Accessibility requirements across all packages

- All functionality must be reachable without pointer input.
- Every new icon-only action needs an accessible name and at least a 44 px target.
- Focus must move predictably into and out of dialogs or mobile sheets.
- Dynamic status such as draft save failure, search result count, connection
  status, recalculated nutrition, and archive creation must be announced without
  moving focus unexpectedly.
- Do not use color alone for active filters, nutrition provenance, errors, or
  connection state.
- Maintain logical heading order as settings and diary controls are reorganized.
- Test at 200% zoom and with reduced motion in addition to the existing Axe pass.
- Screenshot review is not a substitute for keyboard and assistive-technology
  checks.

## 15. Privacy and security review

Before each release, verify:

- New fetches are limited to the existing bundled nutrition asset and explicit
  provider actions.
- Search, draft, and backup metadata never enter a URL or remote log.
- Draft photos receive the same resize and metadata-removal processing as saved
  photos.
- Drafts and manual nutrition choices cannot inject HTML.
- Invalid IndexedDB metadata fails closed without deleting accepted entries.
- Imported archives cannot overwrite settings, credentials, drafts, or backup
  state through unexpected manifest properties.
- Model presets do not weaken CSP or broaden `connect-src` beyond the existing
  configurable endpoint behavior.
- Error messages never include authorization headers, API keys, image data, or
  full imported archive content.

## 16. Test plan

### 16.1 Unit and repository tests

- Schema compatibility for old and current entries.
- Draft schema, construction, storage, recovery, and clearing.
- Search normalization and combined filter predicates.
- Repeat-meal construction and source immutability.
- Automatic/manual/excluded nutrition calculation.
- Backup reminder policy and metadata updates.
- Version 1 archive import/export with both old and new optional fields.

### 16.2 Browser tests

Run the primary behaviors on mobile, narrow mobile, and desktop where layout
differs:

- Canonical brand mark and keyboard file controls.
- Draft recovery after reload, offline reload, save, and discard.
- Search, filter, clear, no-results, and stable selection behavior.
- Log again through draft and final save.
- Nutrition match picker selection, exclusion, recalculation, and keyboard focus.
- Guided model preset and mocked connection results.
- Backup reminder thresholds, dismissal, and export metadata.
- Existing manual entry, model analysis, recipe-card safety, privacy, storage,
  import/export, deletion, offline, PWA, and accessibility paths.

### 16.3 Visual review

Update the opt-in capture flow to include:

- Empty diary with the canonical header mark.
- Draft available card.
- Search with active filters and no-results state.
- Repeated-meal editor.
- Nutrition match picker on mobile and desktop.
- Reorganized model settings.
- Backup reminder and last-archive state.

Inspect all saved screenshots before accepting them. Preserve current desktop
behavior while making mobile-specific layout changes.

### 16.4 Full quality gate

Every work package must pass:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
pnpm cloudflare:preview
```

The opt-in live-model evaluation remains separate. Run it for the guided model
setup package when a compatible local endpoint is available, but do not make it
a deterministic CI gate.

## 17. Delivery sequence and commit boundaries

Use conventional commits and keep data behavior, UI behavior, and verification
reviewable. A likely sequence is:

1. `fix: align in-app branding and file controls`
2. `feat: persist and recover meal drafts`
3. `feat: add diary search and filters`
4. `feat: add log-again meal flow`
5. `feat: allow nutrition match review`
6. `feat: guide optional model setup`
7. `feat: add local backup reminders`
8. `docs: record completed next-feature rollout`

If a work package requires several commits, keep the branch deployable at the end
of the package. Do not combine an IndexedDB or archive compatibility change with
unrelated visual polish in the same commit.

## 18. Rollout and live verification

For each package:

1. Run focused unit tests during implementation.
2. Run the complete local gate.
3. Verify the production-style static preview rather than relying only on the
   hot-reload development server.
4. Capture the affected mobile and desktop states.
5. Commit and push only after the worktree contains no unrelated changes.
6. Let the configured Cloudflare Workers Build deploy `main`.
7. Verify the live root page, privacy page, manifest, icon, service worker,
   security headers, and affected user flow.
8. Confirm static assets are still served without a Worker handler and no new
   diary or model proxy route exists.
9. For storage changes, verify an existing production-created entry and a version
   1 export can still be opened after deployment.

## 19. Risks and mitigations

### Draft/photo storage growth

Risk: a draft photo duplicates a photo blob while editing an existing entry.

Mitigation: retain only one active draft, replace its stored blob atomically, show
storage errors, and remove the draft promptly after save or discard.

### Autosave races

Risk: a delayed save recreates a draft after it was saved or discarded.

Mitigation: cancel pending debounces, use a generation token, and clear metadata
only after the final entry transaction succeeds.

### Search density on mobile

Risk: controls displace the meal list.

Mitigation: keep search visible, collapse secondary filters, and review at both
mobile Playwright sizes.

### Manual nutrition choices becoming stale

Risk: changing ingredient identity leaves an inappropriate selected food.

Mitigation: preserve manual choices only for quantity changes and reset them when
name or preparation changes.

### Endpoint setup appearing to promise connectivity

Risk: presets imply a local server is running or browser access will work.

Mitigation: label presets as configuration only, require an explicit test, and
retain the existing browser/CORS/local-network explanations.

### Backup reminders overstating safety

Risk: the app cannot prove the downloaded archive was retained.

Mitigation: record Archive created, not Backed up, and keep reminder copy factual.

## 20. Explicit non-goals

This plan does not include:

- Accounts, cross-device synchronization, sharing, social feeds, or server
  backups.
- Worker APIs, AI proxies, centrally managed API keys, or server-side diary data.
- Automated calorie goals, meal scores, streaks, weight-loss coaching, or diet
  culture framing.
- Allergens, diagnoses, medical advice, or food-safety decisions.
- Micronutrient expansion.
- Barcode databases, restaurant menus, or external nutrition APIs.
- Bundled WebGPU model inference.
- Multi-photo or video analysis.
- Native iOS or Android applications.
- Analytics or telemetry to measure adoption.

These remain deferred unless the product goal and privacy architecture are
explicitly reconsidered.

## 21. Definition of complete

The next-feature cycle is complete when:

- Every work package's acceptance criteria pass.
- Existing entries and version 1 archives remain compatible.
- Draft, search, repeat logging, manual nutrition selection, model setup, and
  backup reminder behavior work offline except for explicit model requests.
- Keyboard and rendered mobile/desktop reviews show no release-blocking issues.
- The full quality gate passes from a clean checkout.
- Documentation describes the shipped behavior and any decisions that changed
  during implementation.
- Local implementation is complete when the preceding local criteria pass and
  the production-style preview is ready for review.
- Release is complete only after the changes are committed, pushed, deployed,
  and verified on `https://scranbook.labs.tau.gr` without adding a Worker
  handler or remote diary service. That release step is intentionally pending.
