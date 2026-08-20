import { expect, test } from '@playwright/test';

const captureEnabled = process.env.SCRANBOOK_CAPTURE === '1';
const fixture = process.env.SCRANBOOK_TEST_IMAGE ?? '';
const result = {
  classification: 'recipe_card',
  dishName: 'Smoky chilli con carne with rice',
  servings: null,
  portionSummary: 'A recipe card photographed on the kitchen table',
  ingredients: [
    {
      name: 'basmati rice',
      amount: 280,
      unit: 'g',
      preparation: 'steamed',
      confidence: 'high',
      estimatedGrams: 280,
    },
    {
      name: 'beef mince',
      amount: 250,
      unit: 'g',
      preparation: null,
      confidence: 'medium',
      estimatedGrams: 250,
    },
  ],
  overallConfidence: 'medium',
  uncertaintyNotes: ['Recipe quantities do not show what was consumed.'],
};

const labelResult = {
  productName: 'Cocoa oat bar',
  columns: [
    {
      basis: 'per_100g',
      basisAmount: 100,
      basisUnit: 'g',
      printedHeading: 'Per 100 g',
      servingDescription: '1 bar (30 g)',
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
          dailyValuePercent: 20,
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

test('captures the visual review surfaces', async ({ page }, testInfo) => {
  test.skip(
    !captureEnabled,
    'Set SCRANBOOK_CAPTURE=1 to create review captures.',
  );
  test.skip(
    !fixture,
    'Set SCRANBOOK_TEST_IMAGE to a local meal or recipe-card photo.',
  );
  test.skip(
    testInfo.project.name === 'narrow-mobile',
    'The primary mobile and desktop projects cover the visual review.',
  );

  await page.goto('/');
  const project = testInfo.project.name;
  await page.screenshot({
    path: `output/visual-review/${project}-empty.png`,
    fullPage: false,
  });

  await page.route('**/v1/chat/completions', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
      }),
    });
  });
  await startFirstMeal(page);
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole('button', { name: 'Analyse photo' }).click();
  await expect(page.getByLabel('What was it?')).toHaveValue(
    'Smoky chilli con carne with rice',
  );
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Smoky chilli con carne with rice' }),
  ).toBeVisible();
  const dismiss = page.getByRole('button', { name: 'Dismiss message' });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `output/visual-review/${project}-entry.png`,
    fullPage: false,
  });

  await page
    .locator(project === 'mobile' ? '.mobile-add' : '.desktop-add')
    .click();
  await page.getByLabel('What was it?').fill('Fresh tomato salad');
  await page.getByLabel('Portion').fill('A 150 g bowl of fresh tomatoes');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page
    .getByRole('textbox', { name: 'Ingredient', exact: true })
    .fill('tomatoes');
  await page.getByLabel('Amount', { exact: true }).fill('150');
  await page.getByLabel('Unit', { exact: true }).fill('g');
  await page.getByLabel('Estimated grams').fill('150');
  await page.getByLabel('Preparation').fill('raw');
  await page.getByRole('button', { name: 'Calculate locally' }).click();
  await expect(page.getByLabel('Energy (kcal)')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  const nutritionCard = page.locator('.nutrition-card');
  await expect(nutritionCard).toBeVisible();
  if (await dismiss.isVisible()) await dismiss.click();
  await nutritionCard.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `output/visual-review/${project}-nutrition.png`,
    fullPage: false,
  });
});

test('captures nutrition label surfaces', async ({ page }, testInfo) => {
  test.skip(
    !captureEnabled,
    'Set SCRANBOOK_CAPTURE=1 to create review captures.',
  );
  await page.goto('/');
  await startFirstMeal(page);
  await page.getByRole('button', { name: 'Nutrition label' }).click();
  const project = testInfo.project.name;
  await page.screenshot({
    path: `output/visual-review/${project}-label-capture.png`,
    fullPage: false,
  });

  await page.route('**/v1/chat/completions', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(labelResult) } }],
      }),
    });
  });
  await page
    .getByLabel('Choose nutrition label photo')
    .setInputFiles('public/icon-192.png');
  await page
    .getByRole('button', { name: 'Scan label with configured model' })
    .click();
  await page.getByLabel('Printed column').selectOption({ label: 'Per bar' });
  await page.getByLabel('Amount consumed').fill('1.5');
  const review = page.locator('.label-review-card');
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `output/visual-review/${project}-label-review.png`,
    fullPage: false,
  });

  await page.getByRole('button', { name: 'Save to this device' }).click();
  const summary = page.locator('.label-summary');
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `output/visual-review/${project}-label-detail.png`,
    fullPage: false,
  });
});

test('captures meal follow-up surfaces', async ({ page }, testInfo) => {
  test.skip(
    !captureEnabled,
    'Set SCRANBOOK_CAPTURE=1 to create review captures.',
  );
  test.skip(
    testInfo.project.name !== 'mobile',
    'The mobile project is the primary follow-up design reference.',
  );

  await page.setViewportSize({ width: 426, height: 922 });
  await page.goto('/');
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Mushroom toast');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page
    .getByRole('textbox', { name: 'Ingredient', exact: true })
    .fill('Mushrooms');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  const dismiss = page.getByRole('button', { name: 'Dismiss message' });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await page
    .getByLabel('Main navigation')
    .getByRole('button', { name: 'Diary', exact: true })
    .click();
  await page.screenshot({
    path: 'output/visual-review/mobile-meal-timeline.png',
    fullPage: false,
  });

  await page.getByRole('button', { name: 'Add check-in' }).click();
  await page.getByRole('button', { name: 'A little off' }).click();
  await page.getByRole('button', { name: 'Bloating' }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: 'output/visual-review/mobile-meal-check-in.png',
    fullPage: false,
  });

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('scranbook', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('entries', 'readwrite');
    const store = transaction.objectStore('entries');
    for (let index = 0; index < 8; index += 1) {
      const hasOnion = index < 4;
      const hasBloating = index < 3;
      const eatenAt = new Date(Date.UTC(2026, 7, 20 - index, 12)).toISOString();
      const checkInAt = new Date(
        Date.UTC(2026, 7, 20 - index, 15),
      ).toISOString();
      store.put({
        id: `visual-pattern-meal-${index}`,
        capturedAt: eatenAt,
        eatenAt,
        mealType: 'lunch',
        title: hasOnion
          ? `Onion lunch ${index + 1}`
          : `Rice lunch ${index + 1}`,
        notes: '',
        classification: 'meal',
        servings: null,
        portionSummary: '',
        ingredients: [
          {
            id: `visual-ingredient-${index}`,
            name: hasOnion ? 'Onion' : 'Rice',
            amount: null,
            unit: null,
            preparation: null,
            confidence: 'high',
            estimatedGrams: null,
            nutritionMatch: null,
            nutritionExcluded: false,
          },
        ],
        nutrition: null,
        photoId: null,
        analysis: null,
        checkIns: [
          {
            id: `visual-check-in-${index}`,
            recordedAt: checkInAt,
            feeling: hasBloating ? 'a_little_off' : 'fine',
            symptoms: hasBloating ? ['bloating'] : [],
            severity: hasBloating ? 2 : null,
            onset: hasBloating ? '1_to_3_hours' : null,
            notes: '',
          },
        ],
        createdAt: eatenAt,
        updatedAt: checkInAt,
      });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await page
    .getByRole('button', {
      name: /what you’ve noticed|see what you’ve noticed/i,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Onion and bloating' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'output/visual-review/mobile-meal-pattern.png',
    fullPage: false,
  });
});
