import type { StorageData, Application, LabelMap } from './types';

const DEFAULTS: StorageData = {
  applications: {},
  isConnected: false,
  labelMap: {},
};

// ─── Core storage helpers ────────────────────────────────────────────────────

export async function getStorage(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => {
      resolve({ ...DEFAULTS, ...data } as StorageData);
    });
  });
}

export async function setStorage(data: Partial<StorageData>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

// ─── Application helpers ─────────────────────────────────────────────────────

export async function saveApplication(app: Application): Promise<void> {
  const storage = await getStorage();
  const applications = { ...storage.applications, [app.id]: app };
  await setStorage({ applications });
}

export async function hasApplication(id: string): Promise<boolean> {
  const storage = await getStorage();
  return id in storage.applications;
}

export async function getApplications(): Promise<Application[]> {
  const storage = await getStorage();
  return Object.values(storage.applications).sort(
    (a, b) => new Date(b.emailDate).getTime() - new Date(a.emailDate).getTime()
  );
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getStats() {
  const apps = await getApplications();
  return {
    applied: apps.filter((a) => a.status === 'applied').length,
    interview: apps.filter((a) => a.status === 'interview').length,
    assessment: apps.filter((a) => a.status === 'assessment').length,
    offer: apps.filter((a) => a.status === 'offer').length,
    rejected: apps.filter((a) => a.status === 'rejected').length,
    total: apps.length,
  };
}

export async function updateLastCheckAt(): Promise<void> {
  await setStorage({ lastCheckAt: new Date().toISOString() });
}
