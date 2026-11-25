// Turning what someone typed into something a catalogue search can answer.
//
// People type sentences: "a movie about a woman who moves to Italy after a
// divorce". Handing that to TMDB or Google Books whole returns nothing,
// because both match titles far better than descriptions. So the sentence is
// stripped down to the words that carry the subject, and the stripped version
// is what gets searched — alongside anything the user put in quotes, which is
// treated as a phrase they meant literally.

// Words that say how the question was asked rather than what it is about.
const STOP = new Set(`a an the and or but if then than that this these those of
in on at to for from with without about into over under again further once here
there when where why how all any both each few more most other some such no nor
not only own same so too very can will just do does did doing done is are was
were be been being have has had having i me my we our you your he him his she
her it its they them their what which who whom whose as by me show find give
want need looking look recommend recommendation recommendations suggest
suggestion please something anything stuff thing things kind sort like similar
good great best top favourite favorite new old watch watching read reading
movie movies film films cinema book books novel novels story stories read
about on featuring starring set during`.split(/\s+/));

// Phrases that are pure framing; removed before anything else.
const FILLER = [
  /\bi (?:am|'m)? ?(?:looking for|searching for|interested in|into)\b/g,
  /\b(?:can|could) you\b/g,
  /\bi (?:want|need|would like|'d like)(?: to)?(?: (?:see|read|watch|find|get))?\b/g,
  /\b(?:show|give|find) me\b/g,
  /\bwhat (?:are|is)\b/g,
  /\bare there any\b/g,
];

export function parseQuery(raw) {
  const original = String(raw || '').trim();

  // Quoted runs are kept whole and taken out before the rest is shredded.
  const phrases = [];
  const withoutQuotes = original.replace(/"([^"]{2,60})"/g, (_, p) => {
    phrases.push(p.trim());
    return ' ';
  });

  let text = withoutQuotes.toLowerCase();
  for (const re of FILLER) text = text.replace(re, ' ');
  text = text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ');

  const words = text.split(/\s+/).filter(Boolean);
  const keywords = [];
  for (const w of words) {
    if (w.length < 3 || STOP.has(w)) continue;
    if (!keywords.includes(w)) keywords.push(w);
  }

  // What is actually sent upstream. A short input goes through untouched —
  // "dune" should search for Dune, not be mangled. A sentence becomes its
  // keywords, longest (most specific) first, capped so the query stays legible.
  const isSentence = words.length > 4;
  const primary = phrases[0]
    || (isSentence
      ? keywords.slice().sort((a, b) => b.length - a.length).slice(0, 4).join(' ')
      : original);

  // A second, looser pass for when the first comes back thin.
  const fallback = isSentence
    ? keywords.slice(0, 2).join(' ') || primary
    : keywords.join(' ') || primary;

  return {
    original,
    primary: (primary || original).trim(),
    fallback: (fallback || original).trim(),
    keywords: phrases.concat(keywords),
    isSentence,
  };
}

// How well a result answers what was asked: how many of the asked-for words
// show up in its title and blurb. Used to re-rank the merged list, so a
// sentence search puts the thing that matches most of the sentence on top.
export function relevance(item, keywords) {
  if (!keywords.length) return 0;
  const hay = `${item.title || ''} ${item.blurb || ''} ${item.author || ''}`.toLowerCase();
  let hits = 0;
  for (const k of keywords) if (hay.includes(k.toLowerCase())) hits += 1;
  return hits / keywords.length;
}
