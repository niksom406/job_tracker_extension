import type { ClassifyResult, JobStatus } from './types';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are a job application email classifier. Given an email subject and snippet, decide whether it is part of a job application process the recipient is personally involved in.

isJobRelated is true ONLY for emails about a specific application the recipient made, or a named recruiter/hiring manager writing to them directly about a specific role: application confirmations, rejections, interview invitations, assessments, offers.

isJobRelated is false for anything automated or promotional, even if it mentions companies, roles or salaries: job alerts, job recommendations, "jobs for you" digests, job-board newsletters (LinkedIn, Indeed, Vaia, Glassdoor, Reed, Otta, etc.), requests to review or rate a company or interview, profile/notification emails from job sites, career-site marketing, newsletters, receipts, account notifications.

Return ONLY a JSON object with this exact shape:
{
  "isJobRelated": <boolean>,
  "company": "<company name, or empty string>",
  "role": "<job title, or empty string>",
  "status": "<applied|interview|assessment|offer|rejected>",
  "confidence": <0.0-1.0, how sure you are about BOTH isJobRelated and status; use below 0.6 when the email is ambiguous>
}

Status guide:
- "applied"    → application received/submitted confirmation
- "interview"  → interview invitation, schedule a call/meeting
- "assessment" → coding challenge, take-home test, technical assessment
- "offer"      → job offer letter, compensation package
- "rejected"   → not moving forward, position filled, unsuccessful application
- If not job-related → isJobRelated=false, empty strings, status="applied"`;

const VALID_STATUSES: JobStatus[] = [
  'applied',
  'interview',
  'assessment',
  'offer',
  'rejected',
];

export async function classifyEmail(
  apiKey: string,
  subject: string,
  snippet: string
): Promise<ClassifyResult & { tokensUsed: number }> {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Subject: ${subject}\n\nSnippet: ${snippet.slice(0, 500)}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 200,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('Empty response from OpenAI');

  const tokensUsed: number = data.usage?.total_tokens ?? 0;

  const parsed = JSON.parse(content) as {
    isJobRelated: boolean;
    company?: string;
    role?: string;
    status?: string;
    confidence?: number;
  };

  const status: JobStatus = VALID_STATUSES.includes(parsed.status as JobStatus)
    ? (parsed.status as JobStatus)
    : 'applied';

  // A missing/invalid confidence is treated as uncertain so it lands in review
  // rather than being silently filed.
  const confidence =
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

  return {
    isJobRelated: Boolean(parsed.isJobRelated),
    company: parsed.company?.trim() || 'Unknown Company',
    role: parsed.role?.trim() || 'Unknown Role',
    status,
    confidence,
    tokensUsed,
  };
}
