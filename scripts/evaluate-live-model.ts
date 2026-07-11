import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import {
  mealResponseJsonSchema,
  parseAnalysisResponse,
} from '../src/lib/provider';

const defaultImage =
  '/Users/tomauger/projects/recipe-generation/recipes/IMG_20210703_184219.jpg';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const baseUrl = (argument('--base-url') ?? 'http://127.0.0.1:1234/v1').replace(
  /\/$/,
  '',
);
const model = argument('--model') ?? 'google/gemma-4-e4b';
const imagePath = resolve(argument('--image') ?? defaultImage);

const modelsResponse = await fetch(`${baseUrl}/models`);
if (!modelsResponse.ok)
  throw new Error(`Model discovery returned HTTP ${modelsResponse.status}.`);
const modelsPayload = (await modelsResponse.json()) as {
  data?: Array<{ id?: string }>;
};
const models =
  modelsPayload.data?.flatMap((item) => (item.id ? [item.id] : [])) ?? [];
if (!models.includes(model))
  throw new Error(
    `Model ${model} is not available. Found: ${models.join(', ')}`,
  );

const source = await readFile(imagePath);
const image = await sharp(source)
  .rotate()
  .resize({ width: 768, height: 768, fit: 'inside' })
  .jpeg({ quality: 80 })
  .toBuffer();
const startedAt = performance.now();
const response = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    temperature: 0.1,
    max_tokens: 1_400,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'meal_analysis',
        strict: true,
        schema: mealResponseJsonSchema,
      },
    },
    messages: [
      {
        role: 'system',
        content:
          'Return JSON only for a private food diary. Classify as meal, recipe_card, packaged_food, or unclear. Printed recipe quantities are context, not proof of consumption. Include dishName, servings, portionSummary, ingredients with name/amount/unit/preparation/confidence, overallConfidence, and uncertaintyNotes. Never provide medical or allergy claims.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyse this image for my food diary.' },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${image.toString('base64')}`,
            },
          },
        ],
      },
    ],
  }),
});
if (!response.ok)
  throw new Error(
    `Inference returned HTTP ${response.status}: ${await response.text()}`,
  );
const payload = (await response.json()) as {
  choices?: Array<{ message?: { content?: unknown } }>;
};
const result = parseAnalysisResponse(payload.choices?.[0]?.message?.content);
const elapsedSeconds = (performance.now() - startedAt) / 1000;

process.stdout.write(
  `${JSON.stringify(
    {
      model,
      image: basename(imagePath),
      elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
      result,
    },
    null,
    2,
  )}\n`,
);
