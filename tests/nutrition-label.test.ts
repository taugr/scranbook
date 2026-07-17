import { describe, expect, it } from 'vitest';
import {
  canonicalNutrientKey,
  compatibleConsumptionUnits,
  labelPlausibilityWarnings,
  labelScaleFactor,
  scaleNutritionLabel,
} from '@/lib/nutrition-label';
import type { NutritionLabelSource } from '@/lib/schema';

function source(
  patch: Partial<NutritionLabelSource> = {},
): NutritionLabelSource {
  return {
    kind: 'nutrition_label',
    version: 1,
    productName: 'Oat bar',
    columns: [
      {
        id: 'per-100g',
        basis: 'per_100g',
        basisAmount: 100,
        basisUnit: 'g',
        printedHeading: 'Per 100 g',
        servingDescription: null,
        servingSize: null,
        nutrients: [
          {
            id: 'energy',
            key: 'energy_kcal',
            printedName: 'Energy',
            amount: 240,
            unit: 'kcal',
            qualifier: 'exact',
            dailyValuePercent: null,
            confidence: 'high',
          },
          {
            id: 'protein',
            key: 'protein',
            printedName: 'Protein',
            amount: 10,
            unit: 'g',
            qualifier: 'less_than',
            dailyValuePercent: 20,
            confidence: 'medium',
          },
          {
            id: 'iron',
            key: 'other',
            printedName: 'Iron',
            amount: 2.4,
            unit: 'mg',
            qualifier: 'approximately',
            dailyValuePercent: 15,
            confidence: 'high',
          },
        ],
      },
    ],
    selectedColumnId: 'per-100g',
    consumption: { amount: 35, unit: 'g' },
    method: 'model',
    scannedAt: '2026-07-18T00:00:00.000Z',
    edited: false,
    warnings: [],
    copiedFromEntryId: null,
    ...patch,
  };
}

describe('nutrition-label scaling', () => {
  it('maps common printed nutrient names while preserving unknown rows', () => {
    expect(canonicalNutrientKey('of which saturates', 'g')).toBe('saturates');
    expect(canonicalNutrientKey('Dietary Fiber', 'g')).toBe('fibre');
    expect(canonicalNutrientKey('Vitamin B12', 'µg')).toBe('other');
  });

  it('scales per-100-g values without rounding intermediate amounts', () => {
    const result = scaleNutritionLabel(source());
    expect(labelScaleFactor(source())).toBe(0.35);
    expect(result.values.energyKcal).toBe(84);
    expect(result.values.proteinG).toBe(3.5);
    expect(result.additionalValues[0]).toMatchObject({
      printedName: 'Iron',
      amount: 0.84,
      unit: 'mg',
      qualifier: 'approximately',
    });
  });

  it('supports servings and explicit serving weights only', () => {
    const servingColumn = {
      ...source().columns[0]!,
      id: 'serving',
      basis: 'per_serving' as const,
      basisAmount: 1,
      basisUnit: 'serving' as const,
      printedHeading: 'Per bar',
      servingDescription: '1 bar (30 g)',
      servingSize: { amount: 30, unit: 'g' as const },
    };
    const servingSource = source({
      columns: [servingColumn],
      selectedColumnId: 'serving',
      consumption: { amount: 45, unit: 'g' },
    });
    expect(compatibleConsumptionUnits(servingColumn)).toEqual(['serving', 'g']);
    expect(labelScaleFactor(servingSource)).toBe(1.5);
    expect(scaleNutritionLabel(servingSource).values.energyKcal).toBe(360);
  });

  it('scales per-100-ml values without treating volume as mass', () => {
    const volumeColumn = {
      ...source().columns[0]!,
      id: 'per-100ml',
      basis: 'per_100ml' as const,
      basisAmount: 100,
      basisUnit: 'ml' as const,
      printedHeading: 'Per 100 ml',
    };
    const volumeSource = source({
      columns: [volumeColumn],
      selectedColumnId: volumeColumn.id,
      consumption: { amount: 250, unit: 'ml' },
    });
    expect(labelScaleFactor(volumeSource)).toBe(2.5);
    expect(scaleNutritionLabel(volumeSource).values.energyKcal).toBe(600);
  });

  it('keeps kJ-only labels available without fabricating kcal', () => {
    const kilojouleSource = source();
    kilojouleSource.columns[0]!.nutrients = [
      {
        ...kilojouleSource.columns[0]!.nutrients[0]!,
        key: 'energy_kj',
        amount: 1_000,
        unit: 'kJ',
        qualifier: 'approximately',
      },
    ];
    const result = scaleNutritionLabel(kilojouleSource);
    expect(result.values.energyKj).toBe(350);
    expect(result.values.energyKcal).toBeNull();
  });

  it('rejects incompatible mass and volume units', () => {
    expect(() =>
      scaleNutritionLabel(source({ consumption: { amount: 35, unit: 'ml' } })),
    ).toThrow(/not supported/);
  });

  it('keeps missing printed nutrients unknown and propagates qualifiers', () => {
    const missing = source();
    missing.columns[0]!.nutrients[0]!.amount = null;
    const result = scaleNutritionLabel(missing);
    expect(result.values.energyKcal).toBeNull();
    expect(result.additionalValues[0]?.qualifier).toBe('approximately');
  });

  it('recomputes plausibility warnings without persisting stale warnings', () => {
    const suspicious = source();
    suspicious.columns[0]!.nutrients[1]!.amount = 120;
    expect(labelPlausibilityWarnings(suspicious)).toContainEqual(
      expect.stringContaining('exceeds 100 g'),
    );
    const result = scaleNutritionLabel(suspicious);
    if (result.source.kind !== 'nutrition_label')
      throw new Error('Expected label nutrition');
    expect(result.source.warnings).toEqual([]);
    result.source.columns[0]!.nutrients[1]!.amount = 12;
    expect(labelPlausibilityWarnings(result.source)).toEqual([]);
  });
});
