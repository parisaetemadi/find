# Find

> **Moved.** Find now lives in the `Personal` repo under `find/`, deployed by
> the Cloudflare project that already serves that dashboard, at
> `personal-b8d.pages.dev/find/`. One page did not justify a second Pages
> project. Edit it there; this repo is kept only as the original history.

Search in plain words — *“a film about a woman who leaves everything behind”* —
and get the movies and books that are actually about it, with somewhere to
watch or read each one, plus what other members are recommending.

No build step: plain HTML, CSS and ES modules, with one function for search.

## How a search works

| Step | What happens |
| --- | --- |
| 1. Sentence → query | `functions/api/_query.js` strips framing (“I want to watch…”), drops stopwords and keeps the subject words. Quoted text is kept whole. |
| 2. Index first | The browser asks Postgres (`search_items`) for anything already cached from earlier searches — instant, no round trip. |
| 3. Catalogues | `/api/discover` queries TMDB (or Apple's iTunes when no TMDB key is set) and Google Books, twice if the first pass comes back thin. |
| 4. Ranking | 65% how much of the ask a result matches, 35% a vote-weighted rating from the source catalogue, so a widely praised title beats an obscure one that matches equally well. Thin vote counts are pulled toward the middle (the IMDb Top-250 trick). |
| 5. Remember | Results are written back to `items`, so the index grows with use. |

Filters narrow what was found rather than changing the query: films or TV,
runtime band, book language, page count, and likely-translated. The last one is
a heuristic — Google Books has no translation field, so the publisher's blurb
is the only signal, hence "likely".

Nothing is scraped. Every link points at a service that licenses the work:
IMDb, JustWatch, Letterboxd, Goodreads, Open Library, Project Gutenberg and
the Internet Archive.

## Members

Everyone is pseudonymous: signing in with Google mints a handle like
`quiet-otter-418`, and the page never reads the name or email behind it.
Members can save things, pass a pick to one person or the whole board, and
like what others have passed on. The board is ranked by likes decayed with
age, so it keeps moving.

## Tests

```sh
node --test functions/api/_query.test.mjs
```
