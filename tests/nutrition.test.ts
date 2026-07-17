import { describe, expect, it } from 'vitest';
import {
  amountInGrams,
  calculateNutrition,
  findNutritionMatches,
  type NutritionFood,
} from '@/lib/nutrition';
import type { Ingredient } from '@/lib/schema';

const foods: NutritionFood[] = [
  {
    id: 'cofid:rice',
    name: 'Rice, white, boiled',
    category: 'Cereals',
    source: 'uk_cofid',
    energyKcal: 130,
    proteinG: 2.7,
    carbsG: 28,
    fatG: 0.3,
    fibreG: 0.4,
    sodiumMg: 1,
  },
  {
    id: 'fdc:tomato-raw',
    name: 'Tomatoes, raw',
    category: 'Vegetables',
    source: 'usda_fndds',
    energyKcal: 18,
    proteinG: 0.9,
    carbsG: 3.9,
    fatG: 0.2,
    fibreG: 1.2,
    sodiumMg: 5,
  },
  {
    id: 'fdc:tomato-cooked',
    name: 'Tomatoes, cooked',
    category: 'Vegetables',
    source: 'usda_fndds',
    energyKcal: 20,
    proteinG: 1,
    carbsG: 4.8,
    fatG: 0.1,
    fibreG: 1.5,
    sodiumMg: 10,
  },
];

function ingredient(patch: Partial<Ingredient> = {}): Ingredient {
  return {
    id: crypto.randomUUID(),
    name: 'white rice',
    amount: 150,
    unit: 'g',
    preparation: 'boiled',
    confidence: 'high',
    estimatedGrams: null,
    nutritionMatch: null,
    nutritionExcluded: false,
    ...patch,
  };
}

describe('local nutrition calculation', () => {
  it('converts supported household quantities to grams', () => {
    expect(amountInGrams(ingredient({ amount: 2, unit: 'oz' }))).toBeCloseTo(
      56.699,
    );
    expect(amountInGrams(ingredient({ amount: 1, unit: 'tbsp' }))).toBe(15);
    expect(amountInGrams(ingredient({ amount: 2, unit: 'slices' }))).toBeNull();
  });

  it('uses preparation words and prefers raw foods when no cooking is named', () => {
    expect(
      findNutritionMatches({ name: 'tomatoes', preparation: null }, foods, 1)[0]
        ?.food.id,
    ).toBe('fdc:tomato-raw');
    expect(
      findNutritionMatches(
        { name: 'tomatoes', preparation: 'cooked' },
        foods,
        1,
      )[0]?.food.id,
    ).toBe('fdc:tomato-cooked');
  });

  it('scales per-100g nutrients and converts sodium to salt', () => {
    const result = calculateNutrition(
      [ingredient()],
      { version: 'test-1', foods },
      new Date('2026-07-12T00:00:00Z'),
    );
    expect(result.nutrition.values.energyKcal).toBe(195);
    expect(result.nutrition.values.carbsG).toBe(42);
    expect(result.nutrition.values.saltG).toBe(0);
    expect(result.nutrition.source).toMatchObject({
      kind: 'ingredient_database',
      matchedIngredientCount: 1,
    });
    expect(result.ingredients[0]?.nutritionMatch?.foodId).toBe('cofid:rice');
    expect(result.ingredients[0]?.nutritionMatch?.selectedBy).toBe('automatic');
  });

  it('preserves a user-selected food and supports explicit exclusion', () => {
    const manual = calculateNutrition(
      [
        ingredient({
          name: 'tomatoes',
          preparation: 'raw',
          estimatedGrams: 100,
          nutritionMatch: {
            foodId: 'fdc:tomato-cooked',
            foodName: 'Tomatoes, cooked',
            source: 'usda_fndds',
            confidence: 'medium',
            selectedBy: 'user',
            valuesPer100g: {
              energyKcal: 20,
              energyKj: null,
              proteinG: 1,
              carbsG: 4.8,
              fatG: 0.1,
              saturatesG: null,
              sugarsG: null,
              fibreG: 1.5,
              saltG: 0.03,
              sodiumMg: null,
            },
          },
        }),
      ],
      { version: 'test-1', foods },
    );
    expect(manual.ingredients[0]?.nutritionMatch?.foodId).toBe(
      'fdc:tomato-cooked',
    );
    expect(manual.ingredients[0]?.nutritionMatch?.selectedBy).toBe('user');

    const excluded = calculateNutrition(
      [ingredient({ nutritionExcluded: true })],
      { version: 'test-1', foods },
    );
    expect(excluded.nutrition.source).toMatchObject({
      kind: 'ingredient_database',
      matchedIngredientCount: 0,
    });
    expect(excluded.nutrition.notes[0]).toMatch(/excluded/);
  });

  it('keeps unmatched ingredients visible in the estimate notes', () => {
    const result = calculateNutrition(
      [ingredient({ name: 'mystery garnish', estimatedGrams: 10 })],
      { version: 'test-1', foods },
    );
    expect(result.nutrition.source).toMatchObject({
      kind: 'ingredient_database',
      matchedIngredientCount: 0,
    });
    expect(result.nutrition.notes[0]).toMatch(/No reliable local food match/);
  });
});
