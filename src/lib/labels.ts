import type { LabelMap, GmailLabelColor } from './types';
import { listLabels, createLabel, updateLabelColor } from './gmail';

// ─── Label definitions ────────────────────────────────────────────────────────

interface LabelConfig {
  name: string;
  color: GmailLabelColor;
}

// Gmail only accepts colours from its fixed label palette; anything else is
// rejected with a 400. These are the palette entries closest to the app's
// status colours.
const LABEL_CONFIGS: Record<keyof LabelMap, LabelConfig> = {
  applied: {
    name: 'Job/Applied',
    color: { backgroundColor: '#4a86e8', textColor: '#ffffff' },
  },
  interview: {
    name: 'Job/Interview',
    color: { backgroundColor: '#ffad47', textColor: '#000000' },
  },
  assessment: {
    name: 'Job/Assessment',
    color: { backgroundColor: '#a479e2', textColor: '#ffffff' },
  },
  offer: {
    name: 'Job/Offer',
    color: { backgroundColor: '#16a766', textColor: '#ffffff' },
  },
  rejected: {
    name: 'Job/Rejected',
    color: { backgroundColor: '#fb4c2f', textColor: '#ffffff' },
  },
  review: {
    name: 'Job/NeedsReview',
    color: { backgroundColor: '#fad165', textColor: '#000000' },
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
      // Labels that already existed were never coloured (or carry old, invalid
      // colours); bring them in line so the inbox is scannable at a glance.
      try {
        await updateLabelColor(token, found.id, config.color);
        console.log(`[Labels] Found existing: ${config.name} → ${found.id} (colour updated)`);
      } catch (err) {
        console.warn(`[Labels] Could not colour ${config.name}:`, err);
      }
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
