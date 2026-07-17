# Nutrition Label Scanner Implementation Plan

Status: planned
Last updated: 2026-07-18

## 1. Purpose

This document defines a dedicated Scranbook workflow for photographing a
nutrition-information panel, reviewing the transcribed values, entering how much
was consumed, and calculating the nutrients consumed from that amount.

The feature must remain consistent with Scranbook's local-first design:

- a configured vision model may transcribe a label only after an explicit user
  action;
- all arithmetic, editing, persistence, search, export, and import happen in the
  browser;
- manual label entry remains available without a model;
- scanned values are never presented as ingredient-database estimates;
- every printed number and consumption assumption is reviewable before save.

## 2. Product decision

Implement this as a distinct **Scan nutrition label** workflow for one packaged
food at a time. The first release will create a packaged-food diary entry whose
nutrition comes from the reviewed label rather than from ingredient matching.

The first release will not combine a label-derived product with an
ingredient-derived meal in one automatic calculation. Supporting several labels
or mixed provenance inside one meal would require a separate composition model
and should follow only after the single-product workflow is reliable.

The source-of-truth chain is:

1. The label image is evidence.
2. The configured model transcribes visible values; it does not calculate what
   was consumed.
3. The user reviews and corrects the label basis and every nutrient value.
4. Scranbook deterministically scales the reviewed values on-device.
5. The saved entry records label provenance, consumption input, and the derived
   consumed totals.

## 3. Intended user outcome

A person should be able to:

1. Open Add and choose **Scan nutrition label** without changing the ordinary
   meal-photo workflow.
2. Photograph or select a flat, readable nutrition panel.
3. Rotate or replace the image before scanning.
4. Explicitly approve sending the image to the configured model, or enter the
   label manually without a model.
5. Review the product name, serving description, available basis columns, and
   every nutrient transcribed from the panel.
6. Choose the correct printed basis, such as per 100 g, per 100 ml, or per
   serving.
7. Enter grams, millilitres, or servings consumed, using only conversions the
   label actually supports.
8. See calories and each available nutrient scaled immediately.
9. Correct any scanned number and see the result recalculate locally.
10. Save, reload, edit, repeat, export, and import the packaged-food entry while
    retaining clear label provenance.

## 4. Current implementation baseline

The plan is grounded in these current contracts:

- `MealEditor` has one processed photo, one meal-analysis action, editable meal
  fields, ingredient rows, and an ingredient-derived nutrition editor.
- `processImage` strips metadata by decoding to canvas and re-encoding JPEG. The
  default model profile limits the image to 1,600 px at JPEG quality 0.82.
- `analyseMeal` sends the processed photo directly from the browser to a
  configured OpenAI-compatible `chat/completions` endpoint.
- The existing model prompt deliberately does not calculate nutrition. It asks
  for meal classification, ingredients, and consumed gram estimates.
- `MealNutrition` stores common totals, ingredient-match counts, a bundled
  database version, calculation time, edit/stale flags, and notes.
- The local calculator matches ingredients against bundled USDA and UK CoFID
  records, then scales their per-100-g values.
- `MealEntry.classification` already includes `packaged_food`, but that value does
  not currently activate a dedicated label workflow.
- Entries have one `photoId`; draft recovery stores the current processed photo
  blob in IndexedDB metadata.
- The database already stores flexible entry objects in IndexedDB version 1, so
  no new object store is required.
- Archive format version 1 validates entries and photos and excludes model
  settings and credentials.

These contracts mean the new feature can reuse image preparation, provider
settings, cancellation, draft recovery, photo storage, and diary entry storage.
It should not reuse ingredient matching as label provenance.

## 5. Scope

### 5.1 Included in the first release

- A distinct label capture intent in the add-meal editor.
- One nutrition label and one product per entry.
- Model-assisted transcription through the existing configured provider.
- A fully manual label-entry fallback.
- Labels expressed per 100 g, per 100 ml, or per serving.
- Labels containing more than one printed basis column.
- Common UK/EU and US nutrient names and units.
- Energy in kcal and kJ when printed.
- Fat, saturates, carbohydrate, sugars, fibre, protein, salt, and sodium when
  printed.
- Preservation and scaling of additional nutrients such as vitamins and
  minerals when the amount and unit are visible.
- Editable values, field-level confidence, warnings, and deterministic scaling.
- Draft recovery, packaged-food detail display, Log again, export/import, and
  offline manual editing.

### 5.2 Explicit non-goals for the first release

- Barcode lookup or a remote product database.
- Automatic product identification from branding alone.
- Combining multiple packaged products into one derived meal total.
- Mixing label-derived and ingredient-database-derived nutrition automatically.
- Density-based conversion between grams and millilitres.
- Inferring an unprinted serving weight, number of portions, or prepared weight.
- Daily-goal coaching, traffic-light scoring, health claims, or medical advice.
- Automatically treating `% daily value` as a nutrient amount.
- Background OCR, automatic photo sending, or automatic retry.
- Multi-photo, video, or front-and-back package capture.
- A new Worker API, AI proxy, nutrition API, account, or synchronization service.

## 6. Interaction design

### 6.1 Entry point

Keep ordinary meal logging as the default when the central Add action is opened.
Add a compact intent control near the photo area:

- **Meal photo** — the existing capture and meal-analysis behavior.
- **Nutrition label** — label-specific guidance, scan action, review fields, and
  scaling.

Do not insert a mandatory chooser before every meal. Selecting Nutrition label
changes the editor into the dedicated workflow and sets the draft
classification to `packaged_food`.

If a draft already contains ingredients or ingredient-derived nutrition, changing
to label mode must show an in-app confirmation explaining that label nutrition
will replace the current calculation. It must not silently merge or discard
accepted work.

### 6.2 Capture stage

Label mode should show concise capture guidance:

- fill the frame with the nutrition panel;
- keep the panel flat and upright;
- avoid glare and blur;
- include column headings and serving-size text.

Reuse Choose photo, camera capture, Replace, Rotate, Remove, and keyboard-accessible
file controls. Use a label-specific image-processing profile with a maximum long
edge of approximately 2,400 px and JPEG quality around 0.9 so small printed text
survives processing. Continue removing source metadata.

Manual crop or perspective correction is not required for the first release.
Add it later only if representative-label evaluation shows that resolution and
capture guidance are insufficient.

### 6.3 Scan action and privacy

After an image is ready, show:

- **Scan label with configured model**;
- **Enter label manually**;
- the configured model and endpoint;
- the existing explicit acknowledgement that the image goes directly to that
  endpoint;
- the current local/remote endpoint privacy cue;
- Cancel while a request is in progress.

Scanning never begins on file selection. A retry is always explicit. A failed,
cancelled, or malformed response must preserve the photo and any manual edits.

### 6.4 Review printed values

After a successful transcription, move focus to a heading such as **Check the
label values** and announce that every value must be reviewed.

The review surface contains:

- product name, optional;
- serving description exactly as printed;
- detected basis columns;
- a basis selector when several columns were printed;
- nutrient name, numeric amount, qualifier, and unit;
- field confidence and specific warnings;
- Add nutrient and Remove actions;
- a visible **Scanned by model** or **Entered manually** provenance label.

On mobile, show one basis column at a time instead of a horizontally scrolling
nutrition table. Switching basis changes which printed values are used but does
not delete the other transcribed columns.

Common nutrient labels should map to canonical fields while preserving the
original printed label. Unknown but valid rows remain editable additional
nutrients rather than being discarded.

### 6.5 Enter consumption

The consumption control appears only after a usable basis is selected.

- Per 100 g supports grams.
- Per 100 ml supports millilitres.
- Per serving supports servings.
- A per-serving column may additionally support grams or millilitres only when
  the label explicitly supplies a structured serving size in that unit.

Allow positive decimal values. Show a human-readable equation, for example:

> Label: 240 kcal per 100 g · You ate: 35 g · Consumed: 84 kcal

Do not imply that grams and millilitres are interchangeable. When the selected
basis cannot scale the chosen consumption unit, stop calculation and explain
which printed value is missing.

### 6.6 Consumed totals

Show a separate **What you consumed** summary. It should include every available
scaled nutrient, not only the six current macro fields.

Common values remain prominent. Additional vitamins and minerals appear in an
expandable section. Missing printed nutrients stay unknown (`null`), never zero.
Qualifiers such as `<0.5 g` propagate to the scaled result.

Use practical display precision:

- energy: nearest whole kcal and kJ by default;
- gram nutrients: one decimal unless the source requires more precision;
- milligram and microgram nutrients: preserve meaningful source precision;
- no rounding inside the calculation before the final display step.

### 6.7 Save and diary detail

Saving creates a normal `MealEntry` with:

- `classification: 'packaged_food'`;
- the product name as title when available;
- the chosen consumption as the portion summary;
- no fabricated ingredient rows;
- label-derived nutrition and provenance;
- the processed label photo;
- label-analysis metadata when a model was used.

The detail view must say **From reviewed nutrition label** rather than
**Estimated nutrition** or **Matched to bundled food records**. It should show
the selected printed basis, consumed amount, common totals, additional nutrients,
and whether the values were edited after scanning.

Editing the consumed amount recalculates immediately. Editing printed label
values also recalculates and marks the source as edited. Ingredient-based
recalculation must not overwrite label-derived nutrition.

### 6.8 Log again

Log again should copy the reviewed label facts and product identity, clear the
old photo and model-analysis metadata, set new timestamps, and recalculate from
the copied consumption amount. The repeat draft remains editable and recoverable.

The copied entry should say that its label facts came from a previous reviewed
entry. The user can adjust the amount before saving. The source entry remains
unchanged.

## 7. Data model

### 7.1 Nutrient rows

Add schemas equivalent to:

```ts
type LabelNutrientKey =
  | 'energy_kcal'
  | 'energy_kj'
  | 'fat'
  | 'saturates'
  | 'carbohydrate'
  | 'sugars'
  | 'fibre'
  | 'protein'
  | 'salt'
  | 'sodium'
  | 'other';

interface LabelNutrientValue {
  id: string;
  key: LabelNutrientKey;
  printedName: string;
  amount: number | null;
  unit: 'kcal' | 'kJ' | 'g' | 'mg' | 'µg' | 'IU' | string;
  qualifier: 'exact' | 'less_than' | 'approximately';
  dailyValuePercent: number | null;
  confidence: 'low' | 'medium' | 'high';
}
```

The amount is the printed nutrient amount, not the consumed result. Preserve an
unknown unit string for unusual but visible labels, but calculation should only
scale values with valid numeric amounts and units.

### 7.2 Printed basis columns

```ts
interface NutritionLabelColumn {
  id: string;
  basis: 'per_100g' | 'per_100ml' | 'per_serving';
  basisAmount: number;
  basisUnit: 'g' | 'ml' | 'serving';
  printedHeading: string;
  servingDescription: string | null;
  servingSize: { amount: number; unit: 'g' | 'ml' } | null;
  nutrients: LabelNutrientValue[];
}
```

Store each printed column independently. Do not merge per-100-g and per-serving
values, because packaging rounding can make them differ slightly.

### 7.3 Consumption and provenance

```ts
interface NutritionLabelSource {
  kind: 'nutrition_label';
  version: 1;
  productName: string;
  columns: NutritionLabelColumn[];
  selectedColumnId: string;
  consumption: {
    amount: number;
    unit: 'g' | 'ml' | 'serving';
  };
  method: 'model' | 'manual';
  scannedAt: string | null;
  edited: boolean;
  warnings: string[];
}
```

The selected label column and consumption input are persisted so totals can be
recomputed rather than treated as opaque numbers.

### 7.4 Meal nutrition compatibility

Extend `MealNutrition` with explicit provenance:

```ts
type NutritionSource =
  | {
      kind: 'ingredient_database';
      databaseVersion: string;
      matchedIngredientCount: number;
      ingredientCount: number;
    }
  | NutritionLabelSource;
```

Recommended compatibility changes:

- accept the current top-level `databaseVersion` as a legacy input and normalize
  it into `{ kind: 'ingredient_database', databaseVersion }` through an explicit
  schema migration/preprocess step;
- make `source` required in the normalized in-memory shape so new code cannot
  create nutrition with ambiguous provenance;
- move the current database version and ingredient-match counts into the
  ingredient-database source during normalization;
- retain common consumed totals in `MealNutrition.values` for existing summary
  components;
- add nullable common fields for `energyKj`, `saturatesG`, `sugarsG`, and
  `sodiumMg`;
- add a defaulted `additionalValues` array to `MealNutrition` for scaled nutrients
  outside the common summary fields;
- make source-specific UI responsible for its provenance wording;
- never populate ingredient-match counts or database wording for a label source.

The printed columns and consumption inside `source` remain authoritative. Common
totals and `additionalValues` are derived caches regenerated by the local scaler.
Keep the old `databaseVersion` field only at the version 1 decoding boundary; do
not populate it for label nutrition.

Do not use a fake database version such as `nutrition-label-v1`. Provenance must
be structural and unambiguous.

### 7.5 Analysis metadata

Add an analysis kind to `AnalysisMetadata`:

```ts
kind: 'meal_photo' | 'nutrition_label';
```

Default missing values to `meal_photo` for existing entries. Label analysis uses
a separate prompt version and records the configured model, endpoint origin,
analysis time, and overall transcription confidence.

### 7.6 Database and drafts

Keep IndexedDB at version 1 because the existing stores can hold the new entry
shape. Update schemas and repository tests rather than creating a new store.

Draft autosave naturally persists the label record because it lives inside the
entry. Flush immediately after scan completion, basis selection, consumption
changes, and manual label corrections. The draft's processed photo continues to
be stored as its Blob.

## 8. Deterministic scaling rules

Create `src/lib/nutrition-label.ts` containing pure, model-independent helpers.

For a compatible basis and consumption:

```text
factor = consumed amount / printed basis amount
consumed nutrient = printed nutrient amount × factor
```

Examples:

- 35 g consumed from a per-100-g column: factor `0.35`.
- 250 ml consumed from a per-100-ml column: factor `2.5`.
- 1.5 servings consumed from a per-serving column: factor `1.5`.
- 45 g consumed from a per-serving column whose serving size is explicitly
  30 g: factor `45 / 30`.

Rules:

- calculate using unrounded numbers;
- round only for display;
- propagate `less_than` and `approximately` qualifiers;
- keep missing values null;
- reject negative values, zero basis amounts, and non-finite numbers;
- do not convert grams to millilitres;
- do not derive a serving size from package weight or serving count unless both
  are explicitly represented and reviewed;
- preserve printed sodium and salt separately;
- do not silently convert sodium to salt in the first release;
- preserve `% daily value` as contextual label data, never as the nutrient
  amount used for scaling.

Add non-blocking plausibility warnings for likely transcription mistakes, such
as a gram nutrient exceeding a 100-g basis or kcal and kJ values differing by an
implausible ratio. Warnings prompt review but do not overwrite the user's value.

## 9. Model transcription contract

Add a separate provider function, prompt, response schema, and parser rather than
expanding `analyseMeal`:

- `analyseNutritionLabel(photo, settings, signal)`;
- `nutrition-label-analysis-v1` prompt version;
- `nutritionLabelAnalysisSchema`;
- a JSON schema compatible with the existing `json_schema`, `json_object`, and
  tolerant text response modes.

The system prompt must instruct the model to:

- transcribe only visible nutrition information;
- identify every printed basis column;
- preserve nutrient names, numeric values, units, qualifiers, and daily-value
  percentages;
- distinguish energy kcal from kJ;
- distinguish salt from sodium;
- capture serving text but not infer an unprinted serving size;
- use null and low confidence when a cell is unreadable;
- report ambiguity and cropped headings in warnings;
- never calculate consumed totals;
- never infer ingredients, health effects, allergens, or suitability;
- return JSON only.

The parser validates finite nonnegative values and supplies stable row and column
IDs. It must reject a response with no usable column or no nutrient rows while
keeping the user's photo and draft intact.

## 10. Component and module structure

Avoid expanding `ScranbookApp` with all label-specific rendering. Expected
additions are:

- `src/components/nutrition-label-capture.tsx` — capture guidance and actions;
- `src/components/nutrition-label-review.tsx` — product, basis, and nutrient
  editing;
- `src/components/consumption-scaler.tsx` — compatible units, equation, and
  live result;
- `src/components/label-nutrition-summary.tsx` — source-specific detail view;
- `src/lib/nutrition-label.ts` — pure scaling, mapping, and warnings;
- label schemas and types in `src/lib/schema.ts`;
- label prompt and provider request in `src/lib/provider.ts`, or a focused
  `src/lib/nutrition-label-provider.ts` if provider.ts becomes difficult to
  navigate.

`ScranbookApp` remains responsible for screen orchestration, draft lifecycle,
provider settings, notices, and final save.

## 11. Persistence, archive, and compatibility

### 11.1 Existing entries

- Existing IndexedDB entries must parse with ingredient-database provenance.
- Existing nutrition summaries must render unchanged.
- Existing drafts must remain recoverable.
- Existing version 1 archives must import without data loss.

### 11.2 Archive format

Use archive manifest version 2 for exports after this feature ships. Label
provenance is a structural addition, and an older Scranbook build must not import
a new archive while silently dropping label rows or mislabelling their source.

The new importer should accept both versions:

- version 1: migrate entries to explicit ingredient-database provenance;
- version 2: validate full nutrition-source and label structures.

Continue exporting the processed label photo and excluding provider settings,
credentials, active drafts, and backup-reminder metadata.

Archive tests must verify v1 migration, v2 round-trip, invalid label structures,
missing photos, unsafe paths, and maximum size enforcement.

## 12. Offline, privacy, and security

- Manual label entry, editing, scaling, saving, browsing, search, repeat logging,
  export, and import work offline.
- Model transcription requires the configured endpoint and remains an explicit
  action.
- No label data is sent to a nutrition service or Scranbook server.
- No model call is made merely by selecting label mode or choosing a photo.
- Reuse endpoint location guidance without claiming that hostname classification
  is a security guarantee.
- Keep API keys and extra headers out of entries, drafts, archives, notices, and
  error messages.
- Do not render label or model text as HTML.
- Validate and length-limit product names, nutrient labels, units, headings, and
  warnings before persistence.
- Cancelled and failed scans do not retry automatically.
- Processed images continue to remove EXIF and other source metadata.

## 13. Accessibility and responsive behavior

- The Meal photo / Nutrition label intent control is keyboard operable and uses
  `aria-pressed` or radio semantics.
- File inputs keep visible focus treatment and meaningful accessible names.
- Scanning status and results are announced through the existing busy/status
  patterns.
- Focus moves to the review heading after a successful scan and returns to the
  scan action after a recoverable error.
- Basis selection, nutrient editing, adding/removing rows, consumption input,
  and unit selection have persistent labels.
- Low-confidence fields use text and icons, not color alone.
- The consumed-total region uses `aria-live="polite"` without announcing every
  keystroke before a valid calculation exists.
- Mobile shows one basis column at a time; desktop may show a wider comparison
  while keeping the same reading order.
- Target sizes, focus rings, safe-area spacing, reduced motion, and sticky mobile
  navigation follow the current application conventions.

## 14. Error and edge-case behavior

Provide specific, actionable handling for:

- no configured/reachable model — keep manual entry available;
- unsupported vision model — preserve image and fields;
- glare, blur, cropped headings, or unreadable cells — retain null values and
  warnings rather than guessing;
- a label with only per-serving values but no serving weight — allow servings,
  not grams;
- labels with both prepared and unprepared columns — keep both and require an
  explicit basis choice;
- labels with kcal but no kJ, or vice versa — do not fabricate the missing row;
- decimal comma input — normalize locale-aware manual input before validation;
- `<` values — preserve and scale the qualifier;
- unknown nutrients or units — preserve for review, but only calculate when the
  amount is numeric;
- changing label mode back to meal mode — confirm before replacing label source;
- replacing the label photo after review — mark the transcription stale and
  require rescan or explicit confirmation that the existing values still apply;
- changing the selected basis or consumption — recalculate immediately;
- deleting a label entry — remove its photo through the existing transaction;
- failed draft or final storage — retain editable state and show the current
  storage warning pattern.

## 15. Implementation sequence

### Package 0: schema and pure calculator

- Add label schemas, common optional nutrient fields, source provenance, and
  analysis kind.
- Implement canonical nutrient mapping, compatible-unit checks, scaling,
  qualifier propagation, rounding helpers, and plausibility warnings.
- Add legacy-entry parsing and archive migration fixtures.

This package is complete when pure unit tests cover every supported basis and no
UI or model is required to prove the arithmetic.

### Package 1: provider transcription

- Add the label-specific prompt, JSON schema, parser, and request function.
- Reuse timeout, cancellation, headers, response modes, and safe error
  classification.
- Add mocked provider tests and representative JSON fixtures.
- Add an opt-in live-label evaluation command or extend the live evaluator with
  an explicit label mode.

This package is complete when the provider returns validated printed facts and
never calculates consumed totals.

### Package 2: capture and review workflow

- Add the editor intent control without adding a mandatory step to meal logging.
- Add label-specific image processing and capture guidance.
- Implement scan/manual actions, privacy acknowledgement, busy/cancel behavior,
  basis review, field editing, and confidence warnings.
- Persist every accepted change through the active draft.

This package is complete when a user can scan or manually enter a label, reload,
continue the draft, and retain the photo and reviewed fields.

### Package 3: consumption and diary integration

- Add compatible consumption controls and live local scaling.
- Add label-specific nutrition summary and edit behavior.
- Integrate save, detail, search, delete, and Log again.
- Ensure ingredient recalculation cannot overwrite label provenance.

This package is complete when a reviewed label saves as a separate packaged-food
entry and survives reload and offline use.

### Package 4: archive, documentation, and release verification

- Add archive version 2 export and v1/v2 import.
- Update the product specification, README feature list, privacy note, and archive
  documentation.
- Complete browser, accessibility, offline, and visual checks.
- Run opt-in model-quality evaluation on permitted label fixtures.

## 16. Test plan

### 16.1 Unit tests

- Parse legacy entries with ingredient-database provenance defaults.
- Parse valid label columns and reject invalid/empty structures.
- Map common UK/EU and US nutrient names without losing printed names.
- Scale per 100 g, per 100 ml, per serving, and serving-size conversions.
- Reject incompatible grams/millilitres/serving conversions.
- Preserve nulls, qualifiers, units, and additional nutrients.
- Use unrounded intermediate values and stable display rounding.
- Generate non-destructive plausibility warnings.
- Recalculate after printed values, basis, or consumption changes.
- Repeat a label entry without mutating its source or copying its photo/analysis.

### 16.2 Provider tests

- Send the processed image only after explicit scan.
- Include the label-specific prompt and configured model.
- Parse strict JSON, JSON object, fenced JSON, and tolerant wrapped JSON.
- Preserve multiple columns and low-confidence/null cells.
- Reject missing columns, negative values, non-finite values, and malformed units.
- Distinguish timeout, cancellation, authentication, CORS/unreachable, missing
  model, unsupported vision, and invalid response.
- Never include authorization headers or image bytes in error text.

### 16.3 Database, draft, and archive tests

- Save/load a label entry and processed label photo.
- Autosave/recover a partially reviewed label draft with a Blob.
- Keep failed scans and failed final saves recoverable.
- Clear label drafts through Clear diary and successful archive replacement.
- Import a released version 1 archive and apply provenance defaults.
- Round-trip a version 2 label archive, qualifiers, additional nutrients, and
  photo.
- Reject unsafe paths, missing photos, invalid selected-column references, and
  incompatible consumption units.
- Confirm credentials and active drafts remain absent from exports.

### 16.4 Browser tests

Run the primary flow on mobile, narrow mobile, and desktop:

- Switch from Meal photo to Nutrition label without disturbing ordinary Add.
- Capture/upload a label using a keyboard-reachable file input.
- Mock a successful multi-column label transcription.
- Review and correct a low-confidence cell.
- Switch basis columns and verify consumed totals change deterministically.
- Enter grams, millilitres, and servings where compatible.
- Verify incompatible unit choices are unavailable or clearly rejected.
- Save, reload, edit, delete, and Log again.
- Recover an unfinished label draft and photo after reload.
- Confirm a failed or cancelled scan preserves the draft.
- Enter and scale a label manually while offline without a network request.
- Export and re-import a label entry.
- Confirm the detail view says label-derived rather than database-estimated.
- Confirm the ordinary meal-analysis and recipe-card safety flows remain
  unchanged.
- Run Axe with the label review and consumption sections visible.

### 16.5 Visual review

Capture and inspect at 390×844, the narrow mobile project, and 1440×1024:

- label capture guidance;
- multi-column basis selector;
- low-confidence review fields;
- manual-entry state;
- consumption equation and consumed totals;
- additional nutrients expanded;
- saved packaged-food detail;
- error state with photo and edits retained.

### 16.6 Opt-in model-quality evaluation

Use permitted, non-sensitive fixtures representing:

- UK/EU per-100-g and per-serving panels;
- US serving and `% daily value` panels;
- per-100-ml drinks;
- labels with kcal and kJ;
- salt-only and sodium-only labels;
- several columns, decimal values, `<` qualifiers, glare, skew, and partial
  crops.

Record basis-column accuracy, nutrient-name accuracy, numeric-cell accuracy,
unit accuracy, and unsafe inferred-cell count. Do not make live-model quality a
default CI requirement, and do not commit private phone photos or credentials.

## 17. Acceptance criteria

The feature is locally complete when:

- label scanning is visibly distinct from meal-photo estimation;
- a model transcribes printed facts but never calculates consumed nutrition;
- the user can review and correct every printed basis and nutrient value;
- local deterministic scaling covers grams, millilitres, and servings without
  unsupported conversions;
- every available nutrient is preserved, including additional rows;
- common totals and label provenance render clearly in the saved entry;
- manual label entry and all post-scan behavior work offline;
- ordinary meal, recipe-card, and ingredient-database flows do not regress;
- existing entries and version 1 archives remain readable;
- version 2 archives round-trip label provenance and photos;
- draft recovery, accessibility, security, privacy, and storage checks pass;
- the full unit, type, lint, format, production-build, and browser gates pass;
- mobile and desktop screenshots show no clipped tables, obscured actions, or
  misleading source labels.

Release is complete only after a user review, commit/push, configured deployment,
and live verification. Those release actions are outside this planning task.

## 18. Risks and mitigations

### Small text lost during image processing

Use a label-specific resolution/quality profile, capture guidance, rotation, and
representative fixtures. Add crop/perspective tooling only if measured accuracy
requires it.

### Model invents or shifts a column

Use a transcription-only prompt, field confidence, nulls, column headings,
plausibility warnings, and mandatory review. The model never performs the final
arithmetic.

### Serving ambiguity creates a large scaling error

Keep printed columns separate, require a selected basis, allow only compatible
units, and show the scaling equation before save.

### Label values are confused with database estimates

Store structural provenance, use source-specific headings and disclaimers, and
prevent ingredient recalculation from silently replacing label nutrition.

### New archives are misread by an older app

Export archive version 2 and keep the new importer backward-compatible with
version 1 rather than overloading the old manifest contract.

### The first release grows into meal composition

Constrain it to one product and one label per entry. Plan mixed-source meals as a
separate feature after the single-product data model and interaction have been
validated.
