import type {
  Confidence,
  Ingredient,
  MealNutrition,
  NutritionMatch,
  NutritionValues,
} from './schema';

export interface NutritionFood {
  id: string;
  name: string;
  category: string;
  source: NutritionMatch['source'];
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
  sodiumMg: number | null;
}

interface NutritionDatabase {
  version: string;
  generatedAt: string;
  foods: NutritionFood[];
}

let databasePromise: Promise<NutritionDatabase> | undefined;

const stopWords = new Set([
  'and',
  'with',
  'the',
  'a',
  'an',
  'of',
  'fresh',
  'small',
  'large',
  'medium',
  'piece',
  'pieces',
]);

function normalized(value: string) {
  return value
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(/\b(yoghurt)\b/g, 'yogurt')
    .replace(/\b(aubergine)\b/g, 'eggplant')
    .replace(/\b(courgette)\b/g, 'zucchini')
    .replace(/\b(chips)\b/g, 'fries')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string) {
  return normalized(value)
    .split(' ')
    .filter((token) => token.length > 1 && !stopWords.has(token))
    .map((token) =>
      token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token,
    );
}

function scoreFood(query: string, food: NutritionFood) {
  const queryName = normalized(query);
  const foodName = normalized(food.name);
  if (!queryName) return 0;
  if (queryName === foodName) return 1;
  const queryTokens = new Set(tokens(query));
  const foodTokens = new Set(tokens(food.name));
  const shared = [...queryTokens].filter((token) => foodTokens.has(token));
  if (shared.length === 0) return 0;
  const dice = (2 * shared.length) / (queryTokens.size + foodTokens.size);
  const coverage = shared.length / queryTokens.size;
  const phrase = foodName.includes(queryName) || queryName.includes(foodName);
  const cookingWords = new Set([
    'raw',
    'fresh',
    'baked',
    'boiled',
    'broiled',
    'canned',
    'coated',
    'cooked',
    'creamed',
    'dried',
    'fried',
    'grilled',
    'pickled',
    'roasted',
    'sauteed',
    'sauce',
    'steamed',
    'stewed',
    'stuffed',
    'toasted',
  ]);
  const queryCooking = [...queryTokens].filter((token) =>
    cookingWords.has(token),
  );
  const foodCooking = [...foodTokens].filter((token) =>
    cookingWords.has(token),
  );
  const matchingPreparation = queryCooking.filter((token) =>
    foodTokens.has(token),
  ).length;
  const isPlainRaw = foodTokens.has('raw') || foodTokens.has('fresh');
  const unmatchedPreparation = foodCooking.filter(
    (token) =>
      !queryTokens.has(token) &&
      !(queryCooking.length === 0 && ['raw', 'fresh'].includes(token)),
  ).length;
  const preparationAdjustment =
    matchingPreparation * 0.08 -
    unmatchedPreparation * 0.05 +
    (queryCooking.length === 0 && isPlainRaw ? 0.08 : 0);
  const sourceBonus = food.source === 'uk_cofid' ? 0.015 : 0;
  const result =
    dice * 0.55 +
    coverage * 0.35 +
    (phrase ? 0.08 : 0) +
    preparationAdjustment +
    sourceBonus;
  return Math.min(queryTokens.size === 1 && !phrase ? 0.72 : 0.99, result);
}

function confidence(score: number): Confidence {
  if (score >= 0.78) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function per100g(food: NutritionFood): NutritionValues {
  return {
    energyKcal: food.energyKcal,
    proteinG: food.proteinG,
    carbsG: food.carbsG,
    fatG: food.fatG,
    fibreG: food.fibreG,
    saltG:
      food.sodiumMg === null ? null : round((food.sodiumMg * 2.5) / 1000, 2),
  };
}

export function amountInGrams(ingredient: Ingredient) {
  if (ingredient.estimatedGrams !== null) return ingredient.estimatedGrams;
  if (ingredient.amount === null) return null;
  const unit = normalized(ingredient.unit ?? '');
  if (['g', 'gram', 'grams', 'ml', 'millilitre', 'millilitres'].includes(unit))
    return ingredient.amount;
  if (['kg', 'kilogram', 'kilograms'].includes(unit))
    return ingredient.amount * 1000;
  if (['oz', 'ounce', 'ounces'].includes(unit))
    return ingredient.amount * 28.3495;
  if (['tbsp', 'tablespoon', 'tablespoons'].includes(unit))
    return ingredient.amount * 15;
  if (['tsp', 'teaspoon', 'teaspoons'].includes(unit))
    return ingredient.amount * 5;
  if (['cup', 'cups'].includes(unit)) return ingredient.amount * 240;
  return null;
}

export function findNutritionMatches(
  ingredient: Pick<Ingredient, 'name' | 'preparation'>,
  foods: NutritionFood[],
  limit = 5,
) {
  const query = `${ingredient.name} ${ingredient.preparation ?? ''}`.trim();
  return foods
    .map((food) => ({ food, score: scoreFood(query, food) }))
    .filter(({ score }) => score >= 0.22)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function calculateNutrition(
  ingredients: Ingredient[],
  database: Pick<NutritionDatabase, 'version' | 'foods'>,
  now = new Date(),
): { ingredients: Ingredient[]; nutrition: MealNutrition } {
  const notes: string[] = [];
  const values: NutritionValues = {
    energyKcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fibreG: 0,
    saltG: 0,
  };
  let matchedIngredientCount = 0;
  const nextIngredients = ingredients.map((ingredient) => {
    const grams = amountInGrams(ingredient);
    const candidate = findNutritionMatches(ingredient, database.foods, 1)[0];
    if (grams === null) {
      notes.push(
        `${ingredient.name || 'An ingredient'} needs a gram estimate.`,
      );
      return { ...ingredient, nutritionMatch: null };
    }
    if (!candidate || candidate.score < 0.48) {
      notes.push(
        `No reliable local food match for ${ingredient.name || 'an ingredient'}.`,
      );
      return { ...ingredient, nutritionMatch: null };
    }
    const match: NutritionMatch = {
      foodId: candidate.food.id,
      foodName: candidate.food.name,
      source: candidate.food.source,
      confidence: confidence(candidate.score),
      valuesPer100g: per100g(candidate.food),
    };
    if (match.confidence !== 'high')
      notes.push(
        `Review the ${ingredient.name || 'ingredient'} match: ${match.foodName}.`,
      );
    const scale = grams / 100;
    for (const key of Object.keys(values) as Array<keyof NutritionValues>) {
      const nutrientValue = match.valuesPer100g[key];
      if (nutrientValue === null) continue;
      values[key] = (values[key] ?? 0) + nutrientValue * scale;
    }
    matchedIngredientCount += 1;
    return { ...ingredient, estimatedGrams: grams, nutritionMatch: match };
  });

  for (const key of Object.keys(values) as Array<keyof NutritionValues>)
    values[key] = values[key] === null ? null : round(values[key] ?? 0);

  return {
    ingredients: nextIngredients,
    nutrition: {
      values,
      matchedIngredientCount,
      ingredientCount: ingredients.length,
      databaseVersion: database.version,
      calculatedAt: now.toISOString(),
      edited: false,
      stale: false,
      notes,
    },
  };
}

export async function loadNutritionDatabase() {
  databasePromise ??= fetch('/nutrition/foods.json').then(async (response) => {
    if (!response.ok)
      throw new Error('The bundled nutrition database could not be loaded.');
    return (await response.json()) as NutritionDatabase;
  });
  return databasePromise;
}

export async function estimateMealNutrition(ingredients: Ingredient[]) {
  return calculateNutrition(ingredients, await loadNutritionDatabase());
}

export function resetNutritionDatabaseForTests() {
  databasePromise = undefined;
}
