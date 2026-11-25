// Where a saved pick lives: a Supabase table when someone is signed in, the
// browser otherwise. Same shape either way, so the UI never has to ask.
//
// Expected table (run once in the Supabase SQL editor):
//
//   create table saved_items (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid references auth.users not null default auth.uid(),
//     item_id text not null,
//     kind text not null,
//     title text,
//     year text,
//     image text,
//     link text,
//     topic text,
//     created_at timestamptz default now(),
//     unique (user_id, item_id)
//   );
//   alter table saved_items enable row level security;
//   create policy "own rows" on saved_items for all
//     using (auth.uid() = user_id) with check (auth.uid() = user_id);
import { getClient } from './auth.js';

const LOCAL_KEY = 'discover_saved';

function local() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function writeLocal(rows) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
  } catch (e) { /* private mode — the list is simply not kept */ }
}

export async function list(user) {
  if (!user) return local();
  const sb = await getClient();
  const { data, error } = await sb
    .from('saved_items').select('*').order('created_at', { ascending: false });
  if (error) return local();
  return data;
}

export async function save(user, item) {
  if (!user) {
    const rows = local();
    if (!rows.some((r) => r.item_id === item.item_id)) writeLocal([item, ...rows]);
    return;
  }
  const sb = await getClient();
  await sb.from('saved_items').upsert({ ...item, user_id: user.id }, { onConflict: 'user_id,item_id' });
}

export async function remove(user, itemId) {
  if (!user) {
    writeLocal(local().filter((r) => r.item_id !== itemId));
    return;
  }
  const sb = await getClient();
  await sb.from('saved_items').delete().eq('item_id', itemId);
}
