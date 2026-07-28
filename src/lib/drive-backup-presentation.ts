import type {
  DriveBackupStatus,
  GoogleDriveBackupController,
} from './use-google-drive-backup';

export type DriveBackupTone =
  | 'neutral'
  | 'working'
  | 'success'
  | 'warning'
  | 'attention';

export interface DriveBackupPresentation {
  chipLabel: string;
  detail: string;
  label: string;
  needsDecision: boolean;
  tone: DriveBackupTone;
}

function formatBackupTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function driveBackupPresentation(
  controller: Pick<GoogleDriveBackupController, 'message' | 'state' | 'status'>,
): DriveBackupPresentation {
  const common = {
    needsDecision: false,
    tone: 'neutral' as DriveBackupTone,
  };

  switch (controller.status) {
    case 'unavailable':
      return {
        ...common,
        chipLabel: 'Drive unavailable',
        label: 'Unavailable in this build',
        detail:
          'A public Google OAuth client ID is required to offer Drive backup.',
      };
    case 'disconnected':
      return {
        ...common,
        chipLabel: 'Drive not connected',
        label: 'Not connected',
        detail: 'Your diary continues to save only on this device.',
      };
    case 'connecting':
      return {
        ...common,
        chipLabel: 'Connecting…',
        label: 'Connecting…',
        detail: 'Waiting for Google authorization and checking Drive.',
        tone: 'working',
      };
    case 'needs_authorization':
      return {
        ...common,
        chipLabel: 'Reconnect Drive',
        label: 'Reconnect to continue backup',
        detail:
          controller.message ??
          'Local changes remain safe and pending until you reconnect this session.',
        tone: 'warning',
      };
    case 'pending':
      return {
        ...common,
        chipLabel: 'Backup pending',
        label: 'Changes pending',
        detail: 'Local changes will be coalesced and backed up shortly.',
        tone: 'working',
      };
    case 'backing_up':
      return {
        ...common,
        chipLabel: 'Backing up…',
        label: 'Backing up to Drive…',
        detail: 'You can continue using your local diary.',
        tone: 'working',
      };
    case 'up_to_date':
      return {
        ...common,
        chipLabel: 'Backed up',
        label: 'Backed up',
        detail: controller.message
          ? controller.message
          : controller.state?.lastSuccessfulSyncAt
            ? `Last completed ${formatBackupTime(controller.state.lastSuccessfulSyncAt)}.`
            : 'The current diary is backed up.',
        tone: 'success',
      };
    case 'offline':
      return {
        ...common,
        chipLabel: 'Pending · Offline',
        label: 'Changes pending while offline',
        detail:
          'Local saves continue and backup resumes when the app is online.',
        tone: 'warning',
      };
    case 'remote_available':
      return {
        chipLabel: 'Review Drive backup',
        label: 'Drive backup found',
        detail:
          controller.message ??
          'Choose whether to use the Drive copy or replace it with this device.',
        needsDecision: true,
        tone: 'attention',
      };
    case 'conflict':
      return {
        chipLabel: 'Review Drive backup',
        label: 'Drive backup changed elsewhere',
        detail:
          controller.message ??
          'Nothing was overwritten. Restore or explicitly make this device active.',
        needsDecision: true,
        tone: 'attention',
      };
    case 'error':
      return {
        ...common,
        chipLabel: 'Backup needs attention',
        label: 'Backup needs attention',
        detail: controller.message ?? 'Nothing was overwritten in Drive.',
        tone: 'attention',
      };
  }
}

export function driveBackupIsBusy(status: DriveBackupStatus) {
  return status === 'connecting' || status === 'backing_up';
}
