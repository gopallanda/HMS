import 'server-only';

import { getSession } from '@/lib/auth/session';

/**
 * Where a failure goes when the user has already been told about it.
 *
 * Every Server Action in this codebase turns a database error into a sentence
 * for the form (CLAUDE.md 7 -- nothing is swallowed into a silent no-op). That
 * is the right thing for the person at the counter and useless to the three
 * developers: the clerk reads "That MRN is already in use", closes the dialog,
 * and nobody ever finds out it happened. Before this file there were four
 * console.error calls in the whole application.
 *
 * So every handled failure ALSO lands here, structured, with the action that
 * produced it and the tenant and login it happened under.
 *
 * ONE FUNCTION, DELIBERATELY. It writes to console.error today, which in a
 * Next.js deployment is the platform's log stream and is genuinely where these
 * belong for now. Adding Sentry -- or Axiom, or a Supabase table -- is an edit
 * to `emit` below and nothing else: no call site changes, no new import in
 * thirty files, no paid dependency added on a guess about which one this
 * hospital's host will support.
 *
 * WHAT NEVER GOES IN
 *
 * No password, no temporary password, no reset token, no service role key, no
 * session cookie. Callers pass an error and at most a few identifiers; the
 * `extra` bag is for ids and short flags, never for a payload. The one thing
 * that would make this file dangerous is somebody logging a FormData or a
 * whole request body through it, so it takes neither.
 */

/** The shape both Supabase errors and thrown Errors are read through. */
type ReportableError = {
  message?: string;
  code?: string | number;
  details?: string | null;
  hint?: string | null;
};

export type ErrorContext = {
  hospitalId?: string | null;
  userId?: string | null;
  /** Ids and short flags only. Never a payload, never anything secret. */
  extra?: Record<string, string | number | boolean | null | undefined>;
};

type Report = {
  at: string;
  level: 'error';
  action: string;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  hospital_id?: string;
  user_id?: string;
} & Record<string, unknown>;

function describe(error: unknown): ReportableError {
  if (error instanceof Error) return { message: error.message };
  if (error !== null && typeof error === 'object') return error as ReportableError;
  return { message: String(error) };
}

/**
 * The single edit point. Swap the body for a Sentry capture, an Axiom ingest
 * or an insert into an errors table and every call site below follows.
 */
function emit(report: Report): void {
  console.error('[hms]', JSON.stringify(report));
}

/**
 * Report a failure the user has already been shown.
 *
 * The tenant and the login are read from the session rather than threaded
 * through thirty call sites. getSession() is cache()d per request, so on an
 * error path it is a map lookup rather than a round trip -- and reading them
 * from the verified session means a report cannot claim a hospital the caller
 * was never in.
 *
 * It never throws. A reporting helper that can fail the action it is reporting
 * on is worse than no reporting at all.
 */
export async function reportActionError(
  action: string,
  error: unknown,
  context: ErrorContext = {},
): Promise<void> {
  try {
    const described = describe(error);

    let hospitalId = context.hospitalId ?? undefined;
    let userId = context.userId ?? undefined;

    if (hospitalId === undefined || userId === undefined) {
      const session = await getSession();
      if (session.ok) {
        hospitalId ??= session.session.hospitalId;
        userId ??= session.session.userId;
      }
    }

    const report: Report = {
      at: new Date().toISOString(),
      level: 'error',
      action,
      message: described.message ?? 'no message',
    };

    if (described.code !== undefined && described.code !== null) {
      report.code = String(described.code);
    }
    if (described.details) report.details = described.details;
    if (described.hint) report.hint = described.hint;
    if (hospitalId) report.hospital_id = hospitalId;
    if (userId) report.user_id = userId;

    for (const [key, value] of Object.entries(context.extra ?? {})) {
      if (value !== undefined) report[key] = value;
    }

    emit(report);
  } catch {
    // Reporting must never be the thing that breaks a form.
  }
}

/**
 * The same, for code that has no request session behind it -- the mailer, the
 * reset flow before a session exists. Synchronous, so it can be dropped into a
 * branch that is not already async.
 */
export function reportError(action: string, error: unknown, context: ErrorContext = {}): void {
  try {
    const described = describe(error);

    const report: Report = {
      at: new Date().toISOString(),
      level: 'error',
      action,
      message: described.message ?? 'no message',
    };

    if (described.code !== undefined && described.code !== null) {
      report.code = String(described.code);
    }
    if (context.hospitalId) report.hospital_id = context.hospitalId;
    if (context.userId) report.user_id = context.userId;

    for (const [key, value] of Object.entries(context.extra ?? {})) {
      if (value !== undefined) report[key] = value;
    }

    emit(report);
  } catch {
    // As above.
  }
}
