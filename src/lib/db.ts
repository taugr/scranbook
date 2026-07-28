import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import {
  backupStateSchema,
  defaultModelSettings,
  diaryRevisionStateSchema,
  driveSyncStateSchema,
  installationStateSchema,
  mealDraftSchema,
  mealEntrySchema,
  modelSettingsSchema,
  type BackupState,
  type DiaryRevisionState,
  type DriveSyncState,
  type InstallationState,
  type MealDraft,
  type MealEntry,
  type ModelSettings,
  type StoredPhoto,
} from './schema';

const activeDraftKey = 'active-draft';
const backupStateKey = 'backup-state';
const diaryRevisionKey = 'diary-revision';
const driveSyncStateKey = 'drive-sync-state';
const installationStateKey = 'installation-state';

const initialDiaryRevision: DiaryRevisionState = {
  version: 1,
  generation: 0,
  changedAt: new Date(0).toISOString(),
};

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
  const transaction = db.transaction(
    ['entries', 'photos', 'meta'],
    'readwrite',
  );
  if (photo) await transaction.objectStore('photos').put(photo);
  await transaction.objectStore('entries').put(parsed);
  const metaStore = transaction.objectStore('meta');
  const currentRevision = diaryRevisionStateSchema.safeParse(
    await metaStore.get(diaryRevisionKey),
  );
  await metaStore.put(
    {
      version: 1,
      generation: currentRevision.success
        ? currentRevision.data.generation + 1
        : 1,
      changedAt: new Date().toISOString(),
    } satisfies DiaryRevisionState,
    diaryRevisionKey,
  );
  await transaction.done;
}

export async function getPhoto(
  id: string | null,
): Promise<StoredPhoto | undefined> {
  return id ? (await database()).get('photos', id) : undefined;
}

export async function deleteEntry(
  id: string,
  clearAssociatedDraft = false,
): Promise<void> {
  const db = await database();
  const entry = await db.get('entries', id);
  const transaction = db.transaction(
    ['entries', 'photos', 'meta'],
    'readwrite',
  );
  await transaction.objectStore('entries').delete(id);
  if (entry?.photoId)
    await transaction.objectStore('photos').delete(entry.photoId);
  if (clearAssociatedDraft)
    await transaction.objectStore('meta').delete(activeDraftKey);
  const metaStore = transaction.objectStore('meta');
  const currentRevision = diaryRevisionStateSchema.safeParse(
    await metaStore.get(diaryRevisionKey),
  );
  await metaStore.put(
    {
      version: 1,
      generation: currentRevision.success
        ? currentRevision.data.generation + 1
        : 1,
      changedAt: new Date().toISOString(),
    } satisfies DiaryRevisionState,
    diaryRevisionKey,
  );
  await transaction.done;
}

export async function clearDiary(): Promise<void> {
  const db = await database();
  const transaction = db.transaction(
    ['entries', 'photos', 'meta'],
    'readwrite',
  );
  await transaction.objectStore('entries').clear();
  await transaction.objectStore('photos').clear();
  await transaction.objectStore('meta').delete(activeDraftKey);
  await transaction.objectStore('meta').delete(backupStateKey);
  const metaStore = transaction.objectStore('meta');
  const currentRevision = diaryRevisionStateSchema.safeParse(
    await metaStore.get(diaryRevisionKey),
  );
  await metaStore.put(
    {
      version: 1,
      generation: currentRevision.success
        ? currentRevision.data.generation + 1
        : 1,
      changedAt: new Date().toISOString(),
    } satisfies DiaryRevisionState,
    diaryRevisionKey,
  );
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
  const transaction = db.transaction(
    ['entries', 'photos', 'meta'],
    'readwrite',
  );
  const entryStore = transaction.objectStore('entries');
  const photoStore = transaction.objectStore('photos');
  await entryStore.clear();
  await photoStore.clear();
  for (const entry of entries)
    await entryStore.put(mealEntrySchema.parse(entry));
  for (const photo of photos) await photoStore.put(photo);
  const metaStore = transaction.objectStore('meta');
  await metaStore.delete(activeDraftKey);
  const currentRevision = diaryRevisionStateSchema.safeParse(
    await metaStore.get(diaryRevisionKey),
  );
  await metaStore.put(
    {
      version: 1,
      generation: currentRevision.success
        ? currentRevision.data.generation + 1
        : 1,
      changedAt: new Date().toISOString(),
    } satisfies DiaryRevisionState,
    diaryRevisionKey,
  );
  await transaction.done;
}

export async function loadDiaryRevision(): Promise<DiaryRevisionState> {
  const stored = await (await database()).get('meta', diaryRevisionKey);
  const parsed = diaryRevisionStateSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  if (stored !== undefined)
    await (await database()).delete('meta', diaryRevisionKey);
  return initialDiaryRevision;
}

export async function loadDriveSyncState(): Promise<DriveSyncState | null> {
  const stored = await (await database()).get('meta', driveSyncStateKey);
  const parsed = driveSyncStateSchema.safeParse(stored);
  if (parsed.success) {
    const installation = await loadOrCreateInstallationState(
      parsed.data.deviceId,
    );
    if (parsed.data.deviceId === installation.deviceId) return parsed.data;
    return saveDriveSyncState({
      ...parsed.data,
      deviceId: installation.deviceId,
    });
  }
  if (stored !== undefined)
    await (await database()).delete('meta', driveSyncStateKey);
  return null;
}

export async function saveDriveSyncState(
  state: DriveSyncState,
): Promise<DriveSyncState> {
  const parsed = driveSyncStateSchema.parse(state);
  await (await database()).put('meta', parsed, driveSyncStateKey);
  return parsed;
}

export async function clearDriveSyncState(): Promise<void> {
  await (await database()).delete('meta', driveSyncStateKey);
}

export async function loadOrCreateInstallationState(
  preferredDeviceId?: string,
): Promise<InstallationState> {
  const db = await database();
  const transaction = db.transaction('meta', 'readwrite');
  const store = transaction.objectStore('meta');
  const stored = installationStateSchema.safeParse(
    await store.get(installationStateKey),
  );
  if (stored.success) {
    await transaction.done;
    return stored.data;
  }
  const state = installationStateSchema.parse({
    version: 1,
    deviceId: preferredDeviceId ?? crypto.randomUUID(),
  });
  await store.put(state, installationStateKey);
  await transaction.done;
  return state;
}

export async function loadActiveDraft(): Promise<MealDraft | null> {
  const stored = await (await database()).get('meta', activeDraftKey);
  const parsed = mealDraftSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  if (stored !== undefined)
    await (await database()).delete('meta', activeDraftKey);
  return null;
}

export async function saveActiveDraft(draft: MealDraft): Promise<MealDraft> {
  const parsed = mealDraftSchema.parse(draft);
  await (await database()).put('meta', parsed, activeDraftKey);
  return parsed;
}

export async function clearActiveDraft(): Promise<void> {
  await (await database()).delete('meta', activeDraftKey);
}

export async function loadBackupState(): Promise<BackupState | null> {
  const stored = await (await database()).get('meta', backupStateKey);
  const parsed = backupStateSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  if (stored !== undefined)
    await (await database()).delete('meta', backupStateKey);
  return null;
}

export async function saveBackupState(
  state: BackupState,
): Promise<BackupState> {
  const parsed = backupStateSchema.parse(state);
  await (await database()).put('meta', parsed, backupStateKey);
  return parsed;
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
