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
  await page.getByLabel(/I understand this photo goes directly/).check();
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
  await page.getByLabel(/I understand this label photo goes directly/).check();
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
