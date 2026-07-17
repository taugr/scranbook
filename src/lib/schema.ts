import { z } from 'zod';

export const confidenceSchema = z.enum(['low', 'medium', 'high']);
export const classificationSchema = z.enum([
  'meal',
  'recipe_card',
  'packaged_food',
  'unclear',
]);
export const mealTypeSchema = z.enum([
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'other',
]);

export const nutritionValuesSchema = z.object({
  energyKcal: z.number().finite().nonnegative().nullable(),
  energyKj: z.number().finite().nonnegative().nullable().default(null),
  proteinG: z.number().finite().nonnegative().nullable(),
  carbsG: z.number().finite().nonnegative().nullable(),
  fatG: z.number().finite().nonnegative().nullable(),
  saturatesG: z.number().finite().nonnegative().nullable().default(null),
  sugarsG: z.number().finite().nonnegative().nullable().default(null),
  fibreG: z.number().finite().nonnegative().nullable(),
  saltG: z.number().finite().nonnegative().nullable(),
  sodiumMg: z.number().finite().nonnegative().nullable().default(null),
});

export const labelNutrientKeySchema = z.enum([
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
  'other',
]);

export const nutrientQualifierSchema = z.enum([
  'exact',
  'less_than',
  'approximately',
]);

export const labelNutrientValueSchema = z.object({
  id: z.string().min(1),
  key: labelNutrientKeySchema,
  printedName: z.string().max(120),
  amount: z.number().finite().nonnegative().nullable(),
  unit: z.string().max(24),
  qualifier: nutrientQualifierSchema.default('exact'),
  dailyValuePercent: z.number().finite().nonnegative().nullable().default(null),
  confidence: confidenceSchema.default('medium'),
});

export const nutritionLabelColumnSchema = z.object({
  id: z.string().min(1),
  basis: z.enum(['per_100g', 'per_100ml', 'per_serving']),
  basisAmount: z.number().finite().positive(),
  basisUnit: z.enum(['g', 'ml', 'serving']),
  printedHeading: z.string().max(160),
  servingDescription: z.string().max(240).nullable(),
  servingSize: z
    .object({
      amount: z.number().finite().positive(),
      unit: z.enum(['g', 'ml']),
    })
    .nullable(),
  nutrients: z.array(labelNutrientValueSchema).min(1).max(100),
});

export const nutritionLabelSourceSchema = z
  .object({
    kind: z.literal('nutrition_label'),
    version: z.literal(1),
    productName: z.string().max(240),
    columns: z.array(nutritionLabelColumnSchema).min(1).max(12),
    selectedColumnId: z.string().min(1),
    consumption: z.object({
      amount: z.number().finite().positive(),
      unit: z.enum(['g', 'ml', 'serving']),
    }),
    method: z.enum(['model', 'manual']),
    scannedAt: z.string().nullable(),
    edited: z.boolean(),
    warnings: z.array(z.string().max(320)).max(40),
    copiedFromEntryId: z.string().nullable().default(null),
  })
  .superRefine((source, context) => {
    const column = source.columns.find(
      (candidate) => candidate.id === source.selectedColumnId,
    );
    if (!column) {
      context.addIssue({
        code: 'custom',
        path: ['selectedColumnId'],
        message: 'Select a column that exists on this nutrition label.',
      });
      return;
    }
    const directlyCompatible = column.basisUnit === source.consumption.unit;
    const servingSizeCompatible =
      column.basis === 'per_serving' &&
      column.servingSize?.unit === source.consumption.unit;
    if (!directlyCompatible && !servingSizeCompatible) {
      context.addIssue({
        code: 'custom',
        path: ['consumption', 'unit'],
        message: 'The consumed unit is not supported by the selected column.',
      });
    }
  });

export const nutritionSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ingredient_database'),
    databaseVersion: z.string(),
    matchedIngredientCount: z.number().int().nonnegative(),
    ingredientCount: z.number().int().nonnegative(),
  }),
  nutritionLabelSourceSchema,
]);

export const nutritionMatchSchema = z.object({
  foodId: z.string(),
  foodName: z.string(),
  source: z.enum(['usda_foundation', 'usda_fndds', 'uk_cofid']),
  confidence: confidenceSchema,
  selectedBy: z.enum(['automatic', 'user']).default('automatic'),
  valuesPer100g: nutritionValuesSchema,
});

export const ingredientSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  amount: z.number().finite().nonnegative().nullable(),
  unit: z.string().nullable(),
  preparation: z.string().nullable(),
  confidence: confidenceSchema,
  estimatedGrams: z.number().finite().nonnegative().nullable().default(null),
  nutritionMatch: nutritionMatchSchema.nullable().default(null),
  nutritionExcluded: z.boolean().default(false),
});

const normalizedMealNutritionSchema = z.object({
  values: nutritionValuesSchema,
  source: nutritionSourceSchema,
  additionalValues: z.array(labelNutrientValueSchema).max(100).default([]),
  calculatedAt: z.string(),
  edited: z.boolean().default(false),
  stale: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
});

export const mealNutritionSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const legacy = value as Record<string, unknown>;
  if (legacy.source) return legacy;
  if (typeof legacy.databaseVersion !== 'string') return legacy;
  return {
    ...legacy,
    source: {
      kind: 'ingredient_database',
      databaseVersion: legacy.databaseVersion,
      matchedIngredientCount:
        typeof legacy.matchedIngredientCount === 'number'
          ? legacy.matchedIngredientCount
          : 0,
      ingredientCount:
        typeof legacy.ingredientCount === 'number' ? legacy.ingredientCount : 0,
    },
    additionalValues: [],
  };
}, normalizedMealNutritionSchema);

export const mealAnalysisSchema = z.object({
  classification: classificationSchema,
  dishName: z.string(),
  servings: z.number().finite().positive().nullable(),
  portionSummary: z.string(),
  ingredients: z.array(
    ingredientSchema
      .omit({ id: true, nutritionMatch: true })
      .extend({ id: z.string().optional() }),
  ),
  overallConfidence: confidenceSchema,
  uncertaintyNotes: z.array(z.string()),
});

export const analysisMetadataSchema = z.object({
  kind: z.enum(['meal_photo', 'nutrition_label']).default('meal_photo'),
  model: z.string(),
  endpointOrigin: z.string(),
  promptVersion: z.string(),
  analysedAt: z.string(),
  confidence: confidenceSchema,
});

export const nutritionLabelAnalysisSchema = z.object({
  productName: z.string().max(240),
  columns: z
    .array(
      nutritionLabelColumnSchema.omit({ id: true }).extend({
        nutrients: z
          .array(labelNutrientValueSchema.omit({ id: true }))
          .min(1)
          .max(100),
      }),
    )
    .min(1)
    .max(12),
  warnings: z.array(z.string().max(320)).max(40),
  overallConfidence: confidenceSchema,
});

export const mealEntrySchema = z.object({
  id: z.string().min(1),
  capturedAt: z.string(),
  eatenAt: z.string(),
  mealType: mealTypeSchema,
  title: z.string(),
  notes: z.string(),
  classification: classificationSchema,
  servings: z.number().finite().positive().nullable(),
  portionSummary: z.string(),
  ingredients: z.array(ingredientSchema),
  nutrition: mealNutritionSchema.nullable().default(null),
  photoId: z.string().nullable(),
  analysis: analysisMetadataSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const responseModeSchema = z.enum([
  'json_schema',
  'json_object',
  'text',
]);

export const modelSettingsSchema = z.object({
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string(),
  extraHeaders: z.record(z.string(), z.string()),
  responseMode: responseModeSchema,
  timeoutMs: z.number().int().min(1_000).max(300_000),
  maxImageDimension: z.number().int().min(512).max(3_072),
  imageQuality: z.number().min(0.5).max(1),
  privacyAcknowledged: z.boolean(),
  credentialStorage: z.enum(['device', 'session']),
});

const archivePhotoSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string(),
  file: z.string(),
});

const archiveFields = {
  format: z.literal('scranbook-archive'),
  exportedAt: z.string(),
  entries: z.array(mealEntrySchema),
  photos: z.array(archivePhotoSchema),
};

export const archiveManifestSchema = z.discriminatedUnion('version', [
  z.object({ ...archiveFields, version: z.literal(1) }),
  z.object({ ...archiveFields, version: z.literal(2) }),
]);

export const storedPhotoSchema = z.object({
  id: z.string().min(1),
  blob: z.custom<Blob>((value) => value instanceof Blob),
  mimeType: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const mealDraftSchema = z.object({
  format: z.literal('scranbook-draft'),
  version: z.literal(1),
  mode: z.enum(['new', 'edit', 'repeat']),
  sourceEntryId: z.string().nullable(),
  entry: mealEntrySchema,
  photo: storedPhotoSchema.nullable(),
  savedAt: z.string(),
});

export const backupStateSchema = z.object({
  version: z.literal(1),
  lastArchiveCreatedAt: z.string().nullable(),
  entryCountAtArchive: z.number().int().nonnegative(),
  latestEntryUpdatedAtAtArchive: z.string().nullable(),
  reminderDismissedUntil: z.string().nullable(),
});

export type Confidence = z.infer<typeof confidenceSchema>;
export type Classification = z.infer<typeof classificationSchema>;
export type MealType = z.infer<typeof mealTypeSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type NutritionValues = z.infer<typeof nutritionValuesSchema>;
export type LabelNutrientKey = z.infer<typeof labelNutrientKeySchema>;
export type NutrientQualifier = z.infer<typeof nutrientQualifierSchema>;
export type LabelNutrientValue = z.infer<typeof labelNutrientValueSchema>;
export type NutritionLabelColumn = z.infer<typeof nutritionLabelColumnSchema>;
export type NutritionLabelSource = z.infer<typeof nutritionLabelSourceSchema>;
export type NutritionSource = z.infer<typeof nutritionSourceSchema>;
export type NutritionMatch = z.infer<typeof nutritionMatchSchema>;
export type MealNutrition = z.infer<typeof mealNutritionSchema>;
export type MealAnalysis = z.infer<typeof mealAnalysisSchema>;
export type NutritionLabelAnalysis = z.infer<
  typeof nutritionLabelAnalysisSchema
>;
export type AnalysisMetadata = z.infer<typeof analysisMetadataSchema>;
export type MealEntry = z.infer<typeof mealEntrySchema>;
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export type ResponseMode = z.infer<typeof responseModeSchema>;
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;
export type MealDraft = z.infer<typeof mealDraftSchema>;
export type BackupState = z.infer<typeof backupStateSchema>;

export interface StoredPhoto {
  id: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
}

export const defaultModelSettings: ModelSettings = {
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'google/gemma-4-e4b',
  apiKey: '',
  extraHeaders: {},
  responseMode: 'json_schema',
  timeoutMs: 120_000,
  maxImageDimension: 1_600,
  imageQuality: 0.82,
  privacyAcknowledged: false,
  credentialStorage: 'device',
};

export function createBlankEntry(now = new Date()): MealEntry {
  const timestamp = now.toISOString();
  const hour = now.getHours();
  const mealType: MealType =
    hour < 11
      ? 'breakfast'
      : hour < 15
        ? 'lunch'
        : hour < 21
          ? 'dinner'
          : 'snack';

  return {
    id: crypto.randomUUID(),
    capturedAt: timestamp,
    eatenAt: timestamp,
    mealType,
    title: '',
    notes: '',
    classification: 'meal',
    servings: null,
    portionSummary: '',
    ingredients: [],
    nutrition: null,
    photoId: null,
    analysis: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createRepeatedEntry(
  source: MealEntry,
  now = new Date(),
): MealEntry {
  const blank = createBlankEntry(now);
  return mealEntrySchema.parse({
    ...blank,
    title: source.title,
    classification: source.classification,
    servings: source.servings,
    portionSummary: source.portionSummary,
    ingredients: source.ingredients.map((ingredient) => ({
      ...ingredient,
      id: crypto.randomUUID(),
    })),
    nutrition: source.nutrition
      ? source.nutrition.source.kind === 'nutrition_label'
        ? {
            ...source.nutrition,
            source: {
              ...source.nutrition.source,
              copiedFromEntryId: source.id,
            },
            calculatedAt: blank.updatedAt,
            stale: false,
          }
        : {
            ...source.nutrition,
            stale: true,
            notes: [
              ...source.nutrition.notes,
              'Copied from a previous meal. Recalculate after checking the portion.',
            ],
          }
      : null,
    notes: '',
    photoId: null,
    analysis: null,
  });
}
