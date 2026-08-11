import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyticsEnabled,
  canonicalAnalyticsUrl,
  sanitizeAnalyticsEvent,
  setAnalyticsEnabled,
} from '@/lib/analytics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('privacy-safe analytics', () => {
  it('removes query strings and hashes from page URLs', () => {
    expect(
      canonicalAnalyticsUrl('https://scranbook.labs.tau.gr/privacy/?meal=1#x'),
    ).toBe('https://scranbook.labs.tau.gr/privacy/');
  });

  it('removes referrer and campaign properties', () => {
    const result = sanitizeAnalyticsEvent({
      uuid: 'event-id',
      event: '$pageview',
      properties: {
        $current_url: 'https://scranbook.labs.tau.gr/?meal=1#x',
        $initial_current_url:
          'https://scranbook.labs.tau.gr/privacy/?entry=private#details',
        $initial_person_info: { r: 'https://example.com/private-path' },
        $referrer: 'https://example.com/private-path',
        $utm_future_campaign_field: 'private-campaign',
        utm_campaign: 'private-campaign',
      },
    });

    expect(result?.properties).toEqual({
      $initial_current_url: 'https://scranbook.labs.tau.gr/privacy/',
      $current_url: 'https://scranbook.labs.tau.gr/',
      analytics_schema_version: 1,
      app: 'scranbook',
      environment: 'production',
    });
  });

  it('blocks SDK events outside the explicit allowlist', () => {
    expect(
      sanitizeAnalyticsEvent({
        uuid: 'event-id',
        event: '$autocapture',
        properties: {},
      }),
    ).toBeNull();
  });

  it('retains an opt-out in memory when browser storage is unavailable', () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      localStorage: {
        getItem: vi.fn(() => {
          throw new Error('storage unavailable');
        }),
        setItem: vi.fn(() => {
          throw new Error('storage unavailable');
        }),
      },
    });
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(
          public type: string,
          public init: { detail: { enabled: boolean } },
        ) {}
      },
    );

    setAnalyticsEnabled(false);
    expect(analyticsEnabled()).toBe(false);

    setAnalyticsEnabled(true);
  });
});
