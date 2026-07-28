'use client';

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Cloud,
  HardDrive,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  driveBackupIsBusy,
  driveBackupPresentation,
} from '@/lib/drive-backup-presentation';
import type { GoogleDriveBackupController } from '@/lib/use-google-drive-backup';

function StatusIcon({
  controller,
}: {
  controller: GoogleDriveBackupController;
}) {
  if (controller.status === 'up_to_date') return <Check />;
  if (controller.status === 'offline') return <WifiOff />;
  if (
    controller.status === 'remote_available' ||
    controller.status === 'conflict' ||
    controller.status === 'error'
  )
    return <AlertTriangle />;
  if (controller.status === 'connecting' || controller.status === 'backing_up')
    return <RefreshCw className="spin" />;
  return <Cloud />;
}

export function GoogleDriveBackupStatus({
  controller,
  onOpenSettings,
}: {
  controller: GoogleDriveBackupController;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelId = useId();
  const presentation = driveBackupPresentation(controller);
  const busy = driveBackupIsBusy(controller.status);
  const visible = Boolean(controller.state?.enabled);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  if (!visible) return null;

  function openSettings() {
    setOpen(false);
    onOpenSettings();
  }

  function runPrimaryAction() {
    if (controller.status === 'needs_authorization') {
      void controller.reconnect();
      return;
    }
    if (controller.status === 'pending' || controller.status === 'error') {
      void controller.backUpNow();
      return;
    }
    openSettings();
  }

  const primaryLabel =
    controller.status === 'needs_authorization'
      ? 'Reconnect'
      : controller.status === 'pending' || controller.status === 'error'
        ? 'Back up now'
        : presentation.needsDecision
          ? 'Review in settings'
          : 'Manage backup';

  return (
    <div className="drive-status-control" ref={rootRef}>
      <button
        className={`drive-status-chip drive-status-chip--${presentation.tone}`}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Google Drive backup: ${presentation.chipLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <StatusIcon controller={controller} />
        <span>{presentation.chipLabel}</span>
      </button>
      {open && (
        <div
          className="drive-status-popover"
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
        >
          <p className="eyebrow">Google Drive</p>
          <h2 id={titleId}>Drive backup</h2>
          <strong>{presentation.label}</strong>
          <p>{presentation.detail}</p>
          <p className="drive-status-local-note">
            <HardDrive />
            <span>Your diary is still saved on this device.</span>
          </p>
          <button
            className={`button ${controller.status === 'needs_authorization' ? 'button--primary' : 'button--quiet'}`}
            type="button"
            disabled={busy}
            onClick={runPrimaryAction}
          >
            {busy ? <RefreshCw className="spin" /> : null}
            {primaryLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function GoogleDriveConflictBanner({
  controller,
  onReview,
}: {
  controller: GoogleDriveBackupController;
  onReview: () => void;
}) {
  const presentation = driveBackupPresentation(controller);
  if (!presentation.needsDecision || !controller.state?.enabled) return null;

  return (
    <button
      className="drive-conflict-banner"
      type="button"
      onClick={onReview}
      aria-label="Review Drive backup"
    >
      <AlertTriangle />
      <span>
        <strong>{presentation.label}</strong>
        <small>
          Nothing was overwritten. Review the Drive and device copies.
        </small>
      </span>
      <span className="drive-conflict-action">
        Review <ChevronRight />
      </span>
    </button>
  );
}
