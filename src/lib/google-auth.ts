import { BackupProviderError } from './backup-provider';

export const googleDriveScope = 'https://www.googleapis.com/auth/drive.file';

export const googleDriveClientId =
  process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID ?? '';

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  scope?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleOauth2Api {
  initTokenClient(options: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error?: { type?: string }) => void;
  }): GoogleTokenClient;
  hasGrantedAllScopes(
    response: GoogleTokenResponse,
    ...scopes: string[]
  ): boolean;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: GoogleOauth2Api;
      };
    };
  }
}

let scriptPromise: Promise<void> | undefined;

export function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new BackupProviderError(
        'Google authorization is only available in a browser.',
        'authorization',
      ),
    );
  }
  if (window.google?.accounts.oauth2) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-scranbook-google-identity]',
    );
    const script = existing ?? document.createElement('script');
    const onLoad = () => {
      if (window.google?.accounts.oauth2) resolve();
      else {
        reject(
          new BackupProviderError(
            'Google authorization did not become available.',
            'authorization',
          ),
        );
      }
    };
    const onError = () => {
      scriptPromise = undefined;
      script.remove();
      reject(
        new BackupProviderError(
          'Could not load Google authorization. Check your connection and try again.',
          'authorization',
        ),
      );
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.scranbookGoogleIdentity = 'true';
      document.head.append(script);
    }
  });
  return scriptPromise;
}

export class GoogleDriveTokenManager {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private tokenClient: GoogleTokenClient | null = null;
  private pending:
    | {
        resolve: (token: string) => void;
        reject: (error: Error) => void;
        timeoutId: ReturnType<typeof setTimeout>;
      }
    | undefined;

  constructor(
    private readonly clientId: string,
    private readonly authorizationTimeoutMs = 60_000,
  ) {}

  get validToken(): string | null {
    if (!this.accessToken || Date.now() >= this.expiresAt) {
      this.clear();
      return null;
    }
    return this.accessToken;
  }

  async requestToken(prompt: '' | 'consent' = 'consent'): Promise<string> {
    if (!this.clientId) {
      throw new BackupProviderError(
        'Google Drive backup is not configured for this build.',
        'authorization',
      );
    }
    if (this.pending) {
      throw new BackupProviderError(
        'Google authorization is already in progress.',
        'authorization',
      );
    }
    await loadGoogleIdentityServices();
    const oauth2 = window.google?.accounts.oauth2;
    if (!oauth2) {
      throw new BackupProviderError(
        'Google authorization is unavailable.',
        'authorization',
      );
    }
    this.tokenClient ??= oauth2.initTokenClient({
      client_id: this.clientId,
      scope: googleDriveScope,
      callback: (response) => this.receiveResponse(response),
      error_callback: () => this.rejectPending('Google authorization closed.'),
    });
    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(
        () =>
          this.rejectPending(
            'Google authorization did not finish. Close the Google window and try again.',
          ),
        this.authorizationTimeoutMs,
      );
      this.pending = { resolve, reject, timeoutId };
      this.tokenClient?.requestAccessToken({ prompt });
    });
  }

  clear() {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  private receiveResponse(response: GoogleTokenResponse) {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    const oauth2 = window.google?.accounts.oauth2;
    if (
      response.error ||
      !response.access_token ||
      !oauth2?.hasGrantedAllScopes(response, googleDriveScope)
    ) {
      pending.reject(
        new BackupProviderError(
          response.error === 'access_denied'
            ? 'Google Drive permission was not granted.'
            : 'Google authorization did not grant the required Drive permission.',
          'authorization',
        ),
      );
      return;
    }
    this.accessToken = response.access_token;
    const lifetimeSeconds = Math.max(0, response.expires_in ?? 0);
    this.expiresAt = Date.now() + Math.max(0, lifetimeSeconds - 30) * 1_000;
    pending.resolve(response.access_token);
  }

  private rejectPending(message: string) {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) clearTimeout(pending.timeoutId);
    pending?.reject(new BackupProviderError(message, 'authorization'));
  }
}
