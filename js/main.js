// Find — wiring. Search on the left, the shared side (feed, board, likes)
// behind the tabs. Everything degrades: signed out, search and "where to
// watch" still work; only the social half needs an account.
import { configured, currentUser, signIn, signOut, onAuthChange } from './auth.js';
import { list as savedList, save, remove } from './store.js';
import * as hub from './community.js';
import { fromIndex, remember } from './index.js';

const $ = (id) => document.getElementById(id);
const status = $('status');

let me = null;            // { id, handle } once signed in
let savedIds = new Set();
let likedIds = new Set();
let lastTopic = '';
let pending = null;       // the item waiting in the suggest dialog

/* ------------------------------------------------------------------ util */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ------------------------------------------------------------------ rows */
function resultRow(item, kind) {
  const where = (item.where || []).map((w) =>
    `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.label)}</a>`).join('');
  const node = el(`
    <article class="row">
      <div class="cover">${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy">` : ''}</div>
      <div>
        <h3>${esc(item.title)}</h3>
        <p class="meta">${[item.author, item.year,
          item.rating ? `${item.rating}${item.votes ? ` · ${item.votes.toLocaleString()} votes` : ''}` : '',
          item.source].filter(Boolean).map(esc).join(' · ')}</p>
        ${item.blurb ? `<p class="blurb">${esc(item.blurb)}</p>` : ''}
        <div class="acts">${where}
          <button data-act="save">${savedIds.has(item.id) ? 'Saved' : 'Save'}</button>
          <button data-act="suggest">Suggest</button>
        </div>
      </div>
    </article>`);

  node.querySelector('[data-act="save"]').onclick = async (e) => {
    const on = savedIds.has(item.id);
    if (on) { savedIds.delete(item.id); await remove(me, item.id); } else {
      savedIds.add(item.id);
      await save(me, { item_id: item.id, kind, title: item.title, year: item.year || '',
        image: item.image || '', link: item.link || '', topic: lastTopic });
    }
    e.target.textContent = on ? 'Save' : 'Saved';
    e.target.classList.toggle('on', !on);
  };
  node.querySelector('[data-act="suggest"]').onclick = () => openSuggest(item, kind);
  return node;
}

function boardRow(s) {
  const liked = likedIds.has(s.id);
  const node = el(`
    <article class="row">
      <div class="cover">${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : ''}</div>
      <div>
        <h3>${esc(s.title)}</h3>
        <p class="meta">${[s.kind, s.year, s.topic && `on “${s.topic}”`,
          s.from_handle && `from ${s.from_handle}`].filter(Boolean).map(esc).join(' · ')}</p>
        ${s.note ? `<p class="note">“${esc(s.note)}”</p>` : ''}
        <div class="acts">
          ${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">Open</a>` : ''}
          <button data-act="like" class="${liked ? 'on' : ''}">${liked ? '♥' : '♡'} ${s.likes || 0}</button>
        </div>
      </div>
    </article>`);
  node.querySelector('[data-act="like"]').onclick = async (e) => {
    if (!me) return say('Sign in to vote.');
    const on = likedIds.has(s.id);
    if (on) likedIds.delete(s.id); else likedIds.add(s.id);
    s.likes = (s.likes || 0) + (on ? -1 : 1);
    e.target.textContent = `${on ? '♡' : '♥'} ${s.likes}`;
    e.target.classList.toggle('on', !on);
    await hub.like(s.id, !on);
  };
  return node;
}

const say = (t) => { status.textContent = t; };

/* ---------------------------------------------------------------- search */
async function search(raw) {
  const topic = raw.trim();
  if (!topic) return;
  lastTopic = topic;
  show('results');
  say(`Looking for “${topic}”…`);

  // The index first — instant when someone has asked something like this
  // before — then the catalogues, which also refresh what the index holds.
  const cached = await fromIndex(topic).catch(() => ({ movies: [], books: [] }));
  if (cached.movies.length || cached.books.length) {
    render(cached.movies, cached.books);
    say(`From the index: ${cached.movies.length} movies, ${cached.books.length} books. Checking for more…`);
  }

  try {
    const res = await fetch(`/api/discover?${new URLSearchParams({
      q: topic,
      type: $('f-type').value,
      len: $('f-len').value,
      lang: $('f-lang').value,
      pages: $('f-pages').value,
      translated: $('f-translated').checked ? '1' : '',
    })}`);
    const data = await res.json();
    render(data.movies, data.books);
    const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    say(data.movies.length + data.books.length
      ? `${count(data.movies.length, data.filters?.type === 'tv' ? 'show' : 'film')} and ${
          count(data.books.length, 'book')}${
          data.searched && data.searched !== topic ? ` for “${data.searched}”` : ''}.`
      : `Nothing for “${topic}” — try fewer words.`);
    remember(topic, data.movies, data.books);
  } catch (e) {
    if (!cached.movies.length && !cached.books.length) say('Search failed — try again in a moment.');
  }
  hub.logSearch(topic);
  history.replaceState(null, '', `?q=${encodeURIComponent(topic)}`);
}

function render(movies, books) {
  $('movies').replaceChildren(...movies.map((m) => resultRow(m, 'movie')));
  $('books').replaceChildren(...books.map((b) => resultRow(b, 'book')));
}

/* ------------------------------------------------------------------ tabs */
const PANES = ['results', 'ranking', 'feed', 'forme', 'saved'];
function show(name) {
  PANES.forEach((p) => { $(`pane-${p}`).hidden = p !== name; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  if (name === 'ranking') loadRanking();
  if (name === 'feed') loadFeed();
  if (name === 'forme') loadForMe();
  if (name === 'saved') loadSaved();
}

async function loadRanking() {
  const rows = await hub.board({ sort: 'score' });
  likedIds = await hub.myLikes();
  $('ranking').replaceChildren(...(rows.length
    ? rows.map(boardRow)
    : [el('<p class="empty">No suggestions yet — search something and pass one on.</p>')]));
}

async function loadFeed() {
  const rows = await hub.recentSearches();
  $('feed').replaceChildren(...(rows.length
    ? rows.map((r) => {
      const b = el(`<button><span class="topic">${esc(r.topic)}</span>
        <span class="handle"> ${esc(r.handle || 'someone')}</span></button>`);
      b.onclick = () => { $('q').value = r.topic; search(r.topic); };
      return b;
    })
    : [el('<p class="empty">No searches yet.</p>')]));
}

async function loadForMe() {
  if (!me) return $('forme').replaceChildren(el('<p class="empty">Sign in to see what people sent you.</p>'));
  const rows = await hub.board({ sort: 'created_at', toUser: me.id });
  likedIds = await hub.myLikes();
  $('forme').replaceChildren(...(rows.length
    ? rows.map(boardRow)
    : [el('<p class="empty">Nothing yet.</p>')]));
}

async function loadSaved() {
  const rows = await savedList(me);
  savedIds = new Set(rows.map((r) => r.item_id));
  $('saved').replaceChildren(...(rows.length
    ? rows.map((r) => {
      const node = el(`<article class="row">
        <div class="cover">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ''}</div>
        <div><h3>${esc(r.title)}</h3>
          <p class="meta">${esc([r.kind, r.year, r.topic].filter(Boolean).join(' · '))}</p>
          <div class="acts">${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">Open</a>` : ''}
            <button data-act="rm">Remove</button></div></div></article>`);
      node.querySelector('[data-act="rm"]').onclick = async () => {
        await remove(me, r.item_id); savedIds.delete(r.item_id); loadSaved();
      };
      return node;
    })
    : [el('<p class="empty">Nothing saved yet.</p>')]));
}

/* ------------------------------------------------------------- suggesting */
async function openSuggest(item, kind) {
  if (!me) return say('Sign in to suggest something.');
  pending = { item, kind };
  $('suggest-title').textContent = `Suggest “${item.title}”`;
  const people = (await hub.members()).filter((p) => p.id !== me.id);
  $('suggest-to').replaceChildren(
    el('<option value="">Everyone (the board)</option>'),
    ...people.map((p) => el(`<option value="${p.id}">${esc(p.handle)}</option>`)));
  $('suggest-note').value = '';
  $('suggest-dialog').showModal();
}

$('suggest-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'send' || !pending) return;
  const { error } = await hub.suggest(pending.item, pending.kind, lastTopic, {
    toUser: $('suggest-to').value || null,
    note: $('suggest-note').value.trim(),
  });
  say(error ? `Could not send: ${error}` : 'Sent.');
  pending = null;
});

/* ------------------------------------------------------------------ auth */
async function refreshAuth() {
  const user = configured ? await currentUser() : null;
  me = user ? await hub.myProfile() : null;
  $('sign-in').hidden = !configured || Boolean(user);
  $('sign-out').hidden = !user;
  $('handle').hidden = !me;
  if (me) $('handle').textContent = me.handle;
  savedIds = new Set((await savedList(me)).map((r) => r.item_id));
}

/* ------------------------------------------------------------------ boot */
$('search-form').addEventListener('submit', (e) => { e.preventDefault(); search($('q').value); });
// Changing a filter re-runs the last search rather than needing a second click.
document.getElementById('filters').addEventListener('change', () => {
  if (lastTopic) search(lastTopic);
});
$('tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) show(e.target.dataset.tab); });
$('sign-in').addEventListener('click', signIn);
$('sign-out').addEventListener('click', async () => { await signOut(); refreshAuth(); });
if (configured) onAuthChange(refreshAuth);

refreshAuth().then(() => {
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) { $('q').value = initial; search(initial); }
});
