'use client';

import { Database, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { searchNutritionFoods, type NutritionCandidate } from '@/lib/nutrition';
import type { Ingredient } from '@/lib/schema';

function sourceLabel(source: NutritionCandidate['food']['source']) {
  return source === 'uk_cofid' ? 'UK CoFID' : 'USDA FoodData Central';
}

function value(value: number | null, unit: string) {
  return value === null ? '—' : `${value.toLocaleString()} ${unit}`;
}

export function NutritionMatchPicker({
  ingredient,
  onChoose,
  onExclude,
  onAutomatic,
  onClose,
}: {
  ingredient: Ingredient;
  onChoose: (candidate: NutritionCandidate) => void;
  onExclude: () => void;
  onAutomatic: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(
    `${ingredient.name} ${ingredient.preparation ?? ''}`.trim(),
  );
  const [results, setResults] = useState<NutritionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchNutritionFoods({ name: query, preparation: null }, 8).then(
        (matches) => {
          if (!active) return;
          setResults(matches);
          setLoading(false);
        },
      );
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="match-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-picker-heading"
      >
        <header>
          <div>
            <p className="eyebrow">Bundled food data</p>
            <h2 id="match-picker-heading">Review {ingredient.name} match</h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close match picker"
          >
            <X />
          </button>
        </header>
        <label className="match-search">
          <span>Search local food records</span>
          <span>
            <Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
        </label>
        <div className="match-results" aria-live="polite">
          {loading ? (
            <p className="muted">Searching this device…</p>
          ) : results.length === 0 ? (
            <p className="muted">No local food records matched that search.</p>
          ) : (
            results.map((candidate) => (
              <button
                key={candidate.food.id}
                className={
                  ingredient.nutritionMatch?.foodId === candidate.food.id
                    ? 'match-result match-result--selected'
                    : 'match-result'
                }
                onClick={() => onChoose(candidate)}
              >
                <Database />
                <span>
                  <strong>{candidate.food.name}</strong>
                  <small>
                    {sourceLabel(candidate.food.source)} ·{' '}
                    {candidate.food.category}
                  </small>
                  <small>
                    {value(candidate.food.energyKcal, 'kcal')} · Protein{' '}
                    {value(candidate.food.proteinG, 'g')} · Carbs{' '}
                    {value(candidate.food.carbsG, 'g')} · Fat{' '}
                    {value(candidate.food.fatG, 'g')} per 100 g
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
        <footer>
          <button className="button button--quiet" onClick={onAutomatic}>
            Use automatic match
          </button>
          <button className="button button--danger" onClick={onExclude}>
            Exclude from nutrition
          </button>
        </footer>
      </section>
    </div>
  );
}
