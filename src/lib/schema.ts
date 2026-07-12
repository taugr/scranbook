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
  proteinG: z.number().finite().nonnegative().nullable(),
  carbsG: z.number().finite().nonnegative().nullable(),
  fatG: z.number().finite().nonnegative().nullable(),
  fibreG: z.number().finite().nonnegative().nullable(),
  saltG: z.number().finite().nonnegative().nullable(),
});

export const nutritionMatchSchema = z.object({
  foodId: z.string(),
  foodName: z.string(),
  source: z.enum(['usda_foundation', 'usda_fndds', 'uk_cofid']),
  confidence: confidenceSchema,
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
});

export const mealNutritionSchema = z.object({
  values: nutritionValuesSchema,
  matchedIngredientCount: z.number().int().nonnegative(),
  ingredientCount: z.number().int().nonnegative(),
  databaseVersion: z.string(),
  calculatedAt: z.string(),
  edited: z.boolean().default(false),
  stale: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
});

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
  model: z.string(),
  endpointOrigin: z.string(),
  promptVersion: z.string(),
  analysedAt: z.string(),
  confidence: confidenceSchema,
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

export const archiveManifestSchema = z.object({
  format: z.literal('scranbook-archive'),
  version: z.literal(1),
  exportedAt: z.string(),
  entries: z.array(mealEntrySchema),
  photos: z.array(
    z.object({
      id: z.string(),
      mimeType: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      byteSize: z.number().int().nonnegative(),
      createdAt: z.string(),
      file: z.string(),
    }),
  ),
});

export type Confidence = z.infer<typeof confidenceSchema>;
export type Classification = z.infer<typeof classificationSchema>;
export type MealType = z.infer<typeof mealTypeSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type NutritionValues = z.infer<typeof nutritionValuesSchema>;
export type NutritionMatch = z.infer<typeof nutritionMatchSchema>;
export type MealNutrition = z.infer<typeof mealNutritionSchema>;
export type MealAnalysis = z.infer<typeof mealAnalysisSchema>;
export type AnalysisMetadata = z.infer<typeof analysisMetadataSchema>;
export type MealEntry = z.infer<typeof mealEntrySchema>;
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export type ResponseMode = z.infer<typeof responseModeSchema>;
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

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
