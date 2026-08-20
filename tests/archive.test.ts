import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDiaryArchive,
  importDiaryArchive,
  shareOrDownloadArchive,
} from '@/lib/archive';
import {
  getPhoto,
  listEntries,
  resetDatabaseForTests,
  saveEntry,
} from '@/lib/db';
import { createMealCheckIn } from '@/lib/meal-check-ins';
import {
  createManualNutritionLabelSource,
  scaleNutritionLabel,
} from '@/lib/nutrition-label';
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
    const entry = {
      ...createBlankEntry(),
      title: 'Soup',
      checkIns: [
        createMealCheckIn({
          feeling: 'a_little_off',
          symptoms: ['bloating'],
          severity: 2,
          onset: '1_to_3_hours',
          notes: 'Settled later.',
        }),
      ],
    };
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
    const exportedZip = await JSZip.loadAsync(await archive.arrayBuffer());
    const exportedManifest = JSON.parse(
      await exportedZip.file('manifest.json')!.async('string'),
    ) as { version: number };
    expect(exportedManifest.version).toBe(3);
    await clearTestDatabase();
    const result = await importDiaryArchive(archive);
    expect(result.count).toBe(1);
    expect(result.latestEntryUpdatedAt).toBe(entry.updatedAt);
    expect((await listEntries())[0]?.title).toBe('Soup');
    expect((await listEntries())[0]?.checkIns[0]).toMatchObject({
      feeling: 'a_little_off',
      symptoms: ['bloating'],
    });
    expect((await getPhoto(photo.id))?.byteSize).toBe(9);
  });

  it('round-trips version 2 label provenance and additional nutrients', async () => {
    const entry = createBlankEntry();
    const source = createManualNutritionLabelSource();
    source.productName = 'Vitamin drink';
    source.columns[0]!.nutrients.push({
      id: 'vitamin-c',
      key: 'other',
      printedName: 'Vitamin C',
      amount: 24,
      unit: 'mg',
      qualifier: 'less_than',
      dailyValuePercent: 30,
      confidence: 'high',
    });
    entry.title = source.productName;
    entry.classification = 'packaged_food';
    entry.nutrition = scaleNutritionLabel(source);
    await saveEntry(entry);
    const archive = await createDiaryArchive();
    await clearTestDatabase();
    await importDiaryArchive(archive);
    const restored = (await listEntries())[0];
    expect(restored?.nutrition?.source).toMatchObject({
      kind: 'nutrition_label',
      productName: 'Vitamin drink',
    });
    expect(restored?.nutrition?.additionalValues[0]).toMatchObject({
      printedName: 'Vitamin C',
      amount: 24,
      qualifier: 'less_than',
    });
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

  it('rejects a version 2 archive with invalid label provenance', async () => {
    const entry = createBlankEntry();
    const source = createManualNutritionLabelSource();
    source.columns[0]!.nutrients[0]!.amount = 100;
    entry.classification = 'packaged_food';
    entry.nutrition = scaleNutritionLabel(source);
    const invalidEntry = structuredClone(entry);
    if (invalidEntry.nutrition?.source.kind !== 'nutrition_label') {
      throw new Error('Expected label nutrition');
    }
    invalidEntry.nutrition.source.selectedColumnId = 'missing-column';

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        format: 'scranbook-archive',
        version: 2,
        exportedAt: new Date().toISOString(),
        entries: [invalidEntry],
        photos: [],
      }),
    );

    await expect(
      importDiaryArchive(await zip.generateAsync({ type: 'blob' })),
    ).rejects.toThrow('Select a column that exists');
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

describe('archive delivery', () => {
  const archive = new Blob(['backup'], { type: 'application/zip' });

  it('uses native file sharing when supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const download = vi.fn();
    await expect(
      shareOrDownloadArchive(
        archive,
        'diary.scranbook.zip',
        { canShare: () => true, share },
        download,
      ),
    ).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.any(File)],
        title: 'Scranbook diary backup',
      }),
    );
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to download when sharing is unsupported or fails', async () => {
    const unsupportedDownload = vi.fn();
    await expect(
      shareOrDownloadArchive(
        archive,
        'diary.scranbook.zip',
        { canShare: () => false, share: vi.fn() },
        unsupportedDownload,
      ),
    ).resolves.toBe('downloaded');
    expect(unsupportedDownload).toHaveBeenCalledWith(
      archive,
      'diary.scranbook.zip',
    );

    const failedDownload = vi.fn();
    await expect(
      shareOrDownloadArchive(
        archive,
        'diary.scranbook.zip',
        {
          canShare: () => true,
          share: vi.fn().mockRejectedValue(new Error('share failed')),
        },
        failedDownload,
      ),
    ).resolves.toBe('downloaded');
    expect(failedDownload).toHaveBeenCalledOnce();

    const capabilityFailureDownload = vi.fn();
    await expect(
      shareOrDownloadArchive(
        archive,
        'diary.scranbook.zip',
        {
          canShare: () => {
            throw new Error('capability check failed');
          },
          share: vi.fn(),
        },
        capabilityFailureDownload,
      ),
    ).resolves.toBe('downloaded');
    expect(capabilityFailureDownload).toHaveBeenCalledOnce();
  });

  it('does not download when the user cancels the share sheet', async () => {
    const download = vi.fn();
    await expect(
      shareOrDownloadArchive(
        archive,
        'diary.scranbook.zip',
        {
          canShare: () => true,
          share: vi
            .fn()
            .mockRejectedValue(new DOMException('cancelled', 'AbortError')),
        },
        download,
      ),
    ).resolves.toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });
});
