'use client';

import {
  Check,
  Cloud,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Unplug,
  Upload,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import {
  driveBackupIsBusy,
  driveBackupPresentation,
} from '@/lib/drive-backup-presentation';
import type { GoogleDriveBackupController } from '@/lib/use-google-drive-backup';

export function GoogleDriveBackupCard({
  controller,
  localEntryCount,
  hasActiveDraft,
}: {
  controller: GoogleDriveBackupController;
  localEntryCount: number;
  hasActiveDraft: boolean;
}) {
  const copy = driveBackupPresentation(controller);
  const busy = driveBackupIsBusy(controller.status);
  const connected = Boolean(controller.state?.enabled);
  const needsDecision =
    controller.status === 'remote_available' ||
    controller.status === 'conflict';

  async function restore(useAndActivate = false) {
    const count = controller.remote?.snapshot.entries.length ?? 0;
    const draftWarning = hasActiveDraft
      ? ' The unfinished draft on this device will also be discarded.'
      : '';
    if (
      !window.confirm(
        useAndActivate
          ? `Use ${count} ${count === 1 ? 'entry' : 'entries'} from Google Drive on this device? This replaces the ${localEntryCount} ${localEntryCount === 1 ? 'entry' : 'entries'} currently stored locally and makes this browser the active backup device.${draftWarning}`
          : `Restore ${count} ${count === 1 ? 'entry' : 'entries'} from Google Drive? This replaces the ${localEntryCount} ${localEntryCount === 1 ? 'entry' : 'entries'} currently stored on this device.${draftWarning}`,
      )
    )
      return;
    if (useAndActivate) await controller.restoreAndMakeActive();
    else await controller.restore();
  }

  async function makeActive() {
    if (
      !window.confirm(
        `Replace the current Drive backup with ${localEntryCount} local ${localEntryCount === 1 ? 'entry' : 'entries'} and make this browser active?`,
      )
    )
      return;
    await controller.makeActive();
  }

  async function disconnect() {
    if (
      !window.confirm(
        'Disconnect Google Drive? Local diary data and existing files in Drive will be kept.',
      )
    )
      return;
    await controller.disconnect();
  }

  return (
    <div className="drive-backup-panel">
      <div className="settings-subheading">
        <span className="plain-badge">
          <Cloud />
        </span>
        <div>
          <h3>Google Drive</h3>
          <p>Optional app-open backup and recovery.</p>
        </div>
      </div>
      <div
        className={`drive-backup-status drive-backup-status--${controller.status}`}
        role="status"
        aria-live="polite"
      >
        {controller.status === 'up_to_date' ? (
          <Check />
        ) : controller.status === 'offline' ? (
          <WifiOff />
        ) : (
          <RefreshCw />
        )}
        <div>
          <strong>{copy.label}</strong>
          <p>{copy.detail}</p>
        </div>
      </div>

      {controller.remote && (
        <dl className="drive-backup-preview">
          <div>
            <dt>Drive copy</dt>
            <dd>
              {controller.remote.snapshot.entries.length}{' '}
              {controller.remote.snapshot.entries.length === 1
                ? 'entry'
                : 'entries'}
            </dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(controller.remote.snapshot.updatedAt))}
            </dd>
          </div>
        </dl>
      )}

      <div className="stack-actions drive-backup-actions">
        {controller.status === 'disconnected' && controller.configured && (
          <button
            className="button button--primary"
            onClick={() => void controller.connect()}
          >
            <Cloud /> Connect Google Drive
          </button>
        )}
        {controller.status === 'needs_authorization' && (
          <button
            className="button button--primary"
            onClick={() => void controller.reconnect()}
          >
            <RefreshCw /> Reconnect
          </button>
        )}
        {connected && !needsDecision && (
          <button
            className="button button--quiet"
            disabled={busy || controller.status === 'needs_authorization'}
            onClick={() => void controller.backUpNow()}
          >
            <Upload /> Back up now
          </button>
        )}
        {connected && controller.remote && !needsDecision && (
          <button
            className="button button--quiet"
            disabled={busy || controller.status === 'needs_authorization'}
            onClick={() => void restore()}
          >
            <RotateCcw /> Restore from Drive
          </button>
        )}
        {connected && controller.remote && needsDecision && (
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void restore(true)}
          >
            <RotateCcw /> Use Drive copy on this device
          </button>
        )}
        {connected && needsDecision && (
          <button
            className="button button--danger"
            disabled={busy}
            onClick={() => void makeActive()}
          >
            Replace Drive backup with this device
          </button>
        )}
        {controller.folderUrl && (
          <a
            className="button button--quiet"
            href={controller.folderUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink /> Open Scranbook folder
          </a>
        )}
        {connected && (
          <button
            className="button button--quiet"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            <Unplug /> Disconnect
          </button>
        )}
      </div>
      <p className="small-print">
        Accepted entries and processed photos are copied to a visible Scranbook
        folder. Backup runs only while this app is open and authorized. Tokens,
        model credentials, settings, and drafts are never included.{' '}
        <Link className="text-link" href="/privacy">
          Privacy details
        </Link>
      </p>
    </div>
  );
}
