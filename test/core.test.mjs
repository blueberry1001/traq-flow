import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings, channelPost, within, mergeContent, visualPair } from '../src/core.js';
const cid = '11111111-1111-1111-1111-111111111111';
const now = Date.parse('2026-09-18T08:00:30Z');
const message = { id: 'm1', channelId: cid, userId: 'me', content: '最初', createdAt: '2026-09-18T08:00:00Z' };
const merge = (m = message, body = { content: '続き' }, time = now, recent) => mergeContent(m, 'me', cid, body, 60, time, recent);
test('settings validate and clamp persisted values', () => {
  assert.deepEqual(settings(null), { own: true, visual: true, hover: false, seconds: 60 });
  assert.equal(settings({ own: false, seconds: 30 }).hover, false);
  assert.equal(settings({ hover: true }).hover, true);
  assert.equal(settings({ hover: 'true' }).hover, false);
  assert.equal(settings({ seconds: Infinity }).seconds, 60);
  assert.equal(settings({ seconds: -20 }).seconds, 1);
  assert.equal(settings({ seconds: 1000 }).seconds, 600);
  assert.equal(settings({ seconds: '10' }).seconds, 60);
  assert.equal(settings({ own: false }).own, false);
});
test('only exact same-origin channel POSTs are intercepted', () => {
  const url = `/api/v3/channels/${cid}/messages`;
  assert.equal(channelPost('POST', url, 'https://q.trap.jp'), cid);
  for (const [method, path] of [['PUT', url], ['POST', url + '?embed=true'], ['POST', 'https://evil.test' + url], ['POST', '/api/v3/users/me/messages']])
    assert.equal(channelPost(method, path, 'https://q.trap.jp'), undefined);
});
test('threshold includes exact boundary, excludes future and invalid dates', () => {
  assert.ok(within(message.createdAt, '2026-09-18T08:01:00Z', 60));
  assert.ok(!within(message.createdAt, '2026-09-18T08:01:00.001Z', 60));
  assert.ok(!within(message.createdAt, '2026-09-18T07:59:59Z', 60));
  assert.ok(!within('invalid', message.createdAt, 60));
});
test('append preserves markdown and attachment URLs verbatim', () => {
  assert.equal(merge(), '最初\n続き');
  assert.equal(merge(message, { content: 'https://q.trap.jp/files/abc' }), '最初\nhttps://q.trap.jp/files/abc');
});
test('another author, channel, pin, missing or stale target stays a new post', () => {
  for (const m of [null, { ...message, userId: 'other' }, { ...message, channelId: 'other' }, { ...message, pinned: true }, { ...message, createdAt: '2020-01-01' }]) assert.equal(merge(m), null);
});
test('unsupported payload semantics and empty content stay untouched', () => {
  for (const b of [null, { content: '' }, { content: ' ' }, { content: 'hi', embed: true }, { content: 'hi', nonce: 'n' }, { content: 123 }]) assert.equal(merge(message, b), null);
});
test('10000 Unicode codepoints, not UTF-16 units', () => {
  assert.equal([...merge({ ...message, content: '😀'.repeat(9998) }, { content: 'a' })].length, 10000);
  assert.equal(merge({ ...message, content: '😀'.repeat(9999) }, { content: 'a' }), null);
});
test('our confirmed append extends the sliding window only for matching content', () => {
  const later = now + 90000;
  const recent = { id: message.id, content: message.content, time: new Date(later - 10000).toISOString() };
  assert.equal(merge(message, { content: '続き' }, later, recent), '最初\n続き');
  assert.equal(merge(message, { content: '続き' }, later, { ...recent, content: 'external edit' }), null);
});
test('visual groups require adjacent author/channel/time and no special state', () => {
  const next = { ...message, createdAt: '2026-09-18T08:00:20Z' };
  assert.ok(visualPair(message, next, 60));
  for (const b of [{ ...next, userId: 'x' }, { ...next, channelId: 'x' }, { ...next, special: true }, { ...next, createdAt: '2026-09-18T08:05:00Z' }]) assert.ok(!visualPair(message, b, 60));
});
