// ─── Core Domain Types ──────────────────────────────────────────────────────

export type JobStatus = 'applied' | 'interview' | 'assessment' | 'offer' | 'rejected';

export interface Application {
  id: string;        // Gmail message ID (unique)
  threadId: string;
  company: string;
  role: string;
  status: JobStatus;
  emailDate: string; // ISO date string from email headers
  subject: string;
  snippet: string;
  syncedAt: string;  // ISO date string when we processed it
}

export interface LabelMap {
  applied?: string;
  interview?: string;
  assessment?: string;
  offer?: string;
  rejected?: string;
}

export interface StorageData {
  applications: Record<string, Application>; // keyed by Gmail message ID
  /**
   * Messages which have already been classified, including messages that were
   * not job-related. Keeping this separately prevents every sync from paying
   * to classify the same non-job email again.
   */
  processedMessageIds?: Record<string, string>; // message ID → processed ISO date
  lastCheckAt?: string;   // ISO string — when we last synced
  openAiKey?: string;     // User's OpenAI API key
  startDate?: string;     // ISO string — "check emails since this date"
  isConnected: boolean;
  userEmail?: string;
  labelMap: LabelMap;
  // Token / cost analytics
  totalTokensUsed?: number;
  dailyTokenRecords?: DailyTokenRecord[];
  // Live progress of the current sync, shared with every open popup/dashboard
  syncStatus?: SyncStatus;
}

// ─── AI Classification ──────────────────────────────────────────────────────

export interface ClassifyResult {
  isJobRelated: boolean;
  company: string;
  role: string;
  status: JobStatus;
}

// ─── Sync ───────────────────────────────────────────────────────────────────

export interface SyncResult {
  processed: number;      // emails checked
  newApplications: number;// new ones saved
  errors: number;
  tokensUsed?: number;    // total tokens consumed in this sync
  cancelled?: boolean;    // true when the user stopped the current run
}

// ─── Token / Cost Tracking ───────────────────────────────────────────────────

export interface DailyTokenRecord {
  date: string;         // YYYY-MM-DD
  tokens: number;
  emailsProcessed: number;
}

export interface AnalyticsData {
  totalTokens: number;
  totalEmails: number;
  dailyRecords: DailyTokenRecord[];
  applicationsByDate: Record<string, number>;  // YYYY-MM-DD → count
  statusBreakdown: Record<string, number>;
}

// ─── Sync progress / setup ───────────────────────────────────────────────────

export interface SyncStatus {
  running: boolean;
  startedAt?: string;
  processed: number;       // emails fetched + classified so far this run
  newApplications: number; // saved so far this run
  total: number;           // emails in the window still to be checked
}

export interface SetupStatus {
  gmail: boolean;
  openAiKey: boolean;
  startDate: boolean;
  labels: boolean;
}

// ─── UI Stats ───────────────────────────────────────────────────────────────

export interface StatsData {
  applied: number;
  interview: number;
  assessment: number;
  offer: number;
  rejected: number;
  total: number;
  lastCheckAt?: string;
  startDate?: string;
  isConnected: boolean;
  userEmail?: string;
  syncStatus: SyncStatus;
  setup: SetupStatus;
  setupComplete: boolean;
}

// ─── Gmail API ──────────────────────────────────────────────────────────────

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string; // epoch ms as string
  payload: {
    headers: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string; size?: number };
    parts?: GmailMessagePart[];
  };
}

export interface GmailMessagePart {
  mimeType: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

export interface GmailLabelColor {
  backgroundColor: string;
  textColor: string;
}

// ─── Chrome Messaging ───────────────────────────────────────────────────────

export type AppMessage =
  | { type: 'SYNC' }
  | { type: 'CANCEL_SYNC' }
  | { type: 'GET_STATS' }
  | { type: 'SETUP_LABELS' }
  | { type: 'CONNECT_GMAIL' }
  | { type: 'DISCONNECT_GMAIL' }
  | { type: 'GET_APPLICATIONS' }
  | { type: 'GET_EMAIL_BODY'; messageId: string }
  | { type: 'GET_ANALYTICS' };

export type AppResponse =
  | { success: true; data: SyncResult }
  | { success: true; data: StatsData }
  | { success: true; data: Application[] }
  | { success: true; data: { body: string } }
  | { success: true; data: AnalyticsData }
  | { success: true; data: null }
  | { success: false; error: string };
