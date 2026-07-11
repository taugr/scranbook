import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCredentials,
  deleteEntry,
  getPhoto,
  listEntries,
  loadModelSettings,
  resetDatabaseForTests,
  saveEntry,
  saveModelSettings,
} from '@/lib/db';
import {
  createBlankEntry,
  defaultModelSettings,
  type StoredPhoto,
} from '@/lib/schema';

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

  it('stores settings and clears only credentials', async () => {
    await saveModelSettings({
      ...defaultModelSettings,
      apiKey: 'secret',
      extraHeaders: { 'X-Test': 'value' },
      privacyAcknowledged: true,
    });
    expect((await loadModelSettings()).apiKey).toBe('secret');
    const cleared = await clearCredentials();
    expect(cleared.apiKey).toBe('');
    expect(cleared.extraHeaders).toEqual({});
    expect(cleared.model).toBe('google/gemma-4-e4b');
  });
});
