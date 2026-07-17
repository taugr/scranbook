import {
  mealAnalysisSchema,
  nutritionLabelAnalysisSchema,
  type MealAnalysis,
  type ModelSettings,
  type NutritionLabelColumn,
  type StoredPhoto,
} from './schema';
import { blobToDataUrl } from './image';

export const promptVersion = 'meal-analysis-v2';
export const nutritionLabelPromptVersion = 'nutrition-label-analysis-v1';

export type ProviderErrorCode =
  | 'aborted'
  | 'auth'
  | 'cors'
  | 'invalid_response'
  | 'model_missing'
  | 'timeout'
  | 'unreachable'
  | 'unsupported_vision';

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const systemPrompt = `You are helping a person keep a private food diary from a phone photo.
Return JSON only. Describe visible or reasonably inferable food, and separate observation from estimation.
Do not claim hidden ingredients with high confidence. For every ingredient, give the visible amount and a separate best estimate of its consumed weight in grams. Use null when a gram estimate is not defensible.
Classify the image as meal, recipe_card, packaged_food, or unclear. Printed recipe quantities are context, not proof of what was consumed.
Do not calculate calories, macros, or other nutritional values; those are calculated locally from food-composition data. Never provide medical, allergy, or health advice. Use low confidence and uncertainty notes when evidence is weak.`;

const nutritionLabelSystemPrompt = `You transcribe visible nutrition-information panels for a private food diary.
Return JSON only. Transcribe only facts visible in the image; never calculate consumed totals or infer missing cells.
Identify every printed basis column and preserve its heading, serving text, nutrient names, numeric amounts, units, qualifiers, and daily-value percentages.
Distinguish kcal from kJ and salt from sodium. Use null and low confidence for unreadable cells. Do not infer an unprinted serving size.
Report glare, blur, cropped headings, ambiguity, or prepared/unprepared columns in warnings.
Do not infer ingredients, allergens, health effects, suitability, package totals, or serving weights. Never provide medical advice.`;

export const mealResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'classification',
    'dishName',
    'servings',
    'portionSummary',
    'ingredients',
    'overallConfidence',
    'uncertaintyNotes',
  ],
  properties: {
    classification: {
      enum: ['meal', 'recipe_card', 'packaged_food', 'unclear'],
    },
    dishName: { type: 'string' },
    servings: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    portionSummary: { type: 'string' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'amount',
          'unit',
          'preparation',
          'confidence',
          'estimatedGrams',
        ],
        properties: {
          name: { type: 'string' },
          amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          preparation: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          confidence: { enum: ['low', 'medium', 'high'] },
          estimatedGrams: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
          },
        },
      },
    },
    overallConfidence: { enum: ['low', 'medium', 'high'] },
    uncertaintyNotes: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const nutritionLabelResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['productName', 'columns', 'warnings', 'overallConfidence'],
  properties: {
    productName: { type: 'string' },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'basis',
          'basisAmount',
          'basisUnit',
          'printedHeading',
          'servingDescription',
          'servingSize',
          'nutrients',
        ],
        properties: {
          basis: { enum: ['per_100g', 'per_100ml', 'per_serving'] },
          basisAmount: { type: 'number' },
          basisUnit: { enum: ['g', 'ml', 'serving'] },
          printedHeading: { type: 'string' },
          servingDescription: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          servingSize: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['amount', 'unit'],
                properties: {
                  amount: { type: 'number' },
                  unit: { enum: ['g', 'ml'] },
                },
              },
              { type: 'null' },
            ],
          },
          nutrients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'key',
                'printedName',
                'amount',
                'unit',
                'qualifier',
                'dailyValuePercent',
                'confidence',
              ],
              properties: {
                key: {
                  enum: [
                    'energy_kcal',
                    'energy_kj',
                    'fat',
                    'saturates',
                    'carbohydrate',
                    'sugars',
                    'fibre',
                    'protein',
                    'salt',
                    'sodium',
                    'other',
                  ],
                },
                printedName: { type: 'string' },
                amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                unit: { type: 'string' },
                qualifier: {
                  enum: ['exact', 'less_than', 'approximately'],
                },
                dailyValuePercent: {
                  anyOf: [{ type: 'number' }, { type: 'null' }],
                },
                confidence: { enum: ['low', 'medium', 'high'] },
              },
            },
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
    overallConfidence: { enum: ['low', 'medium', 'high'] },
  },
} as const;

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export type EndpointLocation = 'local' | 'remote' | 'invalid';

export function endpointLocation(baseUrl: string): EndpointLocation {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'invalid';
  }
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local') ||
    hostname === 'host.docker.internal' ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname)
  )
    return 'local';
  const private172 = hostname.match(/^172\.(\d{1,2})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31)
    return 'local';
  return 'remote';
}

function headers(settings: ModelSettings) {
  return {
    'Content-Type': 'application/json',
    ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    ...settings.extraHeaders,
  };
}

function responseFormat(settings: ModelSettings, name: string, schema: object) {
  if (settings.responseMode === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name,
        strict: true,
        schema,
      },
    };
  }
  if (settings.responseMode === 'json_object') return { type: 'json_object' };
  return undefined;
}

function stripCodeFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? trimmed;
}

export function parseAnalysisResponse(value: unknown): MealAnalysis {
  if (typeof value !== 'string')
    throw new ProviderError(
      'invalid_response',
      'The model returned no text result.',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(value));
  } catch {
    const first = value.indexOf('{');
    const last = value.lastIndexOf('}');
    if (first < 0 || last <= first) {
      throw new ProviderError(
        'invalid_response',
        'The model did not return valid JSON.',
      );
    }
    try {
      parsed = JSON.parse(value.slice(first, last + 1));
    } catch {
      throw new ProviderError(
        'invalid_response',
        'The model did not return valid JSON.',
      );
    }
  }
  const result = mealAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderError(
      'invalid_response',
      'The model result did not match the meal schema.',
    );
  }
  return {
    ...result.data,
    ingredients: result.data.ingredients.map((ingredient) => ({
      ...ingredient,
      id: ingredient.id ?? crypto.randomUUID(),
    })),
  };
}

export interface ParsedNutritionLabelAnalysis {
  productName: string;
  columns: NutritionLabelColumn[];
  warnings: string[];
  overallConfidence: 'low' | 'medium' | 'high';
}

export function parseNutritionLabelResponse(
  value: unknown,
): ParsedNutritionLabelAnalysis {
  if (typeof value !== 'string')
    throw new ProviderError(
      'invalid_response',
      'The model returned no nutrition-label text.',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(value));
  } catch {
    const first = value.indexOf('{');
    const last = value.lastIndexOf('}');
    if (first < 0 || last <= first)
      throw new ProviderError(
        'invalid_response',
        'The model did not return valid nutrition-label JSON.',
      );
    try {
      parsed = JSON.parse(value.slice(first, last + 1));
    } catch {
      throw new ProviderError(
        'invalid_response',
        'The model did not return valid nutrition-label JSON.',
      );
    }
  }
  const result = nutritionLabelAnalysisSchema.safeParse(parsed);
  if (
    !result.success ||
    result.data.columns.some(
      (column) =>
        !column.printedHeading.trim() ||
        column.nutrients.some(
          (nutrient) => !nutrient.printedName.trim() || !nutrient.unit.trim(),
        ),
    ) ||
    !result.data.columns.some((column) =>
      column.nutrients.some((nutrient) => nutrient.amount !== null),
    )
  )
    throw new ProviderError(
      'invalid_response',
      'No usable nutrition values were found in the model result.',
    );
  return {
    ...result.data,
    columns: result.data.columns.map((column) => ({
      ...column,
      id: crypto.randomUUID(),
      nutrients: column.nutrients.map((nutrient) => ({
        ...nutrient,
        id: crypto.randomUUID(),
      })),
    })),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal,
) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort('timeout'), timeoutMs);
  const onAbort = () => timeoutController.abort('user');
  outerSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: timeoutController.signal });
  } catch (error) {
    if (outerSignal?.aborted || timeoutController.signal.reason === 'user') {
      throw new ProviderError('aborted', 'Analysis cancelled.');
    }
    if (timeoutController.signal.aborted) {
      throw new ProviderError('timeout', 'The model took too long to respond.');
    }
    if (error instanceof TypeError) {
      throw new ProviderError(
        'cors',
        'The model could not be reached. Check that it is running and allows requests from this app.',
      );
    }
    throw new ProviderError(
      'unreachable',
      'The model endpoint could not be reached.',
    );
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onAbort);
  }
}

async function assertOk(response: Response) {
  if (response.ok) return;
  const body = await response.text().catch(() => '');
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError(
      'auth',
      'The model rejected these credentials.',
      response.status,
    );
  }
  if (response.status === 404 && body.toLowerCase().includes('model')) {
    throw new ProviderError(
      'model_missing',
      'That model is not available at this endpoint.',
      404,
    );
  }
  if (/vision|image|multimodal/i.test(body)) {
    throw new ProviderError(
      'unsupported_vision',
      'This model does not accept image input.',
      response.status,
    );
  }
  throw new ProviderError(
    'unreachable',
    `The model returned HTTP ${response.status}.`,
    response.status,
  );
}

export async function discoverModels(
  settings: ModelSettings,
): Promise<string[]> {
  const response = await fetchWithTimeout(
    endpoint(settings.baseUrl, 'models'),
    { headers: headers(settings) },
    Math.min(settings.timeoutMs, 20_000),
  );
  await assertOk(response);
  const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const models =
    data.data?.flatMap((model) =>
      typeof model.id === 'string' ? [model.id] : [],
    ) ?? [];
  return models;
}

export async function testModelConnection(
  settings: ModelSettings,
): Promise<string[]> {
  const models = await discoverModels(settings);
  if (!models.includes(settings.model)) {
    throw new ProviderError(
      'model_missing',
      `Model “${settings.model}” is not available.`,
    );
  }
  return models;
}

export async function analyseMeal(
  photo: StoredPhoto,
  settings: ModelSettings,
  signal?: AbortSignal,
): Promise<MealAnalysis> {
  const imageUrl = await blobToDataUrl(photo.blob);
  const format = responseFormat(
    settings,
    'meal_analysis',
    mealResponseJsonSchema,
  );
  const response = await fetchWithTimeout(
    endpoint(settings.baseUrl, 'chat/completions'),
    {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.1,
        max_tokens: 1_400,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyse this image for my food diary and return the requested JSON.',
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        ...(format ? { response_format: format } : {}),
      }),
    },
    settings.timeoutMs,
    signal,
  );
  await assertOk(response);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  return parseAnalysisResponse(data.choices?.[0]?.message?.content);
}

export async function analyseNutritionLabel(
  photo: StoredPhoto,
  settings: ModelSettings,
  signal?: AbortSignal,
): Promise<ParsedNutritionLabelAnalysis> {
  const imageUrl = await blobToDataUrl(photo.blob);
  const format = responseFormat(
    settings,
    'nutrition_label_analysis',
    nutritionLabelResponseJsonSchema,
  );
  const response = await fetchWithTimeout(
    endpoint(settings.baseUrl, 'chat/completions'),
    {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        max_tokens: 2_400,
        messages: [
          { role: 'system', content: nutritionLabelSystemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe every visible nutrition-information column and return the requested JSON.',
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        ...(format ? { response_format: format } : {}),
      }),
    },
    settings.timeoutMs,
    signal,
  );
  await assertOk(response);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  return parseNutritionLabelResponse(data.choices?.[0]?.message?.content);
}
