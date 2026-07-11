import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseAnalysisResponse,
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
    },
  ],
  overallConfidence: 'medium',
  uncertaintyNotes: ['Oil quantity is not visible'],
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
