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
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
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
import {
  createDiaryArchive,
  downloadBlob,
  importDiaryArchive,
} from '@/lib/archive';
import {
  clearCredentials,
  clearDiary,
  deleteEntry,
  getPhoto,
  listEntries,
  loadModelSettings,
  requestPersistentStorage,
  saveEntry,
  saveModelSettings,
  storageEstimate,
} from '@/lib/db';
import { processImage, rotatePhoto } from '@/lib/image';
import { estimateMealNutrition } from '@/lib/nutrition';
import {
  analyseMeal,
  promptVersion,
  ProviderError,
  testModelConnection,
} from '@/lib/provider';
import {
  createBlankEntry,
  defaultModelSettings,
  modelSettingsSchema,
  type Ingredient,
  type MealEntry,
  type ModelSettings,
  type NutritionValues,
  type StoredPhoto,
} from '@/lib/schema';

type Screen = 'diary' | 'add' | 'settings';

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
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MealEntry>(() => createBlankEntry());
  const [pendingPhoto, setPendingPhoto] = useState<StoredPhoto | null>(null);
  const [modelSettings, setModelSettings] =
    useState<ModelSettings>(defaultModelSettings);
  const [headerJson, setHeaderJson] = useState('{}');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [online, setOnline] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const pendingUrl = usePhotoUrl(pendingPhoto?.id ?? null, pendingPhoto);

  const refresh = useCallback(async () => {
    const [nextEntries, nextStorage] = await Promise.all([
      listEntries(),
      storageEstimate(),
    ]);
    setEntries(nextEntries);
    setStorage(nextStorage);
    setSelectedId((current) => current ?? nextEntries[0]?.id ?? null);
  }, []);

  useEffect(() => {
    async function initialize() {
      try {
        const settings = await loadModelSettings();
        setModelSettings(settings);
        setHeaderJson(JSON.stringify(settings.extraHeaders, null, 2));
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [screen, selectedId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selected = useMemo(
    () =>
      entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  );

  function resetMessages() {
    setError(null);
    setNotice(null);
  }

  function startAdd() {
    resetMessages();
    setDraft(createBlankEntry());
    setPendingPhoto(null);
    setScreen('add');
  }

  async function startEdit(entry: MealEntry, duplicate = false) {
    resetMessages();
    const photo = await getPhoto(entry.photoId);
    const now = new Date().toISOString();
    if (duplicate) {
      const clonedPhoto = photo
        ? { ...photo, id: crypto.randomUUID(), createdAt: now }
        : null;
      setPendingPhoto(clonedPhoto);
      setDraft({
        ...entry,
        id: crypto.randomUUID(),
        photoId: clonedPhoto?.id ?? null,
        analysis: null,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      setPendingPhoto(photo ?? null);
      setDraft(entry);
    }
    setScreen('add');
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
      setDraft((current) => ({
        ...current,
        photoId: photo.id,
        capturedAt: new Date().toISOString(),
      }));
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
      setPendingPhoto(await rotatePhoto(pendingPhoto));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
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
      setDraft((current) => ({
        ...current,
        title: result.dishName,
        classification: result.classification,
        servings: result.servings,
        portionSummary: result.portionSummary,
        ingredients: nutritionEstimate?.ingredients ?? analysedIngredients,
        nutrition: nutritionEstimate?.nutrition ?? null,
        notes:
          result.uncertaintyNotes.length > 0
            ? `${current.notes}${current.notes ? '\n\n' : ''}Model notes: ${result.uncertaintyNotes.join(' • ')}`
            : current.notes,
        analysis: {
          model: modelSettings.model,
          endpointOrigin: new URL(modelSettings.baseUrl).origin,
          promptVersion,
          analysedAt: now,
          confidence: result.overallConfidence,
        },
      }));
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
      await refresh();
      setSelectedId(entry.id);
      setScreen('diary');
      setNotice('Saved on this device.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function removeEntry(entry: MealEntry) {
    if (
      !window.confirm(`Delete “${entry.title}” and its photo from this device?`)
    )
      return;
    await deleteEntry(entry.id);
    setSelectedId(null);
    await refresh();
    setNotice('Meal deleted from this device.');
  }

  function updateIngredient(index: number, patch: Partial<Ingredient>) {
    setDraft((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, candidate) =>
        candidate === index
          ? { ...ingredient, ...patch, nutritionMatch: null }
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
      setDraft((current) => ({
        ...current,
        ingredients: estimate.ingredients,
        nutrition: estimate.nutrition,
      }));
      setNotice(
        `Matched ${estimate.nutrition.matchedIngredientCount} of ${estimate.nutrition.ingredientCount} ingredients to the local database.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

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

  async function testConnection() {
    resetMessages();
    setConnectionStatus('Checking the endpoint…');
    try {
      const parsedHeaders = JSON.parse(headerJson) as Record<string, string>;
      const settings = modelSettingsSchema.parse({
        ...modelSettings,
        extraHeaders: parsedHeaders,
      });
      const models = await testModelConnection(settings);
      setConnectionStatus(
        `Connected. ${settings.model} is ready; ${models.length} model${models.length === 1 ? '' : 's'} available.`,
      );
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
        'Importing replaces the diary currently stored in this browser. Continue?',
      )
    )
      return;
    setBusy('Checking and restoring your archive…');
    try {
      const count = await importDiaryArchive(file);
      await refresh();
      setNotice(`Restored ${count} meal${count === 1 ? '' : 's'}.`);
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
        'Permanently delete every Scranbook entry and photo on this device?',
      )
    )
      return;
    await clearDiary();
    setSelectedId(null);
    await refresh();
    setNotice('All diary entries and photos were deleted.');
  }

  async function removeCredentials() {
    const settings = await clearCredentials();
    setModelSettings(settings);
    setHeaderJson('{}');
    setNotice('Model credentials cleared.');
  }

  if (loading) {
    return (
      <main className="loading-page">
        <div className="brand-mark">
          <Utensils />
        </div>
        <p>Opening your scranbook…</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="wordmark"
          onClick={() => setScreen('diary')}
          aria-label="Open diary"
        >
          <span className="brand-mark">
            <Utensils />
          </span>
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
        <button
          className="desktop-add button button--primary"
          onClick={startAdd}
        >
          <Camera /> Add a meal
        </button>
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
            <button
              className="icon-button"
              onClick={startAdd}
              aria-label="Add a meal"
            >
              <Plus />
            </button>
          </div>
          {entries.length === 0 ? (
            <div className="rail-empty">
              <span>Nothing tucked in yet.</span>
              <button onClick={startAdd}>Add your first meal</button>
            </div>
          ) : (
            <div className="rail-list">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  className={`rail-entry ${selected?.id === entry.id ? 'rail-entry--selected' : ''}`}
                  onClick={() => {
                    setSelectedId(entry.id);
                    setScreen('diary');
                  }}
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
          )}
          <button
            className="rail-settings"
            onClick={() => setScreen('settings')}
          >
            <Settings /> Settings & privacy
          </button>
        </aside>

        <main className="main-stage">
          {screen === 'diary' &&
            (selected ? (
              <EntryDetail
                entry={selected}
                onEdit={() => void startEdit(selected)}
                onDuplicate={() => void startEdit(selected, true)}
                onDelete={() => void removeEntry(selected)}
              />
            ) : (
              <EmptyDiary onAdd={startAdd} />
            ))}
          {screen === 'add' && (
            <MealEditor
              draft={draft}
              photoUrl={pendingUrl}
              busy={busy}
              settings={modelSettings}
              onBack={() => setScreen('diary')}
              onFile={(file) => void choosePhoto(file)}
              onRotate={() => void rotatePendingPhoto()}
              onRemovePhoto={() => {
                setPendingPhoto(null);
                setDraft((current) => ({ ...current, photoId: null }));
              }}
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
              onNutritionChange={updateNutrition}
              onSave={() => void saveDraft()}
              onOpenSettings={() => setScreen('settings')}
            />
          )}
          {screen === 'settings' && (
            <SettingsPanel
              settings={modelSettings}
              headerJson={headerJson}
              storage={storage}
              entryCount={entries.length}
              connectionStatus={connectionStatus}
              onSettingsChange={setModelSettings}
              onHeaderJsonChange={setHeaderJson}
              onSave={() => void saveSettings()}
              onTest={() => void testConnection()}
              onExport={() => void exportDiary()}
              onImport={(file) => void importDiary(file)}
              importRef={importRef}
              onClearDiary={() => void removeAllDiaryData()}
              onClearCredentials={() => void removeCredentials()}
            />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <button
          className={screen === 'diary' ? 'active' : ''}
          onClick={() => setScreen('diary')}
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
          onClick={() => setScreen('settings')}
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
    </div>
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
  onEdit,
  onDuplicate,
  onDelete,
}: {
  entry: MealEntry;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="entry-detail">
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
                        Matched to {ingredient.nutritionMatch.foodName}
                      </small>
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
          <button className="button button--quiet" onClick={onDuplicate}>
            <RefreshCw /> Duplicate
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
  onNutritionChange,
  onSave,
  onOpenSettings,
}: {
  draft: MealEntry;
  photoUrl: string | null;
  busy: string | null;
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
                <label>
                  <ImagePlus /> Replace
                  <input
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
            <label className="camera-drop">
              <span className="camera-orbit">
                <Camera />
              </span>
              <strong>Photograph your plate</strong>
              <span>Use the camera or choose a photo you already have.</span>
              <span className="button button--primary">
                <ImagePlus /> Choose photo
              </span>
              <input
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
                  <p className="nutrition-match">
                    <Database /> {ingredient.nutritionMatch.foodName} ·{' '}
                    {ingredient.nutritionMatch.source === 'uk_cofid'
                      ? 'UK CoFID'
                      : 'USDA FoodData Central'}{' '}
                    · {ingredient.nutritionMatch.confidence} match
                  </p>
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
  onSettingsChange,
  onHeaderJsonChange,
  onSave,
  onTest,
  onExport,
  onImport,
  importRef,
  onClearDiary,
  onClearCredentials,
}: {
  settings: ModelSettings;
  headerJson: string;
  storage: StorageEstimate | null;
  entryCount: number;
  connectionStatus: string | null;
  onSettingsChange: (settings: ModelSettings) => void;
  onHeaderJsonChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onExport: () => void;
  onImport: (file?: File) => void;
  importRef: React.RefObject<HTMLInputElement | null>;
  onClearDiary: () => void;
  onClearCredentials: () => void;
}) {
  return (
    <section className="settings-page">
      <div className="stage-heading">
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
              <h2>Vision model</h2>
              <p>Any compatible endpoint can be your kitchen assistant.</p>
            </div>
          </div>
          <label>
            <span>Base URL</span>
            <input
              value={settings.baseUrl}
              onChange={(event) =>
                onSettingsChange({ ...settings, baseUrl: event.target.value })
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
                onSettingsChange({ ...settings, apiKey: event.target.value })
              }
            />
          </label>
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
          <details>
            <summary>Advanced request headers</summary>
            <label>
              <span>JSON object</span>
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
          <div className="local-model-tip">
            <CircleHelp />
            <p>
              <strong>Using LM Studio?</strong> Start its local server, enable
              requests from your browser, and use{' '}
              <code>http://127.0.0.1:1234/v1</code>. A deployed HTTPS PWA may
              face browser-specific local-network restrictions.
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
              <label className="button button--quiet">
                <Upload /> Import archive
                <input
                  ref={importRef}
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
