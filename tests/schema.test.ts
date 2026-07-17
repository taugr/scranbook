import { describe, expect, it } from 'vitest';
import {
  createBlankEntry,
  createRepeatedEntry,
  mealDraftSchema,
  mealAnalysisSchema,
  mealEntrySchema,
  modelSettingsSchema,
} from '@/lib/schema';
import {
  createManualNutritionLabelSource,
  scaleNutritionLabel,
} from '@/lib/nutrition-label';

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
    expect(parsed.ingredients[0]?.nutritionExcluded).toBe(false);
  });

  it('normalizes legacy nutrition into explicit database provenance', () => {
    const entry = createBlankEntry();
    const parsed = mealEntrySchema.parse({
      ...entry,
      nutrition: {
        values: {
          energyKcal: 100,
          proteinG: 3,
          carbsG: 12,
          fatG: 4,
          fibreG: 2,
          saltG: 0.4,
        },
        matchedIngredientCount: 1,
        ingredientCount: 1,
        databaseVersion: 'legacy-v1',
        calculatedAt: entry.updatedAt,
      },
    });
    expect(parsed.nutrition?.source).toEqual({
      kind: 'ingredient_database',
      databaseVersion: 'legacy-v1',
      matchedIngredientCount: 1,
      ingredientCount: 1,
    });
    expect(parsed.nutrition?.values.energyKj).toBeNull();
    expect(parsed.nutrition?.additionalValues).toEqual([]);
  });

  it('creates a fresh repeat draft without stale context', () => {
    const source = {
      ...createBlankEntry(new Date('2026-07-12T12:00:00Z')),
      title: 'Tomato toast',
      notes: 'Ate this in the garden',
      photoId: 'photo-1',
      analysis: {
        kind: 'meal_photo' as const,
        model: 'vision-model',
        endpointOrigin: 'http://127.0.0.1:1234',
        promptVersion: 'v1',
        analysedAt: '2026-07-12T12:00:00Z',
        confidence: 'high' as const,
      },
    };
    const repeated = createRepeatedEntry(
      source,
      new Date('2026-07-18T18:00:00Z'),
    );
    expect(repeated.id).not.toBe(source.id);
    expect(repeated.title).toBe('Tomato toast');
    expect(repeated.eatenAt).toBe('2026-07-18T18:00:00.000Z');
    expect(repeated.photoId).toBeNull();
    expect(repeated.analysis).toBeNull();
    expect(repeated.notes).toBe('');
  });

  it('repeats reviewed label facts without copying photo or analysis', () => {
    const source = createBlankEntry(new Date('2026-07-12T12:00:00Z'));
    const label = createManualNutritionLabelSource();
    label.productName = 'Oat bar';
    label.columns[0]!.nutrients[0]!.amount = 420;
    source.title = label.productName;
    source.classification = 'packaged_food';
    source.nutrition = scaleNutritionLabel(label);
    source.photoId = 'label-photo';
    source.analysis = {
      kind: 'nutrition_label',
      model: 'vision-model',
      endpointOrigin: 'http://127.0.0.1:1234',
      promptVersion: 'nutrition-label-analysis-v1',
      analysedAt: source.updatedAt,
      confidence: 'medium',
    };

    const repeated = createRepeatedEntry(
      source,
      new Date('2026-07-18T18:00:00Z'),
    );

    expect(repeated.photoId).toBeNull();
    expect(repeated.analysis).toBeNull();
    expect(repeated.nutrition?.stale).toBe(false);
    expect(repeated.nutrition?.source).toMatchObject({
      kind: 'nutrition_label',
      copiedFromEntryId: source.id,
    });
    expect(repeated.nutrition?.values.energyKcal).toBe(420);
  });

  it('validates a versioned meal draft with a processed photo', () => {
    const entry = createBlankEntry();
    const photo = {
      id: 'draft-photo',
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
      byteSize: 1,
      createdAt: entry.createdAt,
    };
    expect(
      mealDraftSchema.parse({
        format: 'scranbook-draft',
        version: 1,
        mode: 'new',
        sourceEntryId: null,
        entry,
        photo,
        savedAt: entry.updatedAt,
      }).photo?.id,
    ).toBe('draft-photo');
  });
});
