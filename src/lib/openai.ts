import type { ClassifyResult, JobStatus } from './types';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are a job application email classifier. Given an email subject and snippet, classify whether it relates to a job application.

Return ONLY a JSON object with this exact shape:
{
  "isJobRelated": <boolean>,
  "company": "<company name, or empty string>",
  "role": "<job title, or empty string>",
  "status": "<applied|interview|assessment|offer|rejected>"
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
  };

  const status: JobStatus = VALID_STATUSES.includes(parsed.status as JobStatus)
    ? (parsed.status as JobStatus)
    : 'applied';

  return {
    isJobRelated: Boolean(parsed.isJobRelated),
    company: parsed.company?.trim() || 'Unknown Company',
    role: parsed.role?.trim() || 'Unknown Role',
    status,
    tokensUsed,
  };
}
