'use client';

import {
  BookOpen,
  Calculator,
  Camera,
  Check,
  ChevronLeft,
  CircleHelp,
  Database,
  Download,
  Globe2,
  ImagePlus,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Utensils,
  WifiOff,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { DiaryControls } from '@/components/diary-controls';
import { NutritionMatchPicker } from '@/components/nutrition-match-picker';
import {
  createDiaryArchive,
  downloadBlob,
  importDiaryArchive,
} from '@/lib/archive';
import {
  backupStateForExport,
  backupStateForImport,
  dismissBackupReminder,
  isBackupReminderDue,
} from '@/lib/backup';
import {
  clearActiveDraft,
  clearCredentials,
  clearDiary,
  deleteEntry,
  getPhoto,
  listEntries,
  loadActiveDraft,
  loadBackupState,
  loadModelSettings,
  requestPersistentStorage,
  saveActiveDraft,
  saveBackupState,
  saveEntry,
  saveModelSettings,
  storageEstimate,
} from '@/lib/db';
import {
  emptyDiaryFilters,
  filterDiaryEntries,
  hasActiveDiaryFilters,
} from '@/lib/diary-search';
import { processImage, rotatePhoto } from '@/lib/image';
import {
  estimateMealNutrition,
  nutritionMatchForCandidate,
  type NutritionCandidate,
} from '@/lib/nutrition';
import {
  analyseMeal,
  discoverModels,
  endpointLocation,
  promptVersion,
  ProviderError,
} from '@/lib/provider';
import {
  createBlankEntry,
  createRepeatedEntry,
  defaultModelSettings,
  modelSettingsSchema,
  type BackupState,
  type Ingredient,
  type MealDraft,
  type MealEntry,
  type ModelSettings,
  type NutritionValues,
  type StoredPhoto,
} from '@/lib/schema';

type Screen = 'diary' | 'add' | 'settings';
type ContentScreen = Exclude<Screen, 'settings'>;
type DiaryView = 'list' | 'detail';

const mealLabels: Record<MealEntry['mealType'], string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  other: 'Other',
};

function dateTimeLocal(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  return new Date(value).toISOString();
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatBytes(value?: number) {
  if (!value) return '0 MB';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

function usePhotoUrl(photoId: string | null, directPhoto?: StoredPhoto | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    async function load() {
      const photo =
        directPhoto ?? (photoId ? await getPhoto(photoId) : undefined);
      if (!photo || !active) return;
      objectUrl = URL.createObjectURL(photo.blob);
      setUrl(objectUrl);
    }
    void load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, directPhoto]);
  return url;
}

function MealPhoto({
  entry,
  className = '',
}: {
  entry: MealEntry;
  className?: string;
}) {
  const url = usePhotoUrl(entry.photoId);
  if (!url) {
    return (
      <div
        className={`meal-photo meal-photo--empty ${className}`}
        aria-hidden="true"
      >
        <Utensils />
      </div>
    );
  }
  return <img className={`meal-photo ${className}`} src={url} alt="" />;
}

function ConfidenceDot({ value }: { value: Ingredient['confidence'] }) {
  return <span className={`confidence confidence--${value}`}>{value}</span>;
}

export function ScranbookApp() {
  const [screen, setScreen] = useState<Screen>('diary');
  const [settingsReturnScreen, setSettingsReturnScreen] =
    useState<ContentScreen>('diary');
  const [diaryView, setDiaryView] = useState<DiaryView>('list');
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState(emptyDiaryFilters);
  const [draft, setDraft] = useState<MealEntry>(() => createBlankEntry());
  const [pendingPhoto, setPendingPhoto] = useState<StoredPhoto | null>(null);
  const [draftMode, setDraftMode] = useState<MealDraft['mode']>('new');
  const [draftSourceEntryId, setDraftSourceEntryId] = useState<string | null>(
    null,
  );
  const [draftReady, setDraftReady] = useState(false);
  const [recoverableDraft, setRecoverableDraft] = useState<MealDraft | null>(
    null,
  );
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [modelSettings, setModelSettings] =
    useState<ModelSettings>(defaultModelSettings);
  const [headerJson, setHeaderJson] = useState('{}');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [backupState, setBackupState] = useState<BackupState | null>(null);
  const [matchPickerIndex, setMatchPickerIndex] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const queuedDraftActionRef = useRef<(() => void) | null>(null);
  const draftGenerationRef = useRef(0);
  const draftSavePromiseRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const pendingUrl = usePhotoUrl(pendingPhoto?.id ?? null, pendingPhoto);

  const refresh = useCallback(async () => {
    const [nextEntries, nextStorage] = await Promise.all([
      listEntries(),
      storageEstimate(),
    ]);
    setEntries(nextEntries);
    setStorage(nextStorage);
    setSelectedId((current) =>
      current && nextEntries.some((entry) => entry.id === current)
        ? current
        : (nextEntries[0]?.id ?? null),
    );
  }, []);

  useEffect(() => {
    async function initialize() {
      try {
        const [settings, savedDraft, savedBackupState] = await Promise.all([
          loadModelSettings(),
          loadActiveDraft(),
          loadBackupState(),
        ]);
        setModelSettings(settings);
        setHeaderJson(JSON.stringify(settings.extraHeaders, null, 2));
        setRecoverableDraft(savedDraft);
        setBackupState(savedBackupState);
        await refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    }
    void initialize();

    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js');
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, [refresh]);

  const persistDraft = useCallback(
    async (
      entry: MealEntry,
      photo: StoredPhoto | null,
      mode = draftMode,
      sourceEntryId = draftSourceEntryId,
    ) => {
      const generation = draftGenerationRef.current;
      const record: MealDraft = {
        format: 'scranbook-draft',
        version: 1,
        mode,
        sourceEntryId,
        entry,
        photo,
        savedAt: new Date().toISOString(),
      };
      setDraftStatus('saving');
      const operation = draftSavePromiseRef.current
        .catch(() => false)
        .then(async () => {
          if (generation !== draftGenerationRef.current) return false;
          const saved = await saveActiveDraft(record);
          if (generation !== draftGenerationRef.current) return false;
          setRecoverableDraft(saved);
          setDraftStatus('saved');
          return true;
        })
        .catch(() => {
          if (generation === draftGenerationRef.current)
            setDraftStatus('error');
          return false;
        });
      draftSavePromiseRef.current = operation;
      return operation;
    },
    [draftMode, draftSourceEntryId],
  );

  useEffect(() => {
    if (!draftReady || screen !== 'add') return;
    setDraftStatus('saving');
    const timer = window.setTimeout(() => {
      void persistDraft(draft, pendingPhoto);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, draftReady, pendingPhoto, persistDraft, screen]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [screen, selectedId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filteredEntries = useMemo(
    () => filterDiaryEntries(entries, filters),
    [entries, filters],
  );
  const filtersActive = hasActiveDiaryFilters(filters);
  const selected = useMemo(
    () =>
      filteredEntries.find((entry) => entry.id === selectedId) ??
      filteredEntries[0] ??
      null,
    [filteredEntries, selectedId],
  );
  const backupDue = useMemo(
    () => isBackupReminderDue(entries, backupState),
    [backupState, entries],
  );

  function resetMessages() {
    setError(null);
    setNotice(null);
  }

  function beginDraft(
    entry: MealEntry,
    photo: StoredPhoto | null,
    mode: MealDraft['mode'],
    sourceEntryId: string | null,
  ) {
    resetMessages();
    setDraft(entry);
    setPendingPhoto(photo);
    setDraftMode(mode);
    setDraftSourceEntryId(sourceEntryId);
    setDraftReady(true);
    setDraftStatus('idle');
    setScreen('add');
    setDraftPromptOpen(false);
  }

  function requestDraftAction(action: () => void) {
    if (recoverableDraft) {
      queuedDraftActionRef.current = action;
      setDraftPromptOpen(true);
      return;
    }
    action();
  }

  function startAdd() {
    if (screen === 'add' && draftReady) return;
    requestDraftAction(() => beginDraft(createBlankEntry(), null, 'new', null));
  }

  function continueDraft() {
    if (!recoverableDraft) return;
    queuedDraftActionRef.current = null;
    beginDraft(
      recoverableDraft.entry,
      recoverableDraft.photo,
      recoverableDraft.mode,
      recoverableDraft.sourceEntryId,
    );
  }

  async function clearDraftState() {
    setDraftReady(false);
    draftGenerationRef.current += 1;
    await draftSavePromiseRef.current.catch(() => undefined);
    await clearActiveDraft();
    setRecoverableDraft(null);
    setDraftStatus('idle');
  }

  async function discardDraft(runQueuedAction = false) {
    await clearDraftState();
    setDraftPromptOpen(false);
    if (screen === 'add') {
      setScreen('diary');
      setDiaryView('list');
    }
    const action = queuedDraftActionRef.current;
    queuedDraftActionRef.current = null;
    if (runQueuedAction) action?.();
  }

  async function leaveEditor() {
    if (draftReady) {
      const saved = await persistDraft(draft, pendingPhoto);
      if (!saved) {
        setError(
          'The latest draft changes could not be saved. Save the meal or try again before leaving.',
        );
        return;
      }
    }
    setScreen('diary');
    setDiaryView(entries.length > 0 ? 'detail' : 'list');
  }

  function openSettings() {
    if (screen === 'add' && draftReady) void persistDraft(draft, pendingPhoto);
    if (screen !== 'settings') setSettingsReturnScreen(screen);
    setScreen('settings');
  }

  function startEdit(entry: MealEntry) {
    requestDraftAction(() => {
      void getPhoto(entry.photoId).then((photo) =>
        beginDraft(entry, photo ?? null, 'edit', entry.id),
      );
    });
  }

  function startRepeat(entry: MealEntry) {
    requestDraftAction(() =>
      beginDraft(createRepeatedEntry(entry), null, 'repeat', entry.id),
    );
  }

  async function choosePhoto(file?: File) {
    if (!file) return;
    resetMessages();
    setBusy('Preparing your photo…');
    try {
      const photo = await processImage(file, {
        maxDimension: modelSettings.maxImageDimension,
        quality: modelSettings.imageQuality,
      });
      setPendingPhoto(photo);
      const nextDraft = {
        ...draft,
        photoId: photo.id,
        capturedAt: new Date().toISOString(),
      };
      setDraft(nextDraft);
      await persistDraft(nextDraft, photo);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function rotatePendingPhoto() {
    if (!pendingPhoto) return;
    setBusy('Turning your photo…');
    try {
      const photo = await rotatePhoto(pendingPhoto);
      setPendingPhoto(photo);
      await persistDraft(draft, photo);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function removePendingPhoto() {
    const nextDraft = { ...draft, photoId: null };
    setPendingPhoto(null);
    setDraft(nextDraft);
    await persistDraft(nextDraft, null);
  }

  async function updatePrivacyAcknowledgement(checked: boolean) {
    const next = { ...modelSettings, privacyAcknowledged: checked };
    setModelSettings(next);
    await saveModelSettings(next);
  }

  async function analyse() {
    resetMessages();
    if (!pendingPhoto) {
      setError('Take or choose a photo before asking the model to analyse it.');
      return;
    }
    if (!modelSettings.privacyAcknowledged) {
      setError(
        'Please confirm that you understand where the photo will be sent.',
      );
      return;
    }
    abortRef.current = new AbortController();
    setBusy('Looking carefully at your meal…');
    try {
      const result = await analyseMeal(
        pendingPhoto,
        modelSettings,
        abortRef.current.signal,
      );
      const analysedIngredients: Ingredient[] = result.ingredients.map(
        (ingredient) => ({
          ...ingredient,
          id: ingredient.id ?? crypto.randomUUID(),
          nutritionMatch: null,
          nutritionExcluded: false,
        }),
      );
      let nutritionEstimate:
        | Awaited<ReturnType<typeof estimateMealNutrition>>
        | undefined;
      if (result.classification === 'meal') {
        try {
          setBusy('Matching ingredients to local nutrition data…');
          nutritionEstimate = await estimateMealNutrition(analysedIngredients);
        } catch {
          // The model result remains useful if the bundled index cannot load.
        }
      }
      const now = new Date().toISOString();
      const nextDraft: MealEntry = {
        ...draft,
        title: result.dishName,
        classification: result.classification,
        servings: result.servings,
        portionSummary: result.portionSummary,
        ingredients: nutritionEstimate?.ingredients ?? analysedIngredients,
        nutrition: nutritionEstimate?.nutrition ?? null,
        notes:
          result.uncertaintyNotes.length > 0
            ? `${draft.notes}${draft.notes ? '\n\n' : ''}Model notes: ${result.uncertaintyNotes.join(' • ')}`
            : draft.notes,
        analysis: {
          model: modelSettings.model,
          endpointOrigin: new URL(modelSettings.baseUrl).origin,
          promptVersion,
          analysedAt: now,
          confidence: result.overallConfidence,
        },
      };
      setDraft(nextDraft);
      await persistDraft(nextDraft, pendingPhoto);
      setNotice(
        nutritionEstimate
          ? 'The model made a first pass and nutrition was calculated locally. Check every estimate before saving.'
          : 'The model made a first pass. Check every estimate before saving.',
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function saveDraft() {
    resetMessages();
    const now = new Date().toISOString();
    const entry = {
      ...draft,
      title: draft.title.trim() || 'Untitled meal',
      updatedAt: now,
    };
    setBusy('Saving to this device…');
    try {
      await saveEntry(entry, pendingPhoto ?? undefined);
      if (entries.length === 0) void requestPersistentStorage();
      setDraftReady(false);
      draftGenerationRef.current += 1;
      await draftSavePromiseRef.current.catch(() => undefined);
      await clearActiveDraft();
      setRecoverableDraft(null);
      setDraftStatus('idle');
      await refresh();
      setSelectedId(entry.id);
      setScreen('diary');
      setDiaryView('detail');
      setNotice('Saved on this device.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function removeEntry(entry: MealEntry) {
    const hasAssociatedEditDraft =
      recoverableDraft?.mode === 'edit' &&
      recoverableDraft.sourceEntryId === entry.id;
    if (
      !window.confirm(
        `Delete “${entry.title}” and its photo from this device?${hasAssociatedEditDraft ? ' This will also discard its unfinished edit.' : ''}`,
      )
    )
      return;
    try {
      if (hasAssociatedEditDraft) {
        setDraftReady(false);
        draftGenerationRef.current += 1;
        await draftSavePromiseRef.current.catch(() => undefined);
      }
      await deleteEntry(entry.id, hasAssociatedEditDraft);
      if (hasAssociatedEditDraft) {
        setRecoverableDraft(null);
        setDraftStatus('idle');
      }
      setSelectedId(null);
      await refresh();
      setNotice('Meal deleted from this device.');
    } catch (caught) {
      setError(`Could not delete the meal: ${errorMessage(caught)}`);
    }
  }

  function updateIngredient(index: number, patch: Partial<Ingredient>) {
    const identityChanged = 'name' in patch || 'preparation' in patch;
    setDraft((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, candidate) =>
        candidate === index
          ? {
              ...ingredient,
              ...patch,
              nutritionMatch: identityChanged
                ? null
                : ingredient.nutritionMatch,
              nutritionExcluded: identityChanged
                ? false
                : ingredient.nutritionExcluded,
            }
          : ingredient,
      ),
      nutrition: current.nutrition
        ? { ...current.nutrition, stale: true }
        : null,
    }));
  }

  function removeIngredient(index: number) {
    setDraft((current) => ({
      ...current,
      ingredients: current.ingredients.filter(
        (_, candidate) => candidate !== index,
      ),
      nutrition: current.nutrition
        ? { ...current.nutrition, stale: true }
        : null,
    }));
  }

  function addIngredient() {
    setDraft((current) => ({
      ...current,
      ingredients: [
        ...current.ingredients,
        {
          id: crypto.randomUUID(),
          name: '',
          amount: null,
          unit: null,
          preparation: null,
          confidence: 'medium',
          estimatedGrams: null,
          nutritionMatch: null,
          nutritionExcluded: false,
        },
      ],
      nutrition: current.nutrition
        ? { ...current.nutrition, stale: true }
        : null,
    }));
  }

  async function calculateDraftNutrition() {
    resetMessages();
    if (draft.ingredients.length === 0) {
      setError('Add at least one ingredient before estimating nutrition.');
      return;
    }
    if (draft.classification !== 'meal') {
      setError(
        'Nutrition is only calculated for a consumed meal. Change the image kind to Meal and enter the amounts you ate first.',
      );
      return;
    }
    setBusy('Calculating nutrition on this device…');
    try {
      const estimate = await estimateMealNutrition(draft.ingredients);
      const nextDraft = {
        ...draft,
        ingredients: estimate.ingredients,
        nutrition: estimate.nutrition,
      };
      setDraft(nextDraft);
      await persistDraft(nextDraft, pendingPhoto);
      setNotice(
        `Matched ${estimate.nutrition.matchedIngredientCount} of ${estimate.nutrition.ingredientCount} ingredients to the local database.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function applyNutritionChoice(
    index: number,
    choice: NutritionCandidate | 'automatic' | 'excluded',
  ) {
    const ingredients = draft.ingredients.map((ingredient, candidate) => {
      if (candidate !== index) return ingredient;
      if (choice === 'excluded')
        return {
          ...ingredient,
          nutritionMatch: null,
          nutritionExcluded: true,
        };
      if (choice === 'automatic')
        return {
          ...ingredient,
          nutritionMatch: null,
          nutritionExcluded: false,
        };
      return {
        ...ingredient,
        nutritionMatch: nutritionMatchForCandidate(choice, 'user'),
        nutritionExcluded: false,
      };
    });
    setBusy('Recalculating nutrition on this device…');
    try {
      const estimate = await estimateMealNutrition(ingredients);
      const nextDraft = {
        ...draft,
        ingredients: estimate.ingredients,
        nutrition: estimate.nutrition,
      };
      setDraft(nextDraft);
      await persistDraft(nextDraft, pendingPhoto);
      setNotice('Nutrition match updated and totals recalculated.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const closeMatchPicker = useCallback(() => {
    const index = matchPickerIndex;
    setMatchPickerIndex(null);
    if (index !== null)
      window.requestAnimationFrame(() =>
        document.getElementById(`review-match-${index}`)?.focus(),
      );
  }, [matchPickerIndex]);

  function updateNutrition(patch: Partial<NutritionValues>) {
    setDraft((current) =>
      current.nutrition
        ? {
            ...current,
            nutrition: {
              ...current.nutrition,
              values: { ...current.nutrition.values, ...patch },
              edited: true,
            },
          }
        : current,
    );
  }

  async function saveSettings() {
    resetMessages();
    try {
      const parsedHeaders = JSON.parse(headerJson) as unknown;
      const parsed = modelSettingsSchema.parse({
        ...modelSettings,
        extraHeaders: parsedHeaders,
      });
      await saveModelSettings(parsed);
      setModelSettings(parsed);
      setNotice('Model settings saved on this device.');
    } catch (caught) {
      setError(`Could not save settings: ${errorMessage(caught)}`);
    }
  }

  function updateModelSettings(settings: ModelSettings) {
    const connectionChanged =
      settings.baseUrl !== modelSettings.baseUrl ||
      settings.model !== modelSettings.model ||
      settings.apiKey !== modelSettings.apiKey ||
      settings.responseMode !== modelSettings.responseMode;
    setModelSettings(settings);
    if (connectionChanged) {
      setConnectionStatus(null);
      setAvailableModels([]);
    }
  }

  function updateHeaderSettings(value: string) {
    setHeaderJson(value);
    setConnectionStatus(null);
    setAvailableModels([]);
  }

  async function testConnection() {
    resetMessages();
    setConnectionStatus('Checking the endpoint…');
    setAvailableModels([]);
    try {
      const parsedHeaders = JSON.parse(headerJson) as Record<string, string>;
      const settings = modelSettingsSchema.parse({
        ...modelSettings,
        extraHeaders: parsedHeaders,
      });
      const models = await discoverModels(settings);
      setAvailableModels(models);
      if (models.includes(settings.model)) {
        setConnectionStatus(
          `Connected. ${settings.model} is available; ${models.length} model${models.length === 1 ? '' : 's'} reported.`,
        );
      } else if (models.length > 0) {
        setConnectionStatus(
          `Connected. Choose one of the ${models.length} models reported by this endpoint.`,
        );
      } else {
        setConnectionStatus(
          'Connected, but this endpoint did not report any models.',
        );
      }
    } catch (caught) {
      setConnectionStatus(null);
      setError(errorMessage(caught));
    }
  }

  async function exportDiary() {
    resetMessages();
    setBusy('Packing your diary…');
    try {
      const blob = await createDiaryArchive();
      downloadBlob(
        blob,
        `scranbook-${new Date().toISOString().slice(0, 10)}.scranbook.zip`,
      );
      const state = backupStateForExport(entries);
      await saveBackupState(state);
      setBackupState(state);
      setNotice('Diary archive created. Model credentials were not included.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function importDiary(file?: File) {
    if (!file) return;
    resetMessages();
    if (
      !window.confirm(
        `Importing replaces the diary currently stored in this browser${recoverableDraft ? ' and discards the active draft' : ''}. Continue?`,
      )
    )
      return;
    setBusy('Checking and restoring your archive…');
    try {
      const result = await importDiaryArchive(file);
      const state = backupStateForImport(result);
      await saveBackupState(state);
      setBackupState(state);
      setRecoverableDraft(null);
      setDraftReady(false);
      await refresh();
      setDiaryView('list');
      setNotice(
        `Restored ${result.count} meal${result.count === 1 ? '' : 's'}.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function removeAllDiaryData() {
    if (
      !window.confirm(
        `Permanently delete every Scranbook entry and photo on this device${recoverableDraft ? ', including the active draft' : ''}?`,
      )
    )
      return;
    await clearDiary();
    setSelectedId(null);
    setRecoverableDraft(null);
    setDraftReady(false);
    setBackupState(null);
    setDiaryView('list');
    await refresh();
    setNotice('All diary entries and photos were deleted.');
  }

  async function removeCredentials() {
    const settings = await clearCredentials();
    setModelSettings(settings);
    setHeaderJson('{}');
    setNotice('Model credentials cleared.');
  }

  function applyLmStudioPreset() {
    setModelSettings((current) => ({
      ...current,
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'google/gemma-4-e4b',
      apiKey: '',
      extraHeaders: {},
      responseMode: 'json_schema',
      privacyAcknowledged: false,
    }));
    setHeaderJson('{}');
    setConnectionStatus(null);
    setAvailableModels([]);
  }

  function selectAvailableModel(model: string) {
    setModelSettings((current) => ({ ...current, model }));
    setConnectionStatus(
      `Selected ${model}. Save settings to keep this choice.`,
    );
  }

  async function dismissBackup() {
    const state = dismissBackupReminder(backupState);
    await saveBackupState(state);
    setBackupState(state);
  }

  function selectEntry(entry: MealEntry) {
    setSelectedId(entry.id);
    setScreen('diary');
    setDiaryView('detail');
  }

  if (loading) {
    return (
      <main className="loading-page">
        <BrandMark />
        <p>Opening your scranbook…</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="wordmark"
          onClick={() => {
            setScreen('diary');
            setDiaryView('list');
          }}
          aria-label="Open diary"
        >
          <BrandMark />
          <span>
            <strong>scranbook</strong>
            <small>your kitchen notebook</small>
          </span>
        </button>
        {!online && (
          <span className="offline-pill">
            <WifiOff /> Offline
          </span>
        )}
        {entries.length > 0 && (
          <button
            className="desktop-add button button--primary"
            onClick={startAdd}
          >
            <Camera /> Add a meal
          </button>
        )}
      </header>

      {(error || notice) && (
        <div
          className={`toast ${error ? 'toast--error' : 'toast--success'}`}
          role="status"
        >
          <span>{error ?? notice}</span>
          <button
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
            aria-label="Dismiss message"
          >
            <X />
          </button>
        </div>
      )}

      <div className="workspace">
        <aside className="diary-rail">
          <div className="rail-heading">
            <div>
              <p className="eyebrow">The recent pages</p>
              <h2>Your diary</h2>
            </div>
          </div>
          {entries.length > 0 && (
            <DiaryControls
              filters={filters}
              resultCount={filteredEntries.length}
              totalCount={entries.length}
              onChange={setFilters}
            />
          )}
          {recoverableDraft && (
            <DraftCard
              draft={recoverableDraft}
              onContinue={continueDraft}
              onDiscard={() => void discardDraft()}
            />
          )}
          {entries.length === 0 ? (
            <div className="rail-empty">
              <span>Nothing tucked in yet.</span>
            </div>
          ) : filteredEntries.length > 0 ? (
            <div className="rail-list">
              {filteredEntries.map((entry) => (
                <button
                  key={entry.id}
                  className={`rail-entry ${selected?.id === entry.id ? 'rail-entry--selected' : ''}`}
                  onClick={() => selectEntry(entry)}
                >
                  <MealPhoto entry={entry} />
                  <span>
                    <small>
                      {formatTime(entry.eatenAt)} · {mealLabels[entry.mealType]}
                    </small>
                    <strong>{entry.title}</strong>
                    <em>{entry.portionSummary || 'A saved meal'}</em>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <NoDiaryResults onClear={() => setFilters(emptyDiaryFilters)} />
          )}
          <button className="rail-settings" onClick={openSettings}>
            <Settings /> Settings & privacy
          </button>
        </aside>

        <main className="main-stage">
          {screen === 'diary' &&
            entries.length === 0 &&
            (recoverableDraft ? (
              <DraftRecoveryPage
                draft={recoverableDraft}
                onContinue={continueDraft}
                onDiscard={() => void discardDraft()}
              />
            ) : (
              <EmptyDiary onAdd={startAdd} />
            ))}
          {screen === 'diary' && entries.length > 0 && (
            <>
              <section
                className={`mobile-diary-index ${diaryView === 'detail' ? 'mobile-hidden' : ''}`}
                aria-label="Your diary"
              >
                <div className="mobile-diary-heading">
                  <p className="eyebrow">The recent pages</p>
                  <h1>Your diary</h1>
                </div>
                <DiaryControls
                  filters={filters}
                  resultCount={filteredEntries.length}
                  totalCount={entries.length}
                  onChange={setFilters}
                />
                {recoverableDraft && (
                  <DraftCard
                    draft={recoverableDraft}
                    onContinue={continueDraft}
                    onDiscard={() => void discardDraft()}
                  />
                )}
                {backupDue && (
                  <BackupReminder
                    onExport={() => void exportDiary()}
                    onDismiss={() => void dismissBackup()}
                  />
                )}
                {filteredEntries.length > 0 ? (
                  <div className="mobile-entry-list">
                    {filteredEntries.map((entry) => (
                      <button
                        key={entry.id}
                        className="mobile-entry"
                        onClick={() => selectEntry(entry)}
                      >
                        <MealPhoto entry={entry} />
                        <span>
                          <small>
                            {formatDate(entry.eatenAt)} ·{' '}
                            {formatTime(entry.eatenAt)}
                          </small>
                          <strong>{entry.title}</strong>
                          <em>{entry.portionSummary || 'A saved meal'}</em>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <NoDiaryResults
                    onClear={() => setFilters(emptyDiaryFilters)}
                  />
                )}
              </section>
              <div
                className={`diary-detail-shell ${diaryView === 'list' ? 'mobile-hidden' : ''}`}
              >
                {selected ? (
                  <EntryDetail
                    entry={selected}
                    onBack={() => setDiaryView('list')}
                    onEdit={() => startEdit(selected)}
                    onRepeat={() => startRepeat(selected)}
                    onDelete={() => void removeEntry(selected)}
                  />
                ) : filtersActive ? (
                  <NoDiaryResults
                    onClear={() => setFilters(emptyDiaryFilters)}
                  />
                ) : null}
              </div>
            </>
          )}
          {screen === 'add' && (
            <MealEditor
              draft={draft}
              photoUrl={pendingUrl}
              busy={busy}
              draftStatus={draftStatus}
              settings={modelSettings}
              onBack={() => void leaveEditor()}
              onFile={(file) => void choosePhoto(file)}
              onRotate={() => void rotatePendingPhoto()}
              onRemovePhoto={() => void removePendingPhoto()}
              onAnalyse={() => void analyse()}
              onCancelAnalyse={() => abortRef.current?.abort()}
              onPrivacyChange={(checked) =>
                void updatePrivacyAcknowledgement(checked)
              }
              onDraftChange={setDraft}
              onIngredientChange={updateIngredient}
              onIngredientRemove={removeIngredient}
              onIngredientAdd={addIngredient}
              onCalculateNutrition={() => void calculateDraftNutrition()}
              onReviewNutritionMatch={setMatchPickerIndex}
              onNutritionChange={updateNutrition}
              onSave={() => void saveDraft()}
              onOpenSettings={openSettings}
            />
          )}
          {screen === 'settings' && (
            <SettingsPanel
              settings={modelSettings}
              headerJson={headerJson}
              storage={storage}
              entryCount={entries.length}
              connectionStatus={connectionStatus}
              availableModels={availableModels}
              backupState={backupState}
              backupDue={backupDue}
              returnScreen={settingsReturnScreen}
              onClose={() => setScreen(settingsReturnScreen)}
              onSettingsChange={updateModelSettings}
              onHeaderJsonChange={updateHeaderSettings}
              onSave={() => void saveSettings()}
              onTest={() => void testConnection()}
              onLmStudioPreset={applyLmStudioPreset}
              onAvailableModelChange={selectAvailableModel}
              onExport={() => void exportDiary()}
              onImport={(file) => void importDiary(file)}
              importRef={importRef}
              onClearDiary={() => void removeAllDiaryData()}
              onClearCredentials={() => void removeCredentials()}
              onDismissBackup={() => void dismissBackup()}
            />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <button
          className={screen === 'diary' ? 'active' : ''}
          onClick={() => {
            setScreen('diary');
            setDiaryView('list');
          }}
        >
          <BookOpen />
          <span>Diary</span>
        </button>
        <button className="mobile-add" onClick={startAdd}>
          <Camera />
          <span>Add</span>
        </button>
        <button
          className={screen === 'settings' ? 'active' : ''}
          onClick={openSettings}
        >
          <Settings />
          <span>Settings</span>
        </button>
      </nav>

      {busy && (
        <div className="busy-overlay" aria-live="polite">
          <LoaderCircle className="spin" />
          <span>{busy}</span>
        </div>
      )}
      {draftPromptOpen && recoverableDraft && (
        <DraftPrompt
          draft={recoverableDraft}
          onContinue={continueDraft}
          onDiscard={() => void discardDraft(true)}
          onClose={() => {
            queuedDraftActionRef.current = null;
            setDraftPromptOpen(false);
          }}
        />
      )}
      {matchPickerIndex !== null && draft.ingredients[matchPickerIndex] && (
        <NutritionMatchPicker
          ingredient={draft.ingredients[matchPickerIndex]}
          onChoose={(candidate) => {
            void applyNutritionChoice(matchPickerIndex, candidate).then(
              closeMatchPicker,
            );
          }}
          onExclude={() => {
            void applyNutritionChoice(matchPickerIndex, 'excluded').then(
              closeMatchPicker,
            );
          }}
          onAutomatic={() => {
            void applyNutritionChoice(matchPickerIndex, 'automatic').then(
              closeMatchPicker,
            );
          }}
          onClose={closeMatchPicker}
        />
      )}
    </div>
  );
}

function DraftCard({
  draft,
  onContinue,
  onDiscard,
}: {
  draft: MealDraft;
  onContinue: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="draft-card" aria-label="Saved meal draft">
      <p className="eyebrow">Saved on this device</p>
      <strong>{draft.entry.title || 'Untitled meal draft'}</strong>
      <small>
        {draft.mode === 'edit'
          ? 'Editing a saved meal'
          : draft.mode === 'repeat'
            ? 'Logging a meal again'
            : 'New meal'}{' '}
        · {formatTime(draft.savedAt)}
      </small>
      <div>
        <button className="button button--primary" onClick={onContinue}>
          Continue draft
        </button>
        <button className="text-button" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </section>
  );
}

function DraftPrompt({
  draft,
  onContinue,
  onDiscard,
  onClose,
}: {
  draft: MealDraft;
  onContinue: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="draft-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-prompt-heading"
      >
        <button
          ref={closeRef}
          className="dialog-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </button>
        <p className="eyebrow">One page is still open</p>
        <h2 id="draft-prompt-heading">
          Continue {draft.entry.title || 'your meal draft'}?
        </h2>
        <p>
          Scranbook kept this unfinished meal on this device. Continue it, or
          discard it before starting something else.
        </p>
        <div>
          <button className="button button--primary" onClick={onContinue}>
            Continue draft
          </button>
          <button className="button button--danger" onClick={onDiscard}>
            Discard and continue
          </button>
        </div>
      </section>
    </div>
  );
}

function BackupReminder({
  onExport,
  onDismiss,
}: {
  onExport: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="backup-reminder">
      <Download />
      <div>
        <strong>Keep a copy of your diary</strong>
        <p>
          Scranbook has no server backup. Create an archive you can keep
          somewhere safe.
        </p>
        <div>
          <button className="button button--quiet" onClick={onExport}>
            Create archive
          </button>
          <button className="text-button" onClick={onDismiss}>
            Remind me later
          </button>
        </div>
      </div>
    </section>
  );
}

function NoDiaryResults({ onClear }: { onClear: () => void }) {
  return (
    <section className="no-diary-results">
      <Search />
      <strong>No pages matched</strong>
      <p>Try a different word, date, meal, or image kind.</p>
      <button className="text-button" onClick={onClear}>
        Clear filters
      </button>
    </section>
  );
}

function DraftRecoveryPage({
  draft,
  onContinue,
  onDiscard,
}: {
  draft: MealDraft;
  onContinue: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="draft-recovery-page">
      <p className="eyebrow">Kept safe on this device</p>
      <h1>Continue where you left off.</h1>
      <p>Your unfinished meal is ready whenever you are.</p>
      <DraftCard draft={draft} onContinue={onContinue} onDiscard={onDiscard} />
    </section>
  );
}

function EmptyDiary({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="empty-diary">
      <div className="empty-illustration" aria-hidden="true">
        <span>✦</span>
        <Utensils />
        <i />
      </div>
      <p className="eyebrow">A fresh page</p>
      <h1>Remember the meals that made your day.</h1>
      <p>
        Photograph a plate, check the model’s best guess, or jot it down
        yourself. Everything stays in this browser.
      </p>
      <button className="button button--primary button--large" onClick={onAdd}>
        <Camera /> Add your first meal
      </button>
      <div className="privacy-note">
        <LockKeyhole />
        <span>
          <strong>Private by design.</strong> Scranbook has no account and no
          diary server.
        </span>
      </div>
    </section>
  );
}

function EntryDetail({
  entry,
  onBack,
  onEdit,
  onRepeat,
  onDelete,
}: {
  entry: MealEntry;
  onBack: () => void;
  onEdit: () => void;
  onRepeat: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="entry-detail">
      <button className="entry-mobile-back" onClick={onBack}>
        <ChevronLeft /> Diary
      </button>
      <div className="entry-hero">
        <MealPhoto entry={entry} />
        <div className="entry-date">
          <span>{formatTime(entry.eatenAt)}</span>
          <strong>{formatDate(entry.eatenAt)}</strong>
        </div>
      </div>
      <div className="entry-content">
        <div className="entry-title-row">
          <div>
            <p className="eyebrow">
              {mealLabels[entry.mealType]} ·{' '}
              {entry.classification.replace('_', ' ')}
            </p>
            <h1>{entry.title}</h1>
          </div>
          <button className="button button--quiet" onClick={onEdit}>
            <Pencil /> Edit
          </button>
        </div>
        {entry.portionSummary && (
          <p className="portion-lead">{entry.portionSummary}</p>
        )}
        {entry.nutrition && <NutritionSummary nutrition={entry.nutrition} />}
        <section className="ingredient-card">
          <div className="section-heading">
            <h2>On the plate</h2>
            {entry.analysis && (
              <span className="ai-label">
                <Sparkles /> Model estimate · {entry.analysis.confidence}
              </span>
            )}
          </div>
          {entry.ingredients.length > 0 ? (
            <ul className="ingredient-list">
              {entry.ingredients.map((ingredient) => (
                <li key={ingredient.id}>
                  <span>
                    <strong>{ingredient.name}</strong>
                    {ingredient.preparation && (
                      <small>{ingredient.preparation}</small>
                    )}
                    {ingredient.nutritionMatch && (
                      <small>
                        {ingredient.nutritionMatch.selectedBy === 'user'
                          ? 'Chosen by you'
                          : 'Matched'}{' '}
                        · {ingredient.nutritionMatch.foodName}
                      </small>
                    )}
                    {ingredient.nutritionExcluded && (
                      <small>Excluded from nutrition by you</small>
                    )}
                  </span>
                  <span className="ingredient-amount">
                    {ingredient.estimatedGrams !== null
                      ? `${ingredient.estimatedGrams} g`
                      : `${ingredient.amount ?? '—'} ${ingredient.unit ?? ''}`}
                    <ConfidenceDot value={ingredient.confidence} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No ingredients recorded. Edit this page whenever you remember
              more.
            </p>
          )}
        </section>
        {entry.notes && (
          <section className="notes-card">
            <p className="eyebrow">Kitchen notes</p>
            <p>{entry.notes}</p>
          </section>
        )}
        <div className="entry-actions">
          <button className="button button--quiet" onClick={onRepeat}>
            <RefreshCw /> Log again
          </button>
          <button className="button button--danger" onClick={onDelete}>
            <Trash2 /> Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function nutrientValue(value: number | null, suffix: string) {
  return value === null ? '—' : `${value.toLocaleString()}${suffix}`;
}

function NutritionSummary({
  nutrition,
}: {
  nutrition: NonNullable<MealEntry['nutrition']>;
}) {
  const { values } = nutrition;
  return (
    <section className="nutrition-card" aria-labelledby="nutrition-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Local food data</p>
          <h2 id="nutrition-heading">Estimated nutrition</h2>
        </div>
      </div>
      <div className="nutrition-facts">
        <div className="nutrition-energy">
          <strong>{nutrientValue(values.energyKcal, '')}</strong>
          <span>kcal</span>
        </div>
        <dl>
          <div>
            <dt>Protein</dt>
            <dd>{nutrientValue(values.proteinG, ' g')}</dd>
          </div>
          <div>
            <dt>Carbs</dt>
            <dd>{nutrientValue(values.carbsG, ' g')}</dd>
          </div>
          <div>
            <dt>Fat</dt>
            <dd>{nutrientValue(values.fatG, ' g')}</dd>
          </div>
          <div>
            <dt>Fibre</dt>
            <dd>{nutrientValue(values.fibreG, ' g')}</dd>
          </div>
          <div>
            <dt>Salt</dt>
            <dd>{nutrientValue(values.saltG, ' g')}</dd>
          </div>
        </dl>
      </div>
      <p className="nutrition-disclaimer">
        Based on {nutrition.matchedIngredientCount} of{' '}
        {nutrition.ingredientCount} ingredient matches from bundled USDA and UK
        food-composition data. This is a rough estimate, not medical guidance.
      </p>
      {nutrition.notes.length > 0 && (
        <details className="nutrition-notes">
          <summary>{nutrition.notes.length} estimate notes</summary>
          <ul>
            {nutrition.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function MealEditor({
  draft,
  photoUrl,
  busy,
  draftStatus,
  settings,
  onBack,
  onFile,
  onRotate,
  onRemovePhoto,
  onAnalyse,
  onCancelAnalyse,
  onPrivacyChange,
  onDraftChange,
  onIngredientChange,
  onIngredientRemove,
  onIngredientAdd,
  onCalculateNutrition,
  onReviewNutritionMatch,
  onNutritionChange,
  onSave,
  onOpenSettings,
}: {
  draft: MealEntry;
  photoUrl: string | null;
  busy: string | null;
  draftStatus: 'idle' | 'saving' | 'saved' | 'error';
  settings: ModelSettings;
  onBack: () => void;
  onFile: (file?: File) => void;
  onRotate: () => void;
  onRemovePhoto: () => void;
  onAnalyse: () => void;
  onCancelAnalyse: () => void;
  onPrivacyChange: (checked: boolean) => void;
  onDraftChange: (entry: MealEntry) => void;
  onIngredientChange: (index: number, patch: Partial<Ingredient>) => void;
  onIngredientRemove: (index: number) => void;
  onIngredientAdd: () => void;
  onCalculateNutrition: () => void;
  onReviewNutritionMatch: (index: number) => void;
  onNutritionChange: (patch: Partial<NutritionValues>) => void;
  onSave: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <section className="editor-page">
      <div className="stage-heading">
        <button className="back-button" onClick={onBack}>
          <ChevronLeft /> Diary
        </button>
        <div>
          <p className="eyebrow">A new page</p>
          <h1>Add a meal</h1>
          <p
            className={`draft-status draft-status--${draftStatus}`}
            aria-live="polite"
          >
            {draftStatus === 'saving'
              ? 'Saving draft…'
              : draftStatus === 'saved'
                ? 'Draft saved on this device'
                : draftStatus === 'error'
                  ? 'Draft could not be saved; you can still save the meal.'
                  : 'Changes are saved locally as you work.'}
          </p>
        </div>
      </div>
      <div className="editor-grid">
        <div className="photo-column">
          {photoUrl ? (
            <div className="photo-preview">
              <img src={photoUrl} alt="Meal ready to review" />
              <div className="photo-tools">
                <button onClick={onRotate}>
                  <RotateCw /> Rotate
                </button>
                <label className="file-picker">
                  <ImagePlus /> Replace
                  <input
                    className="visually-hidden"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => onFile(event.target.files?.[0])}
                  />
                </label>
                <button onClick={onRemovePhoto}>
                  <Trash2 /> Remove
                </button>
              </div>
            </div>
          ) : (
            <label className="camera-drop file-picker">
              <span className="camera-orbit">
                <Camera />
              </span>
              <strong>Photograph your plate</strong>
              <span>Use the camera or choose a photo you already have.</span>
              <span className="button button--primary">
                <ImagePlus /> Choose photo
              </span>
              <input
                className="visually-hidden"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => onFile(event.target.files?.[0])}
              />
            </label>
          )}
          {photoUrl && (
            <div className="analysis-card">
              <div>
                <span className="sparkle-badge">
                  <Sparkles />
                </span>
                <div>
                  <strong>Ask your model for a first pass</strong>
                  <p>
                    {settings.model} via {settings.baseUrl}
                  </p>
                </div>
              </div>
              <label className="privacy-check">
                <input
                  type="checkbox"
                  checked={settings.privacyAcknowledged}
                  onChange={(event) => onPrivacyChange(event.target.checked)}
                />
                <span>
                  I understand this photo goes directly to my configured model
                  endpoint.
                </span>
              </label>
              <div className="analysis-actions">
                <button
                  className="button button--aubergine"
                  onClick={onAnalyse}
                  disabled={Boolean(busy)}
                >
                  <Sparkles /> Analyse photo
                </button>
                {busy && (
                  <button
                    className="button button--quiet"
                    onClick={onCancelAnalyse}
                  >
                    Cancel
                  </button>
                )}
                <button className="text-button" onClick={onOpenSettings}>
                  Model settings
                </button>
              </div>
              <p className="manual-entry-note">
                Prefer not to use a model? Keep filling in the meal manually;
                analysis is always optional.
              </p>
            </div>
          )}
        </div>

        <div className="form-column">
          <div className="form-card">
            <div className="field-row">
              <label>
                <span>Meal</span>
                <select
                  value={draft.mealType}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      mealType: event.target.value as MealEntry['mealType'],
                    })
                  }
                >
                  {Object.entries(mealLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>When</span>
                <input
                  type="datetime-local"
                  value={dateTimeLocal(draft.eatenAt)}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      eatenAt: fromDateTimeLocal(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label>
              <span>What was it?</span>
              <input
                value={draft.title}
                placeholder="e.g. Mushroom toast"
                onChange={(event) =>
                  onDraftChange({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label>
              <span>Portion</span>
              <input
                value={draft.portionSummary}
                placeholder="e.g. One full dinner plate"
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    portionSummary: event.target.value,
                  })
                }
              />
            </label>
            <div className="field-row">
              <label>
                <span>Kind of image</span>
                <select
                  value={draft.classification}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      classification: event.target
                        .value as MealEntry['classification'],
                    })
                  }
                >
                  <option value="meal">Meal</option>
                  <option value="recipe_card">Recipe card</option>
                  <option value="packaged_food">Packaged food</option>
                  <option value="unclear">Unclear</option>
                </select>
              </label>
              <label>
                <span>Servings</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={draft.servings ?? ''}
                  placeholder="—"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      servings: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
            </div>
          </div>

          <div className="form-card ingredients-editor">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Your best estimate</p>
                <h2>Ingredients</h2>
              </div>
              {draft.analysis && (
                <span className="ai-label">
                  <Sparkles /> Check the model’s work
                </span>
              )}
            </div>
            {draft.ingredients.map((ingredient, index) => (
              <div className="ingredient-editor" key={ingredient.id}>
                <label className="ingredient-name">
                  <span>Ingredient</span>
                  <input
                    value={ingredient.name}
                    placeholder="Ingredient"
                    onChange={(event) =>
                      onIngredientChange(index, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={ingredient.amount ?? ''}
                    placeholder="—"
                    onChange={(event) =>
                      onIngredientChange(index, {
                        amount: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Unit</span>
                  <input
                    value={ingredient.unit ?? ''}
                    placeholder="g, ml, tbsp…"
                    onChange={(event) =>
                      onIngredientChange(index, {
                        unit: event.target.value || null,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Estimated grams</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={ingredient.estimatedGrams ?? ''}
                    placeholder="—"
                    onChange={(event) =>
                      onIngredientChange(index, {
                        estimatedGrams: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Confidence</span>
                  <select
                    value={ingredient.confidence}
                    onChange={(event) =>
                      onIngredientChange(index, {
                        confidence: event.target
                          .value as Ingredient['confidence'],
                      })
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <button
                  className="remove-row"
                  onClick={() => onIngredientRemove(index)}
                  aria-label={`Remove ${ingredient.name || 'ingredient'}`}
                >
                  <X />
                </button>
                <label className="ingredient-preparation">
                  <span>Preparation</span>
                  <input
                    value={ingredient.preparation ?? ''}
                    placeholder="e.g. raw, roasted, steamed"
                    onChange={(event) =>
                      onIngredientChange(index, {
                        preparation: event.target.value || null,
                      })
                    }
                  />
                </label>
                {ingredient.nutritionMatch && (
                  <div className="nutrition-match">
                    <p>
                      <Database /> {ingredient.nutritionMatch.foodName} ·{' '}
                      {ingredient.nutritionMatch.source === 'uk_cofid'
                        ? 'UK CoFID'
                        : 'USDA FoodData Central'}{' '}
                      ·{' '}
                      {ingredient.nutritionMatch.selectedBy === 'user'
                        ? 'chosen by you'
                        : `${ingredient.nutritionMatch.confidence} automatic match`}
                    </p>
                    <button
                      id={`review-match-${index}`}
                      className="text-button"
                      onClick={() => onReviewNutritionMatch(index)}
                    >
                      Review match
                    </button>
                  </div>
                )}
                {ingredient.nutritionExcluded && (
                  <div className="nutrition-match nutrition-match--excluded">
                    <p>Excluded from nutrition by you.</p>
                    <button
                      id={`review-match-${index}`}
                      className="text-button"
                      onClick={() => onReviewNutritionMatch(index)}
                    >
                      Review choice
                    </button>
                  </div>
                )}
                {!ingredient.nutritionMatch &&
                  !ingredient.nutritionExcluded &&
                  ingredient.name && (
                    <button
                      id={`review-match-${index}`}
                      className="text-button find-match"
                      onClick={() => onReviewNutritionMatch(index)}
                    >
                      <Database /> Find a local food match
                    </button>
                  )}
              </div>
            ))}
            <button className="add-row" onClick={onIngredientAdd}>
              <Plus /> Add ingredient
            </button>
          </div>

          <NutritionEditor
            nutrition={draft.nutrition}
            onCalculate={onCalculateNutrition}
            onChange={onNutritionChange}
            disabled={Boolean(busy)}
          />

          <div className="form-card">
            <label>
              <span>Kitchen notes</span>
              <textarea
                rows={4}
                value={draft.notes}
                placeholder="Anything you want to remember…"
                onChange={(event) =>
                  onDraftChange({ ...draft, notes: event.target.value })
                }
              />
            </label>
          </div>
          <button
            className="button button--primary button--save"
            onClick={onSave}
          >
            <Save /> Save to this device
          </button>
        </div>
      </div>
    </section>
  );
}

function NutritionEditor({
  nutrition,
  onCalculate,
  onChange,
  disabled,
}: {
  nutrition: MealEntry['nutrition'];
  onCalculate: () => void;
  onChange: (patch: Partial<NutritionValues>) => void;
  disabled: boolean;
}) {
  const fields: Array<{
    key: keyof NutritionValues;
    label: string;
    unit: string;
  }> = [
    { key: 'energyKcal', label: 'Energy', unit: 'kcal' },
    { key: 'proteinG', label: 'Protein', unit: 'g' },
    { key: 'carbsG', label: 'Carbohydrates', unit: 'g' },
    { key: 'fatG', label: 'Fat', unit: 'g' },
    { key: 'fibreG', label: 'Fibre', unit: 'g' },
    { key: 'saltG', label: 'Salt', unit: 'g' },
  ];
  return (
    <div className="form-card nutrition-editor-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Calculated on this device</p>
          <h2>Estimated nutrition</h2>
        </div>
        <button
          className="button button--quiet"
          onClick={onCalculate}
          disabled={disabled}
        >
          <Calculator /> {nutrition ? 'Recalculate' : 'Calculate locally'}
        </button>
      </div>
      {nutrition ? (
        <>
          {nutrition.stale && (
            <p className="nutrition-warning">
              Ingredients changed. Recalculate to refresh these values.
            </p>
          )}
          <div className="nutrition-inputs">
            {fields.map(({ key, label, unit }) => (
              <label key={key}>
                <span>
                  {label} <small>{unit}</small>
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  aria-label={`${label} (${unit})`}
                  value={nutrition.values[key] ?? ''}
                  onChange={(event) =>
                    onChange({
                      [key]: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p className="nutrition-disclaimer">
            {nutrition.matchedIngredientCount} of {nutrition.ingredientCount}{' '}
            ingredients matched to bundled USDA FoodData Central and UK CoFID
            records. Values remain editable because both photo portions and food
            matches are estimates.
          </p>
          {nutrition.notes.length > 0 && (
            <ul className="nutrition-editor-notes">
              {nutrition.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted nutrition-empty">
          Add gram estimates, then match ingredients against the bundled food
          database. No meal details are sent to a nutrition service.
        </p>
      )}
    </div>
  );
}

function SettingsPanel({
  settings,
  headerJson,
  storage,
  entryCount,
  connectionStatus,
  availableModels,
  backupState,
  backupDue,
  returnScreen,
  onClose,
  onSettingsChange,
  onHeaderJsonChange,
  onSave,
  onTest,
  onLmStudioPreset,
  onAvailableModelChange,
  onExport,
  onImport,
  importRef,
  onClearDiary,
  onClearCredentials,
  onDismissBackup,
}: {
  settings: ModelSettings;
  headerJson: string;
  storage: StorageEstimate | null;
  entryCount: number;
  connectionStatus: string | null;
  availableModels: string[];
  backupState: BackupState | null;
  backupDue: boolean;
  returnScreen: ContentScreen;
  onClose: () => void;
  onSettingsChange: (settings: ModelSettings) => void;
  onHeaderJsonChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onLmStudioPreset: () => void;
  onAvailableModelChange: (model: string) => void;
  onExport: () => void;
  onImport: (file?: File) => void;
  importRef: React.RefObject<HTMLInputElement | null>;
  onClearDiary: () => void;
  onClearCredentials: () => void;
  onDismissBackup: () => void;
}) {
  const [setupRoute, setSetupRoute] = useState<'lm-studio' | 'custom'>(() =>
    settings.baseUrl === 'http://127.0.0.1:1234/v1' ? 'lm-studio' : 'custom',
  );
  const location = endpointLocation(settings.baseUrl);
  return (
    <section className="settings-page">
      <div className="stage-heading">
        <button
          className="back-button"
          onClick={onClose}
          aria-label={
            returnScreen === 'add' ? 'Back to meal editor' : 'Back to diary'
          }
        >
          <ChevronLeft /> Back
        </button>
        <div>
          <p className="eyebrow">Kept on this device</p>
          <h1>Settings & privacy</h1>
        </div>
      </div>
      <div className="settings-grid">
        <div className="settings-card settings-card--model">
          <div className="settings-title">
            <span className="sparkle-badge">
              <Sparkles />
            </span>
            <div>
              <h2>Vision assistance</h2>
              <p>Optional help from a model you choose.</p>
            </div>
          </div>
          <div className="manual-model-callout">
            <BookOpen />
            <p>
              <strong>Manual entry always works.</strong> You do not need a
              model to keep your diary or calculate nutrition locally.
            </p>
          </div>
          <div
            className="model-route-picker"
            role="group"
            aria-label="Model connection"
          >
            <button
              type="button"
              className={
                setupRoute === 'lm-studio'
                  ? 'model-route model-route--selected'
                  : 'model-route'
              }
              aria-pressed={setupRoute === 'lm-studio'}
              onClick={() => {
                setSetupRoute('lm-studio');
                onLmStudioPreset();
              }}
            >
              <Laptop />
              <span>
                <strong>LM Studio</strong>
                <small>Quick setup for a model running on this device</small>
              </span>
            </button>
            <button
              type="button"
              className={
                setupRoute === 'custom'
                  ? 'model-route model-route--selected'
                  : 'model-route'
              }
              aria-pressed={setupRoute === 'custom'}
              onClick={() => setSetupRoute('custom')}
            >
              <Globe2 />
              <span>
                <strong>Custom compatible endpoint</strong>
                <small>
                  Use another local or hosted OpenAI-compatible service
                </small>
              </span>
            </button>
          </div>
          {setupRoute === 'lm-studio' ? (
            <div className="model-route-panel">
              <p>
                The local preset is applied. Start LM Studio's server and allow
                browser requests, then test the connection below.
              </p>
              <dl>
                <div>
                  <dt>Endpoint</dt>
                  <dd>http://127.0.0.1:1234/v1</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{settings.model}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="custom-model-fields">
              <p>
                Connect to any browser-accessible service that implements the
                OpenAI-compatible models and chat-completions endpoints.
              </p>
              <label>
                <span>Base URL</span>
                <input
                  value={settings.baseUrl}
                  placeholder="https://example.com/v1"
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      baseUrl: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Model ID</span>
                <input
                  value={settings.model}
                  onChange={(event) =>
                    onSettingsChange({ ...settings, model: event.target.value })
                  }
                />
              </label>
              <label>
                <span>
                  API key <small>optional</small>
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={settings.apiKey}
                  placeholder="Not needed for most local models"
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      apiKey: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          )}
          <div className={`endpoint-location endpoint-location--${location}`}>
            {location === 'local' ? <Laptop /> : <Globe2 />}
            <p>
              <strong>
                {location === 'local'
                  ? 'Appears local'
                  : location === 'remote'
                    ? 'Remote endpoint'
                    : 'Check the endpoint address'}
              </strong>
              {location === 'local'
                ? ' This address appears to be on this device or your local network. Photos go directly to it.'
                : location === 'remote'
                  ? ' Analysed photos leave this device and go directly to this service.'
                  : ' Enter a complete http:// or https:// Base URL before testing.'}
            </p>
          </div>
          <details className="model-config-details">
            <summary>Advanced settings</summary>
            <div className="field-row">
              <label>
                <span>Credential storage</span>
                <select
                  value={settings.credentialStorage}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      credentialStorage: event.target
                        .value as ModelSettings['credentialStorage'],
                    })
                  }
                >
                  <option value="device">This device</option>
                  <option value="session">This tab session</option>
                </select>
              </label>
              <label>
                <span>Response mode</span>
                <select
                  value={settings.responseMode}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      responseMode: event.target
                        .value as ModelSettings['responseMode'],
                    })
                  }
                >
                  <option value="json_object">JSON object</option>
                  <option value="json_schema">Strict JSON schema</option>
                  <option value="text">Tolerant text</option>
                </select>
              </label>
            </div>
            <label>
              <span>Additional request headers (JSON)</span>
              <textarea
                rows={4}
                value={headerJson}
                onChange={(event) => onHeaderJsonChange(event.target.value)}
                spellCheck="false"
              />
            </label>
          </details>
          <label className="privacy-check">
            <input
              type="checkbox"
              checked={settings.privacyAcknowledged}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  privacyAcknowledged: event.target.checked,
                })
              }
            />
            <span>
              I understand that analysed photos go directly to this endpoint.
            </span>
          </label>
          <div className="settings-actions">
            <button className="button button--primary" onClick={onSave}>
              <Save /> Save settings
            </button>
            <button className="button button--quiet" onClick={onTest}>
              <RefreshCw /> Test connection
            </button>
          </div>
          {connectionStatus && (
            <p className="connection-ok">
              <Check /> {connectionStatus}
            </p>
          )}
          {availableModels.length > 0 && (
            <label className="available-models">
              <span>Models reported by this endpoint</span>
              <select
                value={
                  availableModels.includes(settings.model) ? settings.model : ''
                }
                onChange={(event) => onAvailableModelChange(event.target.value)}
              >
                <option value="" disabled>
                  Choose a reported model
                </option>
                {availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <small>
                The endpoint reports availability, not whether every model can
                analyse images. A photo is sent only when you choose Analyse.
              </small>
            </label>
          )}
          <div className="local-model-tip">
            <CircleHelp />
            <p>
              <strong>Browser connection note.</strong> The endpoint must allow
              requests from this app. A deployed HTTPS PWA may face CORS,
              mixed-content, or local-network restrictions even when the same
              endpoint works from a desktop client.
            </p>
          </div>
        </div>

        <div className="settings-stack">
          <div className="settings-card">
            <div className="settings-title">
              <span className="plain-badge">
                <LockKeyhole />
              </span>
              <div>
                <h2>Your local diary</h2>
                <p>
                  {entryCount} saved meal{entryCount === 1 ? '' : 's'} ·{' '}
                  {formatBytes(storage?.usage)} used
                </p>
              </div>
            </div>
            {storage?.quota && (
              <div className="storage-meter">
                <span
                  style={{
                    width: `${Math.min(100, ((storage.usage ?? 0) / storage.quota) * 100)}%`,
                  }}
                />
              </div>
            )}
            <div className="stack-actions">
              <button className="button button--quiet" onClick={onExport}>
                <Download /> Export diary
              </button>
              <label className="button button--quiet file-picker">
                <Upload /> Import archive
                <input
                  ref={importRef}
                  className="visually-hidden"
                  type="file"
                  accept=".zip,.scranbook.zip,application/zip"
                  onChange={(event) => onImport(event.target.files?.[0])}
                />
              </label>
            </div>
            <p className="small-print">
              Exports include entries and processed photos, but never model
              credentials.
            </p>
            {backupState?.lastArchiveCreatedAt && (
              <p className="last-archive">
                Most recent known archive:{' '}
                <strong>{formatDate(backupState.lastArchiveCreatedAt)}</strong>
              </p>
            )}
            {backupDue && (
              <BackupReminder onExport={onExport} onDismiss={onDismissBackup} />
            )}
          </div>
          <div className="settings-card">
            <h2>Privacy controls</h2>
            <p>
              Scranbook has no account or diary API. Cloudflare serves the app;
              meal data stays in this browser unless you send a photo to your
              configured model.
            </p>
            <Link className="text-link" href="/privacy">
              Read the plain-language privacy note →
            </Link>
            <div className="danger-zone">
              <button
                className="button button--danger"
                onClick={onClearCredentials}
              >
                Clear credentials
              </button>
              <button className="button button--danger" onClick={onClearDiary}>
                <Trash2 /> Delete entire diary
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
