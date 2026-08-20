import { describe, expect, it } from 'vitest';
import {
  checkInSummary,
  createMealCheckIn,
  findMealPatterns,
} from '@/lib/meal-check-ins';
import { createBlankEntry, type MealEntry } from '@/lib/schema';

function checkedMeal(
  day: number,
  ingredient: string,
  symptom: boolean,
): MealEntry {
  const date = String(day).padStart(2, '0');
  const entry = createBlankEntry(new Date(`2026-08-${date}T12:00:00.000Z`));
  entry.title = `${ingredient} lunch`;
  entry.ingredients = [
    {
      id: crypto.randomUUID(),
      name: ingredient,
      amount: null,
      unit: null,
      preparation: null,
      confidence: 'high',
      estimatedGrams: null,
      nutritionMatch: null,
      nutritionExcluded: false,
    },
  ];
  entry.checkIns = [
    createMealCheckIn(
      symptom
        ? {
            feeling: 'a_little_off',
            symptoms: ['bloating'],
            severity: 2,
            onset: '1_to_3_hours',
            notes: '',
          }
        : {
            feeling: 'fine',
            symptoms: [],
            severity: null,
            onset: null,
            notes: '',
          },
      new Date(`2026-08-${date}T15:00:00.000Z`),
    ),
  ];
  return entry;
}

describe('meal follow-ups and possible patterns', () => {
  it('summarizes symptom-free and symptom check-ins plainly', () => {
    expect(
      checkInSummary(
        createMealCheckIn({
          feeling: 'fine',
          symptoms: [],
          severity: null,
          onset: null,
          notes: '',
        }),
      ),
    ).toBe('Felt fine');
    expect(
      checkInSummary(
        createMealCheckIn({
          feeling: 'a_little_off',
          symptoms: ['bloating'],
          severity: 2,
          onset: '1_to_3_hours',
          notes: '',
        }),
      ),
    ).toBe('Bloating · light');
    expect(
      checkInSummary(
        createMealCheckIn({
          feeling: 'unwell',
          symptoms: ['other'],
          severity: null,
          onset: null,
          notes: 'Hard to describe',
        }),
      ),
    ).toBe('Something else / not sure');
  });

  it('requires enough checked meals before suggesting a pattern', () => {
    expect(
      findMealPatterns([
        checkedMeal(1, 'Onions', true),
        checkedMeal(2, 'Onion', true),
        checkedMeal(3, 'Onion', true),
        checkedMeal(4, 'Onion', false),
        checkedMeal(5, 'Rice', false),
        checkedMeal(6, 'Rice', false),
        checkedMeal(7, 'Rice', false),
      ]),
    ).toEqual([]);
  });

  it('compares checked meals with and without an ingredient', () => {
    const pattern = findMealPatterns([
      checkedMeal(1, 'Onions', true),
      checkedMeal(2, 'Onion', true),
      checkedMeal(3, 'Onion', true),
      checkedMeal(4, 'Onion', false),
      checkedMeal(5, 'Rice', false),
      checkedMeal(6, 'Rice', false),
      checkedMeal(7, 'Rice', false),
      checkedMeal(8, 'Rice', false),
      { ...checkedMeal(9, 'Onion', true), checkIns: [] },
    ])[0];

    expect(pattern).toMatchObject({
      normalizedIngredient: 'onion',
      symptom: 'bloating',
      exposedMeals: 4,
      exposedSymptomMeals: 3,
      unexposedMeals: 4,
      unexposedSymptomMeals: 0,
      typicalOnset: '1_to_3_hours',
    });
  });

  it('does not turn an uncertain free-text symptom into a food signal', () => {
    const entries = Array.from({ length: 8 }, (_, index) => {
      const entry = checkedMeal(index + 1, index < 4 ? 'Onion' : 'Rice', false);
      if (index < 3) {
        entry.checkIns = [
          createMealCheckIn({
            feeling: 'a_little_off',
            symptoms: ['other'],
            severity: null,
            onset: null,
            notes: '',
          }),
        ];
      }
      return entry;
    });
    expect(findMealPatterns(entries)).toEqual([]);
  });
});
