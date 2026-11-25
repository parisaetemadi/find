// The shared side of Discover: who searched what, what people are passing on,
// and the votes that order it. Every read here is public by design; every
// write is the signed-in member's own row, which is what the RLS policies in
// supabase/migrations/0001_discover.sql enforce.
//
// Nobody's name or email is ever read: a member is their generated handle and
// nothing else.
import { getClient } from './auth.js';

export async function myProfile() {
  const sb = await getClient();
  if (!sb) return null;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('profiles').select('id, handle').eq('id', user.id).maybeSingle();
  return data || { id: user.id, handle: 'you' };
}

export async function logSearch(topic) {
  const sb = await getClient();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('searches').insert({ topic, user_id: user.id });
}

export async function recentSearches(limit = 40) {
  const sb = await getClient();
  if (!sb) return [];
  const { data } = await sb.from('search_feed').select('*').limit(limit);
  return data || [];
}

export async function members(limit = 60) {
  const sb = await getClient();
  if (!sb) return [];
  const { data } = await sb.from('profiles').select('id, handle')
    .order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

// `sort` is 'score' for the ranking (likes decayed by age) or 'created_at'
// for the plain newest-first feed.
export async function board({ sort = 'score', toUser = null, limit = 30 } = {}) {
  const sb = await getClient();
  if (!sb) return [];
  let q = sb.from('suggestion_board').select('*').order(sort, { ascending: false }).limit(limit);
  if (toUser) q = q.eq('to_user', toUser);
  const { data } = await q;
  return data || [];
}

export async function myLikes() {
  const sb = await getClient();
  if (!sb) return new Set();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Set();
  const { data } = await sb.from('suggestion_likes').select('suggestion_id').eq('user_id', user.id);
  return new Set((data || []).map((r) => r.suggestion_id));
}

export async function like(suggestionId, on) {
  const sb = await getClient();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  if (on) {
    await sb.from('suggestion_likes').insert({ suggestion_id: suggestionId, user_id: user.id });
  } else {
    await sb.from('suggestion_likes').delete()
      .eq('suggestion_id', suggestionId).eq('user_id', user.id);
  }
}

export async function suggest(item, kind, topic, { toUser = null, note = '' } = {}) {
  const sb = await getClient();
  if (!sb) return { error: 'not signed in' };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'not signed in' };
  const { error } = await sb.from('suggestions').insert({
    from_user: user.id,
    to_user: toUser,
    item_id: item.id,
    kind,
    title: item.title,
    year: item.year || '',
    image: item.image || '',
    link: item.link || '',
    topic: topic || '',
    note: note ? note.slice(0, 280) : null,
  });
  return { error: error ? error.message : null };
}
