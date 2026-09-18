import type { SetupStatus, StorageData } from './types';

/** The four things that must be configured before a sync is allowed to run. */
export const SETUP_STEPS: Array<{ key: keyof SetupStatus; label: string }> = [
  { key: 'gmail',     label: 'Connect Gmail' },
  { key: 'openAiKey', label: 'Add your OpenAI API key' },
  { key: 'startDate', label: 'Set a sync start date' },
  { key: 'labels',    label: 'Set up Gmail labels' },
];

export function getSetupStatus(storage: Partial<StorageData>): SetupStatus {
  return {
    gmail:     storage.isConnected ?? false,
    openAiKey: !!storage.openAiKey,
    startDate: !!storage.startDate,
    labels:    !!storage.labelMap && Object.keys(storage.labelMap).length > 0,
  };
}

export function missingSetupSteps(setup: SetupStatus): string[] {
  return SETUP_STEPS.filter((s) => !setup[s.key]).map((s) => s.label);
}

/** Shown wherever Gmail needs reconnecting after Google's 7-day testing-mode expiry. */
export const RECONNECT_MESSAGE =
  'Your Gmail sign-in has expired. While JobTracker is in Google\'s testing mode, ' +
  'sign-ins last 7 days — open Settings and click Connect Gmail to carry on. ' +
  'Your applications and sync progress are kept.';
