import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleDriveScope, GoogleDriveTokenManager } from '@/lib/google-auth';

function installGoogleMock(options: {
  response?: Record<string, unknown>;
  granted?: boolean;
  close?: boolean;
  silent?: boolean;
}) {
  vi.stubGlobal('window', {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: ({
            callback,
            error_callback,
          }: {
            callback: (response: Record<string, unknown>) => void;
            error_callback?: () => void;
          }) => ({
            requestAccessToken: () => {
              if (options.silent) return;
              if (options.close) error_callback?.();
              else
                callback(
                  options.response ?? {
                    access_token: 'ephemeral-token',
                    expires_in: 3_600,
                    scope: googleDriveScope,
                  },
                );
            },
          }),
          hasGrantedAllScopes: () => options.granted ?? true,
        },
      },
    },
  });
}

describe('Google Drive token manager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a granted token only in memory until its safe expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    installGoogleMock({
      response: {
        access_token: 'ephemeral-token',
        expires_in: 60,
        scope: googleDriveScope,
      },
    });
    const manager = new GoogleDriveTokenManager('client-id');

    await expect(manager.requestToken()).resolves.toBe('ephemeral-token');
    expect(manager.validToken).toBe('ephemeral-token');
    vi.advanceTimersByTime(30_000);
    expect(manager.validToken).toBeNull();
  });

  it.each([
    [{ response: { error: 'access_denied' } }, 'permission was not granted'],
    [{ granted: false }, 'required Drive permission'],
    [{ close: true }, 'authorization closed'],
  ] as const)(
    'rejects denied, incomplete, and closed authorization',
    async (options, message) => {
      installGoogleMock(options);
      await expect(
        new GoogleDriveTokenManager('client-id').requestToken(),
      ).rejects.toMatchObject({
        code: 'authorization',
        message: expect.stringContaining(message),
      });
    },
  );

  it('times out when the Google popup closes without a callback', async () => {
    vi.useFakeTimers();
    installGoogleMock({ silent: true });
    const pending = new GoogleDriveTokenManager('client-id', 50).requestToken();
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'authorization',
      message: expect.stringContaining('did not finish'),
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });
});
