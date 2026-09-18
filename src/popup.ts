import type { AppMessage, AppResponse, StatsData } from './lib/types';

// ─── Messaging helper ─────────────────────────────────────────────────────────

function send(msg: AppMessage): Promise<AppResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: AppResponse) => {
      resolve(response ?? { success: false, error: 'No response from background' });
    });
  });
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const notConnected   = document.getElementById('not-connected')!;
const connectedView  = document.getElementById('connected-view')!;
const userEmailEl    = document.getElementById('user-email')!;
const statApplied    = document.getElementById('stat-applied')!;
const statInterview  = document.getElementById('stat-interview')!;
const statOffer      = document.getElementById('stat-offer')!;
const statRejected   = document.getElementById('stat-rejected')!;
const btnSync        = document.getElementById('btn-sync') as HTMLButtonElement;
const syncLabel      = document.getElementById('sync-label')!;
const syncSpinner    = document.getElementById('sync-spinner')!;
const lastSyncedEl   = document.getElementById('last-synced')!;
const statusMsg      = document.getElementById('status-msg')!;
const btnSettings    = document.getElementById('btn-settings')!;
const btnDashboard   = document.getElementById('btn-dashboard')!;
const btnGoSettings  = document.getElementById('btn-go-settings');
const btnFooterSettings = document.getElementById('btn-footer-settings')!;

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

function showStatus(text: string, type: 'success' | 'error' | 'info') {
  statusMsg.textContent = text;
  statusMsg.className = `status-msg ${type}`;
  statusMsg.style.display = 'block';
  if (type !== 'info') {
    setTimeout(() => { statusMsg.style.display = 'none'; }, 5000);
  }
}

function setSyncing(syncing: boolean) {
  btnSync.disabled = syncing;
  syncSpinner.classList.toggle('spinning', syncing);
  syncLabel.textContent = syncing ? 'Syncing…' : 'Sync Now';
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderStats(data: StatsData) {
  statApplied.textContent   = String(data.applied);
  statInterview.textContent = String(data.interview);
  statOffer.textContent     = String(data.offer);
  statRejected.textContent  = String(data.rejected);

  if (data.lastCheckAt) {
    lastSyncedEl.textContent = `Last synced ${timeAgo(data.lastCheckAt)}`;
  } else {
    lastSyncedEl.textContent = 'Never synced';
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

  if (!data.isConnected) {
    notConnected.style.display = 'flex';
    connectedView.style.display = 'none';
    return;
  }

  notConnected.style.display = 'none';
  connectedView.style.display = 'block';
  renderStats(data);
}

// ─── Sync handler ─────────────────────────────────────────────────────────────

async function handleSync() {
  setSyncing(true);
  showStatus('Syncing your Gmail inbox…', 'info');

  const res = await send({ type: 'SYNC' });
  setSyncing(false);

  if (!res.success) {
    showStatus(res.error, 'error');
    return;
  }

  const { newApplications, processed, errors } = res.data as {
    newApplications: number;
    processed: number;
    errors: number;
  };

  let msg = `✅ Found ${newApplications} new application${newApplications !== 1 ? 's' : ''}`;
  if (errors > 0) msg += ` (${errors} error${errors !== 1 ? 's' : ''})`;
  showStatus(msg, 'success');

  await loadStats();
}

// ─── Events ───────────────────────────────────────────────────────────────────

btnSync.addEventListener('click', handleSync);
btnSettings.addEventListener('click', openSettings);
btnFooterSettings.addEventListener('click', openSettings);
btnDashboard.addEventListener('click', openDashboard);
btnGoSettings?.addEventListener('click', openSettings);

// ─── Init ─────────────────────────────────────────────────────────────────────

loadStats();
