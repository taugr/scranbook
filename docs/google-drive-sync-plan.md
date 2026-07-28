# Google Drive Backup Implementation Plan

Status: implemented locally with mocks; live Google verification and release are pending
Last updated: 2026-07-28

Implementation note: the portable sharing path, IndexedDB revision tracking,
provider boundary, Google Identity Services adapter, Drive REST adapter,
incremental backup, conflict protection, restore flow, Settings interface,
privacy copy, and automated tests are present in the current worktree. Per the
implementation instruction, automated coverage uses a stateful fake Drive and a
mocked Google authorization surface only. Manual live testing remains a
separate, user-authorized activity. Package 0's live API decision gate, OAuth
publishing, deployment, commit, and push remain separately pending; production builds without
`NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` show the feature as unavailable.

## 1. Purpose

This document defines an optional Google Drive connection that keeps accepted
Scranbook diary data backed up while the application is open, supports recovery
on another device, and preserves Scranbook's local-first operation.

The feature must not turn a successful local save into a network-dependent
operation. IndexedDB remains the working source of truth on the current device;
Google Drive receives an asynchronous copy after the local transaction has
completed.

## 2. Product decision

Implement **app-open periodic backup** directly from the browser using Google
Identity Services and the Google Drive REST API. Internally this uses an
incremental synchronization engine, but the first release must be described to
users as backup and recovery rather than general-purpose or real-time sync. Do
not add a Scranbook backend or store Google refresh tokens.

The first release will provide:

- an explicit **Connect Google Drive** action;
- automatic backup while Scranbook is open, online, and holds a valid
  access token;
- a durable local pending state when a change has not reached Drive;
- a lightweight **Reconnect to continue backup** action after the browser token
  expires or the app is reopened;
- manual **Back up now** and **Restore from Drive** actions;
- clear separation between local-save success and Drive-backup status.

The first release will not promise:

- unattended synchronization while the PWA is closed;
- silent token renewal after a browser access token expires;
- simultaneous editing on several devices;
- server-side accounts, token storage, background jobs, or diary APIs;
- synchronization of model credentials, custom authorization headers, or an
  unfinished draft.

### 2.1 Position among storage options

Google Drive is the first optional automatic backup provider, not the only way
to recover or move Scranbook data. Before implementing the Drive integration,
add a provider-neutral **Share backup** action for the existing validated
`.scranbook.zip` archive. Use the Web Share API when the browser can share the
file and retain direct download as the universal fallback. This allows a person
to save an archive to any destination exposed by their browser or operating
system without granting Scranbook provider access.

Do not implement Dropbox, OneDrive, WebDAV, or a Scranbook-hosted backend in this
plan. Keep the backup orchestration boundary provider-neutral so that another
remote provider can be evaluated later without rewriting local revision,
scheduling, status, or restore rules.

## 3. Intended user outcome

A person should be able to:

1. Continue using Scranbook entirely locally without connecting Google Drive.
2. Connect a Google account from Settings and grant access only to files
   Scranbook creates or the user explicitly shares with it.
3. Save, edit, or delete a diary entry without waiting for the network.
4. See whether the Drive backup is up to date, saving, offline, pending, or needs
   reconnection.
5. Leave the app open and have accepted diary changes coalesced and backed up
   periodically.
6. Reopen the app, reconnect with one deliberate action when required, and have
   pending changes continue automatically.
7. Connect the same Google account on a new device, inspect the remote backup's
   date and entry count, and deliberately restore it.
8. Disconnect Drive without deleting either the local diary or the files already
   stored in Drive.

## 4. Delivery principles

All packages must preserve these contracts:

- A local diary mutation commits before any Drive request begins.
- Offline diary entry, editing, search, nutrition calculation, export, import,
  and deletion continue to work.
- Drive synchronization is opt-in and disabled by default.
- The OAuth access token is held in memory only. It is never written to
  IndexedDB, local storage, logs, URLs, notices, archives, or error reports.
- A Google OAuth client ID may be included in the static build because it is a
  public identifier; a client secret must never be included.
- Use the non-sensitive `drive.file` scope. Do not request access to the user's
  complete Drive.
- Accepted diary entries and their processed photos may be synchronized.
  Provider credentials and active drafts remain device-local.
- Drive failures never roll back a successful local save.
- Synchronization errors retain enough local state to retry without resending a
  photo that is already confirmed on Drive.
- Existing `.scranbook.zip` export/import remains available and compatible.
- The interface must not label pending data as backed up.

### 4.1 Provider boundary

Keep local backup orchestration independent of Google-specific authentication
and file APIs. Define a small internal provider contract covering:

- connection and authorization readiness;
- discovery and inspection of remote state;
- photo upload and manifest commit;
- complete dataset download for restore;
- provider-specific resource links and safe error classification;
- disconnection without remote deletion.

The diary revision counter, scheduler, pending-state derivation, restore staging,
and user-facing backup statuses must depend on this contract rather than calling
Google APIs directly. The initial Google Drive adapter is the only remote
provider required by this plan. OAuth token acquisition remains adapter-specific
and must not be generalized into a shared credential store.

## 5. Current implementation baseline

The plan is grounded in these current code contracts:

- `src/lib/db.ts` stores entries, photos, settings, and metadata in IndexedDB
  version 1.
- `saveEntry` commits an entry and optional photo in one transaction.
- `deleteEntry`, `clearDiary`, and `replaceDiary` are the other accepted-diary
  mutation points.
- Active drafts live under the `active-draft` metadata key and are deliberately
  separate from accepted entries.
- `src/lib/archive.ts` already produces a validated version 2 ZIP containing
  accepted entries and processed photos while excluding settings and
  credentials.
- `src/lib/backup.ts` records local archive history and drives the current backup
  reminder.
- `ScranbookApp` already tracks online/offline state and refreshes the in-memory
  diary after persistence changes.
- The service worker ignores cross-origin requests, so Drive requests will not
  be cached by the application shell.
- The current Content Security Policy allows network connections but does not
  allow Google's identity script or frames, and the current opener policy may
  prevent OAuth popup communication.

## 6. Google Cloud and authorization setup

### 6.1 Cloud configuration

Create or select a Google Cloud project and:

1. Enable the Google Drive API.
2. Configure OAuth branding, support contact, homepage, and privacy-policy URLs.
3. Declare only `https://www.googleapis.com/auth/drive.file` for the initial
   release.
4. Create Web OAuth client IDs for local development and production.
5. Register `http://localhost:<port>` development origins and the production
   `https://scranbook.labs.tau.gr` origin.
6. Complete the basic OAuth verification or publishing steps required for a
   public application using this non-sensitive scope.

Expose the selected client ID as a build-time public configuration value such as
`NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID`. If it is absent, the deployed application
must continue working and show the Drive feature as unavailable rather than
throwing during startup.

### 6.2 Browser authorization

Add a small Google Identity Services adapter which:

- loads `https://accounts.google.com/gsi/client` only when the Drive connection
  surface is needed;
- initializes an OAuth token client with the public client ID and `drive.file`
  scope;
- requests a token only from a user gesture;
- verifies that the requested scope was granted;
- stores the access token and its calculated expiry in module or React memory;
- clears the token on disconnect, authorization failure, or expiry;
- distinguishes a persistent Google grant from the current page's short-lived
  access token.

Do not implement the authorization-code flow in the static app. Google's code
model expects a backend to exchange the code and securely retain refresh tokens.

### 6.3 Security headers

Update `public/_headers` narrowly according to current Google Identity Services
guidance:

- allow the Google Identity Services client in `script-src`;
- allow the required Google identity parent URL in `frame-src` and
  `connect-src`;
- adjust `Cross-Origin-Opener-Policy` only as needed for OAuth popup
  communication;
- retain the existing restrictions for objects, framing of Scranbook itself,
  media, fonts, workers, and form submission.

Verify the final header behavior against the production-style Cloudflare preview,
not only the Next.js development server.

## 7. Remote storage design

### 7.1 User-visible folder

Create one visible `Scranbook` folder in the user's Drive. Mark app-created
resources with private Drive `appProperties` so another Scranbook installation
can rediscover them without requesting broad Drive access.

Use roles such as:

- `scranbookRole=root` for the root folder;
- `scranbookRole=manifest` for the current manifest;
- `scranbookRole=photo` and `scranbookPhotoId=<uuid>` for processed photos;
- `scranbookRole=archive` for any later snapshot archives.

Do not use `appDataFolder` initially. Its contents are hidden from the Drive UI,
whereas the product goal is a user-owned copy that is visible and recoverable.
Google Picker is not required when Scranbook creates and manages its own folder;
it can be considered later if users need to choose an existing folder.

### 7.2 Folder layout

The logical layout should be:

```text
Scranbook/
├── scranbook.json
└── photos/
    ├── <photo-id>.jpg
    └── <photo-id>.jpg
```

An optional `backups/` folder with dated `.scranbook.zip` snapshots can be added
after continuous synchronization is proven. It is not required for the first
incremental-sync release.

### 7.3 Remote manifest

Define and validate a Drive-specific schema rather than treating the existing ZIP
manifest as an unvalidated network response. A representative contract is:

```ts
interface DriveManifestV1 {
  format: 'scranbook-drive';
  version: 1;
  commitId: string;
  updatedAt: string;
  writerDeviceId: string;
  generation: number;
  entries: MealEntry[];
  photos: Array<{
    id: string;
    driveFileId: string;
    mimeType: string;
    width: number;
    height: number;
    byteSize: number;
    createdAt: string;
  }>;
}
```

The remote manifest contains accepted entries only. It must never contain:

- model settings or credentials;
- Google tokens;
- custom provider headers;
- the active draft;
- transient UI state;
- local backup-reminder dismissals.

### 7.4 Upload ordering

For each synchronization run:

1. Read and validate the current local entries and photo metadata.
2. Fetch the remote manifest metadata and confirm it has not unexpectedly
   changed.
3. Upload new or changed photos first.
4. Record the confirmed Drive photo file IDs in the next manifest.
5. Update `scranbook.json` only after every referenced photo is confirmed.
6. Read the manifest back and confirm both its returned version and unique
   `commitId` still match this run.
7. Persist the verified remote manifest version and local generation.
8. Garbage-collect remote photos no longer referenced only after the new manifest
   is safely committed.

This order ensures the current manifest never intentionally points at a missing
photo. Garbage collection should initially be conservative: an interrupted or
ambiguous deletion remains as an unreferenced Drive file rather than risking data
loss.

Use resumable uploads for large media and archive blobs. A small JSON manifest can
use a simple or multipart update. Validate returned file IDs and metadata before
recording success.

## 8. Local revision and sync state

### 8.1 Provider-neutral diary revision

Add a provider-neutral metadata record updated atomically with every accepted
diary mutation:

```ts
interface DiaryRevisionState {
  version: 1;
  generation: number;
  changedAt: string;
}
```

Extend the IndexedDB transactions used by `saveEntry`, `deleteEntry`,
`clearDiary`, and `replaceDiary` to increment this generation in the same
transaction as the diary change. This avoids a failure window in which a local
change commits but is not marked for synchronization.

Do not increment the accepted-diary revision for draft autosaves, model-setting
changes, filter changes, or backup-reminder changes.

### 8.2 Drive sync metadata

Store non-secret Drive metadata under a separate validated `meta` record:

```ts
interface DriveSyncState {
  version: 1;
  enabled: boolean;
  deviceId: string;
  folderId: string | null;
  manifestFileId: string | null;
  lastRemoteVersion: string | null;
  lastSyncedGeneration: number;
  lastSuccessfulSyncAt: string | null;
}
```

The diary is pending whenever:

```text
diaryRevision.generation > driveSync.lastSyncedGeneration
```

Do not persist an access token, token expiry, account email, or raw Drive error
body in this record. Transient states such as `connecting`, `syncing`, and
`needs_authorization` belong in application memory and are derived again after
reload.

### 8.3 Device identity

Generate a random device ID when Drive sync is first configured. It is not a user
identity; it exists only to detect that a different Scranbook installation wrote
the remote manifest.

Disconnecting Drive should disable sync and forget local Drive resource IDs only
after confirmation. It should not delete remote data. Remote deletion, if ever
added, must be a separate explicit destructive action.

## 9. Synchronization lifecycle

### 9.1 Scheduling

After an accepted local mutation:

- return success to the editor immediately;
- mark the diary pending through the atomic generation update;
- schedule a sync after approximately 30 seconds of inactivity;
- enforce a maximum app-open pending interval of approximately five minutes;
- avoid concurrent sync runs by sharing one in-flight promise;
- coalesce further changes into a later generation while a run is active.

Also reconsider pending work when:

- the browser fires `online`;
- the Scranbook tab regains focus;
- the document becomes hidden, as a best-effort flush only;
- the user presses **Back up now**;
- a Drive token has just been reacquired.

Do not rely on `beforeunload`, service-worker periodic background sync, or a
closed PWA for correctness. The service worker cannot renew an expired Google
token without user interaction.

### 9.2 Token and network outcomes

Handle outcomes explicitly:

- **No token or expired token:** keep the generation pending and show
  **Reconnect to continue backup**.
- **Offline:** keep pending and resume after `online` or the next app session.
- **401/authorization failure:** clear the in-memory token and require
  reconnection.
- **403/permission removed:** stop automatic retry and explain that Drive access
  must be granted again.
- **429 or transient 5xx:** retry with bounded exponential backoff while the app
  remains open; retain pending state across reload.
- **Validation or remote-layout error:** stop automatic overwrite and offer
  recovery choices rather than replacing unknown data.
- **Successful sync:** advance `lastSyncedGeneration` only to the exact local
  generation represented by the uploaded manifest.

All errors shown to users must be concise and must exclude tokens, authorization
headers, Drive response bodies, entry contents, and photo bytes.

## 10. Restore and recovery

### 10.1 Restore flow

On **Restore from Drive**:

1. Require an active Drive token.
2. Locate and validate the app-created root folder and manifest.
3. Show the remote update time, entry count, photo count, and approximate size
   before changing local data.
4. Warn when restoring will replace a non-empty local diary or discard an active
   draft.
5. Download and validate every entry and required photo into temporary memory.
6. Check IDs, byte sizes, MIME types, and manifest references before starting the
   local replacement transaction.
7. Reuse the existing `replaceDiary` transaction only after the complete remote
   dataset is valid.
8. Set the local diary generation and Drive sync metadata to the restored remote
   generation without immediately uploading the same data again.

A failed or cancelled restore must leave the existing local diary and active
draft intact.

### 10.2 Existing ZIP archives

Keep manual ZIP export/import unchanged. Drive restore is an additional path,
not a replacement for portable archives. A later **Create Drive snapshot** action
may reuse `createDiaryArchive()` and resumable upload, but it should be presented
as a dated backup rather than current sync state.

## 11. Conflict and multi-device policy

### 11.1 First-release policy

Treat one installation as the active writer. Another device may inspect and
restore the Drive copy, but must explicitly choose to become the active writer
before uploading changes.

Persist the browser installation ID separately from Drive connection metadata.
Disconnecting or reconnecting Drive must not change that identity; only clearing
all site data creates a new installation. Migrate an existing Drive sync state's
writer ID into the durable installation record.

Before every manifest update, compare the stored remote metadata version with the
current Drive file metadata. If it changed unexpectedly or the remote manifest's
`writerDeviceId` differs, stop and show a conflict state. Do not automatically
apply last-write-wins.

Drive's metadata version can be used as a conflict signal, but implementation
must verify the exact conditional-update behavior during the API prototype rather
than assuming it provides a transactional compare-and-swap operation.
Because Drive does not expose an atomic expected-version parameter for this
update, the first release must also read the manifest back after writing and
confirm its unique `commitId` before marking local data synced. A mismatch leaves
the local generation pending and surfaces a conflict. This narrows the race
window but does not turn Drive into a transactional multi-writer database.

### 11.2 Later two-way synchronization

Simultaneous multi-device editing is a separate phase. It would require:

- per-entry revision information rather than one whole-diary generation;
- deletion tombstones so an absent entry is distinguishable from an older copy;
- deterministic merges for edits to different entries;
- an explicit conflict surface when the same entry changed on both devices;
- remote change polling while the application is open;
- retention and cleanup rules for replaced or deleted photos;
- tests covering clock skew, interrupted uploads, and concurrent writers.

Do not add these semantics implicitly to the first backup-oriented release.

## 12. Interface design

Add a **Google Drive backup** card near the existing local diary/archive controls
in Settings.

### 12.1 Disconnected

- Explain that Drive is optional and local saves continue without it.
- Show **Connect Google Drive**.
- State that accepted entries and processed photos will be copied to a visible
  Scranbook folder.
- Link to the updated privacy explanation.

### 12.2 Connected or previously configured

Show one truthful status:

- **Backed up** — include the last successful backup time.
- **Backing up to Drive…**
- **Changes pending** — offline or waiting for the debounce window.
- **Reconnect to continue backup** — the permission remains configured but the
  current page lacks a valid token.
- **Needs attention** — permission, validation, or conflict problem.

Provide:

- **Back up now**;
- **Restore from Drive**;
- **Open Scranbook folder** using a URL returned by Drive metadata rather than a
  synthesized link;
- **Disconnect**.

When a browser with a genuinely new installation identity discovers an existing
backup, describe it neutrally as **Drive backup found** and offer two explicit
choices: **Use Drive copy on this device** restores the remote copy and makes the
browser active, while **Replace Drive backup with this device** uploads the local
diary. Reserve **Drive backup changed elsewhere** for a version or writer change
after this installation has already established ownership.

Do not show a permanent "Connected" assertion solely because Drive file IDs are
stored locally. Authorization can expire or be revoked outside Scranbook.

### 12.3 Save feedback

Keep the editor's current local-save confirmation. Drive state should appear as a
secondary global or Settings status and must not make ordinary entry editing feel
network-bound. Avoid a toast for every successful background sync.

When Drive backup is enabled, show its current state in a compact header chip.
The chip opens a small detail panel with the fuller status, local-save
reassurance, and one context-appropriate action. Keep healthy and pending states
quiet. If the remote backup changed elsewhere or a write conflict needs a user
decision, also show a full-width notice beneath the header so the condition
cannot be missed; do not use that notice for routine sync progress.

## 13. Privacy, security, and documentation

Update the README, product specification, and privacy page to explain:

- Cloudflare still receives no diary API requests;
- Google receives accepted diary entries and processed photos only after the user
  enables Drive backup;
- Google Drive backup is separate from sending a photo to a configured model;
- Drive access can be revoked from Scranbook and the Google Account permissions
  page;
- disconnecting does not silently delete the user's Drive files;
- model credentials, provider headers, Google tokens, and active drafts are not
  synchronized;
- local manual ZIP export remains available.

Security review must confirm:

- no client secret or refresh token is present in source or build output;
- no access token reaches IndexedDB, storage APIs, logs, notices, test snapshots,
  or analytics;
- OAuth and Drive responses are not rendered as HTML;
- every downloaded manifest and photo is validated before persistence;
- CSP changes allow only the Google origins required by Identity Services;
- Drive API calls bypass the service-worker cache;
- Drive file and folder identifiers are treated as metadata, not authorization.

Client-side archive encryption can be evaluated separately. It introduces
password, key derivation, recovery, and cross-device UX that should not be mixed
into the initial synchronization release without a clear product requirement.

## 14. Implementation packages

### Prerequisite package: portable backup sharing

- Add **Share backup** beside the existing archive export control.
- Generate the same validated `.scranbook.zip` produced by the current export
  path rather than introducing another archive format.
- Use `navigator.canShare({ files })` before offering native file sharing.
- Fall back to the existing direct download when file sharing is unavailable,
  rejected, or fails without compromising the generated archive.
- Cover sharing support, user cancellation, failure, and download fallback in
  focused tests.
- Keep this action provider-neutral and independent of Google configuration.

This package establishes a universal recovery path and should ship or be ready
to ship before Drive backup. Its completion does not authorize or imply the
later Google OAuth publishing or deployment steps.

### Package 0: API prototype and Google configuration

- Configure development OAuth credentials and enable the Drive API.
- Prove token acquisition from localhost with `drive.file`.
- Create, update, list, download, and delete temporary app-created test files.
- Verify resource rediscovery through `appProperties` on a fresh browser profile.
- Verify popup, CSP, and opener-policy behavior in Chromium, Firefox, and Safari
  where available.
- Record any API behavior that changes the remote-layout or conflict design.

This package is a go/no-go decision gate. It is complete only when browser-direct
writes work without a backend and the results confirm that authorization,
reconnection, CSP/COOP behavior, resource rediscovery, and remote-version checks
can support the documented user experience. Record the decision and any plan
changes before starting Packages 1–5. If the prototype cannot meet those
conditions without broader permissions, persistent secrets, or misleading
backup claims, stop the Drive implementation and retain portable backup sharing.
Temporary prototype files must not be mixed with real diary data.

### Package 1: local revision tracking

- Add Zod schemas and types for `DiaryRevisionState` and `DriveSyncState`.
- Add validated repository functions for loading and saving sync metadata.
- Update accepted-diary mutation transactions to increment the revision
  atomically.
- Keep draft and settings writes outside the accepted-diary generation.
- Add migration defaults for an existing IndexedDB version 1 database without
  changing its object stores.
- Add database tests for save, edit, delete, clear, import replacement, and
  failed transaction behavior.

### Package 2: authorization and Drive client

- Add a typed Google Identity Services loader and token adapter.
- Add a small Drive REST client using `fetch`, `AbortController`, safe errors,
  narrow response fields, and resumable upload support.
- Keep the production integration deliberately thin. Do not add `googleapis`,
  `gapi.client`, or a React OAuth wrapper unless the API prototype demonstrates
  a requirement that the browser token adapter and REST client cannot meet.
- Add root-folder and manifest discovery/creation.
- Add photo create/update and manifest download/update operations.
- Keep Drive APIs independent of React so they can be unit tested with mocked
  fetch responses.
- Update CSP/COOP headers and verify them through Cloudflare preview.

### Package 3: first synchronization and scheduling

- Implement the remote manifest schema and serialization.
- Implement backup orchestration against the provider contract, with Google
  Drive supplied as the first adapter.
- Upload missing photos before updating the manifest.
- Persist confirmed Drive file IDs and remote metadata.
- Add the debounce, maximum pending interval, online/focus triggers, single-flight
  behavior, and bounded retry policy.
- Make local-save success independent of every sync outcome.
- Add shared status derivation, the Settings connection/status card, the compact
  header status/detail surface, and the decision-only conflict notice.
- Preserve pending generations across reload and token expiry.

### Package 4: restore and conflict protection

- Discover and preview a remote Scranbook dataset.
- Validate and stage the complete dataset before local replacement.
- Add non-empty-diary and active-draft confirmations.
- Add remote-version and writer-device conflict detection.
- Keep installation identity independent of disconnect/reconnect and migrate the
  existing writer ID.
- Add explicit **Use Drive copy on this device** and **Replace Drive backup with
  this device** actions behind a discovery, conflict, or recovery decision.
- Verify interrupted restore and invalid remote data leave the local diary
  untouched.

### Package 5: hardening, documentation, and release review

- Update README, product specification, privacy page, and Settings copy.
- Add mocked browser coverage for connection, the header status/detail surface,
  pending state, reconnection, successful backup, offline recovery, restore, and
  the decision-only conflict notice. Mocked builds use a dummy client ID and
  intercepted Google requests, then restore the `.env.local` build when present.
- Perform an opt-in live test using a dedicated Google account and disposable
  diary fixtures.
- Add a `test:drive-live` package script only when its headed, user-authorized
  harness exists. It must remain opt-in and excluded from CI and the default
  quality gate.
- Inspect the resulting Drive folder and downloaded files manually.
- Run the full local quality gate and production-style Cloudflare preview.
- Review mobile and desktop Settings layouts and accessibility before deployment.

Each package should remain a distinct implementation and review boundary.
Implementation, local verification, Google OAuth publishing, deployment, commit,
and push are separate approval gates.

## 15. Test strategy

### 15.1 Test harness and tool choices

Create a reusable, stateful fake Drive under `tests/support/`. It should model
only the endpoints and behavior Scranbook owns:

- folders and files keyed by deterministic test IDs;
- names, parents, MIME types, `appProperties`, content, and metadata versions;
- manifest and photo create, list, update, download, and conservative cleanup;
- resumable upload session creation, acknowledged byte ranges, interruption,
  resumption, and completion;
- configurable authorization, permission, missing-file, throttling, transient
  server, and remote-version failures.

Keep the fake's state machine independent of a particular test runner so thin
adapters can reuse the same behavior:

- In Vitest, continue using `fake-indexeddb` for local persistence and the
  repository's existing `vi.stubGlobal('fetch', ...)` pattern for focused Drive
  client tests.
- If the REST fixtures and state transitions become unwieldy, add Mock Service
  Worker as a development dependency and use its Node integration for Vitest.
  Do not add an MSW browser worker to the production app or Playwright suite.
- In Playwright, inject a minimal `window.google.accounts.oauth2` fake with
  `page.addInitScript()` before application code runs. It must be able to return
  a valid token, denied scope, cancellation, expiry, and authorization failure.
- Route Drive REST and upload requests with `browserContext.route()` so the
  browser tests can inspect headers and bodies, delay responses, simulate
  failures, and cover popup or new-page activity without contacting Google.

The test harness must not depend on `googleapis`, `gapi.client`, a React OAuth
wrapper, saved Google cookies, or a committed Playwright `storageState`. Mocked
tests are the repeatable CI proof; the separate live exercise is the integration
proof for Google's real OAuth and Drive surfaces.

### 15.2 Unit and repository tests

- Revision increments exactly once for each accepted-diary transaction.
- Failed local transactions do not advance the generation.
- Draft and settings writes do not mark the diary pending.
- Drive sync state rejects malformed or secret-bearing records.
- Manifest serialization excludes credentials and drafts.
- Pending state derives correctly before and after a confirmed generation.
- Scheduler debounces rapid saves, enforces single-flight behavior, and schedules
  a later run when a change occurs during an upload.
- Retry classification distinguishes authorization, permission, quota,
  throttling, transient server, validation, and conflict failures.

### 15.3 Drive client tests

Use mocked `fetch` and deterministic fixtures to cover:

- token and scope validation;
- folder and manifest discovery with zero, one, or duplicate candidates;
- new photo upload and confirmed file ID capture;
- interrupted resumable upload and resume handling;
- manifest update after all referenced photos succeed;
- no manifest update after a photo failure;
- conservative cleanup after a confirmed manifest update;
- 401, 403, 404, unexpected remote-version evidence, 429, and 5xx responses;
- sanitized errors that never include bearer tokens or diary content.

### 15.4 Browser tests

Stub Google Identity Services and Drive endpoints rather than calling a real
account in CI. Cover:

- connecting from Settings;
- denying the requested scope;
- saving locally before a delayed Drive upload completes;
- several rapid edits producing one coalesced sync;
- offline save followed by online recovery;
- reload with pending changes and no token;
- reconnect followed by automatic pending sync;
- restoring on an empty device;
- cancelling a restore over a non-empty diary;
- remote conflict without automatic overwrite;
- keyboard access, focus restoration after the OAuth popup, and status
  announcements;
- no serious or critical accessibility regressions.

### 15.5 Opt-in live verification

Live Google tests must never run in CI or use personal diary data. With a
dedicated Google Cloud development client and dedicated test account registered
as an OAuth test user:

1. Connect from the production-style local preview.
2. Save an entry with a small processed photo.
3. Confirm local success precedes Drive completion.
4. Edit and delete entries while observing generation and remote manifest
   changes.
5. Go offline, save, return online, and verify recovery.
6. Let the token expire, confirm pending state, reconnect, and verify completion.
7. Restore from a clean browser profile.
8. Modify the remote file from another session and verify conflict protection.
9. Revoke the app in Google Account permissions and verify the recovery copy.
10. Remove disposable Drive fixtures after recording the result.

This may be exposed as `pnpm test:drive-live`, but the command must launch a
headed, explicitly user-authorized flow and refuse to run unless its opt-in
environment flag is present. Never automate or persist the Google account
password, consent cookies, access token, or browser profile. Google OAuth
Playground and the Drive API Explorer may help diagnose individual requests, but
they do not replace the Scranbook browser flow because they cannot prove its CSP,
popup, local-state, or interface behavior.

## 16. Quality gates

Before release, run:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
pnpm cloudflare:preview
```

In addition, verify:

- the Google client ID is present where intended and no secret is in `out/`;
- response headers permit the OAuth flow without broadly weakening CSP;
- Drive remains optional when its build-time configuration is absent;
- offline use is unchanged after a user has connected Drive;
- no Drive request is cached by the service worker;
- the remote folder is readable from the Drive UI and recoverable from a fresh
  Scranbook installation;
- deployment and OAuth publishing state are reported separately from local test
  results.

## 17. Acceptance criteria

The first release is complete when:

- **Share backup** offers native file sharing when supported and preserves a
  working direct-download fallback;
- connecting Drive requires an explicit user action and only `drive.file`;
- every accepted diary change is committed locally and atomically marked with a
  new generation;
- pending changes are backed up while the app is open and authorized without
  blocking local work;
- offline, expired-token, revoked-permission, throttled, and interrupted-upload
  states retain local data and present truthful recovery actions;
- the remote manifest never intentionally references an unconfirmed photo;
- a clean device can preview and restore a complete validated diary copy;
- a different remote writer causes a conflict rather than silent overwrite;
- model credentials, custom headers, Google tokens, and active drafts never reach
  Drive;
- manual ZIP export/import and all offline diary behavior still work;
- unit, browser, accessibility, CSP, production-preview, and opt-in live Drive
  verification pass.

## 18. References

- [Google Identity Services browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Identity Services authorization-code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Google Identity Services setup and security headers](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Share files with the Web Share API](https://web.dev/patterns/files/share-files)
- [Vitest request mocking guidance](https://main.vitest.dev/guide/mocking/requests)
- [Playwright network interception](https://playwright.dev/docs/network)
