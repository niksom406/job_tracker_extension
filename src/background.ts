import type { AppMessage, AppResponse, SyncResult, StatsData, AnalyticsData, DailyTokenRecord, JobStatus } from './lib/types';
import {
  getStorage,
  setStorage,
  saveApplication,
  getStats,
  hasApplication,
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
import { bootstrapLabels, getLabelId, getAllLabelNames } from './lib/labels';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getAuthToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
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

async function runSync(): Promise<SyncResult> {
  const storage = await getStorage();
  const result: SyncResult = { processed: 0, newApplications: 0, errors: 0, tokensUsed: 0 };

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

  // Build Gmail search query. We search two things:
  //  1. recent inbox mail, to catch new applications
  //  2. anything already carrying one of our Job/* labels, so emails labeled by
  //     a previous install (or archived out of the inbox) still get imported
  //     into local storage instead of silently vanishing from the dashboard.
  const labelQuery = getAllLabelNames()
    .map((name) => `label:"${name}"`)
    .join(' OR ');
    
  let query = `(in:inbox) OR (${labelQuery})`;

  const since = storage.lastCheckAt ?? storage.startDate;
  if (since) {
    const d = new Date(since);
    const formatted = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('/');
    query = `(${query}) after:${formatted}`;
  }

  // Reverse lookup so we can trust an email's *current* Gmail label as the
  // source of truth for its status, rather than re-guessing with OpenAI.
  const labelIdToStatus = new Map<string, JobStatus>();
  for (const [status, labelId] of Object.entries(storage.labelMap)) {
    if (labelId) labelIdToStatus.set(labelId, status as JobStatus);
  }

  console.log('[JobTracker] Sync query:', query);
  const messageIds = await listMessageIds(token, query, 1000);
  console.log(`[JobTracker] ${messageIds.length} messages to check`);

  for (const id of messageIds) {
    try {
      // Skip already-processed emails
      if (await hasApplication(id)) continue;

      const msg = await getMessage(token, id);
      const subject = extractHeader(msg, 'Subject');
      const snippet = msg.snippet ?? '';
      const dateHeader = extractHeader(msg, 'Date');
      const emailDate = dateHeader
        ? new Date(dateHeader).toISOString()
        : new Date(parseInt(msg.internalDate, 10)).toISOString();

      // Already labeled from a previous sync/install? Trust that status.
      const existingStatus = msg.labelIds
        ?.map((lid) => labelIdToStatus.get(lid))
        .find((s): s is JobStatus => s !== undefined);

      result.processed++;

      let classification;
      
      if (existingStatus) {
        // Skip OpenAI entirely to save tokens and time for historically labeled emails
        classification = {
          isJobRelated: true,
          status: existingStatus,
          company: 'Unknown Company',
          role: 'Unknown Role',
          tokensUsed: 0
        };
      } else {
        // Classify with OpenAI for new inbox emails
        classification = await classifyEmail(storage.openAiKey!, subject, snippet);
        
        // Track token usage
        if (classification.tokensUsed > 0) {
          result.tokensUsed = (result.tokensUsed ?? 0) + classification.tokensUsed;
          await recordTokenUsage(classification.tokensUsed);
        }
      }

      if (!existingStatus && !classification.isJobRelated) {
        console.log(`[JobTracker] Not job-related: "${subject}"`);
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

      // Persist to chrome.storage
      await saveApplication({
        id,
        threadId: msg.threadId,
        company: classification.company,
        role: classification.role,
        status,
        emailDate,
        subject,
        snippet,
        syncedAt: new Date().toISOString(),
      });

      result.newApplications++;
      console.log(
        `[JobTracker] ✅ ${classification.company} – ${classification.role} (${classification.status})`
      );

      // Respect rate limits
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error(`[JobTracker] ❌ Error on message ${id}:`, err);
      result.errors++;
    }
  }

  await updateLastCheckAt();
  return result;
}

// ─── Analytics builder ────────────────────────────────────────────────────────

async function buildAnalytics(): Promise<AnalyticsData> {
  const storage = await getStorage();
  const apps = await getApplications();

  // Applications by date
  const applicationsByDate: Record<string, number> = {};
  const statusBreakdown: Record<string, number> = {};
  const companyMap: Record<string, number> = {};

  for (const app of apps) {
    if (typeof app.emailDate === 'string') {
      const day = app.emailDate.slice(0, 10);
      applicationsByDate[day] = (applicationsByDate[day] ?? 0) + 1;
    }
    if (app.status) {
      statusBreakdown[app.status] = (statusBreakdown[app.status] ?? 0) + 1;
    }
    if (app.company && app.company !== 'Unknown Company') {
      companyMap[app.company] = (companyMap[app.company] ?? 0) + 1;
    }
  }

  const topCompanies = Object.entries(companyMap)
    .map(([company, count]) => ({ company, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

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
    topCompanies,
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

    // ── Stats for popup ──────────────────────────────────────────────────────
    case 'GET_STATS': {
      const storage = await getStorage();
      const counts = await getStats();
      const data: StatsData = {
        ...counts,
        lastCheckAt: storage.lastCheckAt,
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
