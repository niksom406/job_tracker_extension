import type { AppMessage, AppResponse, StatsData, SyncStatus, SetupStatus } from './lib/types';
import { SETUP_STEPS, RECONNECT_MESSAGE } from './lib/setup';

// ─── Messaging helper ─────────────────────────────────────────────────────────

function send(msg: AppMessage): Promise<AppResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: AppResponse) => {
      resolve(response ?? { success: false, error: 'No response from background' });
    });
  });
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const setupPanel     = document.getElementById('setup-panel')!;
const setupList      = document.getElementById('setup-list')!;
const setupNote      = document.getElementById('setup-note')!;
const connectedView  = document.getElementById('connected-view')!;
const userEmailEl    = document.getElementById('user-email')!;
const statApplied    = document.getElementById('stat-applied')!;
const statInterview  = document.getElementById('stat-interview')!;
const statOffer      = document.getElementById('stat-offer')!;
const statRejected   = document.getElementById('stat-rejected')!;
const btnSync        = document.getElementById('btn-sync') as HTMLButtonElement;
const btnStopSync    = document.getElementById('btn-stop-sync') as HTMLButtonElement;
const syncLabel      = document.getElementById('sync-label')!;
const syncSpinner    = document.getElementById('sync-spinner')!;
const lastSyncedEl   = document.getElementById('last-synced')!;
const syncWindowEl   = document.getElementById('sync-window')!;
const statusMsg      = document.getElementById('status-msg')!;
const btnSettings    = document.getElementById('btn-settings')!;
const btnDashboard   = document.getElementById('btn-dashboard')!;
const btnGoSettings  = document.getElementById('btn-go-settings');
const btnFooterSettings = document.getElementById('btn-footer-settings')!;

// ─── State ────────────────────────────────────────────────────────────────────

let setupComplete = false;
let syncInitiatedHere = false;
let lastKnownRunning = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/settings.html') });
  window.close();
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
  window.close();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function showStatus(text: string, type: 'success' | 'error' | 'info') {
  statusMsg.textContent = text;
  statusMsg.className = `status-msg ${type}`;
  statusMsg.style.display = 'block';
  if (type !== 'info') {
    setTimeout(() => { statusMsg.style.display = 'none'; }, 5000);
  }
}

function setSyncing(syncing: boolean) {
  btnSync.disabled = syncing || !setupComplete;
  syncSpinner.classList.toggle('spinning', syncing);
  syncLabel.textContent = syncing ? 'Syncing…' : setupComplete ? 'Sync Now' : 'Finish setup to sync';
  btnStopSync.style.display = syncing ? 'block' : 'none';
  btnStopSync.disabled = false;
  btnStopSync.textContent = 'Stop';
}

// Mirror a sync's progress whether it was started here, in the dashboard, or
// in another popup — the background publishes it to storage for everyone.
function applySyncStatus(s: SyncStatus) {
  setSyncing(s.running);
  if (!s.running) return;
  syncLabel.textContent = s.total > 0 ? `Syncing… ${s.processed}/${s.total}` : 'Syncing…';
  const found = s.newApplications > 0 ? ` · ${s.newApplications} new so far` : '';
  showStatus(`Syncing — ${s.processed}/${s.total} emails checked${found}`, 'info');
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderSetup(setup: SetupStatus, complete: boolean, reconnectRequired: boolean) {
  setupPanel.style.display = complete ? 'none' : 'flex';
  setupNote.textContent = reconnectRequired ? RECONNECT_MESSAGE : '';
  setupNote.style.display = reconnectRequired ? 'block' : 'none';
  setupList.innerHTML = SETUP_STEPS
    .map((step) => {
      const done = setup[step.key];
      return `<li class="${done ? 'done' : 'todo'}">${done ? '✓' : '○'} ${step.label}</li>`;
    })
    .join('');
}

function renderStats(data: StatsData) {
  statApplied.textContent   = String(data.applied);
  statInterview.textContent = String(data.interview);
  statOffer.textContent     = String(data.offer);
  statRejected.textContent  = String(data.rejected);

  if (data.lastCheckAt) {
    lastSyncedEl.textContent = `Last synced ${timeAgo(data.lastCheckAt)} (${formatDateTime(data.lastCheckAt)})`;
  } else {
    lastSyncedEl.textContent = 'Never synced';
  }

  if (data.startDate) {
    const from = data.lastCheckAt ?? data.startDate;
    syncWindowEl.textContent =
      `Start date ${formatDate(data.startDate)} · next sync checks mail after ${formatDateTime(from)}`;
  } else {
    syncWindowEl.textContent = 'No start date set — add one in Settings';
  }

  if (data.userEmail) {
    userEmailEl.textContent = data.userEmail;
  }
}

async function loadStats() {
  const res = await send({ type: 'GET_STATS' });

  if (!res.success) {
    showStatus(res.error, 'error');
    return;
  }

  const data = res.data as StatsData;
  setupComplete = data.setupComplete;
  renderSetup(data.setup, data.setupComplete, data.reconnectRequired);

  connectedView.style.display = data.isConnected ? 'block' : 'none';
  if (data.isConnected) renderStats(data);

  lastKnownRunning = data.syncStatus.running;
  applySyncStatus(data.syncStatus);
}

// ─── Sync handler ─────────────────────────────────────────────────────────────

async function handleSync() {
  if (!setupComplete) {
    showStatus('Finish the setup steps above before syncing.', 'error');
    return;
  }

  syncInitiatedHere = true;
  setSyncing(true);
  showStatus('Syncing your Gmail inbox…', 'info');

  const res = await send({ type: 'SYNC' });
  setSyncing(false);

  if (!res.success) {
    syncInitiatedHere = false;
    showStatus(res.error, 'error');
    return;
  }

  const { newApplications, processed, errors, cancelled } = res.data as {
    newApplications: number;
    processed: number;
    errors: number;
    cancelled?: boolean;
  };

  if (cancelled) {
    showStatus(`Sync stopped after checking ${processed} email${processed !== 1 ? 's' : ''}.`, 'info');
  } else {
    let msg = `✅ Found ${newApplications} new application${newApplications !== 1 ? 's' : ''}`;
    if (processed > 0) msg += ` after checking ${processed} email${processed !== 1 ? 's' : ''}`;
    if (errors > 0) msg += ` (${errors} error${errors !== 1 ? 's' : ''})`;
    showStatus(msg, 'success');
  }

  await loadStats();
  syncInitiatedHere = false;
}

async function handleStopSync() {
  btnStopSync.disabled = true;
  btnStopSync.textContent = 'Stopping…';
  showStatus('Stopping after the current email…', 'info');

  const res = await send({ type: 'CANCEL_SYNC' });
  if (!res.success) showStatus(res.error, 'error');
}

// ─── Live sync updates from other windows ─────────────────────────────────────

let statsRefreshTimer: number | undefined;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // Keep the counts live as the sync saves applications, not just at the end.
  if (changes.applications) {
    clearTimeout(statsRefreshTimer);
    statsRefreshTimer = window.setTimeout(loadStats, 300);
  }

  if (!changes.syncStatus) return;
  const s = changes.syncStatus.newValue as SyncStatus | undefined;
  if (!s) return;

  if (s.running) {
    lastKnownRunning = true;
    applySyncStatus(s);
    return;
  }

  const justFinished = lastKnownRunning;
  lastKnownRunning = false;
  if (syncInitiatedHere) return; // handleSync reports its own result

  if (justFinished) {
    showStatus(
      `✅ Sync finished — ${s.newApplications} new application${s.newApplications !== 1 ? 's' : ''}`,
      'success'
    );
  }
  loadStats();
});

// ─── Events ───────────────────────────────────────────────────────────────────

btnSync.addEventListener('click', handleSync);
btnStopSync.addEventListener('click', handleStopSync);
btnSettings.addEventListener('click', openSettings);
btnFooterSettings.addEventListener('click', openSettings);
btnDashboard.addEventListener('click', openDashboard);
btnGoSettings?.addEventListener('click', openSettings);

// ─── Init ─────────────────────────────────────────────────────────────────────

loadStats();
