import { expect, test } from '@playwright/test';

const captureEnabled = process.env.SCRANBOOK_CAPTURE === '1';
const fixture =
  '/Users/tomauger/projects/recipe-generation/recipes/IMG_20210703_184219.jpg';
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
    },
    {
      name: 'beef mince',
      amount: 250,
      unit: 'g',
      preparation: null,
      confidence: 'medium',
    },
  ],
  overallConfidence: 'medium',
  uncertaintyNotes: ['Recipe quantities do not show what was consumed.'],
};

test('captures the visual review surfaces', async ({ page }, testInfo) => {
  test.skip(
    !captureEnabled,
    'Set SCRANBOOK_CAPTURE=1 to create review captures.',
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
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Add your first meal' })
    .click();
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
});
