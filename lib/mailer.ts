import 'server-only';

import { reportError } from '@/lib/report-error';

/**
 * The one email this product sends.
 *
 * Not a mail framework, and deliberately not one. Block 2 deletes the
 * invitation email; what is left is a password reset link, sent to the contact
 * address captured at provisioning. Anything else that looks like it wants to
 * send mail should be re-read as a feature nobody asked for.
 *
 * Transport is Resend over plain fetch -- no dependency, no SDK, one POST. If
 * RESEND_API_KEY is absent the send is a no-op and says so in the log, which
 * is the right behaviour for `next dev` on a laptop: the reset still works,
 * the link is just printed to the terminal instead of delivered.
 */

export type MailResult =
  | { ok: true; delivered: boolean }
  | { ok: false; error: string };

type Mail = {
  to: string;
  subject: string;
  text: string;
};

function fromAddress(): string {
  return process.env.MAIL_FROM?.trim() || 'Hospital Management System <onboarding@resend.dev>';
}

export async function sendMail(mail: Mail): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY?.trim();

  if (!key) {
    // Deliberately not an error. The caller's contract is "the person is told
    // to check their inbox either way"; failing here would turn a missing
    // development setting into a broken reset flow, and -- worse -- would make
    // the response differ depending on whether mail is configured.
    if (process.env.NODE_ENV === 'production') {
      // Through the one reporting helper, and WITHOUT mail.to: a recipient
      // address is a member of staff, and their mailbox does not belong in a
      // production log line about a missing environment variable.
      reportError('sendMail', new Error('RESEND_API_KEY is not set, so nothing was sent'), {
        extra: { subject: mail.subject },
      });
    } else {
      console.info(`[mailer] no RESEND_API_KEY -- not sending. Message body:\n${mail.text}`);
    }
    return { ok: true, delivered: false };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: `Mail provider returned ${response.status}. ${detail}`.trim() };
    }

    return { ok: true, delivered: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The mail provider could not be reached.',
    };
  }
}

/**
 * The reset email itself.
 *
 * Plain text, short, and it names the hospital -- somebody who works two jobs
 * needs to know which system is asking. It does not name the username: an
 * inbox is not always the person's own, and the link is enough to act on.
 */
export function resetPasswordMail(input: {
  to: string;
  hospitalName: string;
  link: string;
  minutes: number;
}): Mail {
  return {
    to: input.to,
    subject: `Reset your ${input.hospitalName} password`,
    text: [
      `A password reset was requested for your ${input.hospitalName} account.`,
      '',
      'Open this link to choose a new password:',
      input.link,
      '',
      `The link works once and expires in ${input.minutes} minutes.`,
      '',
      'If you did not ask for this, you can ignore this email. Nothing has changed.',
    ].join('\n'),
  };
}
