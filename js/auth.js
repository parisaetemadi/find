// Google sign-in through Supabase, loaded from the CDN so the page keeps the
// repo's no-build-step rule. Everything degrades: with no credentials the
// buttons stay hidden and search still works.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client = null;

export async function getClient() {
  if (!configured) return null;
  if (!client) {
    try {
      const { createClient } = await import(
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'
      );
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      // Offline, or the CDN is blocked. Search and the local list still work;
      // only the signed-in half goes quiet.
      return null;
    }
  }
  return client;
}

export async function currentUser() {
  const sb = await getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}

export async function signIn() {
  const sb = await getClient();
  if (!sb) return;
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

export async function signOut() {
  const sb = await getClient();
  if (sb) await sb.auth.signOut();
}

export async function onAuthChange(fn) {
  const sb = await getClient();
  if (sb) sb.auth.onAuthStateChange(() => fn());
}
