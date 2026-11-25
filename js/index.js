// The local index: results the catalogues have already returned, cached in
// Postgres with a full-text index over them. A search looks here first, so a
// topic someone else already asked about comes back without a round trip, and
// the catalogues are only called for what has never been seen.
//
// This is the honest version of "crawl everything": nothing is scraped from
// sites that forbid it — the index is built from the licensed APIs' own
// answers, and it grows with use.
import { getClient } from './auth.js';

export async function fromIndex(query, limit = 12) {
  const sb = await getClient();
  if (!sb || !query) return { movies: [], books: [] };
  const [m, b] = await Promise.all([
    sb.rpc('search_items', { q: query, want_kind: 'movie', lim: limit }),
    sb.rpc('search_items', { q: query, want_kind: 'book', lim: limit }),
  ]);
  return { movies: toItems(m.data), books: toItems(b.data) };
}

function toItems(rows) {
  return (rows || []).map((r) => ({ ...r, where: r.where || [] }));
}

// Fire-and-forget: a search that hit the catalogues feeds the index for
// everyone after. Only members can write, which is what keeps it clean.
export async function remember(topic, movies, books) {
  const sb = await getClient();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const rows = [...movies.map((m) => row(m, 'movie', topic)),
    ...books.map((b) => row(b, 'book', topic))];
  if (rows.length) await sb.from('items').upsert(rows, { onConflict: 'id' });
}

function row(item, kind, topic) {
  return {
    id: item.id, kind, title: item.title, author: item.author || null,
    year: item.year || null, blurb: item.blurb || null, image: item.image || null,
    link: item.link || null, rating: item.rating || null, votes: item.votes || 0,
    credibility: item.credibility || 0, source: item.source || null,
    topics: topic ? [topic.toLowerCase().slice(0, 120)] : [],
    updated_at: new Date().toISOString(),
  };
}
