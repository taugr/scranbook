import { describe, expect, it } from 'vitest';
import {
  driveBackupDebounceMs,
  driveBackupMaximumRetryMs,
  driveBackupPeriodicCheckMs,
  nextDriveBackupRetryMs,
} from '@/lib/drive-backup-schedule';

describe('Drive backup schedule', () => {
  it('coalesces ordinary saves for 30 seconds and checks at least every five minutes', () => {
    expect(driveBackupDebounceMs).toBe(30_000);
    expect(driveBackupPeriodicCheckMs).toBe(300_000);
  });

  it('backs off transient failures without exceeding five minutes', () => {
    const delays = [30_000];
    for (let index = 0; index < 6; index += 1) {
      delays.push(nextDriveBackupRetryMs(delays.at(-1)!));
    }
    expect(delays).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000,
    ]);
    expect(driveBackupMaximumRetryMs).toBe(300_000);
  });
});
