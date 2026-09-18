import type { AppMessage, AppResponse, Application, AnalyticsData, StatsData, SyncStatus, SetupStatus } from './lib/types';
import { SETUP_STEPS, RECONNECT_MESSAGE } from './lib/setup';

// ─── Messaging ────────────────────────────────────────────────────────────────

function send(msg: AppMessage): Promise<AppResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r: AppResponse) => {
      resolve(r ?? { success: false, error: 'No response' });
    });
  });
}

// ─── State ────────────────────────────────────────────────────────────────────

let allApps: Application[] = [];
let currentFilter: string = 'all';
let searchQuery: string = '';
let selectedId: string | null = null;
let setupComplete = false;
let syncInitiatedHere = false;
let lastKnownRunning = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const viewApplications = document.getElementById('view-applications')!;
const viewGraphs        = document.getElementById('view-graphs')!;

const stateLoading  = document.getElementById('state-loading')!;
const stateEmpty    = document.getElementById('state-empty')!;
const tableWrap     = document.getElementById('table-wrap')!;
const tableBody     = document.getElementById('table-body')!;
const searchInput   = document.getElementById('search-input') as HTMLInputElement;
const totalCount    = document.getElementById('total-count')!;
const syncMeta      = document.getElementById('sync-meta')!;
const setupBanner   = document.getElementById('setup-banner')!;
const setupList     = document.getElementById('setup-list')!;
const setupNote     = document.getElementById('setup-note')!;
const pageTitle     = document.getElementById('page-title')!;
const statusBar     = document.getElementById('status-bar')!;
const statusBarText = document.getElementById('status-bar-text')!;
const btnSyncTop    = document.getElementById('btn-sync-top') as HTMLButtonElement;
const btnStopSyncTop = document.getElementById('btn-stop-sync-top') as HTMLButtonElement;
const syncSpinTop   = document.getElementById('sync-spinner-top')!;
const detailPanel   = document.getElementById('detail-panel')!;
const detailClose   = document.getElementById('detail-close')!;
const detailCompany = document.getElementById('detail-company')!;
const detailRole    = document.getElementById('detail-role')!;
const detailStatus  = document.getElementById('detail-status-badge')!;
const detailDate    = document.getElementById('detail-date')!;
const detailSubject = document.getElementById('detail-subject')!;
const detailBodyWrap = document.getElementById('detail-body-loading')!;
const detailBody    = document.getElementById('detail-body')!;

// Badge elements
const badges: Record<string, HTMLElement | null> = {
  all:        document.getElementById('badge-all'),
  applied:    document.getElementById('badge-applied'),
  interview:  document.getElementById('badge-interview'),
  assessment: document.getElementById('badge-assessment'),
  offer:      document.getElementById('badge-offer'),
  rejected:   document.getElementById('badge-rejected'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function badgeClass(status: string): string {
  return `status-badge badge-${status}`;
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function setStatusBar(text: string, type = 'info') {
  statusBarText.textContent = text;
  statusBar.className = `status-bar ${type}`;
  statusBar.style.display = 'block';
  if (type !== 'info') {
    setTimeout(() => { statusBar.style.display = 'none'; }, 5000);
  }
}

// ─── View switching ───────────────────────────────────────────────────────────

function showView(view: 'applications' | 'graphs') {
  viewApplications.style.display = view === 'applications' ? 'flex' : 'none';
  viewGraphs.style.display       = view === 'graphs' ? 'flex' : 'none';
  (viewApplications as HTMLElement).style.flexDirection = 'column';
  (viewGraphs as HTMLElement).style.flexDirection = 'column';

  document.querySelectorAll('.nav-item').forEach((el) => {
    const isFilter = (el as HTMLElement).dataset.filter !== undefined;
    const isGraphs = (el as HTMLElement).dataset.view === 'graphs';
    if (view === 'graphs') {
      el.classList.toggle('active', isGraphs);
    } else if (isFilter) {
      el.classList.toggle('active', (el as HTMLElement).dataset.filter === currentFilter);
    } else {
      el.classList.remove('active');
    }
  });
}

// ─── Filter & render ──────────────────────────────────────────────────────────

function filteredApps(): Application[] {
  return allApps.filter((app) => {
    if (currentFilter !== 'all' && app.status !== currentFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        app.company.toLowerCase().includes(q) ||
        app.role.toLowerCase().includes(q) ||
        app.subject.toLowerCase().includes(q)
      );
    }
    return true;
  });
}

function renderBadges() {
  const counts = {
    all: allApps.length,
    applied:    allApps.filter(a => a.status === 'applied').length,
    interview:  allApps.filter(a => a.status === 'interview').length,
    assessment: allApps.filter(a => a.status === 'assessment').length,
    offer:      allApps.filter(a => a.status === 'offer').length,
    rejected:   allApps.filter(a => a.status === 'rejected').length,
  };

  for (const [key, el] of Object.entries(badges)) {
    if (el) el.textContent = String(counts[key as keyof typeof counts] ?? 0);
  }
}

function renderTable() {
  const apps = filteredApps();

  stateLoading.style.display = 'none';

  if (apps.length === 0) {
    stateEmpty.style.display = 'flex';
    tableWrap.style.display = 'none';
    totalCount.textContent = '0 results';
    return;
  }

  stateEmpty.style.display = 'none';
  tableWrap.style.display = 'block';
  totalCount.textContent = `${apps.length} result${apps.length !== 1 ? 's' : ''}`;

  tableBody.innerHTML = '';

  for (const app of apps) {
    const tr = document.createElement('tr');
    if (app.id === selectedId) tr.classList.add('selected');

    tr.innerHTML = `
      <td class="company-cell">${escapeHtml(app.company)}</td>
      <td class="role-cell" title="${escapeHtml(app.role)}">${escapeHtml(app.role)}</td>
      <td><span class="${badgeClass(app.status)}">${statusLabel(app.status)}</span></td>
      <td class="date-cell">${formatDate(app.emailDate)}</td>
      <td class="action-cell"><button class="view-btn" data-id="${escapeHtml(app.id)}">View →</button></td>
    `;

    tr.addEventListener('click', () => openDetail(app));
    tableBody.appendChild(tr);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

async function openDetail(app: Application) {
  selectedId = app.id;
  renderTable();

  detailCompany.textContent = app.company;
  detailRole.textContent = app.role;
  detailDate.textContent = formatDate(app.emailDate);
  detailSubject.textContent = app.subject;
  detailStatus.className = badgeClass(app.status);
  detailStatus.textContent = statusLabel(app.status);

  detailBodyWrap.style.display = 'flex';
  detailBody.style.display = 'none';

  detailPanel.classList.add('open');

  const res = await send({ type: 'GET_EMAIL_BODY', messageId: app.id });
  detailBodyWrap.style.display = 'none';
  detailBody.style.display = 'block';

  if (res.success && res.data && 'body' in res.data) {
    detailBody.textContent = (res.data as { body: string }).body.trim() || '(No plain text body)';
  } else {
    detailBody.textContent = app.snippet;
  }
}

function closeDetail() {
  detailPanel.classList.remove('open');
  selectedId = null;
  renderTable();
}

// ─── Nav filter ───────────────────────────────────────────────────────────────

function setFilter(filter: string) {
  currentFilter = filter;
  showView('applications');

  const labels: Record<string, string> = {
    all: 'All Applications',
    applied: 'Applied',
    interview: 'Interviews',
    assessment: 'Assessments',
    offer: 'Offers',
    rejected: 'Rejected',
  };

  pageTitle.textContent = labels[filter] ?? 'Applications';
  renderTable();
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

async function runSync() {
  if (!setupComplete) {
    setStatusBar('Finish the setup steps above before syncing.', 'error');
    return;
  }

  syncInitiatedHere = true;
  setSyncing(true);
  setStatusBar('Syncing inbox…', 'info');

  const res = await send({ type: 'SYNC' });

  setSyncing(false);
  syncInitiatedHere = false;

  if (!res.success) {
    setStatusBar(res.error, 'error');
    return;
  }

  const { newApplications, processed, errors, cancelled } = res.data as {
    newApplications: number;
    processed: number;
    errors: number;
    cancelled?: boolean;
  };
  if (cancelled) {
    setStatusBar(`Sync stopped after checking ${processed} email${processed !== 1 ? 's' : ''}.`, 'info');
    await loadApps();
    return;
  }
  let message = `✅ Sync complete — ${newApplications} new application${newApplications !== 1 ? 's' : ''} found`;
  if (processed > 0) message += ` after checking ${processed} email${processed !== 1 ? 's' : ''}`;
  if (errors > 0) message += ` (${errors} error${errors !== 1 ? 's' : ''}; they will be retried next sync)`;
  setStatusBar(message, errors > 0 ? 'error' : 'success');
  await loadApps();
}

function setSyncing(syncing: boolean) {
  btnSyncTop.disabled = syncing || !setupComplete;
  btnSyncTop.title = setupComplete ? '' : 'Finish setup before syncing';
  syncSpinTop.style.animation = syncing ? 'spin 1s linear infinite' : '';
  btnStopSyncTop.style.display = syncing ? 'block' : 'none';
  btnStopSyncTop.disabled = false;
  btnStopSyncTop.textContent = 'Stop';
}

async function stopSync() {
  btnStopSyncTop.disabled = true;
  btnStopSyncTop.textContent = 'Stopping…';
  setStatusBar('Stopping after the current email…', 'info');

  const res = await send({ type: 'CANCEL_SYNC' });
  if (!res.success) setStatusBar(res.error, 'error');
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadApps() {
  const res = await send({ type: 'GET_APPLICATIONS' });

  if (!res.success) {
    setStatusBar(res.error, 'error');
    return;
  }

  allApps = res.data as Application[];
  renderBadges();
  renderTable();
  await renderSyncState();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function renderSetup(setup: SetupStatus, complete: boolean, reconnectRequired: boolean) {
  setupBanner.style.display = complete ? 'none' : 'flex';
  setupNote.textContent = reconnectRequired ? RECONNECT_MESSAGE : '';
  setupNote.style.display = reconnectRequired ? 'block' : 'none';
  setupList.innerHTML = SETUP_STEPS
    .map((step) => {
      const done = setup[step.key];
      return `<li class="${done ? 'done' : 'todo'}">${done ? '✓' : '○'} ${step.label}</li>`;
    })
    .join('');
}

// Mirror a sync's progress whether it was started here, in the popup, or in
// another dashboard tab — the background publishes it to storage for everyone.
function applySyncStatus(s: SyncStatus) {
  setSyncing(s.running);
  if (!s.running) return;
  const found = s.newApplications > 0 ? `, ${s.newApplications} new so far` : '';
  setStatusBar(`Syncing — ${s.processed}/${s.total} emails checked${found}`, 'info');
}

async function renderSyncState() {
  const res = await send({ type: 'GET_STATS' });
  if (!res.success) return;

  const data = res.data as StatsData;
  setupComplete = data.setupComplete;
  renderSetup(data.setup, data.setupComplete, data.reconnectRequired);

  const from = data.lastCheckAt ?? data.startDate;
  syncMeta.textContent = [
    data.lastCheckAt ? `Last synced ${formatDateTime(data.lastCheckAt)}` : 'Never synced',
    data.startDate ? `start date ${formatDate(data.startDate)}` : 'no start date set',
    from ? `next sync checks mail after ${formatDateTime(from)}` : '',
  ].filter(Boolean).join(' · ');

  lastKnownRunning = data.syncStatus.running;
  applySyncStatus(data.syncStatus);
}

let appsRefreshTimer: number | undefined;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  // Applications are written as the sync finds them; refresh the list as
  // they land instead of waiting for the run to finish. Debounced because a
  // fast run can write several in quick succession.
  if (changes.applications) {
    clearTimeout(appsRefreshTimer);
    appsRefreshTimer = window.setTimeout(loadApps, 300);
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
  if (syncInitiatedHere) return; // runSync reports its own result

  if (justFinished) {
    setStatusBar(
      `✅ Sync finished — ${s.newApplications} new application${s.newApplications !== 1 ? 's' : ''}`,
      'success'
    );
  }
  loadApps();
});

// ─── Chart rendering ──────────────────────────────────────────────────────────

const CHART_COLORS = {
  applied:    '#6366f1',
  interview:  '#f59e0b',
  assessment: '#8b5cf6',
  offer:      '#10b981',
  rejected:   '#ef4444',
};

function getCanvasCtx(id: string): CanvasRenderingContext2D | null {
  const canvas = document.getElementById(id) as HTMLCanvasElement | null;
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx?.scale(dpr, dpr);
  return ctx;
}

function drawLineChart(
  canvasId: string,
  emptyId: string,
  labels: string[],
  values: number[],
  color: string,
  fillColor: string
) {
  const emptyEl = document.getElementById(emptyId)!;
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;

  if (values.length === 0 || values.every(v => v === 0)) {
    canvas.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }
  canvas.style.display = 'block';
  emptyEl.style.display = 'none';

  const ctx = getCanvasCtx(canvasId);
  if (!ctx) return;

  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const pad = { top: 20, right: 20, bottom: 40, left: 40 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const maxVal = Math.max(...values, 1);
  const step = chartW / Math.max(labels.length - 1, 1);

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(maxVal - (maxVal / 4) * i)), pad.left - 6, y + 4);
  }

  // X-axis labels (every N ticks)
  const labelStep = Math.max(1, Math.floor(labels.length / 6));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  labels.forEach((lbl, i) => {
    if (i % labelStep === 0) {
      const x = pad.left + i * step;
      ctx.fillText(lbl.slice(5), x, h - 8); // MM-DD
    }
  });

  // Fill gradient
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  grad.addColorStop(0, fillColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad.left + i * step;
    const y = pad.top + chartH - (v / maxVal) * chartH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.left + (values.length - 1) * step, pad.top + chartH);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  values.forEach((v, i) => {
    const x = pad.left + i * step;
    const y = pad.top + chartH - (v / maxVal) * chartH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  ctx.fillStyle = color;
  values.forEach((v, i) => {
    if (i % labelStep === 0 || i === values.length - 1) {
      const x = pad.left + i * step;
      const y = pad.top + chartH - (v / maxVal) * chartH;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawDonutChart(canvasId: string, emptyId: string, data: Record<string, number>) {
  const emptyEl = document.getElementById(emptyId)!;
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;

  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) {
    canvas.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }
  canvas.style.display = 'block';
  emptyEl.style.display = 'none';

  const ctx = getCanvasCtx(canvasId);
  if (!ctx) return;

  const size = canvas.getBoundingClientRect().width;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.42;
  const innerR = size * 0.26;

  ctx.clearRect(0, 0, size, size);

  let startAngle = -Math.PI / 2;
  const entries = Object.entries(data).filter(([, v]) => v > 0);

  entries.forEach(([status, count]) => {
    const slice = (count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle = CHART_COLORS[status as keyof typeof CHART_COLORS] ?? '#6366f1';
    ctx.fill();
    startAngle += slice;
  });

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = '#0f0f1a';
  ctx.fill();

  // Center text
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 0.12)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(String(total), cx, cy - 2);
  ctx.font = `${Math.round(size * 0.07)}px Inter, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('total', cx, cy + size * 0.09);

  // Legend
  const legendEl = document.getElementById('donut-legend')!;
  legendEl.innerHTML = entries
    .map(([status, count]) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${CHART_COLORS[status as keyof typeof CHART_COLORS] ?? '#6366f1'}"></span>
        <span class="legend-label">${statusLabel(status)}</span>
        <span class="legend-val">${count}</span>
      </div>
    `)
    .join('');
}

function drawBarChart(canvasId: string, emptyId: string, labels: string[], values: number[], color: string) {
  const emptyEl = document.getElementById(emptyId)!;
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;

  if (values.length === 0 || values.every(v => v === 0)) {
    canvas.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }
  canvas.style.display = 'block';
  emptyEl.style.display = 'none';

  const ctx = getCanvasCtx(canvasId);
  if (!ctx) return;

  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const pad = { top: 16, right: 16, bottom: 44, left: 44 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const maxVal = Math.max(...values, 1);
  const barW = chartW / labels.length * 0.6;
  const gap = chartW / labels.length;

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(maxVal - (maxVal / 4) * i)), pad.left - 6, y + 4);
  }

  labels.forEach((lbl, i) => {
    const x = pad.left + i * gap + gap / 2 - barW / 2;
    const barH = (values[i] / maxVal) * chartH;
    const y = pad.top + chartH - barH;

    const grad = ctx.createLinearGradient(x, y, x, y + barH);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color + '55');

    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fillStyle = grad;
    ctx.fill();

    // X label
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    const shortLabel = lbl.length > 10 ? lbl.slice(0, 9) + '…' : lbl;
    ctx.fillText(shortLabel, x + barW / 2, h - 10);
  });
}

// ─── Analytics loading ────────────────────────────────────────────────────────

async function loadGraphs() {
  const res = await send({ type: 'GET_ANALYTICS' });
  if (!res.success) {
    setStatusBar(`Failed to load analytics: ${res.error}`, 'error');
    return;
  }

  const data = res.data as AnalyticsData;

  // Update cost summary
  document.getElementById('stat-total-tokens')!.textContent = data.totalTokens.toLocaleString();
  document.getElementById('stat-total-emails')!.textContent = data.totalEmails.toLocaleString();
  const avgTokens = data.totalEmails > 0 ? Math.round(data.totalTokens / data.totalEmails) : 0;
  document.getElementById('stat-per-email')!.textContent = avgTokens.toLocaleString();

  // Chart 1 — applications over time
  const appDates = Object.keys(data.applicationsByDate).sort();
  const appCounts = appDates.map(d => data.applicationsByDate[d]);
  drawLineChart('canvas-timeline', 'chart-empty-1', appDates, appCounts, '#6366f1', 'rgba(99,102,241,0.25)');

  // Chart 2 — status donut
  drawDonutChart('canvas-status', 'chart-empty-2', data.statusBreakdown);

  // Chart 3 — token usage over time
  const tokenDates = data.dailyRecords.map(r => r.date).sort();
  const tokenVals  = tokenDates.map(d => data.dailyRecords.find(r => r.date === d)?.tokens ?? 0);
  drawLineChart('canvas-tokens', 'chart-empty-3', tokenDates, tokenVals, '#f59e0b', 'rgba(245,158,11,0.2)');

  // Chart 4 — applications per week (last 8 weeks, Monday start)
  const weekStart = (d: Date) => {
    const w = new Date(d);
    w.setHours(0, 0, 0, 0);
    w.setDate(w.getDate() - ((w.getDay() + 6) % 7));
    return w;
  };
  const thisWeek = weekStart(new Date());
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const w = new Date(thisWeek);
    w.setDate(w.getDate() - (7 - i) * 7);
    return w;
  });
  const weekCounts = weeks.map(() => 0);
  for (const [day, count] of Object.entries(data.applicationsByDate)) {
    const ws = weekStart(new Date(`${day}T00:00:00`)).getTime();
    const idx = weeks.findIndex(w => w.getTime() === ws);
    if (idx >= 0) weekCounts[idx] += count;
  }
  drawBarChart('canvas-weekly', 'chart-empty-4',
    weeks.map(w => w.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
    weekCounts,
    '#10b981'
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderTable();
});

btnSyncTop.addEventListener('click', runSync);
btnStopSyncTop.addEventListener('click', stopSync);
detailClose.addEventListener('click', closeDetail);

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const htmlEl = el as HTMLElement;

    if (htmlEl.dataset.view === 'graphs') {
      showView('graphs');
      loadGraphs();
      return;
    }

    showView('applications');
    setFilter(htmlEl.dataset.filter ?? 'all');
  });
});

for (const id of ['sidebar-settings', 'setup-banner-link']) {
  document.getElementById(id)?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/settings.html') });
  });
}

document.getElementById('btn-refresh-graphs')?.addEventListener('click', () => {
  loadGraphs();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadApps();
