# JobTracker Privacy Policy

_Last updated: 18 September 2026_

JobTracker is a Chrome extension that finds job-application emails in your Gmail inbox, labels them, and shows them in a private dashboard. It has no server: everything it does runs inside your browser.

## What the extension accesses

**Gmail.** With your permission (Google OAuth, `gmail.modify` scope) the extension:

- lists and reads messages in your inbox that arrived after the start date you choose;
- adds `Job/*` labels to messages it identifies as job-related.

It never sends email on your behalf, deletes messages, or changes anything other than adding those labels.

**OpenAI.** To decide whether an email is job-related and what kind it is, the extension sends the email's **subject line, sender address, and the first 2,000 characters of its text** — never attachments — to the OpenAI API using an API key you supply. Emails the first check judges not job-related are never sent for the second, more detailed step. This is governed by [OpenAI's API data-usage terms](https://openai.com/policies/api-data-usage-policies), under which API inputs are not used to train models.

## What is stored, and where

All data is stored locally in your browser's extension storage (`chrome.storage.local`) on your device only:

- the application records the extension creates (company, role, status, date, subject, snippet, Gmail message ID);
- IDs of emails already checked, so they are not re-sent to OpenAI;
- your OpenAI API key;
- your Google account email address, sync start date, and last-sync time;
- token-usage totals for the Analytics view.

Nothing is sent to the developer or to any third party other than Google (Gmail API) and OpenAI, as described above. The extension contains no analytics, tracking, or advertising code.

Your Google access token is managed by Chrome's identity system and is never stored by the extension.

## Deleting your data

- **Disconnect Gmail** in Settings to revoke the extension's cached access.
- **Remove the extension** from Chrome to delete all locally stored data.
- To fully revoke Google access, visit your [Google Account permissions](https://myaccount.google.com/permissions).
- `Job/*` labels remain in Gmail until you delete them; deleting a label does not delete the emails.

## Google API Services User Data Policy

JobTracker's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Gmail data is used only to provide the extension's user-facing job-tracking feature, is never transferred to others except as needed to provide that feature, is never used for advertising, and is never read by humans.

## Contact

Questions about this policy: open an issue on the project's GitHub repository.
