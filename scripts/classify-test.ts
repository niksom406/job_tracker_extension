// Runs the extension's real classifier against sample emails.
// Usage: OPENAI_API_KEY=sk-... npm run test:classify
import { classifyEmail } from '../src/lib/openai';

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('Set OPENAI_API_KEY first, e.g.  OPENAI_API_KEY=sk-... npm run test:classify');
  process.exit(1);
}

// [expected status or NO, subject, from, snippet]
const samples: Array<[string, string, string, string]> = [
  ['applied',  'Thank you for your Application - IT Support Engineer – 3rd Line', 'No Reply <noreply@connectats.com>',
    "Netteam tX Ltd Please don't reply to this email. Thank you for getting in touch with us, we appreciate your interest in joining our team. What happens next? If you've applied for a specific position then you will have entered our shortlisting process, which usually takes around 14 days or if you've just sent though a general application"],
  ['rejected', 'Thank you for your application to Thirdfort', 'Thirdfort <no-reply@hire.eu.lever.co>',
    "Hi Nikita, Thank you for your application to Thirdfort, we really appreciate your interest and the time you've invested preparing an application. We unfortunately won't be able to move forward at this time as we are currently not able to offer visa sponsorship or offer this as a remote position outside the UK."],
  ['applied',  'Thank you for your application!', 'Microsoft Careers <microsoft@myworkday.com>',
    'Hi Nikita, Thank you for taking the time to submit your application for Cloud Solution Architect. We have received it and will review it.'],
  ['applied',  'Thank you for your application to Mendix', 'Mendix <no-reply@mendix.com>',
    'Hi Nikita, Thank you for your interest in Mendix! We wanted to let you know we have received your application and our team will be in touch.'],
  ['applied',  'Indeed Application: Automation Lead', 'Indeed Apply <indeedapply@indeed.com>',
    "We'll help you get started. Your application for Automation Lead has been submitted to the employer."],
  ['applied',  'Thank you for applying at Verve', 'Verve <no-reply@verve.com>',
    'Thanks Nikita! We received your application. Hi Nikita, Thank you for applying for the Data Analyst role.'],
  ['NO',       'New jobs posted from BT Group', 'btjobs <jobs@btjobs.com>',
    "Hello Nikita We've found a job opportunity that we think would be a great match for you."],
  ['NO',       'Welcome / Thanks for Creating Account', 'BT Recruitment <recruitment@bt.com>',
    'Hi Nikita, Thank you for setting up your account with BT Careers. You can now apply for roles.'],
  ['NO',       'Welcome to Microsoft Careers!', 'Microsoft Careers <microsoft@myworkday.com>',
    "Welcome! We're excited that you're exploring careers at Microsoft and that you created a profile."],
  ['NO',       'Agreement to be included to Bluetown Candidate Database', 'No Reply <noreply@connectats.com>',
    "Netteam tX Ltd Please don't reply to this email. By submitting your details you agree to be included in the Bluetown candidate database."],
  ['NO',       '-- 90 Ai And Automation Trainer Facilitator jobs in London --', 'Careers World <alerts@careersworld.com>',
    'Powered by FindEveryJob Here are 20 of the latest jobs matching your search.'],
  ['NO',       'Security alert', 'Google <no-reply@accounts.google.com>',
    'You allowed Job Tracker access to some of your Google Account data.'],
  ['NO',       'Joswin D\'Souza, your LLC Group review is still incomplete!', 'AmbitionBox <no-reply@ambitionbox.com>',
    'Hi Joswin D\'Souza, You left your LLC Group Ltd review incomplete a few minutes ago. Complete Your Review.'],
];

(async () => {
  let tokens = 0;
  let misses = 0;
  for (const [expected, subject, from, snippet] of samples) {
    const r = await classifyEmail(key, subject, from, snippet, snippet);
    tokens += r.tokensUsed;
    const got = r.isJobRelated ? `${r.status} (conf ${r.confidence})` : 'NO';
    const ok = r.isJobRelated ? r.status === expected : expected === 'NO';
    if (!ok) misses++;
    console.log(`${ok ? 'OK  ' : 'MISS'} expected=${expected.padEnd(8)} got=${got.padEnd(22)} | ${subject}`);
  }
  console.log(`\n${samples.length - misses}/${samples.length} correct, ${tokens} tokens used`);
})();
