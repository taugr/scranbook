import { describe, expect, it } from 'vitest';
import {
  emptyDiaryFilters,
  filterDiaryEntries,
  normalizeDiaryText,
} from '@/lib/diary-search';
import { createBlankEntry } from '@/lib/schema';

const breakfast = {
  ...createBlankEntry(new Date('2026-07-10T08:00:00Z')),
  title: 'Mushroom toast',
  notes: 'Ate in the garden',
  ingredients: [
    {
      id: 'mushrooms',
      name: 'Chestnut mushrooms',
      amount: 100,
      unit: 'g',
      preparation: 'fried',
      confidence: 'high' as const,
      estimatedGrams: 100,
      nutritionMatch: null,
      nutritionExcluded: false,
    },
  ],
};
const dinner = {
  ...createBlankEntry(new Date('2026-07-12T19:00:00Z')),
  title: 'Tomato pasta',
  mealType: 'dinner' as const,
  classification: 'meal' as const,
};

describe('diary search', () => {
  it('normalizes punctuation, accents, and apostrophes', () => {
    expect(normalizeDiaryText("Tom's café-toast")).toBe('toms cafe toast');
  });

  it('preserves letters and numbers from non-Latin scripts', () => {
    const armenian = {
      ...breakfast,
      title: 'Տոլմա մածունով',
    };
    expect(normalizeDiaryText('ՏՈԼՄԱ №2')).toBe('տոլմա no2');
    expect(
      filterDiaryEntries([dinner, armenian], {
        ...emptyDiaryFilters,
        query: 'տոլմա',
      }).map((entry) => entry.title),
    ).toEqual(['Տոլմա մածունով']);
  });

  it('searches meal content and combines filters', () => {
    expect(
      filterDiaryEntries([dinner, breakfast], {
        ...emptyDiaryFilters,
        query: 'garden',
      }).map((entry) => entry.title),
    ).toEqual(['Mushroom toast']);
    expect(
      filterDiaryEntries([dinner, breakfast], {
        ...emptyDiaryFilters,
        query: 'tomato',
        mealType: 'dinner',
        dateFrom: '2026-07-12',
      }).map((entry) => entry.title),
    ).toEqual(['Tomato pasta']);
  });
});
