import type { DiaryImportResult } from './archive';
import type { BackupState, MealEntry } from './schema';

const minimumEntries = 5;
const minimumChangedEntries = 5;
const reminderAgeMs = 30 * 24 * 60 * 60 * 1000;
const dismissalMs = 7 * 24 * 60 * 60 * 1000;

function latestUpdatedAt(entries: MealEntry[]) {
  return (
    entries
      .map((entry) => entry.updatedAt)
      .sort()
      .at(-1) ?? null
  );
}

export function backupStateForExport(
  entries: MealEntry[],
  now = new Date(),
): BackupState {
  return {
    version: 1,
    lastArchiveCreatedAt: now.toISOString(),
    entryCountAtArchive: entries.length,
    latestEntryUpdatedAtAtArchive: latestUpdatedAt(entries),
    reminderDismissedUntil: null,
  };
}

export function backupStateForImport(result: DiaryImportResult): BackupState {
  return {
    version: 1,
    lastArchiveCreatedAt: result.exportedAt,
    entryCountAtArchive: result.count,
    latestEntryUpdatedAtAtArchive: result.latestEntryUpdatedAt,
    reminderDismissedUntil: null,
  };
}

export function dismissBackupReminder(
  state: BackupState | null,
  now = new Date(),
): BackupState {
  return {
    version: 1,
    lastArchiveCreatedAt: state?.lastArchiveCreatedAt ?? null,
    entryCountAtArchive: state?.entryCountAtArchive ?? 0,
    latestEntryUpdatedAtAtArchive: state?.latestEntryUpdatedAtAtArchive ?? null,
    reminderDismissedUntil: new Date(now.getTime() + dismissalMs).toISOString(),
  };
}

export function isBackupReminderDue(
  entries: MealEntry[],
  state: BackupState | null,
  now = new Date(),
) {
  if (entries.length < minimumEntries) return false;
  if (
    state?.reminderDismissedUntil &&
    new Date(state.reminderDismissedUntil).getTime() > now.getTime()
  )
    return false;
  if (!state?.lastArchiveCreatedAt) return true;
  const archiveTime = new Date(state.lastArchiveCreatedAt).getTime();
  if (now.getTime() - archiveTime < reminderAgeMs) return false;
  return (
    entries.filter((entry) => new Date(entry.updatedAt).getTime() > archiveTime)
      .length >= minimumChangedEntries
  );
}
