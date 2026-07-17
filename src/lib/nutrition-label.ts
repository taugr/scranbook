import {
  nutritionLabelSourceSchema,
  type LabelNutrientKey,
  type LabelNutrientValue,
  type MealNutrition,
  type NutritionLabelColumn,
  type NutritionLabelSource,
  type NutritionValues,
} from './schema';

const commonKeys = new Set<LabelNutrientKey>([
  'energy_kcal',
  'energy_kj',
  'fat',
  'saturates',
  'carbohydrate',
  'sugars',
  'fibre',
  'protein',
  'salt',
  'sodium',
]);

function normalizedName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function canonicalNutrientKey(
  printedName: string,
  unit = '',
): LabelNutrientKey {
  const name = normalizedName(printedName);
  const normalizedUnit = unit.toLowerCase();
  if (name.includes('energy'))
    return normalizedUnit === 'kj' || name.includes('kilojoule')
      ? 'energy_kj'
      : 'energy_kcal';
  if (/\bsaturat(ed|es)?\b/.test(name)) return 'saturates';
  if (/\b(sugars?|of which sugars)\b/.test(name)) return 'sugars';
  if (/\bcarbohydrate(s)?\b|\bcarbs?\b/.test(name)) return 'carbohydrate';
  if (/\bprotein\b/.test(name)) return 'protein';
  if (/\bfib(er|re)\b/.test(name)) return 'fibre';
  if (/\bsodium\b/.test(name)) return 'sodium';
  if (/\bsalt\b/.test(name)) return 'salt';
  if (/\bfat\b/.test(name)) return 'fat';
  return 'other';
}

export function compatibleConsumptionUnits(column: NutritionLabelColumn) {
  const units = new Set<'g' | 'ml' | 'serving'>([column.basisUnit]);
  if (column.basis === 'per_serving' && column.servingSize)
    units.add(column.servingSize.unit);
  return [...units];
}

export function labelScaleFactor(source: NutritionLabelSource) {
  const column = source.columns.find(
    (candidate) => candidate.id === source.selectedColumnId,
  );
  if (!column) throw new Error('Choose a printed label column first.');
  if (column.basisUnit === source.consumption.unit)
    return source.consumption.amount / column.basisAmount;
  if (
    column.basis === 'per_serving' &&
    column.servingSize?.unit === source.consumption.unit
  )
    return source.consumption.amount / column.servingSize.amount;
  throw new Error(
    `This label column cannot scale an amount in ${source.consumption.unit}.`,
  );
}

function amountInUnit(
  amount: number,
  unit: string,
  target: 'g' | 'mg',
): number | null {
  const normalized = unit.toLowerCase().replace('μ', 'µ');
  if (target === 'g') {
    if (normalized === 'g') return amount;
    if (normalized === 'mg') return amount / 1_000;
    if (normalized === 'µg' || normalized === 'ug') return amount / 1_000_000;
  }
  if (target === 'mg') {
    if (normalized === 'mg') return amount;
    if (normalized === 'g') return amount * 1_000;
    if (normalized === 'µg' || normalized === 'ug') return amount / 1_000;
  }
  return null;
}

function commonValue(
  nutrient: LabelNutrientValue,
  scaledAmount: number,
): [keyof NutritionValues, number] | null {
  switch (nutrient.key) {
    case 'energy_kcal':
      return nutrient.unit.toLowerCase() === 'kcal'
        ? ['energyKcal', scaledAmount]
        : null;
    case 'energy_kj':
      return nutrient.unit.toLowerCase() === 'kj'
        ? ['energyKj', scaledAmount]
        : null;
    case 'protein':
    case 'carbohydrate':
    case 'fat':
    case 'saturates':
    case 'sugars':
    case 'fibre':
    case 'salt': {
      const amount = amountInUnit(scaledAmount, nutrient.unit, 'g');
      if (amount === null) return null;
      const keys = {
        protein: 'proteinG',
        carbohydrate: 'carbsG',
        fat: 'fatG',
        saturates: 'saturatesG',
        sugars: 'sugarsG',
        fibre: 'fibreG',
        salt: 'saltG',
      } as const;
      return [keys[nutrient.key], amount];
    }
    case 'sodium': {
      const amount = amountInUnit(scaledAmount, nutrient.unit, 'mg');
      return amount === null ? null : ['sodiumMg', amount];
    }
    default:
      return null;
  }
}

export function labelPlausibilityWarnings(source: NutritionLabelSource) {
  const warnings = [...source.warnings];
  for (const column of source.columns) {
    if (column.basis === 'per_100g') {
      for (const nutrient of column.nutrients) {
        const grams =
          nutrient.amount === null
            ? null
            : amountInUnit(nutrient.amount, nutrient.unit, 'g');
        if (grams !== null && grams > 100)
          warnings.push(
            `${nutrient.printedName} exceeds 100 g in a per-100-g column. Check the transcription.`,
          );
      }
    }
    const kcal = column.nutrients.find(
      (nutrient) => nutrient.key === 'energy_kcal',
    )?.amount;
    const kj = column.nutrients.find(
      (nutrient) => nutrient.key === 'energy_kj',
    )?.amount;
    if (kcal && kj) {
      const ratio = kj / kcal;
      if (ratio < 3.7 || ratio > 4.7)
        warnings.push(
          `${column.printedHeading} has an unusual kcal-to-kJ ratio. Check both energy values.`,
        );
    }
  }
  return [...new Set(warnings)];
}

export function scaleNutritionLabel(
  input: NutritionLabelSource,
  now = new Date(),
): MealNutrition {
  const source = nutritionLabelSourceSchema.parse(input);
  const factor = labelScaleFactor(source);
  const column = source.columns.find(
    (candidate) => candidate.id === source.selectedColumnId,
  )!;
  const values: NutritionValues = {
    energyKcal: null,
    energyKj: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    saturatesG: null,
    sugarsG: null,
    fibreG: null,
    saltG: null,
    sodiumMg: null,
  };
  const additionalValues: LabelNutrientValue[] = [];

  for (const nutrient of column.nutrients) {
    const scaledAmount =
      nutrient.amount === null ? null : nutrient.amount * factor;
    if (scaledAmount !== null) {
      const common = commonValue(nutrient, scaledAmount);
      if (common) values[common[0]] = common[1];
    }
    if (!commonKeys.has(nutrient.key) || commonValue(nutrient, 0) === null) {
      additionalValues.push({ ...nutrient, amount: scaledAmount });
    }
  }

  return {
    values,
    source,
    additionalValues,
    calculatedAt: now.toISOString(),
    edited: source.edited,
    stale: false,
    notes: [],
  };
}

export function createManualNutritionLabelSource(): NutritionLabelSource {
  const columnId = crypto.randomUUID();
  return {
    kind: 'nutrition_label',
    version: 1,
    productName: '',
    columns: [
      {
        id: columnId,
        basis: 'per_100g',
        basisAmount: 100,
        basisUnit: 'g',
        printedHeading: 'Per 100 g',
        servingDescription: null,
        servingSize: null,
        nutrients: [
          {
            id: crypto.randomUUID(),
            key: 'energy_kcal',
            printedName: 'Energy',
            amount: null,
            unit: 'kcal',
            qualifier: 'exact',
            dailyValuePercent: null,
            confidence: 'high',
          },
        ],
      },
    ],
    selectedColumnId: columnId,
    consumption: { amount: 100, unit: 'g' },
    method: 'manual',
    scannedAt: null,
    edited: true,
    warnings: [],
    copiedFromEntryId: null,
  };
}

export function labelPortionSummary(source: NutritionLabelSource) {
  const unit =
    source.consumption.unit === 'serving'
      ? 'servings'
      : source.consumption.unit;
  return `${source.consumption.amount} ${unit} consumed`;
}

export function parseLocaleNumber(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function displayNutrientAmount(value: number, unit: string) {
  if (unit.toLowerCase() === 'kcal' || unit.toLowerCase() === 'kj')
    return Math.round(value).toLocaleString();
  const absolute = Math.abs(value);
  const digits = absolute > 0 && absolute < 0.1 ? 2 : 1;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
