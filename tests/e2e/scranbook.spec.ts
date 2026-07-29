import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import { FakeDrive } from '../support/fake-drive';

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
  const desktopAdd = page.getByRole('button', { name: 'Add a meal' });
  if (await desktopAdd.isVisible()) {
    await desktopAdd.click();
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
  const mobileEntry = page
    .locator('.mobile-entry:visible')
    .filter({ hasText: title });
  await expect(heading.or(mobileEntry)).toBeVisible();
  if (await mobileEntry.isVisible()) await mobileEntry.click();
  await expect(heading).toBeVisible();
}

async function openSettingsSection(
  page: import('@playwright/test').Page,
  name: string,
) {
  const trigger = page.getByRole('button', { name: new RegExp(name) });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
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

async function installMockGoogleDrive(
  page: import('@playwright/test').Page,
  drive: FakeDrive,
  options: {
    authorization?: 'success' | 'denied' | 'missing_scope' | 'closed';
  } = {},
) {
  await page.addInitScript(
    ({ scope, authorization }) => {
      const browserWindow = window as typeof window & {
        google?: {
          accounts: {
            oauth2: {
              initTokenClient: (options: {
                callback: (response: unknown) => void;
                error_callback?: () => void;
              }) => { requestAccessToken: () => void };
              hasGrantedAllScopes: () => boolean;
            };
          };
        };
      };
      browserWindow.google = {
        accounts: {
          oauth2: {
            initTokenClient: ({ callback, error_callback }) => ({
              requestAccessToken: () => {
                if (authorization === 'closed') {
                  error_callback?.();
                  return;
                }
                callback({
                  ...(authorization === 'denied'
                    ? { error: 'access_denied' }
                    : {}),
                  access_token: 'mock-drive-token',
                  expires_in: 3_600,
                  scope,
                });
              },
            }),
            hasGrantedAllScopes: () => authorization !== 'missing_scope',
          },
        },
      };
    },
    {
      scope: 'https://www.googleapis.com/auth/drive.file',
      authorization: options.authorization ?? 'success',
    },
  );
  await page.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request();
    const postData = request.postDataBuffer();
    const response = await drive.handle({
      url: request.url(),
      method: request.method(),
      headers: await request.allHeaders(),
      body: postData ? new Uint8Array(postData) : undefined,
    });
    await route.fulfill({
      status: response.status,
      headers: response.headers,
      body:
        typeof response.body === 'string'
          ? response.body
          : response.body
            ? Buffer.from(response.body)
            : undefined,
    });
  });
  await page.reload();
}

async function browserStorageText(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const indexedDbValues = await new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open('scranbook');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const stores = [...database.objectStoreNames];
        if (stores.length === 0) {
          database.close();
          resolve([]);
          return;
        }
        const transaction = database.transaction(stores, 'readonly');
        const values: unknown[] = [];
        for (const storeName of stores) {
          const all = transaction.objectStore(storeName).getAll();
          all.onsuccess = () => values.push(...all.result);
        }
        transaction.oncomplete = () => {
          database.close();
          resolve(values);
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    return JSON.stringify({
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      indexedDbValues,
      url: location.href,
      body: document.body.innerText,
    });
  });
}

function driveBackupCardStatus(
  page: import('@playwright/test').Page,
  label: string,
) {
  return page.locator('.drive-backup-panel').getByText(label, { exact: true });
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
  await page.setViewportSize({ width: 320, height: 568 });
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

  const privacyNote = await page.locator('.privacy-note').boundingBox();
  const mobileNavigation = await page.locator('.mobile-nav').boundingBox();
  expect(privacyNote).not.toBeNull();
  expect(mobileNavigation).not.toBeNull();
  expect(privacyNote!.y + privacyNote!.height).toBeLessThanOrEqual(
    mobileNavigation!.y,
  );
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

test('backs up, reconnects, and restores through mocked Google Drive', async ({
  page,
}) => {
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive);
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Drive test soup');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');

  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  const backedUpChip = page.getByRole('button', {
    name: 'Google Drive backup: Backed up',
  });
  await expect(backedUpChip).toBeVisible();
  await backedUpChip.click();
  const backupPanel = page.getByRole('dialog', { name: 'Drive backup' });
  await expect(backupPanel).toBeVisible();
  await expect(
    backupPanel.getByText('Your diary is still saved on this device.'),
  ).toBeVisible();
  await expect(
    backupPanel.getByRole('button', { name: 'Manage backup' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(backupPanel).toBeHidden();
  expect(await browserStorageText(page)).not.toContain('mock-drive-token');
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
  expect(drive.manifestJson()).toMatchObject({
    format: 'scranbook-drive',
    entries: [{ title: 'Drive test soup' }],
  });

  await page.reload();
  const reconnectChip = page.getByRole('button', {
    name: 'Google Drive backup: Reconnect Drive',
  });
  await expect(reconnectChip).toBeVisible();
  await reconnectChip.click();
  const reconnectPanel = page.getByRole('dialog', { name: 'Drive backup' });
  await expect(
    reconnectPanel.getByText('Reconnect to continue backup', { exact: true }),
  ).toBeVisible();
  await reconnectPanel.getByRole('button', { name: 'Reconnect' }).click();
  await expect(
    page.getByRole('button', { name: 'Google Drive backup: Backed up' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(
    page.getByRole('button', { name: 'Connect Google Drive' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  await expect(
    page.getByText('Drive backup found', { exact: true }),
  ).toBeHidden();

  await openSettingsSection(page, 'Reset & delete');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete entire diary' }).click();
  await openSettingsSection(page, 'Backup & restore');
  await expect(page.getByText(/0 saved meals/)).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Restore from Drive' }).click();
  await expect(page.getByText(/0 saved meals/)).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Restore from Drive' }).click();
  await expect(
    page.getByText(/Drive backup restored on this device/),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Back to diary' }).click();
  await openSavedEntry(page, 'Drive test soup');
});

test('offers clear choices when an existing Drive backup is found', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'One desktop run is sufficient for the first-connection decision flow.',
  );
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive);
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Existing Drive soup');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  const initialManifest = drive.manifestJson();
  if (!initialManifest) throw new Error('Expected the initial Drive manifest');
  const previousWriter = initialManifest.writerDeviceId;

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('scranbook');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('meta', 'readwrite');
        const store = transaction.objectStore('meta');
        store.delete('drive-sync-state');
        store.delete('installation-state');
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.reload();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();

  await expect(driveBackupCardStatus(page, 'Drive backup found')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use Drive copy on this device' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Replace Drive backup with this device',
    }),
  ).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Use Drive copy on this device' })
    .click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  const activatedManifest = drive.manifestJson();
  expect(activatedManifest).toMatchObject({
    entries: [{ title: 'Existing Drive soup' }],
  });
  expect(activatedManifest?.writerDeviceId).not.toBe(previousWriter);
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});

test('cancels restore without discarding an active local draft', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'One desktop run is sufficient for the shared restore confirmation.',
  );
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive);
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Drive restore source');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();

  await page.getByRole('button', { name: 'Back to diary' }).click();
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Unfinished local draft');
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('unfinished draft');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Restore from Drive' }).click();
  await page.getByRole('button', { name: 'Back to meal editor' }).click();
  await expect(page.getByLabel('What was it?')).toHaveValue(
    'Unfinished local draft',
  );
});

test('handles denied mocked Google authorization safely', async ({ page }) => {
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive, { authorization: 'denied' });
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(page.getByText('Reconnect to continue backup')).toBeVisible();
  await expect(page.getByText(/permission was not granted/)).toBeVisible();
  expect(drive.filesWithRole('root')).toHaveLength(0);
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});

test('keeps offline edits local, resumes online, and requests reconnect after revocation', async ({
  page,
  context,
}) => {
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive);
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Back to diary' }).click();
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Offline lentil soup');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await expect(
    page.getByText('Changes pending while offline', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Google Drive backup: Pending · Offline',
    }),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  expect(drive.manifestJson()).toMatchObject({
    entries: [{ title: 'Offline lentil soup' }],
  });

  drive.failNext(403, 'insufficientPermissions');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Reconnect to continue backup')).toBeVisible();
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});

test('coalesces edits made while a mocked Drive backup is in flight', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'One desktop run is sufficient for deterministic single-flight behavior.',
  );
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive);
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  await page.getByRole('button', { name: 'Back to diary' }).click();

  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('First queued title');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');

  const releaseManifest = drive.delayNextMatching((request) =>
    request.url.includes('uploadType=multipart'),
  );
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Backing up to Drive…')).toBeVisible();
  await page.getByRole('button', { name: 'Back to diary' }).click();
  await openSavedEntry(page, 'First queued title');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('What was it?').fill('Latest queued title');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');

  expect(
    drive.requests.filter((request) =>
      request.url.includes('uploadType=multipart'),
    ),
  ).toHaveLength(2);
  releaseManifest();
  await expect(
    page.getByText('Changes pending', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  expect(drive.manifestJson()).toMatchObject({
    entries: [{ title: 'Latest queued title' }],
  });
});

test('debounces rapid local edits into one mocked Drive commit', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'One desktop run is sufficient for the shared timer policy.',
  );
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive);
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Before rapid edits');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  await page.clock.install();

  await page.getByRole('button', { name: 'Back to diary' }).click();
  await openSavedEntry(page, 'Before rapid edits');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('What was it?').fill('First rapid edit');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('What was it?').fill('Second rapid edit');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await expect(
    page.getByText('Changes pending', { exact: true }),
  ).toBeVisible();

  const manifestCommitCount = () =>
    drive.requests.filter((request) =>
      request.url.includes('uploadType=multipart'),
    ).length;
  expect(manifestCommitCount()).toBe(1);
  await page.clock.runFor(29_999);
  expect(manifestCommitCount()).toBe(1);
  await page.clock.runFor(1);
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  expect(manifestCommitCount()).toBe(2);
  expect(drive.manifestJson()).toMatchObject({
    entries: [{ title: 'Second rapid edit' }],
  });
});

test('backs off a mocked transient Drive failure before retrying', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'One desktop run is sufficient for the shared retry timer.',
  );
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive);
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Before retry');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  await page.clock.install();

  await page.getByRole('button', { name: 'Back to diary' }).click();
  await openSavedEntry(page, 'Before retry');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('What was it?').fill('After retry');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  drive.failNext(503);
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(
    page.getByText('Changes pending', { exact: true }),
  ).toBeVisible();

  const manifestCommitCount = () =>
    drive.requests.filter((request) =>
      request.url.includes('uploadType=multipart'),
    ).length;
  expect(manifestCommitCount()).toBe(1);
  await page.clock.runFor(59_999);
  expect(manifestCommitCount()).toBe(1);
  await page.clock.runFor(1);
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();
  expect(manifestCommitCount()).toBe(2);
  expect(drive.manifestJson()).toMatchObject({
    entries: [{ title: 'After retry' }],
  });
});

test('surfaces a mocked remote conflict without overwriting Drive', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'One desktop run is sufficient for the shared conflict state.',
  );
  const drive = new FakeDrive();
  await installMockGoogleDrive(page, drive);
  await startFirstMeal(page);
  await page.getByLabel('What was it?').fill('Remote original');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(driveBackupCardStatus(page, 'Backed up')).toBeVisible();

  drive.replaceManifest({
    ...drive.manifestJson(),
    commitId: 'another-commit',
    writerDeviceId: 'another-device',
  });
  await page.getByRole('button', { name: 'Back to diary' }).click();
  await openSavedEntry(page, 'Remote original');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('What was it?').fill('Local conflicting edit');
  await page.getByRole('button', { name: 'Save to this device' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await openSettingsSection(page, 'Backup & restore');
  await page.getByRole('button', { name: 'Back up now' }).click();

  await expect(
    driveBackupCardStatus(page, 'Drive backup changed elsewhere'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review Drive backup', exact: true }),
  ).toBeVisible();
  expect(drive.manifestJson()).toMatchObject({
    writerDeviceId: 'another-device',
    entries: [{ title: 'Remote original' }],
  });
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
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
  await expect(page.getByText('Draft saved')).toBeVisible();

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
  await page.getByRole('button', { name: /Privacy & data/ }).click();
  await expect(
    page.getByRole('link', { name: /plain-language privacy note/ }),
  ).toHaveAttribute('href', '/privacy/');
  await page.getByRole('button', { name: /Reset & delete/ }).click();
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
  await expect(page.getByText('Draft saved')).toBeVisible();

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
  await expect(page.getByText('Draft saved')).toBeVisible();
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
  await expect(
    page.getByRole('heading', { name: 'Tuesday lentil bowl' }),
  ).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) <= 780) {
    const mobileDiary = page.locator('.entry-mobile-back');
    await expect(mobileDiary).toBeVisible();
    await mobileDiary.click();
  }
  const diarySearch = page.locator('input[aria-label="Search diary"]:visible');
  await expect(diarySearch).toBeVisible();
  await diarySearch.fill('lentil');
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
  await page.getByText('How this works', { exact: true }).click();
  await expect(page.getByText('Manual entry always works.')).toBeVisible();
  const lmStudio = page.getByRole('button', { name: /^LM Studio/ });
  await expect(lmStudio).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Appears local', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Custom endpoint/ }).click();
  await expect(page.getByLabel('Base URL')).toHaveValue(
    'http://127.0.0.1:1234/v1',
  );
  await page.getByLabel('Base URL').fill('https://models.example.com/v1');
  await page.getByLabel('API key optional').fill('hosted-provider-secret');
  await page.getByText('Advanced settings', { exact: true }).click();
  await page
    .getByLabel('Additional request headers (JSON)')
    .fill('{"X-Hosted-Secret":"secret"}');
  await expect(
    page.getByText('Remote endpoint', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Photos leave this device only when you choose Analyse/),
  ).toBeVisible();

  await lmStudio.click();
  await expect(page.getByText('http://127.0.0.1:1234/v1')).toBeVisible();
  await expect(page.getByLabel('Response mode')).toBeVisible();
  await expect(
    page.getByText('Photos are sent only when you choose Analyse.'),
  ).toBeVisible();
  await expect(page.getByText(/I understand/)).toHaveCount(0);
  await page.getByRole('button', { name: /^Custom endpoint/ }).click();
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
