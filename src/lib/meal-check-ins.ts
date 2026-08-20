import { normalizeDiaryText } from './diary-search';
import type {
  MealCheckIn,
  MealEntry,
  MealSymptom,
  SymptomOnset,
} from './schema';

export const symptomLabels: Record<MealSymptom, string> = {
  bloating: 'Bloating',
  cramps: 'Cramps',
  reflux: 'Reflux',
  nausea: 'Nausea',
  bowel_changes: 'Bowel changes',
  headache: 'Headache',
  tiredness: 'Tiredness',
  skin: 'Skin',
  other: 'Something else / not sure',
};

export const onsetLabels: Record<SymptomOnset, string> = {
  within_30_minutes: 'Within 30 minutes',
  '30_minutes_to_1_hour': '30 minutes–1 hour later',
  '1_to_3_hours': '1–3 hours later',
  '3_to_6_hours': '3–6 hours later',
  later: 'Later',
};

export const severityLabels = ['Mild', 'Light', 'Moderate', 'Strong'] as const;
export const patternSymptomKeys = (
  Object.keys(symptomLabels) as MealSymptom[]
).filter((symptom) => symptom !== 'other');
export const minimumCheckedMealsForPatterns = 8;

export function createMealCheckIn(
  values: Omit<MealCheckIn, 'id' | 'recordedAt'>,
  now = new Date(),
): MealCheckIn {
  return {
    id: crypto.randomUUID(),
    recordedAt: now.toISOString(),
    ...values,
  };
}

export function latestMealCheckIn(entry: MealEntry) {
  return entry.checkIns.toSorted((left, right) =>
    right.recordedAt.localeCompare(left.recordedAt),
  )[0];
}

export function checkInSummary(checkIn: MealCheckIn) {
  if (checkIn.feeling === 'fine') return 'Felt fine';
  const symptoms = checkIn.symptoms.map((symptom) => symptomLabels[symptom]);
  if (symptoms.length === 0)
    return checkIn.feeling === 'unwell' ? 'Felt unwell' : 'Felt a little off';
  const severity = checkIn.severity
    ? severityLabels[checkIn.severity - 1]?.toLowerCase()
    : null;
  return `${symptoms.join(' · ')}${severity ? ` · ${severity}` : ''}`;
}

function canonicalIngredientName(value: string) {
  const normalized = normalizeDiaryText(value);
  if (normalized.endsWith('ies') && normalized.length > 4)
    return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('s') && !normalized.endsWith('ss'))
    return normalized.slice(0, -1);
  return normalized;
}

function ingredientNames(entry: MealEntry) {
  return new Map<string, string>(
    entry.ingredients
      .map((ingredient): [string, string] => [
        canonicalIngredientName(ingredient.name),
        ingredient.name.trim(),
      ])
      .filter(([normalized]) => Boolean(normalized)),
  );
}

function symptomAppeared(entry: MealEntry, symptom: MealSymptom) {
  return entry.checkIns.some((checkIn) => checkIn.symptoms.includes(symptom));
}

function typicalOnset(entry: MealEntry, symptom: MealSymptom) {
  return entry.checkIns.find(
    (checkIn) => checkIn.symptoms.includes(symptom) && checkIn.onset,
  )?.onset;
}

export interface MealPattern {
  ingredient: string;
  normalizedIngredient: string;
  symptom: MealSymptom;
  exposedMeals: number;
  exposedSymptomMeals: number;
  unexposedMeals: number;
  unexposedSymptomMeals: number;
  exposedRate: number;
  unexposedRate: number;
  typicalOnset: SymptomOnset | null;
}

export function findMealPatterns(entries: MealEntry[]): MealPattern[] {
  const checked = entries.filter((entry) => entry.checkIns.length > 0);
  if (checked.length < minimumCheckedMealsForPatterns) return [];

  const names = new Map<string, string>();
  for (const entry of checked) {
    for (const [normalized, display] of ingredientNames(entry)) {
      if (!names.has(normalized)) names.set(normalized, display);
    }
  }

  const patterns: MealPattern[] = [];
  for (const [normalizedIngredient, ingredient] of names) {
    const exposed = checked.filter((entry) =>
      ingredientNames(entry).has(normalizedIngredient),
    );
    const unexposed = checked.filter(
      (entry) => !ingredientNames(entry).has(normalizedIngredient),
    );
    if (exposed.length < 4 || unexposed.length < 4) continue;

    for (const symptom of patternSymptomKeys) {
      const exposedSymptomMeals = exposed.filter((entry) =>
        symptomAppeared(entry, symptom),
      );
      const unexposedSymptomMeals = unexposed.filter((entry) =>
        symptomAppeared(entry, symptom),
      );
      const exposedRate = exposedSymptomMeals.length / exposed.length;
      const unexposedRate = unexposedSymptomMeals.length / unexposed.length;
      if (exposedSymptomMeals.length < 3 || exposedRate - unexposedRate < 0.3)
        continue;

      const onsets = exposedSymptomMeals
        .map((entry) => typicalOnset(entry, symptom))
        .filter((onset): onset is SymptomOnset => Boolean(onset));
      const onsetCounts = new Map<SymptomOnset, number>();
      for (const onset of onsets)
        onsetCounts.set(onset, (onsetCounts.get(onset) ?? 0) + 1);
      const mostCommonOnset = [...onsetCounts].toSorted(
        (left, right) => right[1] - left[1],
      )[0]?.[0];

      patterns.push({
        ingredient,
        normalizedIngredient,
        symptom,
        exposedMeals: exposed.length,
        exposedSymptomMeals: exposedSymptomMeals.length,
        unexposedMeals: unexposed.length,
        unexposedSymptomMeals: unexposedSymptomMeals.length,
        exposedRate,
        unexposedRate,
        typicalOnset: mostCommonOnset ?? null,
      });
    }
  }

  return patterns.toSorted((left, right) => {
    const leftLift = left.exposedRate - left.unexposedRate;
    const rightLift = right.exposedRate - right.unexposedRate;
    return rightLift - leftLift || right.exposedMeals - left.exposedMeals;
  });
}
