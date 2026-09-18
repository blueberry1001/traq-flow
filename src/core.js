export const defaults = Object.freeze({ own: true, visual: true, seconds: 60 });
export function settings(value) {
  return {
    own: typeof value?.own === 'boolean' ? value.own : defaults.own,
    visual: typeof value?.visual === 'boolean' ? value.visual : defaults.visual,
    seconds: Number.isFinite(value?.seconds) ? Math.max(1, Math.min(600, Math.round(value.seconds))) : defaults.seconds
  };
}
export function channelPost(method, url, origin) {
  const u = new URL(url, origin);
  return method.toUpperCase() === 'POST' && u.origin === origin && !u.search
    ? u.pathname.match(/^\/api\/v3\/channels\/([0-9a-f-]{36})\/messages$/i)?.[1] : undefined;
}
export function within(a, b, seconds) {
  const gap = Date.parse(b) - Date.parse(a);
  return Number.isFinite(gap) && gap >= 0 && gap <= seconds * 1000;
}
export function mergeContent(latest, me, channel, body, seconds, now, lastAppend) {
  if (!latest || latest.userId !== me || latest.channelId !== channel || latest.pinned) return null;
  if (!body || typeof body.content !== 'string' || !body.content.trim() ||
      Object.keys(body).some(k => k !== 'content')) return null;
  if (typeof latest.content !== 'string') return null;
  const time = lastAppend?.id === latest.id && lastAppend.content === latest.content
    ? lastAppend.time : latest.createdAt;
  if (!within(time, new Date(now).toISOString(), seconds)) return null;
  const joined = latest.content + '\n' + body.content;
  return [...joined].length <= 10000 ? joined : null;
}
export function visualPair(a, b, seconds) {
  return !!a && !!b && a.userId === b.userId && a.channelId === b.channelId &&
    !a.special && !b.special && within(a.createdAt, b.createdAt, seconds);
}
