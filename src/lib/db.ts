import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import {
  defaultModelSettings,
  mealEntrySchema,
  modelSettingsSchema,
  type MealEntry,
  type ModelSettings,
  type StoredPhoto,
} from './schema';

interface ScranbookDb extends DBSchema {
  entries: {
    key: string;
    value: MealEntry;
    indexes: { 'by-eaten-at': string };
  };
  photos: {
    key: string;
    value: StoredPhoto;
  };
  settings: {
    key: string;
    value: unknown;
  };
  meta: {
    key: string;
    value: unknown;
  };
}

let databasePromise: Promise<IDBPDatabase<ScranbookDb>> | undefined;

function database() {
  databasePromise ??= openDB<ScranbookDb>('scranbook', 1, {
    upgrade(db) {
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('by-eaten-at', 'eatenAt');
      db.createObjectStore('photos', { keyPath: 'id' });
      db.createObjectStore('settings');
      db.createObjectStore('meta');
    },
  });
  return databasePromise;
}

export async function listEntries(): Promise<MealEntry[]> {
  const values = await (
    await database()
  ).getAllFromIndex('entries', 'by-eaten-at');
  return values.map((value) => mealEntrySchema.parse(value)).toReversed();
}

export async function getEntry(id: string): Promise<MealEntry | undefined> {
  const value = await (await database()).get('entries', id);
  return value ? mealEntrySchema.parse(value) : undefined;
}

export async function saveEntry(
  entry: MealEntry,
  photo?: StoredPhoto,
): Promise<void> {
  const parsed = mealEntrySchema.parse(entry);
  const db = await database();
  const transaction = db.transaction(['entries', 'photos'], 'readwrite');
  if (photo) await transaction.objectStore('photos').put(photo);
  await transaction.objectStore('entries').put(parsed);
  await transaction.done;
}

export async function getPhoto(
  id: string | null,
): Promise<StoredPhoto | undefined> {
  return id ? (await database()).get('photos', id) : undefined;
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await database();
  const entry = await db.get('entries', id);
  const transaction = db.transaction(['entries', 'photos'], 'readwrite');
  await transaction.objectStore('entries').delete(id);
  if (entry?.photoId)
    await transaction.objectStore('photos').delete(entry.photoId);
  await transaction.done;
}

export async function clearDiary(): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['entries', 'photos'], 'readwrite');
  await transaction.objectStore('entries').clear();
  await transaction.objectStore('photos').clear();
  await transaction.done;
}

export async function getAllPhotos(): Promise<StoredPhoto[]> {
  return (await database()).getAll('photos');
}

export async function replaceDiary(
  entries: MealEntry[],
  photos: StoredPhoto[],
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['entries', 'photos'], 'readwrite');
  const entryStore = transaction.objectStore('entries');
  const photoStore = transaction.objectStore('photos');
  await entryStore.clear();
  await photoStore.clear();
  for (const entry of entries)
    await entryStore.put(mealEntrySchema.parse(entry));
  for (const photo of photos) await photoStore.put(photo);
  await transaction.done;
}

export async function loadModelSettings(): Promise<ModelSettings> {
  const stored = await (await database()).get('settings', 'model');
  const parsed = modelSettingsSchema.safeParse(stored);
  const settings = parsed.success ? parsed.data : defaultModelSettings;
  if (
    settings.credentialStorage === 'session' &&
    typeof sessionStorage !== 'undefined'
  ) {
    return {
      ...settings,
      apiKey: sessionStorage.getItem('scranbook:api-key') ?? '',
    };
  }
  return settings;
}

export async function saveModelSettings(
  settings: ModelSettings,
): Promise<void> {
  const parsed = modelSettingsSchema.parse(settings);
  if (parsed.credentialStorage === 'session') {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('scranbook:api-key', parsed.apiKey);
    }
    await (
      await database()
    ).put('settings', { ...parsed, apiKey: '' }, 'model');
    return;
  }
  if (typeof sessionStorage !== 'undefined')
    sessionStorage.removeItem('scranbook:api-key');
  await (await database()).put('settings', parsed, 'model');
}

export async function clearCredentials(): Promise<ModelSettings> {
  const settings = {
    ...(await loadModelSettings()),
    apiKey: '',
    extraHeaders: {},
  };
  if (typeof sessionStorage !== 'undefined')
    sessionStorage.removeItem('scranbook:api-key');
  await (await database()).put('settings', settings, 'model');
  return settings;
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  return navigator.storage.persist();
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

export async function resetDatabaseForTests() {
  if (databasePromise) (await databasePromise).close();
  databasePromise = undefined;
}
