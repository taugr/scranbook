'use client';

import { Plus, Trash2 } from 'lucide-react';
import { ConsumptionScaler } from '@/components/consumption-scaler';
import {
  canonicalNutrientKey,
  compatibleConsumptionUnits,
  labelPlausibilityWarnings,
  parseLocaleNumber,
} from '@/lib/nutrition-label';
import type {
  LabelNutrientValue,
  MealNutrition,
  NutritionLabelColumn,
  NutritionLabelSource,
} from '@/lib/schema';

function nextConsumption(column: NutritionLabelColumn) {
  const unit = compatibleConsumptionUnits(column)[0]!;
  return {
    amount:
      unit === column.basisUnit
        ? column.basisAmount
        : (column.servingSize?.amount ?? 1),
    unit,
  };
}

export function NutritionLabelReview({
  nutrition,
  onChange,
}: {
  nutrition: MealNutrition;
  onChange: (source: NutritionLabelSource) => void;
}) {
  if (nutrition.source.kind !== 'nutrition_label') return null;
  const source = nutrition.source;
  const column = source.columns.find(
    (candidate) => candidate.id === source.selectedColumnId,
  )!;
  const warnings = labelPlausibilityWarnings(source);

  function replaceColumn(nextColumn: NutritionLabelColumn) {
    onChange({
      ...source,
      columns: source.columns.map((candidate) =>
        candidate.id === nextColumn.id ? nextColumn : candidate,
      ),
      edited: true,
    });
  }

  function updateNutrient(id: string, patch: Partial<LabelNutrientValue>) {
    replaceColumn({
      ...column,
      nutrients: column.nutrients.map((nutrient) =>
        nutrient.id === id ? { ...nutrient, ...patch } : nutrient,
      ),
    });
  }

  function addColumn() {
    const id = crypto.randomUUID();
    const nextColumn: NutritionLabelColumn = {
      id,
      basis: 'per_100g',
      basisAmount: 100,
      basisUnit: 'g',
      printedHeading: 'Per 100 g',
      servingDescription: null,
      servingSize: null,
      nutrients: column.nutrients.map((nutrient) => ({
        ...nutrient,
        id: crypto.randomUUID(),
        amount: null,
      })),
    };
    onChange({
      ...source,
      columns: [...source.columns, nextColumn],
      selectedColumnId: id,
      consumption: nextConsumption(nextColumn),
      edited: true,
    });
  }

  return (
    <div className="form-card label-review-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {source.method === 'model'
              ? 'Scanned by model'
              : 'Entered manually'}
          </p>
          <h2 id="nutrition-label-review-heading" tabIndex={-1}>
            Check the label values
          </h2>
        </div>
        {source.edited && <span className="ai-label">Reviewed or edited</span>}
      </div>
      <label>
        <span>Product name</span>
        <input
          value={source.productName}
          placeholder="Optional"
          onChange={(event) =>
            onChange({
              ...source,
              productName: event.target.value,
              edited: true,
            })
          }
        />
      </label>
      <div className="label-basis-toolbar">
        <label>
          <span>Printed column</span>
          <select
            value={source.selectedColumnId}
            onChange={(event) => {
              const selected = source.columns.find(
                (candidate) => candidate.id === event.target.value,
              )!;
              onChange({
                ...source,
                selectedColumnId: selected.id,
                consumption: nextConsumption(selected),
                edited: true,
              });
            }}
          >
            {source.columns.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.printedHeading}
              </option>
            ))}
          </select>
        </label>
        <button className="text-button" onClick={addColumn}>
          <Plus /> Add printed column
        </button>
      </div>
      <div className="label-column-fields">
        <label>
          <span>Column heading</span>
          <input
            value={column.printedHeading}
            onChange={(event) =>
              replaceColumn({ ...column, printedHeading: event.target.value })
            }
          />
        </label>
        <label>
          <span>Basis</span>
          <select
            value={column.basis}
            onChange={(event) => {
              const basis = event.target.value as NutritionLabelColumn['basis'];
              const basisUnit: NutritionLabelColumn['basisUnit'] =
                basis === 'per_100g'
                  ? 'g'
                  : basis === 'per_100ml'
                    ? 'ml'
                    : 'serving';
              const next = {
                ...column,
                basis,
                basisUnit,
                basisAmount: basis === 'per_serving' ? 1 : 100,
              };
              onChange({
                ...source,
                columns: source.columns.map((candidate) =>
                  candidate.id === column.id ? next : candidate,
                ),
                consumption: nextConsumption(next),
                edited: true,
              });
            }}
          >
            <option value="per_100g">Per 100 g</option>
            <option value="per_100ml">Per 100 ml</option>
            <option value="per_serving">Per serving</option>
          </select>
        </label>
        <label>
          <span>Serving description</span>
          <input
            value={column.servingDescription ?? ''}
            placeholder="e.g. 1 bar (30 g)"
            onChange={(event) =>
              replaceColumn({
                ...column,
                servingDescription: event.target.value || null,
              })
            }
          />
        </label>
      </div>
      {column.basis === 'per_serving' && (
        <div className="serving-size-fields">
          <label>
            <span>Printed serving size</span>
            <input
              inputMode="decimal"
              value={column.servingSize?.amount ?? ''}
              placeholder="Optional"
              onChange={(event) => {
                const amount = parseLocaleNumber(event.target.value);
                replaceColumn({
                  ...column,
                  servingSize:
                    amount && amount > 0
                      ? { amount, unit: column.servingSize?.unit ?? 'g' }
                      : null,
                });
              }}
            />
          </label>
          <label>
            <span>Serving-size unit</span>
            <select
              value={column.servingSize?.unit ?? 'g'}
              onChange={(event) =>
                replaceColumn({
                  ...column,
                  servingSize: column.servingSize
                    ? {
                        ...column.servingSize,
                        unit: event.target.value as 'g' | 'ml',
                      }
                    : null,
                })
              }
            >
              <option value="g">g</option>
              <option value="ml">ml</option>
            </select>
          </label>
        </div>
      )}
      <div className="label-nutrient-list">
        {column.nutrients.map((nutrient) => (
          <div
            key={nutrient.id}
            className={`label-nutrient-row ${nutrient.confidence === 'low' ? 'label-nutrient-row--low' : ''}`}
          >
            <label>
              <span>Nutrient</span>
              <input
                value={nutrient.printedName}
                onChange={(event) =>
                  updateNutrient(nutrient.id, {
                    printedName: event.target.value,
                    key: canonicalNutrientKey(
                      event.target.value,
                      nutrient.unit,
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>Amount</span>
              <input
                inputMode="decimal"
                value={nutrient.amount ?? ''}
                onChange={(event) =>
                  updateNutrient(nutrient.id, {
                    amount: parseLocaleNumber(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Unit</span>
              <input
                value={nutrient.unit}
                onChange={(event) =>
                  updateNutrient(nutrient.id, {
                    unit: event.target.value,
                    key: canonicalNutrientKey(
                      nutrient.printedName,
                      event.target.value,
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>Qualifier</span>
              <select
                value={nutrient.qualifier}
                onChange={(event) =>
                  updateNutrient(nutrient.id, {
                    qualifier: event.target
                      .value as LabelNutrientValue['qualifier'],
                  })
                }
              >
                <option value="exact">Exact</option>
                <option value="less_than">Less than</option>
                <option value="approximately">Approximately</option>
              </select>
            </label>
            <label>
              <span>Daily value %</span>
              <input
                inputMode="decimal"
                value={nutrient.dailyValuePercent ?? ''}
                placeholder="Optional"
                onChange={(event) =>
                  updateNutrient(nutrient.id, {
                    dailyValuePercent: parseLocaleNumber(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Confidence</span>
              <select
                value={nutrient.confidence}
                onChange={(event) =>
                  updateNutrient(nutrient.id, {
                    confidence: event.target
                      .value as LabelNutrientValue['confidence'],
                  })
                }
              >
                <option value="low">Low — check</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <button
              className="remove-row"
              aria-label={`Remove ${nutrient.printedName}`}
              onClick={() =>
                replaceColumn({
                  ...column,
                  nutrients: column.nutrients.filter(
                    (candidate) => candidate.id !== nutrient.id,
                  ),
                })
              }
              disabled={column.nutrients.length === 1}
            >
              <Trash2 />
            </button>
            {nutrient.confidence === 'low' && (
              <small className="low-confidence-copy">
                Low confidence — compare this cell with the photo.
              </small>
            )}
          </div>
        ))}
      </div>
      <button
        className="add-row"
        onClick={() =>
          replaceColumn({
            ...column,
            nutrients: [
              ...column.nutrients,
              {
                id: crypto.randomUUID(),
                key: 'other',
                printedName: 'Nutrient',
                amount: null,
                unit: 'g',
                qualifier: 'exact',
                dailyValuePercent: null,
                confidence: 'high',
              },
            ],
          })
        }
      >
        <Plus /> Add nutrient
      </button>
      <ConsumptionScaler
        source={source}
        values={nutrition.values}
        onChange={onChange}
      />
      {warnings.length > 0 && (
        <div className="label-warnings">
          <strong>Check these label details</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
