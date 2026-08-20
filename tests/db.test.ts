import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveDraft,
  clearCredentials,
  clearDiary,
  clearDriveSyncState,
  deleteEntry,
  getPhoto,
  listEntries,
  loadActiveDraft,
  loadBackupState,
  loadDiaryRevision,
  loadDriveSyncState,
  loadOrCreateInstallationState,
  loadModelSettings,
  resetDatabaseForTests,
  saveEntry,
  saveActiveDraft,
  saveBackupState,
  saveDriveSyncState,
  saveModelSettings,
} from '@/lib/db';
import {
  createBlankEntry,
  defaultModelSettings,
  type DriveSyncState,
  type StoredPhoto,
} from '@/lib/schema';
import { createMealCheckIn } from '@/lib/meal-check-ins';

async function clearTestDatabase() {
  await resetDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('scranbook');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion blocked'));
  });
}

beforeEach(clearTestDatabase);
afterEach(clearTestDatabase);

describe('local diary database', () => {
  it('persists entries and photos and sorts newest first', async () => {
    const older = {
      ...createBlankEntry(new Date('2026-07-11T08:00:00Z')),
      title: 'Porridge',
    };
    const newer = {
      ...createBlankEntry(new Date('2026-07-12T19:00:00Z')),
      title: 'Stew',
    };
    const photo: StoredPhoto = {
      id: crypto.randomUUID(),
      blob: new Blob(['photo'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 10,
      height: 10,
      byteSize: 5,
      createdAt: newer.createdAt,
    };
    newer.photoId = photo.id;
    await saveEntry(older);
    await saveEntry(newer, photo);
    expect((await listEntries()).map((entry) => entry.title)).toEqual([
      'Stew',
      'Porridge',
    ]);
    expect((await getPhoto(photo.id))?.byteSize).toBe(5);
  });

  it('removes the related photo when deleting an entry', async () => {
    const entry = createBlankEntry();
    const photo: StoredPhoto = {
      id: crypto.randomUUID(),
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
      byteSize: 1,
      createdAt: entry.createdAt,
    };
    entry.photoId = photo.id;
    await saveEntry(entry, photo);
    await deleteEntry(entry.id);
    expect(await listEntries()).toEqual([]);
    expect(await getPhoto(photo.id)).toBeUndefined();
  });

  it('persists structured meal follow-ups with the meal', async () => {
    const entry = createBlankEntry();
    entry.checkIns.push(
      createMealCheckIn({
        feeling: 'unwell',
        symptoms: ['cramps', 'nausea'],
        severity: 3,
        onset: '30_minutes_to_1_hour',
        notes: '',
      }),
    );
    await saveEntry(entry);
    expect((await listEntries())[0]?.checkIns[0]).toMatchObject({
      feeling: 'unwell',
      symptoms: ['cramps', 'nausea'],
      severity: 3,
    });
  });

  it('increments the accepted-diary revision with each mutation', async () => {
    expect((await loadDiaryRevision()).generation).toBe(0);
    const entry = createBlankEntry();
    await saveEntry(entry);
    expect((await loadDiaryRevision()).generation).toBe(1);
    await deleteEntry(entry.id);
    expect((await loadDiaryRevision()).generation).toBe(2);
    await clearDiary();
    expect((await loadDiaryRevision()).generation).toBe(3);
  });

  it('does not advance the diary revision for drafts or settings', async () => {
    const entry = createBlankEntry();
    await saveActiveDraft({
      format: 'scranbook-draft',
      version: 1,
      mode: 'new',
      sourceEntryId: null,
      entry,
      photo: null,
      savedAt: entry.updatedAt,
    });
    await saveModelSettings(defaultModelSettings);
    expect((await loadDiaryRevision()).generation).toBe(0);
  });

  it('validates non-secret Drive sync metadata', async () => {
    const state: DriveSyncState = {
      version: 1,
      enabled: true,
      deviceId: 'device-1',
      folderId: 'folder-1',
      photoFolderId: 'photos-1',
      manifestFileId: 'manifest-1',
      lastRemoteVersion: '3',
      lastSyncedGeneration: 2,
      lastSuccessfulSyncAt: '2026-07-21T00:00:00.000Z',
    };
    await saveDriveSyncState(state);
    expect(await loadDriveSyncState()).toEqual(state);
    await expect(
      saveDriveSyncState({
        ...state,
        accessToken: 'must-not-persist',
      } as DriveSyncState),
    ).rejects.toThrow();
  });

  it('keeps a stable installation identity across Drive disconnects', async () => {
    const installation = await loadOrCreateInstallationState();
    const state: DriveSyncState = {
      version: 1,
      enabled: true,
      deviceId: installation.deviceId,
      folderId: 'folder-1',
      photoFolderId: 'photos-1',
      manifestFileId: 'manifest-1',
      lastRemoteVersion: '3',
      lastSyncedGeneration: 2,
      lastSuccessfulSyncAt: '2026-07-21T00:00:00.000Z',
    };
    await saveDriveSyncState(state);
    await clearDriveSyncState();

    expect(await loadDriveSyncState()).toBeNull();
    expect(await loadOrCreateInstallationState()).toEqual(installation);
  });

  it('migrates the existing Drive writer ID into installation state', async () => {
    const legacyState: DriveSyncState = {
      version: 1,
      enabled: true,
      deviceId: 'legacy-drive-device',
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
      lastRemoteVersion: null,
      lastSyncedGeneration: 0,
      lastSuccessfulSyncAt: null,
    };
    await saveDriveSyncState(legacyState);

    expect((await loadDriveSyncState())?.deviceId).toBe('legacy-drive-device');
    expect((await loadOrCreateInstallationState()).deviceId).toBe(
      'legacy-drive-device',
    );
  });

  it('stores settings and clears only credentials', async () => {
    await saveModelSettings({
      ...defaultModelSettings,
      apiKey: 'secret',
      extraHeaders: { 'X-Test': 'value' },
    });
    expect((await loadModelSettings()).apiKey).toBe('secret');
    const cleared = await clearCredentials();
    expect(cleared.apiKey).toBe('');
    expect(cleared.extraHeaders).toEqual({});
    expect(cleared.model).toBe('google/gemma-4-e4b');
  });

  it('stores and clears an active draft with its photo blob', async () => {
    const entry = createBlankEntry();
    const draft = {
      format: 'scranbook-draft' as const,
      version: 1 as const,
      mode: 'new' as const,
      sourceEntryId: null,
      entry,
      photo: {
        id: 'draft-photo',
        blob: new Blob(['draft'], { type: 'image/jpeg' }),
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
        byteSize: 5,
        createdAt: entry.createdAt,
      },
      savedAt: entry.updatedAt,
    };
    await saveActiveDraft(draft);
    expect((await loadActiveDraft())?.photo?.byteSize).toBe(5);
    await clearActiveDraft();
    expect(await loadActiveDraft()).toBeNull();
  });

  it('atomically deletes an entry and its associated active draft', async () => {
    const entry = createBlankEntry();
    await saveEntry(entry);
    await saveActiveDraft({
      format: 'scranbook-draft',
      version: 1,
      mode: 'edit',
      sourceEntryId: entry.id,
      entry,
      photo: null,
      savedAt: entry.updatedAt,
    });
    await deleteEntry(entry.id, true);
    expect(await listEntries()).toEqual([]);
    expect(await loadActiveDraft()).toBeNull();
  });

  it('clears diary-owned draft and backup metadata', async () => {
    const entry = createBlankEntry();
    await saveEntry(entry);
    await saveActiveDraft({
      format: 'scranbook-draft',
      version: 1,
      mode: 'edit',
      sourceEntryId: entry.id,
      entry,
      photo: null,
      savedAt: entry.updatedAt,
    });
    await saveBackupState({
      version: 1,
      lastArchiveCreatedAt: entry.updatedAt,
      entryCountAtArchive: 1,
      latestEntryUpdatedAtAtArchive: entry.updatedAt,
      reminderDismissedUntil: null,
    });
    await clearDiary();
    expect(await listEntries()).toEqual([]);
    expect(await loadActiveDraft()).toBeNull();
    expect(await loadBackupState()).toBeNull();
  });
});
