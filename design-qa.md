# Meal follow-up design QA

## Findings

- No actionable P0, P1, or P2 differences remain.
- [P3] The implementation keeps Scranbook's existing diary search and filter controls above the mobile timeline. The visual target omitted those established controls; retaining them preserves the current diary workflow without weakening the timeline hierarchy.
- [P3] The comparison uses a cautious eight-meal evidence set rather than the illustrative source. The implementation intentionally reports its real `3 of 4` and `0 of 4` counts rather than copying decorative values.

## Comparison target

- Timeline visual: `/Users/tomauger/.codex/generated_images/01a01dea-699f-7f11-9cf1-348b89b11220/exec-aeed91ca-c419-41d6-9fd9-e196a9af0253.png`
- Check-in visual: `/Users/tomauger/.codex/generated_images/01a01dea-699f-7f11-9cf1-348b89b11220/exec-8d637d50-78d4-45b5-b30f-c0dc9f5dae30.png`
- Pattern visual: `/Users/tomauger/.codex/generated_images/01a01dea-699f-7f11-9cf1-348b89b11220/exec-64f03c77-20ff-4979-ba2a-a6cb354a9ce4.png`
- Browser-rendered preview: `http://localhost:3000/`
- Implementation screenshots:
  - `output/visual-review/mobile-meal-timeline.png`
  - `output/visual-review/mobile-meal-check-in.png`
  - `output/visual-review/mobile-meal-pattern.png`
- Same-input comparison: `output/visual-review/meal-follow-up-design-comparison.png`

## Viewport and state

- Source images are 853 x 1844 pixels, representing an approximately 426 x 922 mobile viewport at 2x density.
- Implementation captures use a 426 x 922 CSS viewport and were normalized to the same 426 x 922 comparison size.
- Timeline state: a saved lunch with ingredient context and an unanswered follow-up.
- Check-in state: `A little off` and `Bloating`, with severity unset and onset at `Not sure` until the person chooses them.
- Pattern state: onion appears in four checked meals, bloating follows three, and the four checked comparison meals report no bloating.
- Every source/implementation pair was composited side by side before judging fidelity.

## Fidelity evidence

- Typography and hierarchy preserve Scranbook's Fraunces/Nunito notebook system, with display headings, compact factual labels, and clear primary actions.
- The timeline retains the approved chronological thread, quiet meal context, warm follow-up card, fast `Felt fine` path, and non-causal caution.
- The check-in keeps the approved single-screen progression and fits feeling, symptoms, severity, onset, note, save, privacy cue, and bottom navigation in the reference viewport.
- The pattern view shows the underlying with/without counts, proportional comparison bars, onset, evidence size, diagnostic caution, review action, and method disclosure.
- Existing paper, ink, tomato, sage, butter, border, and shadow tokens are reused. Lucide supplies every new icon; no placeholder artwork, emoji, CSS drawing, or handcrafted SVG was added.
- Mobile tap targets remain practical, content does not overflow horizontally, and the check-in wordmark remains stable when the flow starts from a scrolled diary.

## Interaction, persistence, and safety evidence

- Browser-tested manual meal save, neutral detail defaults, an uncertain symptom, editing without duplication, deletion, and persistence after reload.
- Browser-tested stronger evidence gating and opening the early-signal view on standard mobile, narrow mobile, and desktop.
- Unchecked meals are excluded from the symptom-free comparison; the UI exposes real numerator and denominator values and labels the result as an association rather than a cause.
- Check-ins use the existing local entry transaction and diary revision path, round-trip through version 3 portable archives, and remain included in opt-in Drive backup.
- Privacy copy confirms that symptom content is excluded from analytics and that pattern calculation is on-device.
- The running in-app preview reported no console warnings or errors, and its document width matched its 1280-pixel viewport.

## Verification

- Unit/integration: 15 files, 105 tests passed.
- Full serial browser regression: 68 passed, 29 intentional skips.
- Final feature and serious-accessibility run: 9 passed across mobile, narrow mobile, and desktop.
- Opt-in visual capture: 1 passed.
- TypeScript, lint, formatting, production build, and `git diff --check` passed.

## Comparison history

1. Pass 1 found P2 mobile-density issues: the check-in did not fit the reference viewport and the pattern evidence was pushed below the fold. Mobile type, spacing, controls, and evidence rhythm were compacted while keeping tap targets usable.
2. Pass 1 also found a P2 state issue: the check-in could inherit the diary's scroll position and omit the wordmark. The mobile check-in header was made stable and its workspace offset explicitly reserved.
3. Pass 2 used a fresh production build, captured all three states at the exact reference viewport, and confirmed the full check-in plus the pattern evidence and review action fit the approved hierarchy.
4. The final side-by-side comparison found no remaining P0, P1, or P2 differences.

## Open questions

- None blocking manual review.

final result: passed
