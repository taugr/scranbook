# Google Drive backup status design QA

## Scope and source of truth

- Selected design direction: the compact status chip from Option 1 plus the
  detail popover from Option 3.
- Exceptional-state rule: the full-width notice is reserved for remote-change
  and conflict decisions.

The Option 1 and Option 3 concept images, implementation capture, and comparison
composites were temporary review artifacts and are intentionally not committed.
This document records the durable design decisions and verification results
without machine-specific file references.

The implementation was reviewed at the primary 390 by 844 mobile viewport and
at a 320 by 568 narrow viewport. The comparison evidence normalized the concept
and implementation captures to 390 by 844.
The reviewed state is `Reconnect Drive`, with its detail panel open. Browser
state was supplied through isolated IndexedDB metadata and no Google request was
made.

## Findings

### Typography

- The existing Scranbook display and body families are preserved rather than
  imitating rasterized lettering from the generated references.
- The status hierarchy matches the selected direction: small Google Drive
  eyebrow, display heading, emphasized state, supporting copy, then action.
- No remaining typography mismatch is severe enough to impair hierarchy or
  legibility.

### Spacing and layout

- The chip remains compact and aligned with the header while retaining a useful
  text label.
- The 320-pixel layout has no horizontal scroll and no overlap between the
  41-pixel brand mark and the 112-pixel status chip.
- The popover aligns beneath the chip, stays within the viewport, and keeps the
  primary page visible behind it.
- The final 320-pixel breakpoint hides only the wordmark text, preserving the
  brand icon and status access.

### Color, tokens, assets, and icons

- The implementation uses the product's existing paper, ink, clay, sage, border,
  radius, and shadow vocabulary.
- Existing Lucide icons provide consistent cloud, local-device, sync, warning,
  and success signals; no new image asset or icon system was introduced.
- Attention states remain distinct without making routine pending or successful
  sync states visually dominant.

### Copy and interaction

- The panel explicitly says that local changes remain safe and that the diary is
  still saved on the device.
- Only one context-appropriate action is shown in the panel.
- The chip opens and toggles the panel, outside click and Escape are implemented,
  and focused browser tests cover direct reconnect, offline pending status, and
  the decision-only conflict banner.
- The local preview produced no browser warnings or errors.

## Comparison history

1. Initial comparison found the 340-pixel panel too wide and modal relative to
   the selected Option 3 reference. It was reduced to 320 pixels.
2. DOM measurement at the 320-pixel viewport found that the original narrow
   header treatment could collide with the status chip. The narrow breakpoints
   were tightened and only the wordmark text is hidden below 340 pixels.
3. Final full-view and focused comparisons show the selected chip and popover
   hierarchy carried into the existing Scranbook visual system. No P0, P1, or P2
   visual mismatch remains.

final result: passed
