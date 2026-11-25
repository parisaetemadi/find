-- A local index that grows from real searches: every result the catalogues
-- return is cached here, so a repeated or near-miss search is answered from
-- our own full-text index instead of a round trip. It is the legal shape of
-- "crawl everything" — the catalogues are queried once per new thing and the
-- answer is kept, rather than scraping sites that forbid it.
create table if not exists items (
  id text primary key,
  kind text not null check (kind in ('movie','book')),
  title text not null,
  author text, year text, blurb text, image text, link text, rating text,
  votes int default 0,
  credibility real default 0,
  source text,
  topics text[] default '{}',
  seen_count int default 1,
  updated_at timestamptz default now()
);
alter table items enable row level security;
create policy "items are public" on items for select using (true);
create policy "signed in may index" on items for insert to authenticated with check (true);
create policy "signed in may refresh" on items for update to authenticated using (true) with check (true);

create index if not exists items_fts on items
  using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(author,'') || ' ' || coalesce(blurb,'')));
create index if not exists items_topics on items using gin (topics);

create or replace function search_items(q text, want_kind text default null, lim int default 12)
returns setof items language sql stable as $$
  select * from items
  where (want_kind is null or kind = want_kind)
    and to_tsvector('english', coalesce(title,'') || ' ' || coalesce(author,'') || ' ' || coalesce(blurb,''))
        @@ plainto_tsquery('english', q)
  order by ts_rank(
      to_tsvector('english', coalesce(title,'') || ' ' || coalesce(author,'') || ' ' || coalesce(blurb,'')),
      plainto_tsquery('english', q)) * 0.65 + credibility * 0.35 desc,
    votes desc
  limit lim;
$$;
