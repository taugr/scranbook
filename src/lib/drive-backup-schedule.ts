export const driveBackupDebounceMs = 30_000;
export const driveBackupMaximumRetryMs = 5 * 60_000;
export const driveBackupPeriodicCheckMs = 5 * 60_000;

export function nextDriveBackupRetryMs(currentDelayMs: number) {
  return Math.min(currentDelayMs * 2, driveBackupMaximumRetryMs);
}
