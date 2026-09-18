# Job Tracker — Chrome Extension

A zero-server Chrome extension that monitors your Gmail inbox for job application emails, classifies them with OpenAI, auto-creates Gmail labels, and shows a dashboard — all privately on your own machine.

---

## Decisions Locked In ✅

| Decision | Choice | Rationale |
|---|---|---|
| Gmail Auth | **Proper OAuth (Google Cloud)** | Secure, works with any Gmail, no DOM scraping fragility |
| AI Model | **`gpt-4o-mini`** | Pennies per month for this use case, reliable JSON output, stable API |
| Date range picker | **Free date picker** | User picks exact start date for first sync |
| Extension UI | **Popup + Full Dashboard tab** | Popup for quick stats/sync, full tab for the applications table |
| Telegram alerts | **Skip for now** | Can add later as a feature request |

---

## User Review Required

> [!IMPORTANT]
> Please review the full plan below and confirm you're happy before implementation begins.

---

## Proposed Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                              │
│                                                                      │
│  ┌─────────────────┐  ┌──────────────────────┐  ┌────────────────┐  │
│  │  Popup (icon)   │  │  Dashboard (full tab) │  │  Settings tab  │  │
│  │  - Quick stats  │  │  - Applications table │  │  - Gmail OAuth │  │
│  │  - Sync button  │  │  - Search & filter    │  │  - OpenAI key  │  │
│  │  - Open Dash →  │  │  - Email detail view  │  │  - Date picker │  │
│  │  - Settings →   │  │  - Status timeline    │  │  - Label setup │  │
│  └─────────────────┘  └──────────────────────┘  └────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │               background.ts (service worker)                 │   │
│  │  - Gmail API calls (fetch emails since lastCheckAt)          │   │
│  │  - OpenAI gpt-4o-mini (classify + extract company/role)      │   │
│  │  - Label management (auto-create + apply Job/* labels)       │   │
│  │  - Deduplication (skip emails already with Job/* label)      │   │
│  │  - chrome.storage (cache metadata + lastCheckAt)             │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
   Gmail REST API                  OpenAI API
   (OAuth 2.0, user's account)     (gpt-4o-mini, user's key)
```

**No servers. No Docker. No database. No n8n. Data lives in Gmail + chrome.storage.**

---

## Proposed File Structure

```
job-tracker-extension/
├── manifest.json              # Chrome Manifest V3
├── package.json               # Build config + scripts
├── tsconfig.json              # TypeScript config
│
├── src/
│   ├── background.ts          # Service worker: sync orchestrator
│   │                          #   → fetch Gmail → OpenAI → label → store
│   │
│   ├── popup.html             # Popup UI (600×400px)
│   ├── popup.ts               # Quick stats, sync button, nav links
│   ├── popup.css
│   │
│   ├── dashboard.html         # Full-page dashboard (opens as tab)
│   ├── dashboard.ts           # Table, search, filters, email detail
│   ├── dashboard.css
│   │
│   ├── settings.html          # Settings page (opens as tab)
│   ├── settings.ts            # OAuth connect, API key, date picker
│   ├── settings.css
│   │
│   └── lib/
│       ├── gmail.ts           # Gmail REST API (fetch, label, create label)
│       ├── openai.ts          # gpt-4o-mini classify + extract
│       ├── storage.ts         # chrome.storage.local helpers
│       ├── labels.ts          # Gmail label bootstrap (Job/Applied etc.)
│       └── types.ts           # Shared TS types (Application, EmailEvent)
│
├── assets/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── dist/                      # Build output → load this in Chrome
```

---

## Proposed Flow (how it works)

### Step 1 — First-time setup
1. User installs extension from Chrome Web Store (or loads unpacked)
2. Popup appears → user clicks **"Get Started"** → opens Settings tab
3. In Settings:
   - Clicks **"Connect Gmail"** → Google OAuth consent screen → grants Gmail read + label permissions
   - Pastes **OpenAI API key**
   - Picks **start date** (free date picker — "check emails from this date onwards")
4. Clicks **"Set up Gmail Labels"** → extension auto-creates:
   - `Job/Applied` `Job/Interview` `Job/Assessment` `Job/Offer` `Job/Rejected`
5. Ready ✅

### Step 2 — First sync
1. User clicks **"🔄 Sync Now"** in popup
2. Background worker fetches all emails since the chosen start date
3. For each email:
   - Check: does it already have a `Job/*` label? → **skip** (already processed)
   - Send subject + snippet to **OpenAI gpt-4o-mini** → classify
   - Response: `{ isJobRelated: true, company: "Google", role: "SWE", status: "applied" }`
   - If job-related: apply Gmail label + save metadata to `chrome.storage`
4. Updates `lastCheckAt` to now
5. Popup shows: "✅ Sync complete — 12 new applications found"

### Step 3 — Ongoing syncs
- Same flow but only fetches emails **since `lastCheckAt`** (fast — usually just a few emails)
- User clicks sync whenever they want, or we can add an optional auto-sync interval

### Dashboard (full tab)
- Reads from `chrome.storage` — **instant, no API call**
- Table: Company | Role | Status | Date | Action
- Click row → email detail panel (fetches body from Gmail API on demand)
- Filter by: Applied / Interview / Assessment / Offer / Rejected
- Search by company name or role
- Stats bar: 23 Applied · 5 Interviews · 1 Offer · 8 Rejected

### Recovery (if chrome.storage is wiped)
- Re-sync: fetches all emails with `Job/*` labels from Gmail → rebuilds cache
- **Gmail is always the source of truth** — no data is ever truly lost

---

## Tech Stack

| Part | Technology |
|---|---|
| Extension type | Chrome Manifest V3 |
| Language | TypeScript |
| Build tool | esbuild (fast, zero config) |
| Gmail access | Gmail REST API (OAuth 2.0) |
| AI | OpenAI `gpt-4o-mini` |
| Storage | `chrome.storage.local` |
| UI | Vanilla HTML/CSS/TS (no framework needed) |
| Styling | Modern dark-mode CSS (premium feel) |

---

## What Gets Dropped vs Existing Project

| Existing | Extension equivalent |
|---|---|
| Postgres | `chrome.storage.local` |
| Strapi | `background.ts` (direct OpenAI calls) |
| n8n | `background.ts` (plain automation script) |
| Docker | Nothing — no install needed |
| Next.js frontend | `dashboard.html` + `dashboard.ts` |
| `scripts/setup-gmail-labels.js` | Built into the extension (runs on first setup) |

---

## Verification Plan

### Manual Testing
1. Load unpacked extension in Chrome
2. Go through settings → connect Gmail → verify labels created in Gmail
3. Run sync → verify emails classified correctly
4. Check dashboard renders with correct data
5. Test edge cases: duplicate sync, 0 job emails, very old emails

### Before Publishing
- Test on 3+ Gmail accounts
- Verify API key is never logged or transmitted externally
- Chrome Web Store review checklist
