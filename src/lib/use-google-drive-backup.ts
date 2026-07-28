'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackupProviderError,
  type RemoteBackupRecord,
} from './backup-provider';
import {
  createDriveSyncState,
  driveBackupPending,
  inspectDriveBackup,
  performDriveBackup,
  restoreDriveBackup,
} from './drive-backup';
import {
  driveBackupDebounceMs,
  driveBackupPeriodicCheckMs,
  nextDriveBackupRetryMs,
} from './drive-backup-schedule';
import {
  clearDriveSyncState,
  loadOrCreateInstallationState,
  loadDriveSyncState,
  saveDriveSyncState,
} from './db';
import { googleDriveClientId, GoogleDriveTokenManager } from './google-auth';
import { GoogleDriveProvider } from './google-drive-provider';
import type { DiaryRevisionState, DriveSyncState } from './schema';

export type DriveBackupStatus =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'needs_authorization'
  | 'pending'
  | 'backing_up'
  | 'up_to_date'
  | 'offline'
  | 'remote_available'
  | 'conflict'
  | 'error';

export interface GoogleDriveBackupController {
  configured: boolean;
  state: DriveSyncState | null;
  status: DriveBackupStatus;
  message: string | null;
  remote: RemoteBackupRecord | null;
  folderUrl: string | null;
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  backUpNow: () => Promise<void>;
  restore: () => Promise<void>;
  restoreAndMakeActive: () => Promise<void>;
  makeActive: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Google Drive backup could not be completed.';
}

export function useGoogleDriveBackup(
  revision: DiaryRevisionState,
  refreshDiary: () => Promise<void>,
): GoogleDriveBackupController {
  const configured = Boolean(googleDriveClientId);
  const [state, setState] = useState<DriveSyncState | null>(null);
  const [status, setStatus] = useState<DriveBackupStatus>(
    configured ? 'disconnected' : 'unavailable',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteBackupRecord | null>(null);
  const [folderUrl, setFolderUrl] = useState<string | null>(null);
  const tokenManagerRef = useRef<GoogleDriveTokenManager | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const retryDelayRef = useRef(driveBackupDebounceMs);

  if (configured && !tokenManagerRef.current) {
    tokenManagerRef.current = new GoogleDriveTokenManager(googleDriveClientId);
  }

  useEffect(() => {
    let active = true;
    void loadDriveSyncState().then((saved) => {
      if (!active) return;
      setState(saved);
      if (!configured) setStatus('unavailable');
      else if (saved?.enabled) setStatus('needs_authorization');
      else setStatus('disconnected');
    });
    return () => {
      active = false;
    };
  }, [configured]);

  const handleError = useCallback((error: unknown) => {
    const providerError =
      error instanceof BackupProviderError ? error : undefined;
    setMessage(errorMessage(error));
    if (
      providerError?.code === 'authorization' ||
      providerError?.code === 'permission'
    ) {
      tokenManagerRef.current?.clear();
      setStatus('needs_authorization');
    } else if (providerError?.code === 'conflict') {
      setStatus('conflict');
    } else if (
      providerError?.code === 'transient' ||
      providerError?.code === 'throttled'
    ) {
      retryDelayRef.current = nextDriveBackupRetryMs(retryDelayRef.current);
      setStatus(navigator.onLine ? 'pending' : 'offline');
    } else {
      setStatus('error');
    }
  }, []);

  const providerForToken = useCallback(() => {
    const token = tokenManagerRef.current?.validToken;
    if (!token) {
      throw new BackupProviderError(
        'Reconnect Google Drive to continue backup.',
        'authorization',
      );
    }
    return new GoogleDriveProvider(token);
  }, []);

  const backUpWithState = useCallback(
    async (current: DriveSyncState, allowTakeover = false) => {
      if (inFlightRef.current) return inFlightRef.current;
      const operation = (async () => {
        if (!navigator.onLine) {
          setStatus('offline');
          setMessage(
            'Changes are safe on this device and will back up online.',
          );
          return;
        }
        setStatus('backing_up');
        setMessage(null);
        try {
          const result = await performDriveBackup(providerForToken(), current, {
            allowTakeover,
          });
          setState(result.state);
          setRemote(result.remote);
          setFolderUrl(result.resources.folderUrl);
          retryDelayRef.current = driveBackupDebounceMs;
          setStatus('up_to_date');
        } catch (error) {
          handleError(error);
          if (
            error instanceof BackupProviderError &&
            error.code === 'conflict'
          ) {
            try {
              const inspection = await inspectDriveBackup(
                providerForToken(),
                current,
              );
              setRemote(inspection.remote);
              setFolderUrl(inspection.resources.folderUrl);
            } catch {
              // Keep the original conflict as the actionable state.
            }
          }
        }
      })();
      inFlightRef.current = operation;
      try {
        await operation;
      } finally {
        inFlightRef.current = null;
      }
    },
    [handleError, providerForToken],
  );

  const authorize = useCallback(
    async (prompt: '' | 'consent') => {
      if (!configured || !tokenManagerRef.current) return;
      setStatus('connecting');
      setMessage(null);
      try {
        const token = await tokenManagerRef.current.requestToken(prompt);
        const provider = new GoogleDriveProvider(token);
        const current =
          state ??
          createDriveSyncState(
            (await loadOrCreateInstallationState()).deviceId,
          );
        const inspection = await inspectDriveBackup(provider, current);
        const discoveredState = await saveDriveSyncState({
          ...current,
          enabled: true,
          folderId: inspection.resources.folderId,
          photoFolderId: inspection.resources.photoFolderId,
          manifestFileId:
            inspection.remote?.manifestFileId ??
            inspection.resources.manifestFileId,
        });
        setState(discoveredState);
        setRemote(inspection.remote);
        setFolderUrl(inspection.resources.folderUrl);
        if (
          inspection.remote &&
          (inspection.remote.snapshot.writerDeviceId !==
            discoveredState.deviceId ||
            (discoveredState.lastRemoteVersion !== null &&
              inspection.remote.version !== discoveredState.lastRemoteVersion))
        ) {
          setStatus('remote_available');
          setMessage(
            'A Scranbook backup already exists in this Drive. Choose whether to use the Drive copy on this device or replace it with the local diary.',
          );
          return;
        }
        if (
          inspection.remote &&
          !driveBackupPending(revision, discoveredState)
        ) {
          retryDelayRef.current = driveBackupDebounceMs;
          setStatus('up_to_date');
          return;
        }
        await backUpWithState(discoveredState);
      } catch (error) {
        handleError(error);
      }
    },
    [backUpWithState, configured, handleError, revision, state],
  );

  const backUpNow = useCallback(async () => {
    if (!state) return;
    await backUpWithState(state);
  }, [backUpWithState, state]);

  const restore = useCallback(async () => {
    if (!state) return;
    setStatus('backing_up');
    setMessage('Checking and restoring the Drive backup…');
    try {
      const result = await restoreDriveBackup(providerForToken(), state);
      setState(result.state);
      setRemote(result.remote);
      setFolderUrl(result.resources.folderUrl);
      await refreshDiary();
      if (result.remote?.snapshot.writerDeviceId === result.state.deviceId) {
        setStatus('up_to_date');
        setMessage('Drive backup restored on this device.');
      } else {
        setStatus('remote_available');
        setMessage(
          'Drive backup restored on this device. Make this device active before backing up new changes.',
        );
      }
    } catch (error) {
      handleError(error);
    }
  }, [handleError, providerForToken, refreshDiary, state]);

  const makeActive = useCallback(async () => {
    if (!state) return;
    await backUpWithState(state, true);
  }, [backUpWithState, state]);

  const restoreAndMakeActive = useCallback(async () => {
    if (!state) return;
    setStatus('backing_up');
    setMessage('Restoring the Drive backup and activating this device…');
    try {
      const restored = await restoreDriveBackup(providerForToken(), state);
      await refreshDiary();
      const activated = await performDriveBackup(
        providerForToken(),
        restored.state,
        { allowTakeover: true },
      );
      setState(activated.state);
      setRemote(activated.remote);
      setFolderUrl(activated.resources.folderUrl);
      retryDelayRef.current = driveBackupDebounceMs;
      setStatus('up_to_date');
      setMessage('Drive backup restored and this device is now active.');
    } catch (error) {
      handleError(error);
    }
  }, [handleError, providerForToken, refreshDiary, state]);

  const disconnect = useCallback(async () => {
    tokenManagerRef.current?.clear();
    await clearDriveSyncState();
    setState(null);
    setRemote(null);
    setFolderUrl(null);
    setMessage(null);
    setStatus(configured ? 'disconnected' : 'unavailable');
  }, [configured]);

  useEffect(() => {
    if (!state?.enabled) return;
    if (!tokenManagerRef.current?.validToken) {
      if (
        status !== 'remote_available' &&
        status !== 'conflict' &&
        status !== 'connecting'
      )
        setStatus('needs_authorization');
      return;
    }
    if (!driveBackupPending(revision, state)) {
      if (status === 'pending' || status === 'offline') setStatus('up_to_date');
      return;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    if (
      status === 'conflict' ||
      status === 'remote_available' ||
      status === 'backing_up'
    )
      return;
    setStatus('pending');
    const timeout = window.setTimeout(
      () => void backUpWithState(state),
      retryDelayRef.current,
    );
    return () => window.clearTimeout(timeout);
  }, [backUpWithState, revision, state, status]);

  useEffect(() => {
    if (!state?.enabled) return;
    const reconsider = () => {
      if (
        driveBackupPending(revision, state) &&
        tokenManagerRef.current?.validToken &&
        navigator.onLine &&
        status !== 'conflict' &&
        status !== 'remote_available'
      ) {
        void backUpWithState(state);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') reconsider();
    };
    window.addEventListener('online', reconsider);
    window.addEventListener('focus', reconsider);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(reconsider, driveBackupPeriodicCheckMs);
    return () => {
      window.removeEventListener('online', reconsider);
      window.removeEventListener('focus', reconsider);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [backUpWithState, revision, state, status]);

  return {
    configured,
    state,
    status,
    message,
    remote,
    folderUrl,
    connect: () => authorize('consent'),
    reconnect: () => authorize(''),
    backUpNow,
    restore,
    restoreAndMakeActive,
    makeActive,
    disconnect,
  };
}
