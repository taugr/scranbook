import { describe, expect, it } from 'vitest';
import {
  backupStateForExport,
  dismissBackupReminder,
  isBackupReminderDue,
} from '@/lib/backup';
import { createBlankEntry } from '@/lib/schema';

function entries(count: number, updatedAt = '2026-07-18T00:00:00Z') {
  return Array.from({ length: count }, (_, index) => ({
    ...createBlankEntry(new Date(updatedAt)),
    id: `entry-${index}`,
    updatedAt,
  }));
}

describe('backup reminder policy', () => {
  it('waits until a local diary has five entries', () => {
    expect(isBackupReminderDue(entries(4), null)).toBe(false);
    expect(isBackupReminderDue(entries(5), null)).toBe(true);
  });

  it('requires age and five changed entries after an export', () => {
    const state = backupStateForExport(
      entries(5, '2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(
      isBackupReminderDue(entries(5), state, new Date('2026-07-18T00:00:00Z')),
    ).toBe(true);
    expect(
      isBackupReminderDue(
        entries(4).concat(entries(1, '2026-05-01T00:00:00Z')),
        state,
        new Date('2026-07-18T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('honors a seven-day dismissal', () => {
    const now = new Date('2026-07-18T00:00:00Z');
    const dismissed = dismissBackupReminder(null, now);
    expect(isBackupReminderDue(entries(5), dismissed, now)).toBe(false);
    expect(
      isBackupReminderDue(
        entries(5),
        dismissed,
        new Date('2026-07-26T00:00:00Z'),
      ),
    ).toBe(true);
  });
});
