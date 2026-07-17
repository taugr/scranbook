import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDiaryArchive, importDiaryArchive } from '@/lib/archive';
import {
  getPhoto,
  listEntries,
  resetDatabaseForTests,
  saveEntry,
} from '@/lib/db';
import { createBlankEntry, type StoredPhoto } from '@/lib/schema';

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

describe('diary archives', () => {
  it('round-trips entries and photos', async () => {
    const entry = { ...createBlankEntry(), title: 'Soup' };
    const photo: StoredPhoto = {
      id: crypto.randomUUID(),
      blob: new Blob(['jpeg-data'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 20,
      height: 10,
      byteSize: 9,
      createdAt: entry.createdAt,
    };
    entry.photoId = photo.id;
    await saveEntry(entry, photo);
    const archive = await createDiaryArchive();
    await clearTestDatabase();
    const result = await importDiaryArchive(archive);
    expect(result.count).toBe(1);
    expect(result.latestEntryUpdatedAt).toBe(entry.updatedAt);
    expect((await listEntries())[0]?.title).toBe('Soup');
    expect((await getPhoto(photo.id))?.byteSize).toBe(9);
  });

  it('imports legacy nutrition fields with current defaults', async () => {
    const entry = createBlankEntry();
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        format: 'scranbook-archive',
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: [
          {
            ...entry,
            ingredients: [
              {
                id: 'rice',
                name: 'rice',
                amount: 100,
                unit: 'g',
                preparation: null,
                confidence: 'medium',
              },
            ],
          },
        ],
        photos: [],
      }),
    );
    await importDiaryArchive(await zip.generateAsync({ type: 'blob' }));
    const ingredient = (await listEntries())[0]?.ingredients[0];
    expect(ingredient?.nutritionExcluded).toBe(false);
    expect(ingredient?.nutritionMatch).toBeNull();
  });

  it('rejects archives with unsafe photo paths', async () => {
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        format: 'scranbook-archive',
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: [],
        photos: [
          {
            id: 'photo',
            mimeType: 'image/jpeg',
            width: 1,
            height: 1,
            byteSize: 1,
            createdAt: new Date().toISOString(),
            file: '../photo.jpg',
          },
        ],
      }),
    );
    zip.file('photo.jpg', 'x');
    await expect(
      importDiaryArchive(await zip.generateAsync({ type: 'blob' })),
    ).rejects.toThrow('unsafe photo path');
  });
});
