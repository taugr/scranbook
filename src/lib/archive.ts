import JSZip from 'jszip';
import { getAllPhotos, listEntries, replaceDiary } from './db';
import {
  archiveManifestSchema,
  type ArchiveManifest,
  type StoredPhoto,
} from './schema';

const maximumArchiveBytes = 250 * 1024 * 1024;

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function createDiaryArchive(): Promise<Blob> {
  const [entries, photos] = await Promise.all([listEntries(), getAllPhotos()]);
  const zip = new JSZip();
  const manifest: ArchiveManifest = {
    format: 'scranbook-archive',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
    photos: photos.map((photo) => ({
      id: photo.id,
      mimeType: photo.mimeType,
      width: photo.width,
      height: photo.height,
      byteSize: photo.byteSize,
      createdAt: photo.createdAt,
      file: `photos/${safeFileName(photo.id)}.jpg`,
    })),
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  for (const photo of photos) {
    zip.file(
      `photos/${safeFileName(photo.id)}.jpg`,
      await photo.blob.arrayBuffer(),
    );
  }
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function importDiaryArchive(file: Blob): Promise<number> {
  if (file.size > maximumArchiveBytes)
    throw new Error('Choose a Scranbook archive smaller than 250 MB.');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('This archive has no Scranbook manifest.');
  const manifest = archiveManifestSchema.parse(
    JSON.parse(await manifestFile.async('string')),
  );
  const photos: StoredPhoto[] = [];
  for (const metadata of manifest.photos) {
    if (metadata.file.includes('..') || !metadata.file.startsWith('photos/')) {
      throw new Error('The archive contains an unsafe photo path.');
    }
    const photoFile = zip.file(metadata.file);
    if (!photoFile) throw new Error(`The archive is missing ${metadata.file}.`);
    const blob = await photoFile.async('blob');
    if (blob.size !== metadata.byteSize)
      throw new Error(`The archive photo ${metadata.id} is incomplete.`);
    photos.push({ ...metadata, blob });
  }
  const photoIds = new Set(photos.map((photo) => photo.id));
  if (
    manifest.entries.some(
      (entry) => entry.photoId && !photoIds.has(entry.photoId),
    )
  ) {
    throw new Error('The archive contains an entry with a missing photo.');
  }
  await replaceDiary(manifest.entries, photos);
  return manifest.entries.length;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
