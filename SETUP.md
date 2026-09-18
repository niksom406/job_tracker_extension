# 🎯 JobTracker Chrome Extension — Setup Guide

## Step 0 — Prerequisites

- Google Chrome browser
- A Google account (Gmail)
- An OpenAI API key ([get one here](https://platform.openai.com/api-keys))

---

## Step 1 — Google Cloud Setup (one-time, ~10 minutes)

You need a **Google Cloud OAuth client ID** to let the extension read your Gmail.

### 1a. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **"New Project"** → Name it `JobTracker Extension` → Create

### 1b. Enable Gmail API

1. In your project, go to **APIs & Services → Library**
2. Search for **"Gmail API"** → Click Enable

### 1c. Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **"Create Credentials" → "OAuth client ID"**
3. If asked, configure the **OAuth consent screen** first:
   - User type: **External**
   - App name: `JobTracker`
   - Add your email as test user
   - Scopes: Add `gmail.modify`
4. Back to Create Credentials:
   - Application type: **Chrome App**
   - Name: `JobTracker`
   - Application ID: (leave blank for now — see Step 2)

### 1d. Get the Extension ID

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **"Load unpacked"** → select the `job-tracker-extension/` folder
4. Copy the **Extension ID** shown (e.g. `abcdefghijklmnopqrstuvwxyz123456`)

### 1e. Finish OAuth Setup

1. Back in Google Cloud → Credentials → Edit your OAuth client
2. Paste the extension ID as **Application ID**
3. Copy the **Client ID** (looks like `123456789.apps.googleusercontent.com`)

---

## Step 2 — Add Client ID to the Extension

Open `manifest.json` and replace:

```json
"client_id": "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
```

with your actual client ID:

```json
"client_id": "123456789-abcdef.apps.googleusercontent.com"
```

Then rebuild:

```bash
npm run build
```

---

## Step 3 — Reload the Extension

1. Go to `chrome://extensions`
2. Find **JobTracker** → click the **🔄 refresh icon**

---

## Step 4 — First-time Configuration

The Settings page opens automatically on first install. If not:

1. Click the JobTracker icon in your Chrome toolbar
2. Click **Settings**

Then in Settings:

| Step | What to do |
|------|------------|
| **1. Connect Gmail** | Click "Connect Gmail" → sign in with Google → grant permissions |
| **2. OpenAI API Key** | Paste your key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → Save |
| **3. Start Date** | Pick a date to sync from (e.g. 3 months ago) → Save |
| **4. Create Labels** | Click "Set Up Gmail Labels" → 5 labels appear in your Gmail |

---

## Step 5 — Sync!

1. Click the **JobTracker icon** in Chrome toolbar
2. Click **"Sync Now"**
3. Wait while it processes emails (progress shown)
4. Click **"Dashboard"** to view all your applications

---

## 💰 Cost Estimate

- **Gmail API**: Free (within generous quotas)
- **OpenAI gpt-4o-mini**: ~$0.001 per email → 1,000 emails ≈ $0.15

---

## 🔒 Privacy

- Your emails are **never sent to any third-party server**
- Only the email **subject + snippet** (first ~500 chars) is sent to OpenAI
- Your OpenAI key is stored in `chrome.storage.local` — only on your machine
- Gmail tokens are managed by Chrome's identity API

---

## 🚀 Publishing to Chrome Web Store

Once you're happy with it:

1. `npm run build`
2. Zip the project folder (excluding `node_modules/`)
3. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
4. Pay the one-time **$5 developer fee**
5. Upload the zip → fill in description + screenshots → submit for review
6. Google reviews in 1–3 business days

---

## 🛠️ Development

```bash
# Watch mode — auto-rebuilds on file changes
npm run dev

# Single build
npm run build
```

After any code change, go to `chrome://extensions` and click the **refresh icon** on JobTracker.
