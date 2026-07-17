import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverModels,
  endpointLocation,
  parseAnalysisResponse,
  parseNutritionLabelResponse,
  ProviderError,
  testModelConnection,
} from '@/lib/provider';
import { defaultModelSettings } from '@/lib/schema';

const validAnalysis = {
  classification: 'meal',
  dishName: 'Mushroom toast',
  servings: 1,
  portionSummary: 'Two slices of toast',
  ingredients: [
    {
      name: 'bread',
      amount: 2,
      unit: 'slices',
      preparation: 'toasted',
      confidence: 'high',
      estimatedGrams: 80,
    },
  ],
  overallConfidence: 'medium',
  uncertaintyNotes: ['Oil quantity is not visible'],
};

const validLabelAnalysis = {
  productName: 'Oat bar',
  columns: [
    {
      basis: 'per_100g',
      basisAmount: 100,
      basisUnit: 'g',
      printedHeading: 'Per 100 g',
      servingDescription: 'One bar is 35 g',
      servingSize: null,
      nutrients: [
        {
          key: 'energy_kcal',
          printedName: 'Energy',
          amount: 240,
          unit: 'kcal',
          qualifier: 'exact',
          dailyValuePercent: null,
          confidence: 'high',
        },
        {
          key: 'protein',
          printedName: 'Protein',
          amount: null,
          unit: 'g',
          qualifier: 'approximately',
          dailyValuePercent: 12,
          confidence: 'low',
        },
      ],
    },
  ],
  warnings: ['Protein cell is blurred'],
  overallConfidence: 'medium',
};

afterEach(() => vi.unstubAllGlobals());

describe('model response parsing', () => {
  it('parses direct and fenced JSON and supplies ingredient IDs', () => {
    const direct = parseAnalysisResponse(JSON.stringify(validAnalysis));
    const fenced = parseAnalysisResponse(
      `\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\``,
    );
    expect(direct.dishName).toBe('Mushroom toast');
    expect(direct.ingredients[0]?.id).toBeTruthy();
    expect(direct.ingredients[0]?.estimatedGrams).toBe(80);
    expect(fenced.classification).toBe('meal');
  });

  it('extracts JSON from a conversational wrapper', () => {
    const result = parseAnalysisResponse(
      `Here is the result: ${JSON.stringify(validAnalysis)} Thanks.`,
    );
    expect(result.ingredients).toHaveLength(1);
  });

  it('rejects a malformed or incomplete result', () => {
    expect(() => parseAnalysisResponse('not json')).toThrow(ProviderError);
    expect(() => parseAnalysisResponse('{"dishName":"Toast"}')).toThrow(
      'did not match the meal schema',
    );
  });
});

describe('nutrition-label response parsing', () => {
  it('preserves printed columns, null cells, confidence, and stable IDs', () => {
    const result = parseNutritionLabelResponse(
      `Result:\n\`\`\`json\n${JSON.stringify(validLabelAnalysis)}\n\`\`\``,
    );
    expect(result.productName).toBe('Oat bar');
    expect(result.columns[0]?.id).toBeTruthy();
    expect(result.columns[0]?.nutrients[1]).toMatchObject({
      amount: null,
      confidence: 'low',
    });
    expect(result.columns[0]?.nutrients[1]?.id).toBeTruthy();
  });

  it('rejects missing, negative, and malformed printed values', () => {
    expect(() =>
      parseNutritionLabelResponse(
        JSON.stringify({ ...validLabelAnalysis, columns: [] }),
      ),
    ).toThrow('No usable nutrition values');
    const negative = structuredClone(validLabelAnalysis);
    negative.columns[0]!.nutrients[0]!.amount = -1;
    expect(() => parseNutritionLabelResponse(JSON.stringify(negative))).toThrow(
      'No usable nutrition values',
    );
    const missingUnit = structuredClone(validLabelAnalysis);
    missingUnit.columns[0]!.nutrients[0]!.unit = '';
    expect(() =>
      parseNutritionLabelResponse(JSON.stringify(missingUnit)),
    ).toThrow('No usable nutrition values');
  });
});

describe('model connection diagnostics', () => {
  it('confirms the selected model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }),
            { status: 200 },
          ),
      ),
    );
    await expect(testModelConnection(defaultModelSettings)).resolves.toEqual([
      'google/gemma-4-e4b',
    ]);
  });

  it('reports a missing model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ),
    );
    await expect(
      testModelConnection(defaultModelSettings),
    ).rejects.toMatchObject({
      code: 'model_missing',
    });
  });

  it('discovers models even when the current model is not reported', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'vision-model' }] }), {
            status: 200,
          }),
      ),
    );
    await expect(discoverModels(defaultModelSettings)).resolves.toEqual([
      'vision-model',
    ]);
  });

  it('reports authentication failure without leaking a response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('secret details', { status: 401 })),
    );
    await expect(
      testModelConnection(defaultModelSettings),
    ).rejects.toMatchObject({
      code: 'auth',
      status: 401,
    });
  });
});

describe('endpoint location cues', () => {
  it('distinguishes local, private-network, remote, and invalid addresses', () => {
    expect(endpointLocation('http://127.0.0.1:1234/v1')).toBe('local');
    expect(endpointLocation('http://[::1]:1234/v1')).toBe('local');
    expect(endpointLocation('http://192.168.1.20:8080/v1')).toBe('local');
    expect(endpointLocation('https://models.example.com/v1')).toBe('remote');
    expect(endpointLocation('not a URL')).toBe('invalid');
  });
});
