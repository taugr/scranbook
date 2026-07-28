import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDriveSyncState,
  driveBackupPending,
  performDriveBackup,
  restoreDriveBackup,
} from '@/lib/drive-backup';
import {
  getPhoto,
  deleteEntry,
  listEntries,
  loadDiaryRevision,
  resetDatabaseForTests,
  saveEntry,
} from '@/lib/db';
import { GoogleDriveProvider } from '@/lib/google-drive-provider';
import { createBlankEntry, type StoredPhoto } from '@/lib/schema';
import { FakeDrive } from './support/fake-drive';

async function clearTestDatabase() {
  await resetDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('scranbook');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion blocked'));
  });
}

describe('Drive backup orchestration', () => {
  let drive: FakeDrive;
  let provider: GoogleDriveProvider;

  beforeEach(async () => {
    await clearTestDatabase();
    drive = new FakeDrive();
    provider = new GoogleDriveProvider('mock-drive-token');
    vi.stubGlobal('fetch', drive.fetch.bind(drive));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearTestDatabase();
  });

  it('backs up local entries after their IndexedDB transaction completes', async () => {
    const entry = { ...createBlankEntry(), title: 'Soup' };
    const photo: StoredPhoto = {
      id: 'photo-1',
      blob: new Blob(['photo-data'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 12,
      height: 8,
      byteSize: 10,
      createdAt: entry.createdAt,
    };
    entry.photoId = photo.id;
    await saveEntry(entry, photo);
    const initialState = createDriveSyncState();
    expect(driveBackupPending(await loadDiaryRevision(), initialState)).toBe(
      true,
    );

    const result = await performDriveBackup(provider, initialState);
    expect(result.state.lastSyncedGeneration).toBe(1);
    expect(driveBackupPending(await loadDiaryRevision(), result.state)).toBe(
      false,
    );
    expect(drive.manifestJson()).toMatchObject({
      entries: [{ title: 'Soup' }],
      photos: [{ id: photo.id }],
    });
    expect(drive.filesWithRole('photo')).toHaveLength(1);

    await saveEntry({ ...entry, title: 'Tomato soup' });
    await performDriveBackup(provider, result.state);
    expect(drive.filesWithRole('photo')).toHaveLength(1);
    expect(drive.manifestJson()).toMatchObject({
      entries: [{ title: 'Tomato soup' }],
    });
  });

  it('restores and validates a complete backup on a clean device', async () => {
    const entry = { ...createBlankEntry(), title: 'Pasta' };
    const photo: StoredPhoto = {
      id: 'photo-pasta',
      blob: new Blob(['pasta-photo'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 20,
      height: 10,
      byteSize: 11,
      createdAt: entry.createdAt,
    };
    entry.photoId = photo.id;
    await saveEntry(entry, photo);
    await performDriveBackup(provider, createDriveSyncState());

    await clearTestDatabase();
    const restored = await restoreDriveBackup(provider, createDriveSyncState());
    expect((await listEntries())[0]?.title).toBe('Pasta');
    expect((await getPhoto(photo.id))?.byteSize).toBe(11);
    expect(restored.state.lastSyncedGeneration).toBe(
      (await loadDiaryRevision()).generation,
    );
  });

  it('stops when another writer changes the remote manifest', async () => {
    const entry = { ...createBlankEntry(), title: 'Toast' };
    await saveEntry(entry);
    const first = await performDriveBackup(provider, createDriveSyncState());
    drive.replaceManifest({
      ...drive.manifestJson(),
      writerDeviceId: 'another-device',
      updatedAt: '2026-07-21T12:00:00.000Z',
    });
    await saveEntry({ ...entry, title: 'Changed locally' });

    await expect(
      performDriveBackup(provider, first.state),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(drive.manifestJson()).toMatchObject({
      writerDeviceId: 'another-device',
      entries: [{ title: 'Toast' }],
    });
  });

  it('leaves local data untouched when the remote manifest is invalid', async () => {
    const local = { ...createBlankEntry(), title: 'Local meal' };
    await saveEntry(local);
    await performDriveBackup(provider, createDriveSyncState());
    drive.replaceManifest({ format: 'not-scranbook' });

    await expect(
      restoreDriveBackup(provider, createDriveSyncState()),
    ).rejects.toMatchObject({
      code: 'validation',
    });
    expect((await listEntries())[0]?.title).toBe('Local meal');
  });

  it('does not advance sync state when another writer races the manifest commit', async () => {
    const entry = { ...createBlankEntry(), title: 'Race-safe soup' };
    await saveEntry(entry);
    const state = createDriveSyncState();
    drive.raceNextManifestCommit();

    await expect(performDriveBackup(provider, state)).rejects.toMatchObject({
      code: 'conflict',
    });

    expect(drive.manifestJson()).toMatchObject({
      writerDeviceId: 'racing-device',
    });
    expect(driveBackupPending(await loadDiaryRevision(), state)).toBe(true);
  });

  it('does not change the manifest when a photo upload fails', async () => {
    const entry = { ...createBlankEntry(), title: 'Original photo' };
    const originalPhoto: StoredPhoto = {
      id: 'photo-failure',
      blob: new Blob(['original'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 12,
      height: 8,
      byteSize: 8,
      createdAt: entry.createdAt,
    };
    entry.photoId = originalPhoto.id;
    await saveEntry(entry, originalPhoto);
    const first = await performDriveBackup(provider, createDriveSyncState());
    const originalManifest = drive.manifestJson();

    await saveEntry(
      { ...entry, title: 'Changed photo' },
      { ...originalPhoto, blob: new Blob(['replacement']), byteSize: 11 },
    );
    drive.failNextMatching(
      (request) => request.url.includes('uploadType=resumable'),
      403,
      'storageQuotaExceeded',
    );

    await expect(
      performDriveBackup(provider, first.state),
    ).rejects.toMatchObject({
      code: 'quota',
    });
    expect(drive.manifestJson()).toEqual(originalManifest);
  });

  it('deletes obsolete photos only after the replacement manifest commits', async () => {
    const entry = { ...createBlankEntry(), title: 'Temporary photo' };
    const photo: StoredPhoto = {
      id: 'photo-cleanup',
      blob: new Blob(['cleanup'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 12,
      height: 8,
      byteSize: 7,
      createdAt: entry.createdAt,
    };
    entry.photoId = photo.id;
    await saveEntry(entry, photo);
    const first = await performDriveBackup(provider, createDriveSyncState());
    await deleteEntry(entry.id);
    drive.failNextMatching(
      (request) => request.url.includes('uploadType=multipart'),
      503,
    );

    await expect(
      performDriveBackup(provider, first.state),
    ).rejects.toMatchObject({
      code: 'transient',
    });
    expect(drive.filesWithRole('photo')).toHaveLength(1);

    await performDriveBackup(provider, first.state);
    expect(drive.filesWithRole('photo')).toHaveLength(0);
  });

  it('treats a manually deleted known manifest as a conflict', async () => {
    const entry = { ...createBlankEntry(), title: 'Known backup' };
    await saveEntry(entry);
    const first = await performDriveBackup(provider, createDriveSyncState());
    drive.deleteFirstWithRole('manifest');
    await saveEntry({ ...entry, title: 'Local change' });

    await expect(
      performDriveBackup(provider, first.state),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
