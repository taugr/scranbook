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

const labelAnalysis = {
  productName: 'Cocoa oat bar',
  columns: [
    {
      basis: 'per_100g',
      basisAmount: 100,
      basisUnit: 'g',
      printedHeading: 'Per 100 g',
      servingDescription: 'One bar is 30 g',
      servingSize: null,
      nutrients: [
        {
          key: 'energy_kcal',
          printedName: 'Energy',
          amount: 400,
          unit: 'kcal',
          qualifier: 'exact',
          dailyValuePercent: null,
          confidence: 'high',
        },
        {
          key: 'protein',
          printedName: 'Protein',
          amount: 10,
          unit: 'g',
          qualifier: 'exact',
          dailyValuePercent: null,
          confidence: 'low',
        },
      ],
    },
    {
      basis: 'per_serving',
      basisAmount: 1,
      basisUnit: 'serving',
      printedHeading: 'Per bar',
      servingDescription: '1 bar (30 g)',
      servingSize: { amount: 30, unit: 'g' },
      nutrients: [
        {
          key: 'energy_kcal',
          printedName: 'Energy',
          amount: 120,
          unit: 'kcal',
          qualifier: 'exact',
          dailyValuePercent: null,
          confidence: 'high',
        },
        {
          key: 'other',
          printedName: 'Iron',
          amount: 2,
          unit: 'mg',
          qualifier: 'approximately',
          dailyValuePercent: 10,
          confidence: 'medium',
        },
      ],
    },
  ],
  warnings: ['Check the low-confidence protein cell'],
  overallConfidence: 'medium',
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

async function startFirstMeal(page: import('@playwright/test').Page) {
  const mobileAdd = page.getByRole('button', { name: 'Add', exact: true });
  if (await mobileAdd.isVisible()) {
    await mobileAdd.click();
    return;
  }
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add your first meal' })
    .click();
}

async function openSavedEntry(
  page: import('@playwright/test').Page,
  title: string,
) {
  const heading = page.getByRole('heading', { name: title, exact: true });
  if (await heading.isVisible()) return;
  await page.locator('.mobile-entry').filter({ hasText: title }).click();
}

async function seriousAccessibilityViolations(
  page: import('@playwright/test').Page,
) {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
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
}

test.beforeEach(async ({ page }) => {
  await clearBrowserData(page);
});

test('empty mobile diary fits without page scrolling', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'desktop',
    'The desktop empty state uses its own two-column composition.',
  );
  const overflow = await page.evaluate(() => {
    const scrollingElement =
      document.scrollingElement ?? document.documentElement;
    return Math.ceil(scrollingElement.scrollHeight - window.innerHeight);
  });
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByText('Private by design.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add', exact: true }),
  ).toBeVisible();
});

test('creates and retains a manual diary entry', async ({ page }) => {
  await expect(
    page.getByRole('heading', {
      name: 'Remember the meals that made your day.',
    }),
  ).toBeVisible();
  await startFirstMeal(page);
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
  await openSavedEntry(page, 'Mushroom toast');
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
  await startFirstMeal(page);
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

test('scans, reviews, scales, and saves a nutrition label', async ({
  page,
}) => {
  await page.route('**/v1/chat/completions', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(labelAnalysis) } }],
      }),
    });
  });
  await startFirstMeal(page);
  await page.getByRole('button', { name: 'Nutrition label' }).click();
  await page
    .getByLabel('Choose nutrition label photo')
    .setInputFiles('public/icon-192.png');
  await page.getByLabel(/I understand this label photo goes directly/).check();
  await page
    .getByRole('button', { name: 'Scan label with configured model' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Check the label values' }),
  ).toBeVisible();
  await expect(page.getByLabel('Product name')).toHaveValue('Cocoa oat bar');
  await expect(
    page.getByText(/Low confidence — compare this cell/),
  ).toBeVisible();
  await expect(page.getByLabel('Daily value %').first()).toBeVisible();
  await page.getByLabel('Printed column').selectOption({ label: 'Per bar' });
  await page.getByLabel('Amount consumed').fill('1.5');
  await expect(page.getByText(/Consumed: 180 kcal/)).toBeVisible();
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Cocoa oat bar' }),
  ).toBeVisible();
  await expect(page.getByText('From reviewed nutrition label')).toBeVisible();
  await expect(page.getByText(/1.5 serving using/)).toBeVisible();
  await page.reload();
  await openSavedEntry(page, 'Cocoa oat bar');
  await expect(page.getByText('From reviewed nutrition label')).toBeVisible();
});

test('enters and scales a nutrition label manually without a photo', async ({
  page,
}) => {
  let providerRequests = 0;
  await page.route('**/v1/**', async (route) => {
    providerRequests += 1;
    await route.abort();
  });
  await startFirstMeal(page);
  await page.getByRole('button', { name: 'Nutrition label' }).click();
  await page.getByRole('button', { name: 'Enter label manually' }).click();
  await page.getByLabel('Product name').fill('Manual cereal');
  const nutrientRow = page.locator('.label-nutrient-row').first();
  await nutrientRow.getByLabel('Amount').fill('360');
  await page.getByLabel('Amount consumed').fill('50');
  await expect(page.getByText(/Consumed: 180 kcal/)).toBeVisible();
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Manual cereal' }),
  ).toBeVisible();
  expect(providerRequests).toBe(0);
});

test('recovers an unfinished nutrition label draft with its photo', async ({
  page,
}) => {
  await startFirstMeal(page);
  await page.getByRole('button', { name: 'Nutrition label' }).click();
  await page
    .getByLabel('Choose nutrition label photo')
    .setInputFiles('public/icon-192.png');
  await page.getByRole('button', { name: 'Enter label manually' }).click();
  await page.getByLabel('Product name').fill('Recoverable snack');
  await page
    .locator('.label-nutrient-row')
    .first()
    .getByLabel('Amount')
    .fill('250');
  await expect(page.getByText('Draft saved on this device')).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Continue where you left off.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue draft' }).last().click();
  await expect(page.getByLabel('Product name')).toHaveValue(
    'Recoverable snack',
  );
  await expect(
    page.getByAltText('Nutrition label ready to review'),
  ).toBeVisible();
  await expect(
    page.locator('.label-nutrient-row').first().getByLabel('Amount'),
  ).toHaveValue('250');
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
  await startFirstMeal(page);
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

test('tests model discovery and exposes privacy controls', async ({
  page,
}, testInfo) => {
  await page.route('**/v1/models', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'google/gemma-4-e4b' }, { id: 'another-vision-model' }],
      }),
    });
  });
  if (testInfo.project.name === 'desktop') {
    await expect(
      page.getByRole('button', { name: 'Add your first meal' }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Add', exact: true }),
    ).toHaveCount(0);
  } else {
    await expect(
      page.getByRole('button', { name: 'Add your first meal' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Add', exact: true }),
    ).toHaveCount(1);
  }
  await expect(
    page.getByRole('button', { name: 'Add a meal', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: /Settings/ })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Settings & privacy' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(
    page.getByText(/Connected\. google\/gemma-4-e4b is available/),
  ).toBeVisible();
  await page
    .getByLabel('Models reported by this endpoint')
    .selectOption('another-vision-model');
  await expect(page.getByText(/Selected another-vision-model/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: /plain-language privacy note/ }),
  ).toHaveAttribute('href', '/privacy/');
  await expect(
    page.getByRole('button', { name: 'Delete entire diary' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to diary' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Remember the meals that made your day.',
    }),
  ).toBeVisible();
});

test('returns from settings to an in-progress meal', async ({ page }) => {
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Unfinished supper');
  await page
    .getByRole('button', { name: /Settings/ })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Settings & privacy' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to meal editor' }).click();
  await expect(page.getByLabel('What was it?')).toHaveValue(
    'Unfinished supper',
  );
});

test('recovers an unfinished meal with its photo after reload', async ({
  page,
}) => {
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Recoverable noodles');
  await page.getByLabel('Portion').fill('One deep bowl');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('public/icon-192.png');
  await expect(page.getByText('Draft saved on this device')).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Continue where you left off.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue draft' }).last().click();
  await expect(page.getByLabel('What was it?')).toHaveValue(
    'Recoverable noodles',
  );
  await expect(page.getByLabel('Portion')).toHaveValue('One deep bowl');
  await expect(page.getByAltText('Meal ready to review')).toBeVisible();
});

test('deleting a meal also removes its unfinished edit draft', async ({
  page,
}) => {
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Meal to delete');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('What was it?').fill('Unfinished edited meal');
  await expect(page.getByText('Draft saved on this device')).toBeVisible();
  await page.locator('.back-button').click();
  await openSavedEntry(page, 'Meal to delete');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Remember the meals that made your day.',
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Remember the meals that made your day.',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continue draft' }),
  ).toHaveCount(0);
});

test('searches the diary and starts a fresh log from an entry', async ({
  page,
}) => {
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Tuesday lentil bowl');
  await page.getByLabel('Notes').fill('Extra lemon');
  await page.getByRole('button', { name: 'Save to this device' }).click();

  const mobileDiary = page.locator('.entry-mobile-back:visible');
  if ((await mobileDiary.count()) > 0) await mobileDiary.click();
  await page.locator('input[aria-label="Search diary"]:visible').fill('lentil');
  await expect(page.locator('.diary-result-count:visible')).toHaveText(
    '1 of 1 entries',
  );
  await openSavedEntry(page, 'Tuesday lentil bowl');
  await page.getByRole('button', { name: 'Log again' }).click();
  await expect(page.getByLabel('What was it?')).toHaveValue(
    'Tuesday lentil bowl',
  );
  await expect(page.getByLabel('Notes')).toHaveValue('');
  await page.getByLabel('What was it?').fill('Wednesday lentil bowl');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Wednesday lentil bowl' }),
  ).toBeVisible();
});

test('lets people review and override a local nutrition match', async ({
  page,
}) => {
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Tomato side');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page
    .getByRole('textbox', { name: 'Ingredient', exact: true })
    .fill('tomatoes');
  await page.getByLabel('Estimated grams').fill('100');
  await page.getByRole('button', { name: 'Calculate locally' }).click();
  await page.getByRole('button', { name: 'Review match' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Review tomatoes match' }),
  ).toBeVisible();
  await page
    .getByLabel('Search local food records')
    .fill('Tomatoes, fresh, cooked');
  await page.getByRole('button', { name: /Tomatoes, fresh, cooked/ }).click();
  await expect(
    page.getByText(/Tomatoes, fresh, cooked.*chosen by you/),
  ).toBeVisible();
});

test('offers guided local-model setup and keyboard-reachable file inputs', async ({
  page,
}) => {
  await startFirstMeal(page);
  const photoInput = page.locator('input[type="file"]').first();
  await expect(photoInput).not.toHaveCSS('display', 'none');
  await photoInput.focus();
  await expect(photoInput).toBeFocused();

  await page
    .getByRole('button', { name: /Settings/ })
    .last()
    .click();
  await expect(page.getByText('Manual entry always works.')).toBeVisible();
  const lmStudio = page.getByRole('button', { name: /^LM Studio/ });
  await expect(lmStudio).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Appears local')).toBeVisible();

  await page
    .getByRole('button', { name: /^Custom compatible endpoint/ })
    .click();
  await expect(page.getByLabel('Base URL')).toHaveValue(
    'http://127.0.0.1:1234/v1',
  );
  await page.getByLabel('Base URL').fill('https://models.example.com/v1');
  await page.getByLabel('API key optional').fill('hosted-provider-secret');
  await page.getByLabel(/I understand that analysed photos/).check();
  await page.getByText('Advanced settings', { exact: true }).click();
  await page
    .getByLabel('Additional request headers (JSON)')
    .fill('{"X-Hosted-Secret":"secret"}');
  await expect(page.getByText('Remote endpoint')).toBeVisible();
  await expect(
    page.getByText(/Analysed photos leave this device/),
  ).toBeVisible();

  await lmStudio.click();
  await expect(page.getByText('http://127.0.0.1:1234/v1')).toBeVisible();
  await expect(page.getByLabel('Response mode')).toBeVisible();
  await expect(
    page.getByLabel(/I understand that analysed photos/),
  ).not.toBeChecked();
  await page
    .getByRole('button', { name: /^Custom compatible endpoint/ })
    .click();
  await expect(page.getByLabel('API key optional')).toHaveValue('');
  await expect(
    page.getByLabel('Additional request headers (JSON)'),
  ).toHaveValue('{}');
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
  await startFirstMeal(page);
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
  const violations = await seriousAccessibilityViolations(page);
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
  await startFirstMeal(page);
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
  await openSavedEntry(page, 'Offline soup');
  await expect(
    page.getByRole('heading', { name: 'Offline soup' }),
  ).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Recalculate' }).click();
  await expect(page.getByLabel('Energy (kcal)')).not.toHaveValue('');
  await context.setOffline(false);
});
