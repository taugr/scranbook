import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleDriveProvider } from '@/lib/google-drive-provider';
import type { RemoteBackupSnapshot } from '@/lib/backup-provider';
import { createBlankEntry, type StoredPhoto } from '@/lib/schema';
import { FakeDrive } from './support/fake-drive';

describe('Google Drive provider', () => {
  let drive: FakeDrive;
  let provider: GoogleDriveProvider;

  beforeEach(() => {
    drive = new FakeDrive();
    provider = new GoogleDriveProvider('mock-drive-token');
    vi.stubGlobal('fetch', drive.fetch.bind(drive));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates and rediscovers app-owned resources', async () => {
    const resources = await provider.ensureResources({
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
    });
    expect(resources.folderUrl).toContain('drive.google.com');
    expect(drive.filesWithRole('root')).toHaveLength(1);
    expect(drive.filesWithRole('photos')).toHaveLength(1);
    expect(await provider.inspectBackup(resources)).toBeNull();

    const rediscovered = await provider.ensureResources({
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
    });
    expect(rediscovered.folderId).toBe(resources.folderId);
    expect(rediscovered.photoFolderId).toBe(resources.photoFolderId);
  });

  it('uploads a photo, commits a validated manifest, and downloads it', async () => {
    const resources = await provider.ensureResources({
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
    });
    const photo: StoredPhoto = {
      id: 'photo-1',
      blob: new Blob(['photo-data'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 12,
      height: 8,
      byteSize: 10,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const uploaded = await provider.uploadPhoto(photo, resources);
    const snapshot: RemoteBackupSnapshot = {
      commitId: 'commit-1',
      updatedAt: '2026-07-21T00:01:00.000Z',
      writerDeviceId: 'device-1',
      generation: 1,
      entries: [{ ...createBlankEntry(), photoId: photo.id }],
      photos: [uploaded],
    };
    const committed = await provider.commitBackup(snapshot, resources, null);
    const discovered = await provider.ensureResources({
      ...resources,
      manifestFileId: committed.manifestFileId,
    });
    const inspected = await provider.inspectBackup(discovered);
    expect(inspected?.snapshot).toEqual(snapshot);
    expect((await provider.downloadPhoto(uploaded)).blob.size).toBe(10);
    expect(drive.manifestJson()).toMatchObject({
      format: 'scranbook-drive',
      writerDeviceId: 'device-1',
      photos: [{ driveFileId: uploaded.remoteFileId }],
    });
  });

  it('refuses a manifest update when the expected version is stale', async () => {
    const resources = await provider.ensureResources({
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
    });
    const snapshot: RemoteBackupSnapshot = {
      commitId: 'commit-2',
      updatedAt: '2026-07-21T00:00:00.000Z',
      writerDeviceId: 'device-1',
      generation: 0,
      entries: [],
      photos: [],
    };
    const committed = await provider.commitBackup(snapshot, resources, null);
    await expect(
      provider.commitBackup(
        { ...snapshot, generation: 1 },
        { ...resources, manifestFileId: committed.manifestFileId },
        'stale-version',
      ),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('classifies HTTP failures without exposing response content', async () => {
    drive.failNext(401);
    await expect(
      provider.ensureResources({
        folderId: null,
        photoFolderId: null,
        manifestFileId: null,
      }),
    ).rejects.toMatchObject({
      code: 'authorization',
      message: 'Reconnect Google Drive to continue backup.',
    });
  });

  it('resumes a photo upload from the last confirmed byte after interruption', async () => {
    const resources = await provider.ensureResources({
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
    });
    const photo: StoredPhoto = {
      id: 'photo-resume',
      blob: new Blob(['abcdefghij'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 10,
      height: 10,
      byteSize: 10,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    drive.interruptNextUploadAfter(4);

    const uploaded = await provider.uploadPhoto(photo, resources);

    expect((await provider.downloadPhoto(uploaded)).blob.size).toBe(10);
    const sessionRequests = drive.requests.filter((request) =>
      request.url.includes('/upload/session/'),
    );
    expect(
      sessionRequests.map(
        (request) =>
          request.headers?.['Content-Range'] ??
          request.headers?.['content-range'],
      ),
    ).toEqual(['bytes 0-9/10', 'bytes */10', 'bytes 4-9/10']);
  });

  it.each([
    [403, 'userRateLimitExceeded', 'throttled'],
    [403, 'storageQuotaExceeded', 'quota'],
    [403, 'insufficientPermissions', 'permission'],
    [429, undefined, 'throttled'],
    [503, undefined, 'transient'],
  ] as const)(
    'classifies Drive status %s reason %s as %s',
    async (status, reason, code) => {
      drive.failNext(status, reason);
      await expect(
        provider.ensureResources({
          folderId: null,
          photoFolderId: null,
          manifestFileId: null,
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it('rejects ambiguous duplicate app-owned folders', async () => {
    await provider.ensureResources({
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
    });
    drive.duplicateFirstWithRole('root');

    await expect(
      provider.ensureResources({
        folderId: null,
        photoFolderId: null,
        manifestFileId: null,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('recreates manually deleted folders without touching orphaned files', async () => {
    const first = await provider.ensureResources({
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
    });
    drive.deleteFirstWithRole('root');

    const recreated = await provider.ensureResources(first);

    expect(recreated.folderId).not.toBe(first.folderId);
    expect(recreated.photoFolderId).not.toBe(first.photoFolderId);
    expect(drive.filesWithRole('photos')).toHaveLength(2);
  });

  it('reports a manually deleted photo without returning partial data', async () => {
    const resources = await provider.ensureResources({
      folderId: null,
      photoFolderId: null,
      manifestFileId: null,
    });
    const photo: StoredPhoto = {
      id: 'photo-deleted',
      blob: new Blob(['photo'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 10,
      height: 10,
      byteSize: 5,
      createdAt: '2026-07-21T00:00:00.000Z',
    };
    const uploaded = await provider.uploadPhoto(photo, resources);
    drive.deleteFirstWithRole('photo');

    await expect(provider.downloadPhoto(uploaded)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
