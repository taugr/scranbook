'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { analyticsPreferenceEvent, capturePageView } from '@/lib/analytics';

export function PostHogAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    void capturePageView(pathname);

    const captureAfterEnable = (event: Event) => {
      if ((event as CustomEvent<{ enabled: boolean }>).detail.enabled)
        void capturePageView(pathname);
    };
    window.addEventListener(analyticsPreferenceEvent, captureAfterEnable);
    return () =>
      window.removeEventListener(analyticsPreferenceEvent, captureAfterEnable);
  }, [pathname]);

  return null;
}
