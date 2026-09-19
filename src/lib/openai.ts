import type { ClassifyResult, JobStatus } from './types';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Two stages, mirroring the job-tracker pipeline:
//   1. classify — strict YES/NO. A NO gets no label and no row.
//   2. extract  — only for YES: what kind of email, company, role, confidence.

function classifyPrompt(subject: string, from: string, snippet: string, body: string): string {
  return `You are a classifier. Decide if this email is about a job application the recipient has made, or a direct approach to the recipient about a specific role.

Answer YES for:
- confirmations that an application was received or submitted — including automated ones from an applicant tracking system or job board, e.g. "we have received your application", "thank you for applying", "your application was sent", Indeed Apply or LinkedIn application confirmations
- rejections, interview invitations or scheduling, assessments or tests, job offers, and any update on the progress of an application
- a named recruiter or hiring manager writing to the recipient about a specific role

Answer NO for emails that are not about an application the recipient made:
- job alerts, job recommendations, "jobs for you" / "new jobs posted" digests, job-board newsletters and marketing
- requests to review or rate a company or an interview
- account and profile notifications from job sites (welcome, account created, profile views), career-site marketing
- newsletters, product updates, security alerts, OTP codes, receipts, spam

Being automated or sent from a no-reply address does NOT make an email NO — most application confirmations are automated.

Subject: ${subject}
From: ${from}
Snippet: ${snippet.slice(0, 300)}
Body start: ${body.slice(0, 600)}

Reply with exactly one word: YES or NO`;
}

function extractPrompt(subject: string, from: string, body: string): string {
  return `Extract structured information from this job application email.

Subject: ${subject}
From: ${from}
Body:
${body.slice(0, 2000)}

IMPORTANT — email_type classification rules:
- "rejection": Any email indicating the candidate was NOT selected. Key phrases: "move forward with other candidates", "decided not to move forward", "will not be moving forward", "regret to inform", "unsuccessful", "not selected", "we have decided to pursue", "wish you well", "keep your details on file", "encourage you to apply for other roles", "gone with another candidate". These all mean REJECTION even if they sound polite.
- "applied_confirmation": Auto-reply confirming receipt of an application. Usually says "we have received your application" or "thank you for applying".
- "interview_invite": Explicitly invites you to an interview, phone screen, or video call with a date/time or scheduling link.
- "assessment": Sends you a test, task, or online assessment to complete.
- "offer": Contains a job offer to you with salary or start date.
- "stage_update": Confirms you are moving FORWARD in the process (e.g. "you have been shortlisted", "progressing to next stage") — NOT rejections.
- "recruiter_outreach": A named recruiter or hiring manager personally contacts you about a specific role you haven't applied to. Automated job-board recommendations are NOT recruiter_outreach.
- "other": Anything else, including job alerts, job recommendations, "new jobs posted" digests, and requests to review a company. For these, set company and job_title to null — they are not applications.

Return ONLY valid JSON:
{
  "email_type": "<one of: applied_confirmation | rejection | interview_invite | assessment | offer | recruiter_outreach | stage_update | other>",
  "company": "<company name or null>",
  "job_title": "<job title or null>",
  "confidence": <0.0-1.0, how confident you are in email_type>
}`;
}

// Only these types are applications the user is part of. Outreach and
// "other" (alerts, digests, review requests) are dropped without a label.
const STATUS_FROM_EMAIL_TYPE: Record<string, JobStatus | undefined> = {
  applied_confirmation: 'applied',
  assessment: 'assessment',
  interview_invite: 'interview',
  stage_update: 'interview',
  offer: 'offer',
  rejection: 'rejected',
  recruiter_outreach: undefined,
  other: undefined,
};

async function chat(
  apiKey: string,
  prompt: string,
  maxTokens: number,
  json: boolean
): Promise<{ text: string; tokens: number }> {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0,
      ...(json && { response_format: { type: 'json_object' } }),
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Empty response from OpenAI');
  return { text, tokens: data.usage?.total_tokens ?? 0 };
}

const NOT_JOB: ClassifyResult = {
  isJobRelated: false,
  company: '',
  role: '',
  status: 'applied',
  confidence: 1,
};

export async function classifyEmail(
  apiKey: string,
  subject: string,
  from: string,
  snippet: string,
  body: string
): Promise<ClassifyResult & { tokensUsed: number }> {
  // Stage 1 — is it job-related at all? The snippet is Gmail's clean preview;
  // fall back to the body when there is none.
  const yesNo = await chat(apiKey, classifyPrompt(subject, from, snippet, body), 5, false);
  let tokensUsed = yesNo.tokens;
  if (!/^\s*YES\b/i.test(yesNo.text)) {
    return { ...NOT_JOB, tokensUsed };
  }

  // Stage 2 — what kind, and how sure? Needs the body: confirmations often
  // start with "please don't reply / view in browser", which is all a snippet
  // shows, and the "we received your application" line comes later.
  const extracted = await chat(apiKey, extractPrompt(subject, from, body || snippet), 300, true);
  tokensUsed += extracted.tokens;

  let parsed: { email_type?: string; company?: string | null; job_title?: string | null; confidence?: number };
  try {
    parsed = JSON.parse(extracted.text);
  } catch {
    // Unparseable extraction: it is job-related but we don't know what kind.
    return { isJobRelated: true, company: 'Unknown Company', role: 'Unknown Role', status: 'applied', confidence: 0, tokensUsed };
  }

  const status = STATUS_FROM_EMAIL_TYPE[parsed.email_type ?? 'other'];
  if (!status) return { ...NOT_JOB, tokensUsed };

  const confidence =
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

  return {
    isJobRelated: true,
    company: parsed.company?.trim() || 'Unknown Company',
    role: parsed.job_title?.trim() || 'Unknown Role',
    status,
    confidence,
    tokensUsed,
  };
}
