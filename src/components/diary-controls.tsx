import { Search, X } from 'lucide-react';
import {
  emptyDiaryFilters,
  hasActiveDiaryFilters,
  type DiaryFilters,
} from '@/lib/diary-search';

export function DiaryControls({
  filters,
  resultCount,
  totalCount,
  onChange,
}: {
  filters: DiaryFilters;
  resultCount: number;
  totalCount: number;
  onChange: (filters: DiaryFilters) => void;
}) {
  const active = hasActiveDiaryFilters(filters);
  return (
    <section className="diary-controls" aria-label="Find diary entries">
      <div className="diary-search">
        <Search />
        <input
          aria-label="Search diary"
          type="search"
          value={filters.query}
          placeholder="Search meals, ingredients, notes…"
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
        />
        {filters.query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange({ ...filters, query: '' })}
          >
            <X />
          </button>
        )}
      </div>
      <details className="diary-filter-details">
        <summary>Filters{active ? ` · ${resultCount} found` : ''}</summary>
        <div className="diary-filter-grid">
          <label>
            <span>Meal</span>
            <select
              value={filters.mealType}
              onChange={(event) =>
                onChange({
                  ...filters,
                  mealType: event.target.value as DiaryFilters['mealType'],
                })
              }
            >
              <option value="all">All meals</option>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
              <option value="snack">Snack</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span>Kind</span>
            <select
              value={filters.classification}
              onChange={(event) =>
                onChange({
                  ...filters,
                  classification: event.target
                    .value as DiaryFilters['classification'],
                })
              }
            >
              <option value="all">All kinds</option>
              <option value="meal">Meals</option>
              <option value="recipe_card">Recipe cards</option>
              <option value="packaged_food">Packaged food</option>
              <option value="unclear">Unclear images</option>
            </select>
          </label>
          <label>
            <span>From</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) =>
                onChange({ ...filters, dateFrom: event.target.value })
              }
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) =>
                onChange({ ...filters, dateTo: event.target.value })
              }
            />
          </label>
        </div>
        {active && (
          <button
            type="button"
            className="text-button"
            onClick={() => onChange(emptyDiaryFilters)}
          >
            Clear all filters
          </button>
        )}
      </details>
      <p className="diary-result-count" aria-live="polite">
        {active
          ? `${resultCount} of ${totalCount} entries`
          : `${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}`}
      </p>
    </section>
  );
}
