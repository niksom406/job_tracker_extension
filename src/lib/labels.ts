import type { LabelMap, GmailLabelColor } from './types';
import { listLabels, createLabel } from './gmail';

// ─── Label definitions ────────────────────────────────────────────────────────

interface LabelConfig {
  name: string;
  color: GmailLabelColor;
}

const LABEL_CONFIGS: Record<keyof LabelMap, LabelConfig> = {
  applied: {
    name: 'Job/Applied',
    color: { backgroundColor: '#1a73e8', textColor: '#ffffff' },
  },
  interview: {
    name: 'Job/Interview',
    color: { backgroundColor: '#f29900', textColor: '#000000' },
  },
  assessment: {
    name: 'Job/Assessment',
    color: { backgroundColor: '#9334e6', textColor: '#ffffff' },
  },
  offer: {
    name: 'Job/Offer',
    color: { backgroundColor: '#188038', textColor: '#ffffff' },
  },
  rejected: {
    name: 'Job/Rejected',
    color: { backgroundColor: '#d93025', textColor: '#ffffff' },
  },
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Creates all Job/* labels in Gmail if they don't already exist.
 * Returns a map of status → Gmail label ID.
 */
export async function bootstrapLabels(token: string): Promise<LabelMap> {
  const existing = await listLabels(token);
  const labelMap: LabelMap = {};

  for (const [key, config] of Object.entries(LABEL_CONFIGS) as [
    keyof LabelMap,
    LabelConfig
  ][]) {
    const found = existing.find((l) => l.name === config.name);
    if (found) {
      labelMap[key] = found.id;
      console.log(`[Labels] Found existing: ${config.name} → ${found.id}`);
    } else {
      const created = await createLabel(token, config.name, config.color);
      labelMap[key] = created.id;
      console.log(`[Labels] Created: ${config.name} → ${created.id}`);
    }
  }

  return labelMap;
}

export function getLabelId(
  labelMap: LabelMap,
  status: keyof LabelMap
): string | undefined {
  return labelMap[status];
}

/** Gmail label names this extension owns, e.g. "Job/Applied". */
export function getAllLabelNames(): string[] {
  return Object.values(LABEL_CONFIGS).map((c) => c.name);
}
