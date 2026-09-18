import type { AppMessage, AppResponse, SyncResult, StatsData, AnalyticsData, DailyTokenRecord, JobStatus } from './lib/types';
import {
  getStorage,
  setStorage,
  getStats,
  updateLastCheckAt,
  getApplications,
} from './lib/storage';
import {
  getUserProfile,
  listMessageIds,
  getMessage,
  applyLabel,
  extractHeader,
  extractBody,
} from './lib/gmail';
import { classifyEmail } from './lib/openai';
import { bootstrapLabels, getLabelId } from './lib/labels';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getAuthToken(interactive: boolean, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(
        'Google sign-in did not finish. Check that the account is signed in to this Chrome profile and, if your OAuth consent screen is in Testing mode, add it as a test user.'
      ));
    }, timeoutMs);

    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'Auth failed'));
      } else {
        resolve(token as string);
      }
    });
  });
}

function removeCachedToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// ─── Token tracking helpers ────────────────────────────────────────────────────

async function recordTokenUsage(tokens: number): Promise<void> {
  const storage = await getStorage();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const existing: DailyTokenRecord[] = storage.dailyTokenRecords ?? [];
  const todayRecord = existing.find((r) => r.date === today);

  if (todayRecord) {
    todayRecord.tokens += tokens;
    todayRecord.emailsProcessed += 1;
  } else {
    existing.push({ date: today, tokens, emailsProcessed: 1 });
  }

  // Keep last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const trimmed = existing.filter((r) => r.date >= cutoffStr);

  const totalTokensUsed = (storage.totalTokensUsed ?? 0) + tokens;

  await setStorage({ dailyTokenRecords: trimmed, totalTokensUsed });
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

let activeSync: Promise<SyncResult> | null = null;
let syncCancellationRequested = false;

/** Returns the exact lower bound used for both Gmail's query and local validation. */
function getSyncCutoff(since?: string): number | undefined {
  if (!since) return undefined;
  const timestamp = new Date(since).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

async function runSyncOnce(): Promise<SyncResult> {
  syncCancellationRequested = false;
  const storage = await getStorage();
  const result: SyncResult = { processed: 0, newApplications: 0, errors: 0, tokensUsed: 0 };
  const syncStartedAt = new Date().toISOString();
  const processedMessageIds = { ...(storage.processedMessageIds ?? {}) };
  const processedIds = new Set([
    ...Object.keys(storage.applications),
    ...Object.keys(processedMessageIds),
  ]);

  if (!storage.isConnected) {
    throw new Error('Gmail not connected. Open Settings to connect.');
  }
  if (!storage.openAiKey) {
    throw new Error('OpenAI API key missing. Open Settings to add your key.');
  }
  if (!storage.labelMap || Object.keys(storage.labelMap).length === 0) {
    throw new Error('Gmail labels not set up. Open Settings → "Set Up Labels".');
  }

  let token: string;
  try {
    token = await getAuthToken(false);
  } catch {
    // Token expired or revoked — mark as disconnected
    await setStorage({ isConnected: false });
    throw new Error('Gmail session expired. Reconnect in Settings.');
  }

  // Gmail's YYYY/MM/DD search is day-granular and based on Gmail's timezone,
  // which can return mail from the previous local calendar day. Unix seconds
  // are exact; the local check below is retained as a second safeguard.
  let query = 'in:inbox';
  const cutoff = getSyncCutoff(storage.lastCheckAt ?? storage.startDate);
  if (cutoff !== undefined) {
    // Gmail's after operator is strictly greater than its operand. Subtract one
    // second so a message received exactly at the selected day's midnight is in
    // the result set, then enforce the precise millisecond boundary locally.
    query += ` after:${Math.floor(cutoff / 1000) - 1}`;
    const source = storage.lastCheckAt ? 'last sync' : 'start date';
    console.log(
      `[JobTracker] Only checking mail received on/after ${new Date(cutoff).toLocaleString()} ` +
      `(${new Date(cutoff).toISOString()}, from ${source})`
    );
  } else {
    console.log('[JobTracker] No start date or previous sync — checking all inbox mail');
  }

  // Reverse lookup so we can trust an email's *current* Gmail label as the
  // source of truth for its status, rather than re-guessing with OpenAI.
  const labelIdToStatus = new Map<string, JobStatus>();
  for (const [status, labelId] of Object.entries(storage.labelMap)) {
    if (labelId) labelIdToStatus.set(labelId, status as JobStatus);
  }

  console.log('[JobTracker] Sync query:', query);
  const messageIds = await listMessageIds(token, query, 300);
  console.log(`[JobTracker] ${messageIds.length} messages to check`);

  // A failed message must be retried next sync. Instead of freezing the
  // checkpoint until a perfectly clean pass, remember the earliest failure so
  // the checkpoint can advance to it: everything newer was already handled.
  let earliestFailureAt: number | undefined;
  let failureWithUnknownDate = false;

  // Flush progress every few messages so closing the browser mid-sync keeps
  // what was already classified (and paid for).
  let unsavedSinceFlush = 0;
  const persistProgress = async () => {
    // Keep the non-job de-duplication data bounded. Applications themselves are
    // retained indefinitely because they are the dashboard's source of truth.
    const processedCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const recentProcessedMessageIds = Object.fromEntries(
      Object.entries(processedMessageIds).filter(([, processedAt]) => {
        const timestamp = new Date(processedAt).getTime();
        return Number.isFinite(timestamp) && timestamp >= processedCutoff;
      })
    );
    await setStorage({
      applications: storage.applications,
      processedMessageIds: recentProcessedMessageIds,
    });
    unsavedSinceFlush = 0;
  };

  for (const id of messageIds) {
    if (syncCancellationRequested) {
      result.cancelled = true;
      console.log('[JobTracker] Sync stopped by user.');
      break;
    }

    if (unsavedSinceFlush >= 10) await persistProgress();

    let receivedAt: number | undefined;
    try {
      // Skip job messages and non-job messages already classified in an earlier
      // run. Without this, every unlabelled non-job email is sent to OpenAI on
      // every sync and a run can appear never-ending.
      if (processedIds.has(id)) continue;

      const msg = await getMessage(token, id);
      receivedAt = Number.parseInt(msg.internalDate, 10);
      if (!Number.isFinite(receivedAt)) {
        throw new Error('Gmail returned a message with an invalid internal date.');
      }
      if (cutoff !== undefined && receivedAt < cutoff) {
        console.warn(
          `[JobTracker] Ignoring message ${id} received ${new Date(receivedAt).toISOString()} — before the cutoff.`
        );
        continue;
      }

      const subject = extractHeader(msg, 'Subject');
      const snippet = msg.snippet ?? '';
      // Use Gmail's receipt timestamp consistently for the displayed date and
      // filtering. Sender-provided Date headers can be malformed or can refer
      // to the preceding day in a different timezone.
      const emailDate = new Date(receivedAt).toISOString();
      console.log(`[JobTracker] Checking ${id} received ${emailDate}`);

      // Already labeled from a previous sync/install? Trust that status.
      const existingStatus = msg.labelIds
        ?.map((lid) => labelIdToStatus.get(lid))
        .find((s): s is JobStatus => s !== undefined);

      result.processed++;

      // Classify with OpenAI (still needed for company/role extraction)
      const classification = await classifyEmail(storage.openAiKey!, subject, snippet);

      // Track token usage
      if (classification.tokensUsed > 0) {
        result.tokensUsed = (result.tokensUsed ?? 0) + classification.tokensUsed;
        await recordTokenUsage(classification.tokensUsed);
      }

      // An in-flight Gmail/OpenAI request cannot be safely interrupted after it
      // has been sent. Stop before any further processing and preserve the work
      // completed before this point.
      if (syncCancellationRequested) {
        result.cancelled = true;
        console.log('[JobTracker] Sync stopped by user.');
        break;
      }

      if (!existingStatus && !classification.isJobRelated) {
        console.log(`[JobTracker] Not job-related: "${subject}"`);
        processedIds.add(id);
        processedMessageIds[id] = new Date().toISOString();
        unsavedSinceFlush++;
        continue;
      }

      const status = existingStatus ?? classification.status;

      // Apply Gmail label (skip if it's already labeled)
      if (!existingStatus) {
        const labelId = getLabelId(storage.labelMap, status);
        if (labelId) {
          await applyLabel(token, id, labelId);
        }
      }

      // Persist in the in-memory copy and write it once after the batch.
      storage.applications[id] = {
        id,
        threadId: msg.threadId,
        company: classification.company,
        role: classification.role,
        status,
        emailDate,
        subject,
        snippet,
        syncedAt: new Date().toISOString(),
      };
      processedIds.add(id);
      processedMessageIds[id] = new Date().toISOString();
      unsavedSinceFlush++;

      result.newApplications++;
      console.log(
        `[JobTracker] ✅ ${classification.company} – ${classification.role} (${classification.status})`
      );

      // Respect rate limits
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error(`[JobTracker] ❌ Error on message ${id}:`, err);
      result.errors++;
      if (receivedAt !== undefined && Number.isFinite(receivedAt)) {
        earliestFailureAt = Math.min(earliestFailureAt ?? receivedAt, receivedAt);
      } else {
        failureWithUnknownDate = true;
      }
    }
  }

  await persistProgress();

  if (syncCancellationRequested) result.cancelled = true;
  if (!result.cancelled) {
    if (result.errors === 0) {
      await updateLastCheckAt(syncStartedAt);
    } else if (!failureWithUnknownDate && earliestFailureAt !== undefined) {
      // The cutoff is inclusive, so the failed message itself is retried next
      // time while everything older stays out of the window.
      await updateLastCheckAt(new Date(earliestFailureAt).toISOString());
    }
    // If a failure's date is unknown (the fetch itself failed), keep the old
    // checkpoint so the whole window is retried.
  }
  return result;
}

/** Coalesce concurrent clicks from the popup/dashboard into one Gmail sync. */
async function runSync(): Promise<SyncResult> {
  if (activeSync) return activeSync;
  activeSync = runSyncOnce().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

// ─── Analytics builder ────────────────────────────────────────────────────────

async function buildAnalytics(): Promise<AnalyticsData> {
  const storage = await getStorage();
  const apps = await getApplications();

  // Applications by date
  const applicationsByDate: Record<string, number> = {};
  const statusBreakdown: Record<string, number> = {};

  for (const app of apps) {
    if (typeof app.emailDate === 'string') {
      const day = app.emailDate.slice(0, 10);
      applicationsByDate[day] = (applicationsByDate[day] ?? 0) + 1;
    }
    if (app.status) {
      statusBreakdown[app.status] = (statusBreakdown[app.status] ?? 0) + 1;
    }
  }

  const totalTokens = storage.totalTokensUsed ?? 0;
  // gpt-4o-mini pricing: $0.150 per 1M input tokens (approx blended)
  const estimatedCostUsd = (totalTokens / 1_000_000) * 0.3;

  return {
    totalTokens,
    totalEmails: apps.length,
    estimatedCostUsd,
    dailyRecords: storage.dailyTokenRecords ?? [],
    applicationsByDate,
    statusBreakdown,
  };
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (msg: AppMessage, _sender, reply: (r: AppResponse) => void) => {
    handleMessage(msg)
      .then(reply)
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[JobTracker] Handler error:', error);
        reply({ success: false, error });
      });
    return true; // keep message channel open for async
  }
);

async function handleMessage(msg: AppMessage): Promise<AppResponse> {
  switch (msg.type) {
    // ── Gmail connect ───────────────────────────────────────────────────────
    case 'CONNECT_GMAIL': {
      const token = await getAuthToken(true);
      const profile = await getUserProfile(token);
      await setStorage({ isConnected: true, userEmail: profile.emailAddress });
      return { success: true, data: null };
    }

    // ── Gmail disconnect ────────────────────────────────────────────────────
    case 'DISCONNECT_GMAIL': {
      try {
        const token = await getAuthToken(false);
        await removeCachedToken(token);
      } catch {
        // Ignore — token may already be gone
      }
      await setStorage({ isConnected: false, userEmail: undefined });
      return { success: true, data: null };
    }

    // ── Label setup ──────────────────────────────────────────────────────────
    case 'SETUP_LABELS': {
      const token = await getAuthToken(false);
      const labelMap = await bootstrapLabels(token);
      await setStorage({ labelMap });
      return { success: true, data: null };
    }

    // ── Email sync ───────────────────────────────────────────────────────────
    case 'SYNC': {
      const result = await runSync();
      return { success: true, data: result };
    }

    // ── Stop an in-progress email sync ──────────────────────────────────────
    case 'CANCEL_SYNC': {
      if (activeSync) syncCancellationRequested = true;
      return { success: true, data: null };
    }

    // ── Stats for popup ──────────────────────────────────────────────────────
    case 'GET_STATS': {
      const storage = await getStorage();
      const counts = await getStats();
      const data: StatsData = {
        ...counts,
        lastCheckAt: storage.lastCheckAt,
        startDate: storage.startDate,
        isConnected: storage.isConnected,
        userEmail: storage.userEmail,
      };
      return { success: true, data };
    }

    // ── Full application list ────────────────────────────────────────────────
    case 'GET_APPLICATIONS': {
      const apps = await getApplications();
      return { success: true, data: apps };
    }

    // ── Fetch email body on demand ───────────────────────────────────────────
    case 'GET_EMAIL_BODY': {
      const token = await getAuthToken(false);
      const message = await getMessage(token, msg.messageId);
      const body = extractBody(message);
      return { success: true, data: { body } };
    }

    // ── Analytics for graphs tab ─────────────────────────────────────────────
    case 'GET_ANALYTICS': {
      const analytics = await buildAnalytics();
      return { success: true, data: analytics };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ─── Install handler ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    console.log('[JobTracker] Installed — opening Settings...');
    chrome.tabs.create({ url: chrome.runtime.getURL('src/settings.html') });
  }
});

console.log('[JobTracker] Background service worker ready ✅');
