import { expect, test } from '@playwright/test';
import { gunzipSync } from 'node:zlib';

test.use({ serviceWorkers: 'block' });

type CapturedRequest = {
  body: Buffer;
  contentType: string;
  url: string;
};

function decodedPayloads(request: CapturedRequest) {
  const candidates: Buffer[] = [request.body];
  const text = request.body.toString('utf8');
  const data = new URLSearchParams(text).get('data');
  if (data) candidates.push(Buffer.from(data, 'base64'));

  const decoded: string[] = [];
  for (const candidate of candidates) {
    decoded.push(candidate.toString('utf8'));
    if (candidate[0] === 0x1f && candidate[1] === 0x8b) {
      decoded.push(gunzipSync(candidate).toString('utf8'));
    }
  }
  return decoded;
}

test('captures only privacy-safe production analytics and honors opt-out', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'The production analytics contract needs one Chromium execution.',
  );

  // PostHog intentionally excludes automated browsers. This test is exercising
  // our payload contract, so make the isolated browser context behave like a
  // regular browser before the SDK initializes.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: [
          { brand: 'Google Chrome', version: '151' },
          { brand: 'Chromium', version: '151' },
        ],
        mobile: false,
        platform: 'Windows',
      }),
    });
  });

  const posthogRequests: CapturedRequest[] = [];
  await page.route('https://eu.i.posthog.com/**', async (route) => {
    const request = route.request();
    const body = request.postDataBuffer();
    if (request.method() === 'POST' && body) {
      posthogRequests.push({
        body,
        contentType: request.headers()['content-type'] ?? '',
        url: request.url(),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
  await page.route('https://scranbook.labs.tau.gr/**', async (route) => {
    const source = new URL(route.request().url());
    const localUrl = `http://127.0.0.1:3000${source.pathname}${source.search}`;
    const response = await route.fetch({ url: localUrl });
    await route.fulfill({ response });
  });

  await page.goto(
    'https://scranbook.labs.tau.gr/?entry=private-value&utm_campaign=private-campaign#private-fragment',
  );
  await expect(
    page.getByRole('heading', {
      name: 'Remember the meals that made your day.',
    }),
  ).toBeVisible();
  await expect.poll(() => posthogRequests.length).toBeGreaterThanOrEqual(1);

  const payloadText = posthogRequests.flatMap(decodedPayloads).join('\n');
  expect(payloadText).toContain('scranbook');
  expect(payloadText).toContain('analytics_schema_version');
  expect(payloadText).not.toContain('private-value');
  expect(payloadText).not.toContain('private-campaign');
  expect(payloadText).not.toContain('private-fragment');

  const persistence = await page.evaluate(() => ({
    cookies: document.cookie,
    localStorageKeys: Object.keys(localStorage),
    sessionStorageKeys: Object.keys(sessionStorage),
  }));
  expect(persistence.cookies).not.toMatch(/(?:^|;\s*)ph_/);
  expect(persistence.localStorageKeys).not.toContainEqual(
    expect.stringMatching(/^ph_/),
  );
  expect(persistence.sessionStorageKeys).not.toContainEqual(
    expect.stringMatching(/^ph_/),
  );

  await page
    .getByRole('button', { name: 'Settings & privacy', exact: true })
    .click();
  await page.getByRole('button', { name: /Privacy & data/ }).click();
  await page.getByRole('checkbox', { name: /Share anonymous usage/ }).uncheck();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('scranbook.analytics.enabled'),
      ),
    )
    .toBe('false');

  await page.waitForTimeout(700);
  const requestCountAfterOptOut = posthogRequests.length;
  await page.reload();
  await page.waitForTimeout(1_000);
  expect(posthogRequests).toHaveLength(requestCountAfterOptOut);
});
