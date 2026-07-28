import { describe, expect, it } from 'vitest';
import { driveBackupPresentation } from '@/lib/drive-backup-presentation';
import type { DriveBackupStatus } from '@/lib/use-google-drive-backup';

function presentation(status: DriveBackupStatus) {
  return driveBackupPresentation({ message: null, state: null, status });
}

describe('Google Drive backup presentation', () => {
  it.each([
    ['needs_authorization', 'Reconnect Drive', 'warning'],
    ['pending', 'Backup pending', 'working'],
    ['backing_up', 'Backing up…', 'working'],
    ['up_to_date', 'Backed up', 'success'],
    ['offline', 'Pending · Offline', 'warning'],
    ['error', 'Backup needs attention', 'attention'],
  ] as const)('maps %s to its compact header state', (status, label, tone) => {
    expect(presentation(status)).toMatchObject({ chipLabel: label, tone });
  });

  it.each(['remote_available', 'conflict'] as const)(
    'escalates %s to the decision treatment',
    (status) => {
      expect(presentation(status)).toMatchObject({
        chipLabel: 'Review Drive backup',
        needsDecision: true,
        tone: 'attention',
      });
    },
  );

  it('uses the saved completion time in the detailed successful state', () => {
    const copy = driveBackupPresentation({
      message: null,
      status: 'up_to_date',
      state: {
        version: 1,
        enabled: true,
        deviceId: 'device-1',
        folderId: 'folder-1',
        photoFolderId: 'photo-folder-1',
        manifestFileId: 'manifest-1',
        lastRemoteVersion: 'remote-1',
        lastSyncedGeneration: 2,
        lastSuccessfulSyncAt: '2026-07-28T10:00:00.000Z',
      },
    });

    expect(copy.detail).toContain('Last completed');
  });
});
