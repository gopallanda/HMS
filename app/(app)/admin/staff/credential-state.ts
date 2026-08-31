/**
 * The result shape of the two actions whose OUTPUT is the point.
 *
 * In its own module rather than beside the actions because a `'use server'`
 * file may export nothing but async functions -- a constant exported from one
 * is a 500 at request time, not a build error, which is exactly the kind of
 * failure that reaches a hospital rather than a developer.
 *
 * Wider than ActionState because provisioning and resetting a password hand
 * back credentials that exist nowhere else afterwards: a username and a
 * temporary password, shown once, in a modal, with copy buttons. There is no
 * "show it again" anywhere in the product -- a password that can be re-read is
 * a password stored in plaintext, and the honest alternative (reset it, hand
 * over a new one) takes the same ten seconds.
 */
export type CredentialState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[] | undefined> }
  | {
      status: 'issued';
      message: string;
      staffName: string;
      username: string;
      password: string;
      loginUrl: string;
    };

export const CREDENTIALS_IDLE: CredentialState = { status: 'idle' };
