import type { AppMessage, AppResponse, StorageData } from './lib/types';

// ─── Messaging ────────────────────────────────────────────────────────────────

function send(msg: AppMessage): Promise<AppResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r: AppResponse) => {
      resolve(r ?? { success: false, error: 'No response from background' });
    });
  });
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const gmailStatusBadge   = document.getElementById('gmail-status-badge')!;
const gmailConnectedInfo = document.getElementById('gmail-connected-info')!;
const gmailEmailDisplay  = document.getElementById('gmail-email-display')!;
const btnConnectGmail    = document.getElementById('btn-connect-gmail') as HTMLButtonElement;
const btnDisconnectGmail = document.getElementById('btn-disconnect-gmail') as HTMLButtonElement;

const openaiStatusBadge  = document.getElementById('openai-status-badge')!;
const openaiKeyInput     = document.getElementById('openai-key-input') as HTMLInputElement;
const eyeBtn             = document.getElementById('eye-btn') as HTMLButtonElement;
const btnSaveKey         = document.getElementById('btn-save-key') as HTMLButtonElement;

const startDateInput     = document.getElementById('start-date-input') as HTMLInputElement;
const btnSaveDate        = document.getElementById('btn-save-date') as HTMLButtonElement;

const labelsStatusBadge  = document.getElementById('labels-status-badge')!;
const btnSetupLabels     = document.getElementById('btn-setup-labels') as HTMLButtonElement;
const labelsBtnLabel     = document.getElementById('labels-btn-label')!;

const toastContainer     = document.getElementById('toast-container')!;

const steps = [1, 2, 3, 4].map((n) => document.getElementById(`step-${n}`)!);

// ─── Toast system ──────────────────────────────────────────────────────────────

function showToast(text: string, type: 'success' | 'error' | 'info' = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = text;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function updateSteps(storage: Partial<StorageData>) {
  const doneFlags = [
    storage.isConnected ?? false,
    !!(storage.openAiKey),
    !!(storage.startDate),
    !!(storage.labelMap && Object.keys(storage.labelMap).length > 0),
  ];

  steps.forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (doneFlags[i]) {
      el.classList.add('done');
      const numEl = el.querySelector('.step-num')!;
      numEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>`;
    } else {
      // Find first incomplete step and mark active
      const firstIncomplete = doneFlags.findIndex((d) => !d);
      if (i === firstIncomplete) el.classList.add('active');
    }
  });
}

// ─── Status badges ──────────────────────────────────────────────────────────

function setGmailStatus(connected: boolean, email?: string) {
  const dot = gmailStatusBadge.querySelector('.badge-dot')!;
  dot.classList.toggle('connected', connected);
  dot.classList.toggle('disconnected', !connected);
  gmailStatusBadge.lastChild!.textContent = connected ? ' Connected' : ' Not connected';

  gmailConnectedInfo.style.display = connected ? 'flex' : 'none';
  if (email) gmailEmailDisplay.textContent = email;

  btnConnectGmail.style.display = connected ? 'none' : 'flex';
  btnDisconnectGmail.style.display = connected ? 'flex' : 'none';
}

function setOpenAiStatus(hasKey: boolean) {
  const dot = openaiStatusBadge.querySelector('.badge-dot')!;
  dot.classList.toggle('connected', hasKey);
  dot.classList.toggle('disconnected', !hasKey);
  openaiStatusBadge.lastChild!.textContent = hasKey ? ' Key saved' : ' Not set';
}

function setLabelsStatus(hasLabels: boolean) {
  const dot = labelsStatusBadge.querySelector('.badge-dot')!;
  dot.classList.toggle('connected', hasLabels);
  dot.classList.toggle('disconnected', !hasLabels);
  labelsStatusBadge.lastChild!.textContent = hasLabels ? ' Ready' : ' Not set up';
  labelsBtnLabel.textContent = hasLabels ? '✅ Labels Ready (Re-create)' : 'Set Up Gmail Labels';
}

// ─── Load state ───────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise<void>((resolve) => {
    chrome.storage.local.get(null, (data) => {
      const storage = data as Partial<StorageData>;

      setGmailStatus(storage.isConnected ?? false, storage.userEmail);
      setOpenAiStatus(!!(storage.openAiKey));
      setLabelsStatus(!!(storage.labelMap && Object.keys(storage.labelMap).length > 0));
      updateSteps(storage);

      // Pre-fill saved values (masked)
      if (storage.openAiKey) {
        openaiKeyInput.value = storage.openAiKey;
      }

      if (storage.startDate) {
        startDateInput.value = storage.startDate.slice(0, 10);
      } else {
        // Default: 3 months ago
        const d = new Date();
        d.setMonth(d.getMonth() - 3);
        startDateInput.value = d.toISOString().slice(0, 10);
      }

      resolve();
    });
  });
}

// ─── Gmail connect ────────────────────────────────────────────────────────────

btnConnectGmail.addEventListener('click', async () => {
  btnConnectGmail.disabled = true;
  btnConnectGmail.textContent = 'Connecting…';

  const res = await send({ type: 'CONNECT_GMAIL' });

  btnConnectGmail.disabled = false;
  btnConnectGmail.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
    Connect Gmail`;

  if (!res.success) {
    showToast(res.error, 'error');
    return;
  }

  showToast('✅ Gmail connected successfully!', 'success');
  await loadSettings();
});

// ─── Gmail disconnect ─────────────────────────────────────────────────────────

btnDisconnectGmail.addEventListener('click', async () => {
  if (!confirm('Disconnect Gmail? You will need to reconnect to sync emails.')) return;

  btnDisconnectGmail.disabled = true;
  const res = await send({ type: 'DISCONNECT_GMAIL' });
  btnDisconnectGmail.disabled = false;

  if (!res.success) {
    showToast(res.error, 'error');
    return;
  }

  showToast('Disconnected from Gmail.', 'info');
  await loadSettings();
});

// ─── OpenAI key ───────────────────────────────────────────────────────────────

let keyVisible = false;

eyeBtn.addEventListener('click', () => {
  keyVisible = !keyVisible;
  openaiKeyInput.type = keyVisible ? 'text' : 'password';
  eyeBtn.title = keyVisible ? 'Hide key' : 'Show key';
});

btnSaveKey.addEventListener('click', async () => {
  const key = openaiKeyInput.value.trim();
  if (!key) {
    showToast('Please enter your OpenAI API key.', 'error');
    return;
  }
  if (!key.startsWith('sk-')) {
    showToast('Key should start with "sk-". Please double-check.', 'error');
    return;
  }

  btnSaveKey.disabled = true;
  await new Promise<void>((r) =>
    chrome.storage.local.set({ openAiKey: key }, r)
  );
  btnSaveKey.disabled = false;

  showToast('✅ OpenAI API key saved!', 'success');
  setOpenAiStatus(true);
  await loadSettings();
});

// ─── Start date ───────────────────────────────────────────────────────────────

btnSaveDate.addEventListener('click', async () => {
  const val = startDateInput.value;
  if (!val) {
    showToast('Please select a start date.', 'error');
    return;
  }

  await new Promise<void>((r) =>
    chrome.storage.local.set({ startDate: new Date(val).toISOString() }, r)
  );

  showToast('✅ Start date saved!', 'success');
  await loadSettings();
});

// ─── Setup labels ─────────────────────────────────────────────────────────────

btnSetupLabels.addEventListener('click', async () => {
  btnSetupLabels.disabled = true;
  labelsBtnLabel.textContent = 'Creating labels…';

  const res = await send({ type: 'SETUP_LABELS' });

  btnSetupLabels.disabled = false;

  if (!res.success) {
    labelsBtnLabel.textContent = 'Set Up Gmail Labels';
    showToast(res.error, 'error');
    return;
  }

  showToast('✅ Gmail labels created! Check your Gmail sidebar.', 'success');
  await loadSettings();
});

// ─── Navigation ───────────────────────────────────────────────────────────────

document.getElementById('go-dashboard')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadSettings();
