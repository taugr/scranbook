import { displayNutrientAmount } from '@/lib/nutrition-label';
import type { MealNutrition } from '@/lib/schema';

function qualifier(value: 'exact' | 'less_than' | 'approximately') {
  return value === 'less_than' ? '<' : value === 'approximately' ? '≈' : '';
}

export function LabelNutritionSummary({
  nutrition,
}: {
  nutrition: MealNutrition;
}) {
  if (nutrition.source.kind !== 'nutrition_label') return null;
  const { source, values } = nutrition;
  const column = source.columns.find(
    (candidate) => candidate.id === source.selectedColumnId,
  )!;
  const common = [
    ['Protein', 'protein', values.proteinG, 'g'],
    ['Carbohydrate', 'carbohydrate', values.carbsG, 'g'],
    ['Sugars', 'sugars', values.sugarsG, 'g'],
    ['Fat', 'fat', values.fatG, 'g'],
    ['Saturates', 'saturates', values.saturatesG, 'g'],
    ['Fibre', 'fibre', values.fibreG, 'g'],
    ['Salt', 'salt', values.saltG, 'g'],
    ['Sodium', 'sodium', values.sodiumMg, 'mg'],
  ] as const;
  const energyQualifier = column.nutrients.find(
    (nutrient) => nutrient.key === 'energy_kcal',
  )?.qualifier;
  const energyKjQualifier = column.nutrients.find(
    (nutrient) => nutrient.key === 'energy_kj',
  )?.qualifier;
  return (
    <section
      className="nutrition-card label-summary"
      aria-labelledby="nutrition-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">From reviewed nutrition label</p>
          <h2 id="nutrition-heading">What you consumed</h2>
        </div>
      </div>
      <p className="label-source-summary">
        {source.consumption.amount} {source.consumption.unit} using{' '}
        <strong>{column.printedHeading}</strong>
        {source.copiedFromEntryId
          ? ' · copied from a previous reviewed entry'
          : ''}
        {source.edited ? ' · values edited after transcription' : ''}
      </p>
      <div className="nutrition-facts">
        <div className="nutrition-energy">
          <strong>
            {values.energyKcal === null
              ? '—'
              : `${energyQualifier ? qualifier(energyQualifier) : ''}${displayNutrientAmount(values.energyKcal, 'kcal')}`}
          </strong>
          <span>kcal</span>
          {values.energyKj !== null && (
            <small>
              {energyKjQualifier ? qualifier(energyKjQualifier) : ''}
              {displayNutrientAmount(values.energyKj, 'kJ')} kJ
            </small>
          )}
        </div>
        <dl>
          {common.map(([name, key, amount, unit]) => {
            const sourceQualifier = column.nutrients.find(
              (nutrient) => nutrient.key === key,
            )?.qualifier;
            return (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  {amount === null
                    ? '—'
                    : `${sourceQualifier ? qualifier(sourceQualifier) : ''}${displayNutrientAmount(amount, unit)} ${unit}`}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      {nutrition.additionalValues.length > 0 && (
        <details className="nutrition-notes">
          <summary>
            {nutrition.additionalValues.length} additional nutrients
          </summary>
          <dl className="additional-nutrients">
            {nutrition.additionalValues.map((nutrient) => (
              <div key={nutrient.id}>
                <dt>{nutrient.printedName}</dt>
                <dd>
                  {nutrient.amount === null
                    ? '—'
                    : `${qualifier(nutrient.qualifier)}${displayNutrientAmount(nutrient.amount, nutrient.unit)} ${nutrient.unit}`}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <p className="nutrition-disclaimer">
        Scaled locally from reviewed printed values. Missing nutrients remain
        unknown. This is not medical guidance.
      </p>
    </section>
  );
}
