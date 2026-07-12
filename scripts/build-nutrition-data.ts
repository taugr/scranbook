import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import JSZip from 'jszip';

const sources = {
  foundation: {
    name: 'USDA FoodData Central Foundation Foods',
    version: '2026-04-30',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip',
    license: 'CC0 1.0',
    homepage: 'https://fdc.nal.usda.gov/download-datasets/',
  },
  survey: {
    name: 'USDA FoodData Central FNDDS 2021-2023',
    version: '2024-10-31',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip',
    license: 'CC0 1.0',
    homepage: 'https://fdc.nal.usda.gov/download-datasets/',
  },
  cofid: {
    name: 'McCance and Widdowson CoFID',
    version: '2021',
    url: 'https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx',
    license: 'Open Government Licence v3.0',
    homepage:
      'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid',
  },
} as const;

interface NutritionFood {
  id: string;
  name: string;
  category: string;
  source: 'usda_foundation' | 'usda_fndds' | 'uk_cofid';
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
  sodiumMg: number | null;
}

interface UsdaNutrient {
  nutrient: { id: number };
  amount?: number;
}

interface UsdaFood {
  fdcId: number;
  description: string;
  foodCategory?: { description?: string };
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
  foodNutrients: UsdaNutrient[];
}

function nutrient(food: UsdaFood, ids: number[]) {
  for (const id of ids) {
    const value = food.foodNutrients.find(
      (candidate) => candidate.nutrient.id === id,
    )?.amount;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function usdaFood(
  food: UsdaFood,
  source: NutritionFood['source'],
): NutritionFood | null {
  const result: NutritionFood = {
    id: `fdc:${food.fdcId}`,
    name: food.description,
    category:
      food.foodCategory?.description ??
      food.wweiaFoodCategory?.wweiaFoodCategoryDescription ??
      '',
    source,
    energyKcal: nutrient(food, [1008, 2047, 2048]),
    proteinG: nutrient(food, [1003]),
    carbsG: nutrient(food, [1005]),
    fatG: nutrient(food, [1004]),
    fibreG: nutrient(food, [1079]),
    sodiumMg: nutrient(food, [1093]),
  };
  return result.energyKcal === null &&
    result.proteinG === null &&
    result.carbsG === null &&
    result.fatG === null
    ? null
    : result;
}

async function download(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not download ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function jsonFromZip<T>(bytes: Buffer): Promise<T> {
  const zip = await JSZip.loadAsync(bytes);
  const file = Object.values(zip.files).find(
    (candidate) => !candidate.dir && candidate.name.endsWith('.json'),
  );
  if (!file) throw new Error('The USDA archive did not contain JSON.');
  return JSON.parse(await file.async('string')) as T;
}

function cofidNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  if (value.trim().toLowerCase() === 'tr') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function columnNumber(reference: string) {
  let result = 0;
  for (const character of reference.match(/^[A-Z]+/)?.[0] ?? '')
    result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

async function workbookSheet(
  zip: JSZip,
  sheetName: string,
): Promise<Array<Map<number, string | number>>> {
  const workbookFile = zip.file('xl/workbook.xml');
  const relationsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (!workbookFile || !relationsFile)
    throw new Error('The CoFID workbook metadata is missing.');
  const workbookXml = await workbookFile.async('string');
  const relationsXml = await relationsFile.async('string');
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)].find(
    ([tag]) => decodeXml(attribute(tag, 'name') ?? '') === sheetName,
  )?.[0];
  const relationshipId = sheetTag ? attribute(sheetTag, 'r:id') : undefined;
  if (!relationshipId)
    throw new Error(`The CoFID sheet ${sheetName} is missing.`);
  const relationshipTag = [
    ...relationsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g),
  ].find(([tag]) => attribute(tag, 'Id') === relationshipId)?.[0];
  const target = relationshipTag
    ? attribute(relationshipTag, 'Target')
    : undefined;
  if (!target) throw new Error(`The CoFID sheet ${sheetName} has no target.`);
  const sheetPath = target.startsWith('/')
    ? target.slice(1)
    : `xl/${target.replace(/^\.\.\//, '')}`;
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile)
    throw new Error(`The CoFID worksheet file ${sheetPath} is missing.`);

  const sharedFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings = sharedFile
    ? [
        ...(await sharedFile.async('string')).matchAll(
          /<si\b[^>]*>([\s\S]*?)<\/si>/g,
        ),
      ].map(([, item]) =>
        decodeXml(
          [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map(([, text]) => text)
            .join(''),
        ),
      )
    : [];
  const sheetXml = await sheetFile.async('string');
  return [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(
    ([, rowXml]) => {
      const cells = new Map<number, string | number>();
      for (const [, cellTag, cellXml] of rowXml.matchAll(
        /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const reference = attribute(cellTag, 'r');
        const value = cellXml?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (!reference || value === undefined) continue;
        const type = attribute(cellTag, 't');
        const parsed =
          type === 's'
            ? (sharedStrings[Number(value)] ?? '')
            : Number.isFinite(Number(value))
              ? Number(value)
              : decodeXml(value);
        cells.set(columnNumber(reference), parsed);
      }
      return cells;
    },
  );
}

async function loadCofid(bytes: Buffer): Promise<NutritionFood[]> {
  const workbook = await JSZip.loadAsync(bytes);
  const [proximates, inorganics] = await Promise.all([
    workbookSheet(workbook, '1.3 Proximates'),
    workbookSheet(workbook, '1.4 Inorganics'),
  ]);

  const sodiumByCode = new Map<string, number | null>();
  for (const row of inorganics.slice(3)) {
    const code = String(row.get(1) ?? '').trim();
    if (code) sodiumByCode.set(code, cofidNumber(row.get(8)));
  }

  const foods: NutritionFood[] = [];
  for (const row of proximates.slice(3)) {
    const code = String(row.get(1) ?? '').trim();
    const name = String(row.get(2) ?? '').trim();
    if (!code || !name) continue;
    const food: NutritionFood = {
      id: `cofid:${code}`,
      name,
      category: String(row.get(4) ?? '').trim(),
      source: 'uk_cofid',
      proteinG: cofidNumber(row.get(10)),
      fatG: cofidNumber(row.get(11)),
      carbsG: cofidNumber(row.get(12)),
      energyKcal: cofidNumber(row.get(13)),
      fibreG: cofidNumber(row.get(26)),
      sodiumMg: sodiumByCode.get(code) ?? null,
    };
    if (
      food.energyKcal !== null ||
      food.proteinG !== null ||
      food.carbsG !== null ||
      food.fatG !== null
    )
      foods.push(food);
  }
  return foods;
}

async function main() {
  const [foundationZip, surveyZip, cofidWorkbook] = await Promise.all([
    download(sources.foundation.url),
    download(sources.survey.url),
    download(sources.cofid.url),
  ]);
  const foundation = await jsonFromZip<{
    FoundationFoods: Array<UsdaFood | null>;
  }>(foundationZip);
  const survey = await jsonFromZip<{
    SurveyFoods: Array<UsdaFood | null>;
  }>(surveyZip);
  const foods = [
    ...foundation.FoundationFoods.filter((food) => food !== null)
      .map((food) => usdaFood(food, 'usda_foundation'))
      .filter((food): food is NutritionFood => food !== null),
    ...survey.SurveyFoods.filter((food) => food !== null)
      .map((food) => usdaFood(food, 'usda_fndds'))
      .filter((food): food is NutritionFood => food !== null),
    ...(await loadCofid(cofidWorkbook)),
  ].sort((left, right) => left.name.localeCompare(right.name));

  const output = resolve('public/nutrition/foods.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({
      version: 'fdc-2026-04-30_fndds-2024-10-31_cofid-2021',
      generatedAt: '2026-07-12',
      sources: Object.values(sources).map(({ url: _, ...source }) => source),
      foods,
    })}\n`,
  );
  console.log(`Wrote ${foods.length} foods to ${output}`);
}

await main();
