import type { CaptureResult, PostHog } from 'posthog-js';

const analyticsPreferenceKey = 'scranbook.analytics.enabled';
export const analyticsPreferenceEvent = 'scranbook:analytics-preference';

const analyticsIdentity = {
  analytics_schema_version: 1,
  app: 'scranbook',
  environment: 'production',
} as const;

const allowedEvents = new Set([
  '$pageview',
  'screen_viewed',
  'analysis_completed',
  'analysis_failed',
  'meal_saved',
]);

let posthogPromise: Promise<PostHog | null> | null = null;
let analyticsPreferenceOverride: boolean | null = null;

export function canonicalAnalyticsUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

export function sanitizeAnalyticsEvent(
  event: CaptureResult | null,
): CaptureResult | null {
  if (!event) return null;
  if (!allowedEvents.has(event.event)) return null;

  const properties: CaptureResult['properties'] = {
    ...event.properties,
    ...analyticsIdentity,
  };
  for (const key of [
    '$current_url',
    '$initial_current_url',
    '$session_entry_url',
  ]) {
    if (typeof properties[key] === 'string')
      properties[key] = canonicalAnalyticsUrl(properties[key]);
  }
  const blockedProperties = new Set([
    '$referrer',
    '$referring_domain',
    '$initial_referrer',
    '$initial_referring_domain',
    '$initial_person_info',
    'gclid',
    'gad_source',
    'dclid',
    'fbclid',
    'gbraid',
    'msclkid',
    'twclid',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'wbraid',
  ]);
  for (const key of Object.keys(properties)) {
    const normalizedKey = key.replace(/^\$/, '');
    if (
      blockedProperties.has(key) ||
      blockedProperties.has(normalizedKey) ||
      /^\$?utm_/i.test(key)
    ) {
      delete properties[key];
    }
  }

  return { ...event, properties };
}

export function analyticsEnabled() {
  if (typeof window === 'undefined') return true;
  if (analyticsPreferenceOverride !== null) return analyticsPreferenceOverride;
  try {
    return window.localStorage.getItem(analyticsPreferenceKey) !== 'false';
  } catch {
    return true;
  }
}

function analyticsConfigured() {
  return (
    typeof window !== 'undefined' &&
    Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY) &&
    window.location.hostname === process.env.NEXT_PUBLIC_POSTHOG_ALLOWED_HOST
  );
}

async function posthogClient() {
  if (!analyticsConfigured() || !analyticsEnabled()) return null;
  if (posthogPromise) return posthogPromise;

  posthogPromise = import('posthog-js').then(({ default: posthog }) => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
      advanced_disable_feature_flags: true,
      advanced_disable_flags: true,
      autocapture: false,
      before_send: sanitizeAnalyticsEvent,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_pageleave: false,
      capture_pageview: false,
      capture_performance: false,
      cookieless_mode: 'always',
      disable_capture_url_hashes: true,
      disable_persistence: true,
      disable_session_recording: true,
      disable_surveys: true,
      disableDeviceModel: true,
      mask_all_element_attributes: true,
      mask_all_text: true,
      person_profiles: 'never',
      rageclick: false,
      respect_dnt: true,
      save_campaign_params: false,
      save_referrer: false,
    });
    return posthog;
  });

  return posthogPromise;
}

export function setAnalyticsEnabled(enabled: boolean) {
  analyticsPreferenceOverride = enabled;
  try {
    window.localStorage.setItem(analyticsPreferenceKey, String(enabled));
  } catch {
    // The in-memory choice still applies for this render when storage is blocked.
  }
  window.dispatchEvent(
    new CustomEvent(analyticsPreferenceEvent, { detail: { enabled } }),
  );
}

export async function capturePageView(pathname: string) {
  const posthog = await posthogClient();
  if (!posthog || !analyticsEnabled()) return;
  const currentUrl = canonicalAnalyticsUrl(
    new URL(pathname, window.location.origin).toString(),
  );
  posthog.capture('$pageview', { $current_url: currentUrl });
}

type AnalyticsEventProperties = {
  screen_viewed: {
    screen: 'diary' | 'add' | 'check_in' | 'patterns' | 'settings';
  };
  analysis_completed: {
    endpoint_type: 'local' | 'remote' | 'invalid';
    image_kind: 'meal' | 'nutrition_label';
  };
  analysis_failed: {
    endpoint_type: 'local' | 'remote' | 'invalid';
    image_kind: 'meal' | 'nutrition_label';
  };
  meal_saved: {
    analysis_used: boolean;
    entry_kind: 'meal' | 'nutrition_label' | 'other';
    mode: 'new' | 'edit' | 'repeat';
    photo_present: boolean;
  };
};

export async function captureAnalyticsEvent<
  EventName extends keyof AnalyticsEventProperties,
>(event: EventName, properties: AnalyticsEventProperties[EventName]) {
  const posthog = await posthogClient();
  if (!posthog || !analyticsEnabled()) return;
  posthog.capture(event, properties);
}
