import type { GmailMessage, GmailLabel, GmailLabelColor, GmailMessagePart } from './types';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ─── Base request helper ─────────────────────────────────────────────────────

async function req<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    throw new Error(`Gmail API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getUserProfile(token: string): Promise<{ emailAddress: string }> {
  return req(token, '/profile');
}

// ─── Messages ────────────────────────────────────────────────────────────────

export async function listMessageIds(
  token: string,
  query: string,
  maxResults = 200
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(500, maxResults - ids.length)),
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await req<{
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    }>(token, `/messages?${params}`);

    if (data.messages) ids.push(...data.messages.map((m) => m.id));
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < maxResults);

  return ids;
}

export async function getMessage(token: string, id: string): Promise<GmailMessage> {
  return req(token, `/messages/${id}?format=full`);
}

export async function applyLabel(token: string, messageId: string, labelId: string): Promise<void> {
  await req(token, `/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

export async function modifyLabels(
  token: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[]
): Promise<void> {
  await req(token, `/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export async function listLabels(token: string): Promise<GmailLabel[]> {
  const data = await req<{ labels?: GmailLabel[] }>(token, '/labels');
  return data.labels ?? [];
}

export async function createLabel(
  token: string,
  name: string,
  color: GmailLabelColor
): Promise<GmailLabel> {
  return req(token, '/labels', {
    method: 'POST',
    body: JSON.stringify({
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
      color,
    }),
  });
}

export async function updateLabelColor(
  token: string,
  labelId: string,
  color: GmailLabelColor
): Promise<void> {
  await req(token, `/labels/${labelId}`, {
    method: 'PATCH',
    body: JSON.stringify({ color }),
  });
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

export function extractHeader(message: GmailMessage, name: string): string {
  return (
    message.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase()
    )?.value ?? ''
  );
}

export function extractBody(message: GmailMessage): string {
  function decode(data: string): string {
    return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  }

  function walkParts(parts: GmailMessagePart[]): string {
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decode(part.body.data);
      }
      if (part.parts) {
        const found = walkParts(part.parts);
        if (found) return found;
      }
    }
    // Fallback: try HTML parts
    for (const part of parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decode(part.body.data);
        // Strip tags for plain text view
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
    return '';
  }

  if (message.payload?.body?.data) {
    return decode(message.payload.body.data);
  }

  if (message.payload?.parts) {
    return walkParts(message.payload.parts);
  }

  return message.snippet ?? '';
}
