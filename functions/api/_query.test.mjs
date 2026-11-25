// The sentence-to-query reduction is the part that can be quietly wrong:
// if it strips too much a search returns nothing, if it strips too little
// the catalogues match no titles at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, relevance } from './_query.js';

test('a bare topic is left alone', () => {
  const q = parseQuery('dune');
  assert.equal(q.primary, 'dune');
  assert.equal(q.isSentence, false);
});

test('a sentence is reduced to its subject words', () => {
  const q = parseQuery('I want to watch a movie about a woman who moves to Italy after a divorce');
  assert.equal(q.isSentence, true);
  assert.ok(/italy/.test(q.primary), q.primary);
  assert.ok(/divorce/.test(q.primary), q.primary);
  assert.ok(!/\bi\b|want|watch|movie/.test(q.primary), q.primary);
});

test('quoted text is kept as a phrase and wins', () => {
  const q = parseQuery('something like "The Leopard" but shorter');
  assert.equal(q.primary, 'The Leopard');
});

test('framing words never survive on their own', () => {
  const q = parseQuery('can you recommend books about grief and loss please');
  assert.ok(/grief/.test(q.primary) && /loss/.test(q.primary), q.primary);
  assert.ok(!/recommend|please|books/.test(q.primary), q.primary);
});

test('punctuation does not leak into the query', () => {
  assert.ok(!/[?!,]/.test(parseQuery('what are the best films about climate change?!').primary));
});

test('relevance counts how much of the ask a result answers', () => {
  const kw = ['italy', 'divorce'];
  const strong = relevance({ title: 'Divorce in Italy', blurb: '' }, kw);
  const weak = relevance({ title: 'Italy', blurb: '' }, kw);
  assert.ok(strong > weak);
  assert.equal(relevance({ title: 'Nothing' }, kw), 0);
});
