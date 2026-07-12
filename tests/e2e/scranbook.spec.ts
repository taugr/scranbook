import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const analysis = {
  classification: 'meal',
  dishName: 'Tomato and herb toast',
  servings: 1,
  portionSummary: 'Two slices of toast with a generous tomato topping',
  ingredients: [
    {
      name: 'sourdough bread',
      amount: 2,
      unit: 'slices',
      preparation: 'toasted',
      confidence: 'high',
      estimatedGrams: 80,
    },
    {
      name: 'tomatoes',
      amount: 120,
      unit: 'g',
      preparation: 'chopped',
      confidence: 'medium',
      estimatedGrams: 120,
    },
  ],
  overallConfidence: 'medium',
  uncertaintyNotes: ['The amount of oil is not visible'],
};

async function clearBrowserData(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('scranbook');
    if ('serviceWorker' in navigator) {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister();
      }
    }
  });
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await clearBrowserData(page);
});

test('creates and retains a manual diary entry', async ({ page }) => {
  await expect(
    page.getByRole('heading', {
      name: 'Remember the meals that made your day.',
    }),
  ).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add your first meal' })
    .click();
  await page.getByLabel('What was it?').fill('Mushroom toast');
  await page.getByLabel('Portion').fill('Two slices with mushrooms');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page
    .getByRole('textbox', { name: 'Ingredient', exact: true })
    .fill('Mushrooms');
  await page
    .getByRole('spinbutton', { name: 'Amount', exact: true })
    .fill('120');
  await page.getByRole('textbox', { name: 'Unit', exact: true }).fill('g');
  await page.getByRole('button', { name: 'Calculate locally' }).click();
  await expect(page.getByLabel('Energy (kcal)')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Mushroom toast' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Mushroom toast' }),
  ).toBeVisible();
  await expect(page.getByText('Mushrooms', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Estimated nutrition' }),
  ).toBeVisible();
});

test('analyses a selected image through a mocked compatible endpoint', async ({
  page,
}) => {
  await page.route('**/v1/chat/completions', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      messages: Array<{ content: unknown }>;
    };
    expect(JSON.stringify(body.messages)).toContain('image_url');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(analysis) } }],
      }),
    });
  });
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add your first meal' })
    .click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('public/icon-192.png');
  await expect(page.getByAltText('Meal ready to review')).toBeVisible();
  await page.getByLabel(/I understand this photo goes directly/).check();
  await page.getByRole('button', { name: 'Analyse photo' }).click();
  await expect(page.getByLabel('What was it?')).toHaveValue(
    'Tomato and herb toast',
  );
  await expect(page.getByLabel('Ingredient').first()).toHaveValue(
    'sourdough bread',
  );
  await expect(page.getByLabel('Energy (kcal)')).not.toHaveValue('');
  await expect(
    page.getByText(/Check every estimate before saving/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tomato and herb toast' }),
  ).toBeVisible();
});

test('does not treat recipe quantities as a consumed nutrition estimate', async ({
  page,
}) => {
  await page.route('**/v1/chat/completions', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ...analysis,
                classification: 'recipe_card',
              }),
            },
          },
        ],
      }),
    });
  });
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add your first meal' })
    .click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('public/icon-192.png');
  await page.getByLabel(/I understand this photo goes directly/).check();
  await page.getByRole('button', { name: 'Analyse photo' }).click();
  await expect(page.getByLabel('Kind of image')).toHaveValue('recipe_card');
  await expect(page.getByLabel('Energy (kcal)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Calculate locally' }).click();
  await expect(
    page.getByText(/Nutrition is only calculated for a consumed meal/),
  ).toBeVisible();
});

test('tests model discovery and exposes privacy controls', async ({ page }) => {
  await page.route('**/v1/models', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'google/gemma-4-e4b' }] }),
    });
  });
  await page
    .getByRole('button', { name: /Settings/ })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Settings & privacy' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(
    page.getByText(/Connected\. google\/gemma-4-e4b is ready/),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /plain-language privacy note/ }),
  ).toHaveAttribute('href', '/privacy/');
  await expect(
    page.getByRole('button', { name: 'Delete entire diary' }),
  ).toBeVisible();
});

test('has an installable manifest and no serious accessibility violations', async ({
  page,
}) => {
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe('standalone');
  const nutritionDatabase = await page.request.get('/nutrition/foods.json');
  expect(nutritionDatabase.ok()).toBe(true);
  const nutritionPayload = (await nutritionDatabase.json()) as {
    version: string;
    foods: unknown[];
  };
  expect(nutritionPayload.version).toContain('cofid-2021');
  expect(nutritionPayload.foods.length).toBeGreaterThan(8_000);
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add your first meal' })
    .click();
  await page.getByLabel('What was it?').fill('Accessible tomato salad');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page
    .getByRole('textbox', { name: 'Ingredient', exact: true })
    .fill('tomatoes');
  await page.getByLabel('Estimated grams').fill('150');
  await page.getByLabel('Preparation').fill('raw');
  await page.getByRole('button', { name: 'Calculate locally' }).click();
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Estimated nutrition' }),
  ).toBeVisible();
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const runner = (
      window as unknown as {
        axe: {
          run: () => Promise<{
            violations: Array<{ impact: string | null; id: string }>;
          }>;
        };
      }
    ).axe;
    return (await runner.run()).violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
  });
  expect(violations).toEqual([]);
});

test('keeps the diary available offline', async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile',
    'One browser is enough for the offline lifecycle.',
  );
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add your first meal' })
    .click();
  await page.getByLabel('What was it?').fill('Offline soup');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page
    .getByRole('textbox', { name: 'Ingredient', exact: true })
    .fill('potatoes');
  await page.getByLabel('Amount', { exact: true }).fill('200');
  await page.getByLabel('Unit', { exact: true }).fill('g');
  await page.getByLabel('Preparation').fill('boiled');
  await page.getByRole('button', { name: 'Calculate locally' }).click();
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Offline soup' }),
  ).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Recalculate' }).click();
  await expect(page.getByLabel('Energy (kcal)')).not.toHaveValue('');
  await context.setOffline(false);
});
