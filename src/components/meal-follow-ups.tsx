import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Circle,
  Clock3,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  PencilLine,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  checkInSummary,
  latestMealCheckIn,
  onsetLabels,
  severityLabels,
  symptomLabels,
  type MealPattern,
} from '@/lib/meal-check-ins';
import type {
  MealCheckIn,
  MealEntry,
  MealFeeling,
  MealSymptom,
  SymptomOnset,
} from '@/lib/schema';

const feelings: Array<{ value: MealFeeling; label: string }> = [
  { value: 'fine', label: 'Fine' },
  { value: 'a_little_off', label: 'A little off' },
  { value: 'unwell', label: 'Unwell' },
];

const symptoms = Object.entries(symptomLabels) as Array<[MealSymptom, string]>;

const onsetOptions = Object.entries(onsetLabels) as Array<
  [SymptomOnset, string]
>;

function formatTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatDay(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
}

function dateKey(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function mealName(entry: MealEntry) {
  return entry.mealType === 'other' ? 'meal' : entry.mealType;
}

export function MealTimeline({
  entries,
  patternAvailable,
  onOpenEntry,
  onStartCheckIn,
  onMarkFine,
  onOpenPatterns,
  savingEntryId,
}: {
  entries: MealEntry[];
  patternAvailable: boolean;
  onOpenEntry: (entry: MealEntry) => void;
  onStartCheckIn: (entry: MealEntry) => void;
  onMarkFine: (entry: MealEntry) => void;
  onOpenPatterns: () => void;
  savingEntryId: string | null;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, MealEntry[]>();
    for (const entry of entries) {
      const key = dateKey(entry.eatenAt);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return [...grouped.values()];
  }, [entries]);

  return (
    <div className="meal-timeline">
      {patternAvailable && (
        <button className="patterns-invitation" onClick={onOpenPatterns}>
          <Lightbulb />
          <span>
            <small>Early signal ready</small>
            <strong>See what you’ve noticed</strong>
          </span>
          <ChevronLeft className="patterns-invitation-arrow" />
        </button>
      )}
      {groups.map((group) => (
        <section className="diary-day" key={dateKey(group[0]!.eatenAt)}>
          <header>
            <h2>{formatDay(group[0]!.eatenAt)}</h2>
            <p>Meals and how they sat with you</p>
          </header>
          <div className="day-thread">
            {group.map((entry) => {
              const latest = latestMealCheckIn(entry);
              return (
                <article className="thread-entry" key={entry.id}>
                  <time>{formatTime(entry.eatenAt)}</time>
                  <span className="thread-dot" aria-hidden="true" />
                  <div className="thread-entry-content">
                    <button
                      className="thread-meal"
                      onClick={() => onOpenEntry(entry)}
                    >
                      <strong>{entry.title}</strong>
                      <span>
                        {entry.ingredients
                          .slice(0, 3)
                          .map((ingredient) => ingredient.name)
                          .join(' · ') ||
                          entry.portionSummary ||
                          'Saved meal'}
                      </span>
                    </button>
                    {!latest ? (
                      <div className="timeline-follow-up">
                        <p>How did {mealName(entry)} sit?</p>
                        <div>
                          <button
                            className="button button--primary"
                            onClick={() => onStartCheckIn(entry)}
                          >
                            <PencilLine /> Add check-in
                          </button>
                          <button
                            className="button button--quiet"
                            disabled={savingEntryId === entry.id}
                            onClick={() => onMarkFine(entry)}
                          >
                            {savingEntryId === entry.id ? (
                              <LoaderCircle className="spin" />
                            ) : (
                              <Check />
                            )}{' '}
                            Felt fine
                          </button>
                        </div>
                      </div>
                    ) : latest.feeling === 'fine' ? (
                      <p className="timeline-fine">
                        <CheckCircle2 /> Felt fine · checked
                      </p>
                    ) : (
                      <div className="timeline-symptom-event">
                        <small>{formatTime(latest.recordedAt)}</small>
                        <span>
                          <strong>{checkInSummary(latest)}</strong>
                          {latest.onset && <em>{onsetLabels[latest.onset]}</em>}
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      <p className="timeline-caution">
        <Sparkles /> A timeline can show patterns, but not their cause.
      </p>
    </div>
  );
}

export function MealCheckInPage({
  entry,
  initialCheckIn,
  onBack,
  onSave,
}: {
  entry: MealEntry;
  initialCheckIn?: MealCheckIn;
  onBack: () => void;
  onSave: (checkIn: Omit<MealCheckIn, 'id' | 'recordedAt'>) => Promise<boolean>;
}) {
  const [feeling, setFeeling] = useState<MealFeeling>(
    initialCheckIn?.feeling ?? 'fine',
  );
  const [selectedSymptoms, setSelectedSymptoms] = useState<MealSymptom[]>(
    initialCheckIn?.symptoms ?? [],
  );
  const [severity, setSeverity] = useState<number | null>(
    initialCheckIn?.severity ?? null,
  );
  const [onset, setOnset] = useState<SymptomOnset | null>(
    initialCheckIn?.onset ?? null,
  );
  const [noteOpen, setNoteOpen] = useState(Boolean(initialCheckIn?.notes));
  const [notes, setNotes] = useState(initialCheckIn?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const needsDetails = feeling !== 'fine';
  const canSave = !needsDetails || selectedSymptoms.length > 0;

  function chooseFeeling(value: MealFeeling) {
    setFeeling(value);
    if (value === 'fine') setSelectedSymptoms([]);
  }

  function toggleSymptom(symptom: MealSymptom) {
    setSelectedSymptoms((current) =>
      current.includes(symptom)
        ? current.filter((candidate) => candidate !== symptom)
        : [...current, symptom],
    );
  }

  async function saveCheckIn() {
    if (saving) return;
    setSaving(true);
    const saved = await onSave({
      feeling,
      symptoms: feeling === 'fine' ? [] : selectedSymptoms,
      severity: feeling === 'fine' ? null : severity,
      onset: feeling === 'fine' ? null : onset,
      notes,
    });
    if (!saved) setSaving(false);
  }

  return (
    <section className="check-in-page">
      <button className="check-in-back" onClick={onBack}>
        <ChevronLeft /> {entry.title}
      </button>
      <h1>{initialCheckIn ? 'Edit check-in' : 'How did that sit?'}</h1>
      <div className="check-in-meal-context">
        <div aria-hidden="true">
          <BookOpen />
        </div>
        <span>
          <strong>{entry.title}</strong>
          <small>
            {formatDay(entry.eatenAt)} · {formatTime(entry.eatenAt)}
          </small>
        </span>
      </div>

      <div className="check-in-section">
        <h2>How are you feeling?</h2>
        <div className="feeling-picker" role="group" aria-label="How you felt">
          {feelings.map((option) => (
            <button
              key={option.value}
              className={feeling === option.value ? 'selected' : ''}
              aria-pressed={feeling === option.value}
              onClick={() => chooseFeeling(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {needsDetails && (
        <>
          <div className="check-in-section">
            <h2>What did you notice?</h2>
            <div className="symptom-picker" role="group" aria-label="Symptoms">
              {symptoms.map(([value, label]) => (
                <button
                  key={value}
                  className={selectedSymptoms.includes(value) ? 'selected' : ''}
                  aria-pressed={selectedSymptoms.includes(value)}
                  onClick={() => toggleSymptom(value)}
                >
                  {selectedSymptoms.includes(value) && <Check />}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="check-in-section">
            <h2>
              How noticeable? <small>Optional</small>
            </h2>
            <div className="severity-picker" role="group" aria-label="Severity">
              {severityLabels.map((label, index) => (
                <button
                  key={label}
                  className={severity === index + 1 ? 'selected' : ''}
                  aria-pressed={severity === index + 1}
                  onClick={() =>
                    setSeverity((current) =>
                      current === index + 1 ? null : index + 1,
                    )
                  }
                >
                  <span aria-hidden="true">
                    {Array.from({ length: index + 1 }, (_, dot) => (
                      <Circle key={dot} fill="currentColor" />
                    ))}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="check-in-onset">
            <span>
              When did it begin? <small>Optional</small>
            </span>
            <select
              value={onset ?? ''}
              onChange={(event) =>
                setOnset((event.target.value || null) as SymptomOnset | null)
              }
            >
              <option value="">Not sure</option>
              {onsetOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <div className="check-in-note">
        <button onClick={() => setNoteOpen((current) => !current)}>
          <PencilLine /> Add a note <ChevronDown />
        </button>
        {noteOpen && (
          <textarea
            rows={3}
            maxLength={1_000}
            value={notes}
            aria-label="Check-in note"
            placeholder="Anything else you noticed…"
            onChange={(event) => setNotes(event.target.value)}
          />
        )}
      </div>

      {!canSave && (
        <p className="check-in-guidance">Choose what you noticed.</p>
      )}
      <button
        className="button button--primary check-in-save"
        disabled={!canSave || saving}
        onClick={() => void saveCheckIn()}
      >
        {saving ? <LoaderCircle className="spin" /> : <CheckCircle2 />}
        {saving ? 'Saving…' : initialCheckIn ? 'Save changes' : 'Save check-in'}
      </button>
      <p className="check-in-local-note">
        <LockKeyhole /> Stored with your private diary.
      </p>
    </section>
  );
}

export function MealPatternPage({
  pattern,
  checkedMealCount,
  onBack,
  onReview,
}: {
  pattern: MealPattern;
  checkedMealCount: number;
  onBack: () => void;
  onReview: () => void;
}) {
  const symptom = symptomLabels[pattern.symptom].toLowerCase();
  return (
    <section className="pattern-page">
      <button className="check-in-back" onClick={onBack}>
        <ChevronLeft /> Diary
      </button>
      <div className="pattern-heading">
        <div>
          <h1>What you’ve noticed</h1>
          <p>Repeated check-ins can reveal associations—not causes.</p>
        </div>
        <Lightbulb aria-hidden="true" />
      </div>
      <div className="pattern-result">
        <p className="eyebrow">Early signal</p>
        <h2>
          {pattern.ingredient} and {symptom}
        </h2>
        <p className="pattern-lead">
          {symptomLabels[pattern.symptom]} followed{' '}
          {pattern.exposedSymptomMeals} of {pattern.exposedMeals} checked meals
          containing {pattern.ingredient.toLowerCase()}.
        </p>
        <dl className="pattern-comparison">
          <div>
            <dt>With {pattern.ingredient.toLowerCase()}</dt>
            <dd>
              <span>
                <i style={{ width: `${pattern.exposedRate * 100}%` }} />
              </span>
              <strong>
                {pattern.exposedSymptomMeals} of {pattern.exposedMeals}
              </strong>
            </dd>
          </div>
          <div>
            <dt>Without {pattern.ingredient.toLowerCase()}</dt>
            <dd>
              <span>
                <i style={{ width: `${pattern.unexposedRate * 100}%` }} />
              </span>
              <strong>
                {pattern.unexposedSymptomMeals} of {pattern.unexposedMeals}
              </strong>
            </dd>
          </div>
        </dl>
        {pattern.typicalOnset && (
          <p className="pattern-evidence">
            <Clock3 /> Typical onset:{' '}
            {onsetLabels[pattern.typicalOnset].toLowerCase()}
          </p>
        )}
        <p className="pattern-evidence">
          <CheckCircle2 /> Based on {checkedMealCount} meals you checked
        </p>
        <div className="pattern-caution">
          <Sparkles />
          <p>
            Several foods often appeared together, and small samples can be
            misleading. This is worth watching, not a diagnosis.
          </p>
        </div>
        <button
          className="button button--primary pattern-review"
          onClick={onReview}
        >
          <BookOpen /> Review these meals
        </button>
        <details className="pattern-method">
          <summary>How Scranbook finds patterns</summary>
          <p>
            Scranbook compares checked meals containing an ingredient with
            checked meals that do not. Unchecked meals are never treated as
            symptom-free, and everything is calculated on this device. It is not
            designed to diagnose an intolerance or track an emergency allergic
            reaction.
          </p>
        </details>
      </div>
    </section>
  );
}

export function MealCheckInSummary({
  entry,
  onAdd,
  onEdit,
  onDelete,
  busyCheckInId,
}: {
  entry: MealEntry;
  onAdd: () => void;
  onEdit: (checkIn: MealCheckIn) => void;
  onDelete: (checkIn: MealCheckIn) => void;
  busyCheckInId: string | null;
}) {
  const latest = latestMealCheckIn(entry);
  const history = entry.checkIns.toSorted((left, right) =>
    right.recordedAt.localeCompare(left.recordedAt),
  );
  return (
    <section className="check-in-summary-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Meal follow-up</p>
          <h2>How it sat with you</h2>
        </div>
        <button className="button button--quiet" onClick={onAdd}>
          <PencilLine /> {latest ? 'Check in again' : 'Add check-in'}
        </button>
      </div>
      {latest ? (
        <ol className="check-in-history" aria-label="Check-in history">
          {history.map((checkIn, index) => (
            <li key={checkIn.id}>
              <div className="check-in-summary-copy">
                <strong>{checkInSummary(checkIn)}</strong>
                <span>
                  {formatDay(checkIn.recordedAt)} ·{' '}
                  {formatTime(checkIn.recordedAt)}
                  {index === 0 ? ' · Latest' : ''}
                </span>
                {checkIn.onset && <em>{onsetLabels[checkIn.onset]}</em>}
                {checkIn.notes && <p>{checkIn.notes}</p>}
              </div>
              <div className="check-in-history-actions">
                <button
                  className="button button--quiet"
                  disabled={busyCheckInId === checkIn.id}
                  onClick={() => onEdit(checkIn)}
                >
                  <PencilLine /> Edit
                </button>
                <button
                  className="button button--quiet button--danger"
                  disabled={busyCheckInId === checkIn.id}
                  onClick={() => onDelete(checkIn)}
                >
                  {busyCheckInId === checkIn.id ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <Trash2 />
                  )}
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">
          Add a quick follow-up after this meal. Symptom-free check-ins are just
          as useful as the uncomfortable ones.
        </p>
      )}
    </section>
  );
}
