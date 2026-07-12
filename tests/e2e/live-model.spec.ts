import { expect, test } from '@playwright/test';

const liveEnabled = process.env.SCRANBOOK_LIVE_MODEL === '1';
const fixture = process.env.SCRANBOOK_TEST_IMAGE ?? '';

test('analyses the recipe-card fixture through browser-direct LM Studio', async ({
  page,
}, testInfo) => {
  test.skip(
    !liveEnabled,
    'Set SCRANBOOK_LIVE_MODEL=1 for the opt-in local model test.',
  );
  test.skip(
    !fixture,
    'Set SCRANBOOK_TEST_IMAGE to a local meal or recipe-card photo.',
  );
  test.skip(
    testInfo.project.name !== 'mobile',
    'The live model only needs one browser profile.',
  );
  test.setTimeout(180_000);

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).last().click();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(
    page.getByText(/Connected\. google\/gemma-4-e4b is ready/),
  ).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await expect(page.getByAltText('Meal ready to review')).toBeVisible();
  await page.getByLabel(/I understand this photo goes directly/).check();
  await page.getByRole('button', { name: 'Analyse photo' }).click();
  await expect(page.getByLabel('What was it?')).toHaveValue(
    /Smoky Chilli Con Carne/i,
    {
      timeout: 150_000,
    },
  );
  await expect(page.getByLabel('Kind of image')).toHaveValue('recipe_card');
  await expect(
    page.getByText(/Check every estimate before saving/),
  ).toBeVisible();
});
