import { describe, expect, it } from 'vitest';
import {
  createBlankEntry,
  mealAnalysisSchema,
  mealEntrySchema,
  modelSettingsSchema,
} from '@/lib/schema';

describe('Scranbook schemas', () => {
  it('creates a valid editable diary entry', () => {
    const entry = createBlankEntry(new Date('2026-07-12T12:00:00.000Z'));
    expect(mealEntrySchema.parse(entry)).toEqual(entry);
    expect(entry.ingredients).toEqual([]);
    expect(entry.photoId).toBeNull();
  });

  it('rejects impossible portions and invalid confidence', () => {
    const result = mealAnalysisSchema.safeParse({
      classification: 'meal',
      dishName: 'Toast',
      servings: -1,
      portionSummary: 'one plate',
      ingredients: [],
      overallConfidence: 'certain',
      uncertaintyNotes: [],
    });
    expect(result.success).toBe(false);
  });

  it('validates model limits', () => {
    const result = modelSettingsSchema.safeParse({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'google/gemma-4-e4b',
      apiKey: '',
      extraHeaders: {},
      responseMode: 'json_object',
      timeoutMs: 10,
      maxImageDimension: 1600,
      imageQuality: 0.82,
      privacyAcknowledged: true,
      credentialStorage: 'device',
    });
    expect(result.success).toBe(false);
  });

  it('migrates entries created before local nutrition was added', () => {
    const entry = createBlankEntry();
    const legacy = {
      ...entry,
      ingredients: [
        {
          id: crypto.randomUUID(),
          name: 'rice',
          amount: 100,
          unit: 'g',
          preparation: null,
          confidence: 'medium',
        },
      ],
    };
    delete (legacy as Partial<typeof legacy>).nutrition;
    const parsed = mealEntrySchema.parse(legacy);
    expect(parsed.nutrition).toBeNull();
    expect(parsed.ingredients[0]?.estimatedGrams).toBeNull();
    expect(parsed.ingredients[0]?.nutritionMatch).toBeNull();
  });
});
