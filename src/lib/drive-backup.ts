import {
  BackupProviderError,
  type BackupProvider,
  type BackupProviderResources,
  type RemoteBackupRecord,
  type RemoteBackupSnapshot,
} from './backup-provider';
import {
  getAllPhotos,
  listEntries,
  loadDiaryRevision,
  replaceDiary,
  saveDriveSyncState,
} from './db';
import type { DiaryRevisionState, DriveSyncState, StoredPhoto } from './schema';

export interface DriveBackupInspection {
  resources: BackupProviderResources;
  remote: RemoteBackupRecord | null;
}

export interface DriveBackupRunResult extends DriveBackupInspection {
  state: DriveSyncState;
}

export function createDriveSyncState(
  deviceId = crypto.randomUUID(),
): DriveSyncState {
  return {
    version: 1,
    enabled: true,
    deviceId,
    folderId: null,
    photoFolderId: null,
    manifestFileId: null,
    lastRemoteVersion: null,
    lastSyncedGeneration: 0,
    lastSuccessfulSyncAt: null,
  };
}

export async function inspectDriveBackup(
  provider: BackupProvider,
  state: DriveSyncState,
): Promise<DriveBackupInspection> {
  const resources = await provider.ensureResources({
    folderId: state.folderId,
    photoFolderId: state.photoFolderId,
    manifestFileId: state.manifestFileId,
  });
  return {
    resources,
    remote: await provider.inspectBackup(resources),
  };
}

function unchangedPhoto(
  local: StoredPhoto,
  remote: RemoteBackupSnapshot['photos'][number],
) {
  return (
    local.id === remote.id &&
    local.mimeType === remote.mimeType &&
    local.width === remote.width &&
    local.height === remote.height &&
    local.byteSize === remote.byteSize
  );
}

function assertSafeToWrite(
  remote: RemoteBackupRecord | null,
  state: DriveSyncState,
  allowTakeover: boolean,
) {
  if (!remote) {
    if (state.lastRemoteVersion && !allowTakeover) {
      throw new BackupProviderError(
        'The previous Drive backup could not be found. Nothing was overwritten.',
        'conflict',
      );
    }
    return;
  }
  if (allowTakeover) return;
  if (
    (state.lastRemoteVersion && state.lastRemoteVersion !== remote.version) ||
    remote.snapshot.writerDeviceId !== state.deviceId
  ) {
    throw new BackupProviderError(
      'The Drive backup was written by another Scranbook installation. Restore it or explicitly make this device active.',
      'conflict',
    );
  }
}

export async function performDriveBackup(
  provider: BackupProvider,
  state: DriveSyncState,
  options: { allowTakeover?: boolean } = {},
): Promise<DriveBackupRunResult> {
  const [inspection, entries, photos, revision] = await Promise.all([
    inspectDriveBackup(provider, state),
    listEntries(),
    getAllPhotos(),
    loadDiaryRevision(),
  ]);
  assertSafeToWrite(inspection.remote, state, options.allowTakeover ?? false);

  const previousPhotos = new Map(
    inspection.remote?.snapshot.photos.map((photo) => [photo.id, photo]) ?? [],
  );
  const uploadedPhotos = [];
  for (const photo of photos) {
    const previous = previousPhotos.get(photo.id);
    uploadedPhotos.push(
      previous && unchangedPhoto(photo, previous)
        ? previous
        : await provider.uploadPhoto(
            photo,
            inspection.resources,
            previous?.remoteFileId,
          ),
    );
  }

  const referencedPhotoIds = new Set(uploadedPhotos.map((photo) => photo.id));
  if (
    entries.some(
      (entry) => entry.photoId && !referencedPhotoIds.has(entry.photoId),
    )
  ) {
    throw new BackupProviderError(
      'A local diary entry has a missing photo. The Drive backup was not changed.',
      'validation',
    );
  }

  const snapshot: RemoteBackupSnapshot = {
    commitId: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
    writerDeviceId: state.deviceId,
    generation: revision.generation,
    entries,
    photos: uploadedPhotos,
  };
  const committed = await provider.commitBackup(
    snapshot,
    inspection.resources,
    inspection.remote?.version ?? null,
  );
  const verified = await provider.inspectBackup({
    ...inspection.resources,
    manifestFileId: committed.manifestFileId,
  });
  if (
    !verified ||
    verified.version !== committed.version ||
    verified.snapshot.commitId !== snapshot.commitId
  ) {
    throw new BackupProviderError(
      'The Drive backup changed before this device could verify it. Local changes remain pending.',
      'conflict',
    );
  }
  const nextState = await saveDriveSyncState({
    ...state,
    enabled: true,
    folderId: inspection.resources.folderId,
    photoFolderId: inspection.resources.photoFolderId,
    manifestFileId: committed.manifestFileId,
    lastRemoteVersion: verified.version,
    lastSyncedGeneration: revision.generation,
    lastSuccessfulSyncAt: verified.snapshot.updatedAt,
  });

  const retainedFiles = new Set(
    uploadedPhotos.map((photo) => photo.remoteFileId),
  );
  const obsoleteFiles =
    inspection.remote?.snapshot.photos.filter(
      (photo) => !retainedFiles.has(photo.remoteFileId),
    ) ?? [];
  await Promise.allSettled(
    obsoleteFiles.map((photo) => provider.deleteFile(photo.remoteFileId)),
  );

  return {
    state: nextState,
    resources: {
      ...inspection.resources,
      manifestFileId: committed.manifestFileId,
    },
    remote: verified,
  };
}

export async function restoreDriveBackup(
  provider: BackupProvider,
  state: DriveSyncState,
): Promise<DriveBackupRunResult> {
  const inspection = await inspectDriveBackup(provider, state);
  if (!inspection.remote) {
    throw new BackupProviderError(
      'No Scranbook backup was found in this Google Drive.',
      'not_found',
    );
  }
  const photoIds = new Set(
    inspection.remote.snapshot.photos.map((photo) => photo.id),
  );
  if (
    inspection.remote.snapshot.entries.some(
      (entry) => entry.photoId && !photoIds.has(entry.photoId),
    )
  ) {
    throw new BackupProviderError(
      'The Drive backup contains an entry with a missing photo.',
      'validation',
    );
  }
  const photos = [];
  for (const reference of inspection.remote.snapshot.photos) {
    photos.push(await provider.downloadPhoto(reference));
  }
  await replaceDiary(inspection.remote.snapshot.entries, photos);
  const revision = await loadDiaryRevision();
  const nextState = await saveDriveSyncState({
    ...state,
    enabled: true,
    folderId: inspection.resources.folderId,
    photoFolderId: inspection.resources.photoFolderId,
    manifestFileId: inspection.remote.manifestFileId,
    lastRemoteVersion: inspection.remote.version,
    lastSyncedGeneration: revision.generation,
    lastSuccessfulSyncAt: inspection.remote.snapshot.updatedAt,
  });
  return { ...inspection, state: nextState };
}

export function driveBackupPending(
  revision: DiaryRevisionState,
  state: DriveSyncState | null,
) {
  return Boolean(
    state?.enabled && revision.generation > state.lastSyncedGeneration,
  );
}
