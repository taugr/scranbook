import type { MealEntry, StoredPhoto } from './schema';

export type BackupProviderErrorCode =
  | 'authorization'
  | 'permission'
  | 'quota'
  | 'not_found'
  | 'throttled'
  | 'transient'
  | 'conflict'
  | 'validation'
  | 'unknown';

export class BackupProviderError extends Error {
  constructor(
    message: string,
    readonly code: BackupProviderErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BackupProviderError';
  }
}

export interface RemotePhotoReference {
  id: string;
  remoteFileId: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
}

export interface RemoteBackupSnapshot {
  commitId: string;
  updatedAt: string;
  writerDeviceId: string;
  generation: number;
  entries: MealEntry[];
  photos: RemotePhotoReference[];
}

export interface RemoteBackupRecord {
  snapshot: RemoteBackupSnapshot;
  manifestFileId: string;
  version: string;
  modifiedTime: string;
}

export interface BackupProviderResources {
  folderId: string;
  photoFolderId: string;
  manifestFileId: string | null;
  folderUrl: string | null;
}

export type UploadedRemotePhoto = RemotePhotoReference;

export interface BackupProvider {
  readonly id: 'google-drive';
  ensureResources(input: {
    folderId: string | null;
    photoFolderId: string | null;
    manifestFileId: string | null;
  }): Promise<BackupProviderResources>;
  inspectBackup(
    resources: BackupProviderResources,
  ): Promise<RemoteBackupRecord | null>;
  uploadPhoto(
    photo: StoredPhoto,
    resources: BackupProviderResources,
    existingRemoteFileId?: string,
  ): Promise<UploadedRemotePhoto>;
  commitBackup(
    snapshot: RemoteBackupSnapshot,
    resources: BackupProviderResources,
    expectedVersion: string | null,
  ): Promise<RemoteBackupRecord>;
  downloadPhoto(reference: RemotePhotoReference): Promise<StoredPhoto>;
  deleteFile(fileId: string): Promise<void>;
}
