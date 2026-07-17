'use client';

import { useEffect, useState } from 'react';
import {
  compatibleConsumptionUnits,
  displayNutrientAmount,
  parseLocaleNumber,
} from '@/lib/nutrition-label';
import type { NutritionLabelSource, NutritionValues } from '@/lib/schema';

function qualifier(value: 'exact' | 'less_than' | 'approximately') {
  return value === 'less_than' ? '<' : value === 'approximately' ? '≈' : '';
}

export function ConsumptionScaler({
  source,
  values,
  onChange,
}: {
  source: NutritionLabelSource;
  values: NutritionValues;
  onChange: (source: NutritionLabelSource) => void;
}) {
  const column = source.columns.find(
    (candidate) => candidate.id === source.selectedColumnId,
  )!;
  const [amount, setAmount] = useState(String(source.consumption.amount));
  useEffect(
    () => setAmount(String(source.consumption.amount)),
    [source.consumption.amount],
  );
  const units = compatibleConsumptionUnits(column);
  const energy =
    column.nutrients.find((nutrient) => nutrient.key === 'energy_kcal') ??
    column.nutrients.find((nutrient) => nutrient.key === 'energy_kj');
  const consumedEnergy =
    energy?.key === 'energy_kj' ? values.energyKj : values.energyKcal;

  function commitAmount(value: string) {
    const parsed = parseLocaleNumber(value);
    if (parsed === null || parsed <= 0) return;
    onChange({
      ...source,
      consumption: { ...source.consumption, amount: parsed },
      edited: true,
    });
  }

  return (
    <section
      className="consumption-scaler"
      aria-labelledby="consumption-heading"
    >
      <div>
        <p className="eyebrow">Scale on this device</p>
        <h3 id="consumption-heading">How much did you consume?</h3>
      </div>
      <div className="consumption-inputs">
        <label>
          <span>Amount consumed</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              commitAmount(event.target.value);
            }}
            onBlur={() => commitAmount(amount)}
          />
        </label>
        <label>
          <span>Unit</span>
          <select
            value={source.consumption.unit}
            onChange={(event) =>
              onChange({
                ...source,
                consumption: {
                  ...source.consumption,
                  unit: event.target.value as 'g' | 'ml' | 'serving',
                },
                edited: true,
              })
            }
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unit === 'serving' ? 'servings' : unit}
              </option>
            ))}
          </select>
        </label>
      </div>
      {energy && energy.amount !== null && consumedEnergy !== null && (
        <p className="scaling-equation">
          Label: {qualifier(energy.qualifier)}
          {displayNutrientAmount(energy.amount, energy.unit)} {energy.unit} per{' '}
          {column.basisAmount} {column.basisUnit} · You consumed:{' '}
          {source.consumption.amount} {source.consumption.unit} · Consumed:{' '}
          <strong>
            {qualifier(energy.qualifier)}
            {displayNutrientAmount(consumedEnergy, energy.unit)} {energy.unit}
          </strong>
        </p>
      )}
    </section>
  );
}
