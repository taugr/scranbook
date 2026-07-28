import { z } from 'zod';
import {
  BackupProviderError,
  type BackupProvider,
  type BackupProviderResources,
  type RemoteBackupRecord,
  type RemoteBackupSnapshot,
  type RemotePhotoReference,
  type UploadedRemotePhoto,
} from './backup-provider';
import {
  driveManifestSchema,
  type DriveManifest,
  type DriveSyncState,
  type StoredPhoto,
} from './schema';

const filesBaseUrl = 'https://www.googleapis.com/drive/v3/files';
const uploadBaseUrl = 'https://www.googleapis.com/upload/drive/v3/files';
const folderMimeType = 'application/vnd.google-apps.folder';
const maximumManifestBytes = 25 * 1024 * 1024;

const driveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  mimeType: z.string().default(''),
  version: z.string().default('0'),
  modifiedTime: z.string().default(''),
  webViewLink: z.string().optional(),
  parents: z.array(z.string()).optional(),
});

type DriveFile = z.infer<typeof driveFileSchema>;

const driveFileListSchema = z.object({
  files: z.array(driveFileSchema),
});

const googleErrorSchema = z.object({
  error: z.object({
    errors: z
      .array(z.object({ reason: z.string().optional() }).passthrough())
      .optional(),
  }),
});

function classifyStatus(status: number, reason?: string) {
  if (status === 401) return 'authorization' as const;
  if (
    reason === 'storageQuotaExceeded' ||
    reason === 'activeItemCreationLimitExceeded'
  )
    return 'quota' as const;
  if (
    status === 429 ||
    reason === 'rateLimitExceeded' ||
    reason === 'userRateLimitExceeded'
  )
    return 'throttled' as const;
  if (status === 403) return 'permission' as const;
  if (status === 404) return 'not_found' as const;
  if (status === 409 || status === 412) return 'conflict' as const;
  if (status === 429) return 'throttled' as const;
  if (status >= 500) return 'transient' as const;
  return 'unknown' as const;
}

function safeStatusMessage(
  status: number,
  code: ReturnType<typeof classifyStatus>,
) {
  if (code === 'quota')
    return 'Google Drive storage is full. Free some space before retrying backup.';
  if (code === 'throttled')
    return 'Google Drive is busy. Backup will retry later.';
  if (status === 401) return 'Reconnect Google Drive to continue backup.';
  if (status === 403) return 'Google Drive permission is no longer available.';
  if (status === 404) return 'A Scranbook Drive file could not be found.';
  if (status === 409 || status === 412)
    return 'The Drive backup changed on another device.';
  if (status >= 500)
    return 'Google Drive is temporarily unavailable. Backup will retry later.';
  return 'Google Drive could not complete the backup request.';
}

function toDriveManifest(snapshot: RemoteBackupSnapshot): DriveManifest {
  return driveManifestSchema.parse({
    format: 'scranbook-drive',
    version: 1,
    commitId: snapshot.commitId,
    updatedAt: snapshot.updatedAt,
    writerDeviceId: snapshot.writerDeviceId,
    generation: snapshot.generation,
    entries: snapshot.entries,
    photos: snapshot.photos.map(({ remoteFileId, ...photo }) => ({
      ...photo,
      driveFileId: remoteFileId,
    })),
  });
}

function fromDriveManifest(manifest: DriveManifest): RemoteBackupSnapshot {
  return {
    commitId: manifest.commitId,
    updatedAt: manifest.updatedAt,
    writerDeviceId: manifest.writerDeviceId,
    generation: manifest.generation,
    entries: manifest.entries,
    photos: manifest.photos.map(({ driveFileId, ...photo }) => ({
      ...photo,
      remoteFileId: driveFileId,
    })),
  };
}

export class GoogleDriveProvider implements BackupProvider {
  readonly id = 'google-drive' as const;

  constructor(private readonly accessToken: string) {}

  async ensureResources(input: {
    folderId: string | null;
    photoFolderId: string | null;
    manifestFileId: string | null;
  }): Promise<BackupProviderResources> {
    const root =
      (await this.tryMetadata(input.folderId)) ??
      (await this.findOne('root')) ??
      (await this.createFolder('Scranbook', 'root'));
    const cachedPhotos = await this.tryMetadata(input.photoFolderId);
    const photos =
      (cachedPhotos?.parents?.includes(root.id) ? cachedPhotos : null) ??
      (await this.findOne('photos', root.id)) ??
      (await this.createFolder('photos', 'photos', root.id));
    const cachedManifest = await this.tryMetadata(input.manifestFileId);
    const manifest =
      (cachedManifest?.parents?.includes(root.id) ? cachedManifest : null) ??
      (await this.findOne('manifest', root.id));
    return {
      folderId: root.id,
      photoFolderId: photos.id,
      manifestFileId: manifest?.id ?? null,
      folderUrl: root.webViewLink ?? null,
    };
  }

  async inspectBackup(
    resources: BackupProviderResources,
  ): Promise<RemoteBackupRecord | null> {
    const metadata = resources.manifestFileId
      ? await this.tryMetadata(resources.manifestFileId)
      : await this.findOne('manifest', resources.folderId);
    if (!metadata) return null;
    const response = await this.request(
      `${filesBaseUrl}/${encodeURIComponent(metadata.id)}?alt=media`,
    );
    let manifest: DriveManifest;
    try {
      const manifestBlob = await response.blob();
      if (manifestBlob.size > maximumManifestBytes) {
        throw new Error('Manifest exceeds the safe size limit');
      }
      manifest = driveManifestSchema.parse(
        JSON.parse(await manifestBlob.text()),
      );
    } catch (error) {
      throw new BackupProviderError(
        'The Scranbook backup in Drive is not valid and was not changed.',
        'validation',
        { cause: error },
      );
    }
    return {
      snapshot: fromDriveManifest(manifest),
      manifestFileId: metadata.id,
      version: metadata.version,
      modifiedTime: metadata.modifiedTime || manifest.updatedAt,
    };
  }

  async uploadPhoto(
    photo: StoredPhoto,
    resources: BackupProviderResources,
    existingRemoteFileId?: string,
  ): Promise<UploadedRemotePhoto> {
    const metadata = {
      name: `${photo.id}.jpg`,
      mimeType: photo.mimeType,
      ...(existingRemoteFileId ? {} : { parents: [resources.photoFolderId] }),
      appProperties: {
        scranbookRole: 'photo',
        scranbookPhotoId: photo.id,
      },
    };
    const target = existingRemoteFileId
      ? `${uploadBaseUrl}/${encodeURIComponent(existingRemoteFileId)}?uploadType=resumable`
      : `${uploadBaseUrl}?uploadType=resumable`;
    const initiation = await this.request(target, {
      method: existingRemoteFileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': photo.mimeType,
        'X-Upload-Content-Length': String(photo.byteSize),
      },
      body: JSON.stringify(metadata),
    });
    const sessionUrl = initiation.headers.get('Location');
    if (!sessionUrl) {
      throw new BackupProviderError(
        'Google Drive did not start the photo upload.',
        'transient',
      );
    }
    const uploaded = await this.uploadToSession(sessionUrl, photo);
    const file = driveFileSchema.parse(await uploaded.json());
    return {
      id: photo.id,
      remoteFileId: file.id,
      mimeType: photo.mimeType,
      width: photo.width,
      height: photo.height,
      byteSize: photo.byteSize,
      createdAt: photo.createdAt,
    };
  }

  async commitBackup(
    snapshot: RemoteBackupSnapshot,
    resources: BackupProviderResources,
    expectedVersion: string | null,
  ): Promise<RemoteBackupRecord> {
    if (resources.manifestFileId) {
      const current = await this.metadata(resources.manifestFileId);
      if (!expectedVersion || current.version !== expectedVersion) {
        throw new BackupProviderError(
          'The Drive backup changed on another device.',
          'conflict',
        );
      }
    }
    const manifest = toDriveManifest(snapshot);
    const boundary = `scranbook-${crypto.randomUUID()}`;
    const metadata = {
      name: 'scranbook.json',
      mimeType: 'application/json',
      ...(resources.manifestFileId ? {} : { parents: [resources.folderId] }),
      appProperties: { scranbookRole: 'manifest' },
    };
    const body = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      JSON.stringify(manifest),
      `\r\n--${boundary}--`,
    ].join('');
    const target = resources.manifestFileId
      ? `${uploadBaseUrl}/${encodeURIComponent(resources.manifestFileId)}?uploadType=multipart&fields=id,name,mimeType,version,modifiedTime,webViewLink,parents`
      : `${uploadBaseUrl}?uploadType=multipart&fields=id,name,mimeType,version,modifiedTime,webViewLink,parents`;
    const response = await this.request(target, {
      method: resources.manifestFileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    const file = driveFileSchema.parse(await response.json());
    return {
      snapshot,
      manifestFileId: file.id,
      version: file.version,
      modifiedTime: file.modifiedTime || snapshot.updatedAt,
    };
  }

  async downloadPhoto(reference: RemotePhotoReference): Promise<StoredPhoto> {
    const response = await this.request(
      `${filesBaseUrl}/${encodeURIComponent(reference.remoteFileId)}?alt=media`,
    );
    const blob = await response.blob();
    if (blob.size !== reference.byteSize) {
      throw new BackupProviderError(
        `The Drive photo ${reference.id} is incomplete.`,
        'validation',
      );
    }
    return {
      id: reference.id,
      blob,
      mimeType: reference.mimeType,
      width: reference.width,
      height: reference.height,
      byteSize: reference.byteSize,
      createdAt: reference.createdAt,
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.request(`${filesBaseUrl}/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (error instanceof BackupProviderError && error.code === 'not_found')
        return;
      throw error;
    }
  }

  private async findOne(
    role: 'root' | 'photos' | 'manifest',
    parentId?: string,
  ): Promise<DriveFile | null> {
    const query = [
      'trashed = false',
      `appProperties has { key='scranbookRole' and value='${role}' }`,
      ...(parentId ? [`'${parentId}' in parents`] : []),
    ].join(' and ');
    const parameters = new URLSearchParams({
      q: query,
      spaces: 'drive',
      fields:
        'files(id,name,mimeType,version,modifiedTime,webViewLink,parents)',
      pageSize: '10',
    });
    const response = await this.request(`${filesBaseUrl}?${parameters}`);
    const files = driveFileListSchema.parse(await response.json()).files;
    if (files.length > 1) {
      throw new BackupProviderError(
        `Drive contains more than one Scranbook ${role} resource. Nothing was changed.`,
        'validation',
      );
    }
    return files[0] ?? null;
  }

  private async createFolder(
    name: string,
    role: 'root' | 'photos',
    parentId?: string,
  ): Promise<DriveFile> {
    const response = await this.request(
      `${filesBaseUrl}?fields=id,name,mimeType,version,modifiedTime,webViewLink,parents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: folderMimeType,
          ...(parentId ? { parents: [parentId] } : {}),
          appProperties: { scranbookRole: role },
        }),
      },
    );
    return driveFileSchema.parse(await response.json());
  }

  private async tryMetadata(fileId: string | null): Promise<DriveFile | null> {
    if (!fileId) return null;
    try {
      return await this.metadata(fileId);
    } catch (error) {
      if (error instanceof BackupProviderError && error.code === 'not_found')
        return null;
      throw error;
    }
  }

  private async metadata(fileId: string): Promise<DriveFile> {
    const response = await this.request(
      `${filesBaseUrl}/${encodeURIComponent(fileId)}?fields=id,name,mimeType,version,modifiedTime,webViewLink,parents`,
    );
    return driveFileSchema.parse(await response.json());
  }

  private async uploadToSession(sessionUrl: string, photo: StoredPhoto) {
    let offset = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchResponse(sessionUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': photo.mimeType,
            'Content-Range': `bytes ${offset}-${photo.byteSize - 1}/${photo.byteSize}`,
          },
          body: photo.blob.slice(offset),
        });
      } catch (error) {
        if (
          !(error instanceof BackupProviderError) ||
          error.code !== 'transient'
        )
          throw error;
        response = await this.queryUploadSession(sessionUrl, photo.byteSize);
      }

      if (response.ok) return response;
      if (response.status === 308) {
        offset = this.nextUploadOffset(response);
        if (offset >= photo.byteSize) {
          response = await this.queryUploadSession(sessionUrl, photo.byteSize);
          if (response.ok) return response;
        }
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        response = await this.queryUploadSession(sessionUrl, photo.byteSize);
        if (response.ok) return response;
        if (response.status === 308) {
          offset = this.nextUploadOffset(response);
          continue;
        }
      }
      throw await this.responseError(response);
    }
    throw new BackupProviderError(
      'Google Drive photo upload was interrupted. Backup will retry later.',
      'transient',
    );
  }

  private queryUploadSession(sessionUrl: string, totalBytes: number) {
    return this.fetchResponse(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${totalBytes}` },
    });
  }

  private nextUploadOffset(response: Response) {
    const lastByte = /bytes=0-(\d+)/.exec(
      response.headers.get('Range') ?? '',
    )?.[1];
    return lastByte ? Number(lastByte) + 1 : 0;
  }

  private async fetchResponse(input: string, init: RequestInit = {}) {
    try {
      return await fetch(input, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...init.headers,
        },
      });
    } catch (error) {
      throw new BackupProviderError(
        'Google Drive could not be reached. Backup will retry when the app is online.',
        'transient',
        { cause: error },
      );
    }
  }

  private async responseError(response: Response) {
    let reason: string | undefined;
    try {
      const parsed = googleErrorSchema.safeParse(await response.clone().json());
      reason = parsed.success
        ? parsed.data.error.errors?.[0]?.reason
        : undefined;
    } catch {
      // Response bodies are never included in user-facing errors.
    }
    const code = classifyStatus(response.status, reason);
    return new BackupProviderError(
      safeStatusMessage(response.status, code),
      code,
    );
  }

  private async request(input: string, init: RequestInit = {}) {
    const response = await this.fetchResponse(input, init);
    if (!response.ok) {
      throw await this.responseError(response);
    }
    return response;
  }
}

export function resourcesFromDriveState(
  state: DriveSyncState,
): BackupProviderResources {
  return {
    folderId: state.folderId ?? '',
    photoFolderId: state.photoFolderId ?? '',
    manifestFileId: state.manifestFileId,
    folderUrl: null,
  };
}
