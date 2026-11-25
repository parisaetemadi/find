// Topic search for the Discover page: one request in, movies and books out,
// each with places to actually watch or read it.
//
// Both upstreams are called server-side rather than from the browser. That
// keeps the TMDB key (if one is set) off the page, and it sidesteps CORS on
// the iTunes fallback, which is the only keyless movie catalogue worth using.
//
// Movies: TMDB when env.TMDB_KEY exists, otherwise Apple's iTunes search.
// Books:  Google Books, which needs no key.
//
// What someone types is rarely a bare topic, so _query.js reduces a sentence
// to its subject words first and the results are re-ranked against them.
import { parseQuery, relevance } from './_query.js';

// How much a result's rating should count for. A 9.0 from twelve people is
// not a 9.0 from forty thousand, so each score is pulled toward the middle in
// proportion to how thin its vote count is (a Bayesian prior, the same trick
// IMDb's Top 250 uses). Catalogues that publish no ratings at all score 0 and
// are ordered by how well they match instead.
function credibility(rating, votes) {
  const r = Number(rating);
  const v = Number(votes) || 0;
  if (!r) return 0;
  const PRIOR_VOTES = 50;   // votes needed before a score is taken at face value
  const PRIOR_SCORE = 0.6;  // what an unproven title is assumed to be worth
  return ((v * (r / 10)) + (PRIOR_VOTES * PRIOR_SCORE)) / (v + PRIOR_VOTES);
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=600',
};

function ok(body) {
  return new Response(JSON.stringify(body), { headers: JSON_HEADERS });
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'personal-dashboard' } });
  if (!res.ok) throw new Error(`${res.status} ${new URL(url).host}`);
  return res.json();
}

// Where to watch / where to read. These are search links into services that
// license the work — JustWatch covers every subscription and rental service in
// a country at once, and for books the free links are the public-domain
// archives. Nothing here points at an unlicensed copy.
function watchLinks(title, year) {
  const q = encodeURIComponent(`${title} ${year || ''}`.trim());
  return [
    { label: 'IMDb', url: `https://www.imdb.com/find/?q=${q}&s=tt` },
    { label: 'Where to stream', url: `https://www.justwatch.com/us/search?q=${q}` },
    { label: 'Letterboxd', url: `https://letterboxd.com/search/${q}/` },
    { label: 'Free (Archive.org)', url: `https://archive.org/search?query=${q}&and[]=mediatype%3A%22movies%22` },
  ];
}

function readLinks(title, author, previewLink) {
  const q = encodeURIComponent(`${title} ${author || ''}`.trim());
  const links = [
    { label: 'Goodreads', url: `https://www.goodreads.com/search?q=${q}` },
    { label: 'Borrow (Open Library)', url: `https://openlibrary.org/search?q=${q}` },
    { label: 'Free (Gutenberg)', url: `https://www.gutenberg.org/ebooks/search/?query=${q}` },
    { label: 'Free (Archive.org)', url: `https://archive.org/search?query=${q}&and[]=mediatype%3A%22texts%22` },
  ];
  if (previewLink) links.unshift({ label: 'Preview', url: previewLink });
  return links;
}

async function moviesFromTMDB(q, key, kind = 'movie') {
  const path = kind === 'tv' ? 'tv' : 'movie';
  const url = `https://api.themoviedb.org/3/search/${path}?api_key=${key}`
    + `&query=${encodeURIComponent(q)}&include_adult=false&page=1`;
  const data = await getJSON(url);
  return (data.results || []).map((m) => ({
    id: `tmdb-${path}-${m.id}`,
    title: m.title || m.name,
    year: (m.release_date || m.first_air_date || '').slice(0, 4),
    blurb: m.overview || '',
    image: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : '',
    rating: m.vote_average ? m.vote_average.toFixed(1) : '',
    votes: m.vote_count || 0,
    credibility: credibility(m.vote_average, m.vote_count),
    source: 'TMDB',
    minutes: 0, // filled in by withRuntimes() only when a length filter asks
    tmdbId: m.id,
    tmdbKind: path,
    link: `https://www.themoviedb.org/${path}/${m.id}`,
    where: watchLinks(m.title || m.name, (m.release_date || m.first_air_date || '').slice(0, 4)),
  }));
}

// Runtime is not in TMDB's search payload, so it is fetched per title — and
// only when someone actually filters by length, since it costs one request
// each.
async function withRuntimes(items, key) {
  const detailed = await Promise.all(items.map(async (it) => {
    if (!it.tmdbId) return it;
    try {
      const d = await getJSON(`https://api.themoviedb.org/3/${it.tmdbKind}/${it.tmdbId}?api_key=${key}`);
      const mins = it.tmdbKind === 'tv'
        ? (d.episode_run_time || [])[0] || 0
        : d.runtime || 0;
      return { ...it, minutes: mins };
    } catch (e) {
      return it;
    }
  }));
  return detailed;
}

async function moviesFromITunes(q, kind = 'movie') {
  const media = kind === 'tv' ? 'tvShow' : 'movie';
  const url = `https://itunes.apple.com/search?media=${media}&limit=25&term=`
    + encodeURIComponent(q);
  const data = await getJSON(url);
  return (data.results || []).map((m) => ({
    id: `itunes-${m.trackId}`,
    title: m.trackName,
    year: (m.releaseDate || '').slice(0, 4),
    blurb: m.longDescription || m.shortDescription || '',
    image: (m.artworkUrl100 || '').replace('100x100', '400x400'),
    minutes: Math.round((m.trackTimeMillis || 0) / 60000),
    rating: '',
    votes: 0,
    credibility: 0,
    source: 'iTunes',
    link: m.trackViewUrl || '',
    where: watchLinks(m.trackName, (m.releaseDate || '').slice(0, 4)),
  }));
}

async function booksFrom(q, lang = '') {
  const url = 'https://www.googleapis.com/books/v1/volumes?maxResults=25&orderBy=relevance'
    + (lang ? `&langRestrict=${encodeURIComponent(lang)}` : '')
    + '&q=' + encodeURIComponent(q);
  const data = await getJSON(url);
  return (data.items || []).map((b) => {
    const v = b.volumeInfo || {};
    const img = (v.imageLinks || {}).thumbnail || '';
    const author = (v.authors || []).join(', ');
    return {
      id: `gb-${b.id}`,
      title: v.title || 'Untitled',
      author,
      year: (v.publishedDate || '').slice(0, 4),
      blurb: v.description || '',
      image: img.replace('http://', 'https://'),
      rating: v.averageRating ? String(v.averageRating) : '',
      votes: v.ratingsCount || 0,
      // Google Books rates out of 5; credibility() expects a ten-point scale.
      credibility: credibility(v.averageRating * 2, v.ratingsCount),
      source: 'Google Books',
      pages: v.pageCount || 0,
      language: v.language || '',
      // Google Books has no "is a translation" field. The honest proxy is the
      // publisher's own blurb, which nearly always says so when it matters;
      // the page labels this filter "likely translated" for that reason.
      translated: /translat(ed|ion)/i.test(`${v.description || ''} ${v.subtitle || ''}`),
      link: v.infoLink || `https://books.google.com/books?id=${b.id}`,
      where: readLinks(v.title, author, v.previewLink),
    };
  });
}

function merge(lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const item of list) if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

// Two passes: the tightened query, then a looser one if that came back thin.
// Everything is merged, scored against the asked-for words and cut to 12.
async function gather(fetcher, parsed, cap = 12) {
  const first = await fetcher(parsed.primary).catch(() => []);
  let all = first;
  if (first.length < 6 && parsed.fallback && parsed.fallback !== parsed.primary) {
    all = merge([first, await fetcher(parsed.fallback).catch(() => [])]);
  }
  // What comes out on top has to be both about the thing asked for and well
  // regarded where the ratings are real: match first, then the vote-weighted
  // score from the catalogue, so a widely praised title outranks an obscure
  // one that matches equally well.
  return all
    .map((item) => ({
      item,
      score: (relevance(item, parsed.keywords) * 0.65) + ((item.credibility || 0) * 0.35),
    }))
    .sort((a, b) => (b.score - a.score) || ((b.item.votes || 0) - (a.item.votes || 0)))
    .slice(0, cap)
    .map(({ item, score }) => ({ ...item, score: Number(score.toFixed(3)) }));
}

// Length buckets, in minutes for screen and pages for print. A filter narrows
// what was found rather than changing the query, so turning one off and on
// does not reshuffle everything underneath it.
const SCREEN_LENGTH = {
  short: (m) => m > 0 && m <= 45,
  standard: (m) => m > 45 && m <= 120,
  long: (m) => m > 120,
};
const BOOK_LENGTH = {
  short: (p) => p > 0 && p <= 200,
  medium: (p) => p > 200 && p <= 450,
  long: (p) => p > 450,
};

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const raw = (params.get('q') || '').trim();
  if (!raw) return ok({ topic: '', movies: [], books: [] });

  const kind = params.get('type') === 'tv' ? 'tv' : 'movie';     // movie | tv
  const screenLen = params.get('len') || '';                      // short|standard|long
  const lang = params.get('lang') || '';                          // ISO code, e.g. en
  const bookLen = params.get('pages') || '';                      // short|medium|long
  const translatedOnly = params.get('translated') === '1';

  const parsed = parseQuery(raw);
  const key = env && env.TMDB_KEY;
  const movieFetcher = key
    ? (q) => moviesFromTMDB(q, key, kind)
    : (q) => moviesFromITunes(q, kind);

  // One dead upstream should not blank the other half of the page.
  const [m, b] = await Promise.allSettled([
    gather(movieFetcher, parsed, 24),
    gather((q) => booksFrom(q, lang), parsed, 24),
  ]);

  let movies = m.status === 'fulfilled' ? m.value : [];
  let books = b.status === 'fulfilled' ? b.value : [];

  if (screenLen && SCREEN_LENGTH[screenLen]) {
    // TMDB only knows a runtime once the title is fetched in full.
    if (key) movies = await withRuntimes(movies, key);
    const fits = SCREEN_LENGTH[screenLen];
    const known = movies.filter((x) => x.minutes > 0);
    // If no runtime is known at all (iTunes sometimes omits it), keep the list
    // rather than showing an empty page for a filter we cannot honour.
    if (known.length) movies = known.filter((x) => fits(x.minutes));
  }

  if (bookLen && BOOK_LENGTH[bookLen]) {
    const fits = BOOK_LENGTH[bookLen];
    const known = books.filter((x) => x.pages > 0);
    if (known.length) books = known.filter((x) => fits(x.pages));
  }
  if (translatedOnly) {
    const t = books.filter((x) => x.translated);
    if (t.length) books = t;
  }

  return ok({
    topic: raw,
    searched: parsed.primary,
    keywords: parsed.keywords,
    filters: { type: kind, len: screenLen, lang, pages: bookLen, translated: translatedOnly },
    source: key ? 'tmdb' : 'itunes',
    movies: movies.slice(0, 12),
    books: books.slice(0, 12),
  });
}
