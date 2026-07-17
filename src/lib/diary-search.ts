import type { Classification, MealEntry, MealType } from './schema';

export interface DiaryFilters {
  query: string;
  mealType: MealType | 'all';
  classification: Classification | 'all';
  dateFrom: string;
  dateTo: string;
}

export const emptyDiaryFilters: DiaryFilters = {
  query: '',
  mealType: 'all',
  classification: 'all',
  dateFrom: '',
  dateTo: '',
};

export function normalizeDiaryText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function searchableEntryText(entry: MealEntry) {
  return normalizeDiaryText(
    [
      entry.title,
      entry.portionSummary,
      entry.notes,
      ...entry.ingredients.flatMap((ingredient) => [
        ingredient.name,
        ingredient.preparation ?? '',
        ingredient.nutritionMatch?.foodName ?? '',
      ]),
    ].join(' '),
  );
}

export function hasActiveDiaryFilters(filters: DiaryFilters) {
  return (
    filters.query.trim() !== '' ||
    filters.mealType !== 'all' ||
    filters.classification !== 'all' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== ''
  );
}

export function filterDiaryEntries(
  entries: MealEntry[],
  filters: DiaryFilters,
) {
  const query = normalizeDiaryText(filters.query);
  const from = filters.dateFrom
    ? new Date(`${filters.dateFrom}T00:00:00`).getTime()
    : null;
  const to = filters.dateTo
    ? new Date(`${filters.dateTo}T23:59:59.999`).getTime()
    : null;

  return entries.filter((entry) => {
    if (filters.mealType !== 'all' && entry.mealType !== filters.mealType)
      return false;
    if (
      filters.classification !== 'all' &&
      entry.classification !== filters.classification
    )
      return false;
    const eatenAt = new Date(entry.eatenAt).getTime();
    if (from !== null && eatenAt < from) return false;
    if (to !== null && eatenAt > to) return false;
    return !query || searchableEntryText(entry).includes(query);
  });
}
