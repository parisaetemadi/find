-- Discover: anonymous profiles, a public search feed, suggestions between
-- users, likes and a ranking.
--
-- "Anonymous" here means pseudonymous: everyone gets a generated handle
-- (quiet-otter-418) and nothing else about them is ever exposed. Email and
-- name stay in auth.users, which no client policy here can read.

-- ---------------------------------------------------------------- profiles
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text unique not null,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "profiles are public" on profiles for select using (true);
create policy "own profile write" on profiles for update using (auth.uid() = id);

-- A handle nobody can trace back: two words and a number, retried on collision.
create or replace function gen_handle() returns text language plpgsql as $$
declare
  adjectives text[] := array['quiet','amber','slow','bright','soft','odd','late',
    'north','wild','salt','paper','glass','velvet','low','far'];
  nouns text[] := array['otter','finch','cedar','comet','harbor','ember','willow',
    'falcon','marble','lantern','river','orchid','badger','kestrel','monsoon'];
  candidate text;
begin
  for i in 1..30 loop
    candidate := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
      || '-' || nouns[1 + floor(random() * array_length(nouns, 1))::int]
      || '-' || lpad(floor(random() * 1000)::text, 3, '0');
    if not exists (select 1 from profiles where handle = candidate) then
      return candidate;
    end if;
  end loop;
  return 'member-' || substr(md5(random()::text), 1, 8);
end $$;

-- Every new sign-in gets a profile without the client having to ask for one.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, handle) values (new.id, gen_handle())
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------- searches
-- The public feed. Topics only — never which results someone opened.
create table if not exists searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade default auth.uid(),
  topic text not null check (char_length(topic) between 1 and 120),
  created_at timestamptz default now()
);
alter table searches enable row level security;
create policy "searches are public" on searches for select using (true);
create policy "own searches insert" on searches for insert with check (auth.uid() = user_id);
create policy "own searches delete" on searches for delete using (auth.uid() = user_id);
create index if not exists searches_recent on searches (created_at desc);

-- ------------------------------------------------------------ saved items
create table if not exists saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade default auth.uid(),
  item_id text not null,
  kind text not null check (kind in ('movie','book')),
  title text, year text, image text, link text, topic text,
  created_at timestamptz default now(),
  unique (user_id, item_id)
);
alter table saved_items enable row level security;
create policy "own saved rows" on saved_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------- suggestions
-- A pick one member passes on. to_user null means it goes to everyone.
create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  from_user uuid references auth.users on delete cascade default auth.uid(),
  to_user uuid references auth.users on delete cascade,
  item_id text not null,
  kind text not null check (kind in ('movie','book')),
  title text not null, year text, image text, link text, topic text,
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz default now()
);
alter table suggestions enable row level security;
create policy "suggestions are public" on suggestions for select using (true);
create policy "own suggestions insert" on suggestions for insert with check (auth.uid() = from_user);
create policy "own suggestions delete" on suggestions for delete using (auth.uid() = from_user);
create index if not exists suggestions_recent on suggestions (created_at desc);
create index if not exists suggestions_to on suggestions (to_user);

-- ------------------------------------------------------------------- likes
create table if not exists suggestion_likes (
  suggestion_id uuid references suggestions on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  created_at timestamptz default now(),
  primary key (suggestion_id, user_id)
);
alter table suggestion_likes enable row level security;
create policy "likes are public" on suggestion_likes for select using (true);
create policy "own like insert" on suggestion_likes for insert with check (auth.uid() = user_id);
create policy "own like delete" on suggestion_likes for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------- ranking
-- Hacker News gravity: a suggestion's score decays with age, so a week-old
-- favourite does not sit on top of the board forever.
create or replace view suggestion_board as
select
  s.*,
  p.handle as from_handle,
  coalesce(l.likes, 0) as likes,
  (coalesce(l.likes, 0) + 1)
    / power((extract(epoch from (now() - s.created_at)) / 3600.0) + 2, 1.5) as score
from suggestions s
left join profiles p on p.id = s.from_user
left join (
  select suggestion_id, count(*)::int as likes
  from suggestion_likes group by suggestion_id
) l on l.suggestion_id = s.id;

-- The feed of what people are looking for, with the handle attached.
create or replace view search_feed as
select s.id, s.topic, s.created_at, p.handle, s.user_id
from searches s left join profiles p on p.id = s.user_id
order by s.created_at desc;
