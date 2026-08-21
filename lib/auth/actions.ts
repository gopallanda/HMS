'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Sign out.
 *
 * scope 'local' clears this browser only. A doctor signing out of a
 * consultation room should not knock the same account out of the front desk
 * machine it is also open on.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}
