if (window.top !== window || window.__traqFlowInstalled) return;
window.__traqFlowInstalled = true;
const KEY = 'traq-flow.settings.v1';
const nativeFetch = window.fetch.bind(window);
const proto = XMLHttpRequest.prototype;
const native = { open: proto.open, send: proto.send, header: proto.setRequestHeader, abort: proto.abort };
const requests = new WeakMap();
const recent = new Map(); // Never persist message contents.
let config = loadSettings();
let status = '待機中';
let statusNode;
let skipOnce = false;
// Capture before traQ's router changes the initial URL.
const settingsRequested = new URL(location.href).searchParams.get('traq-flow-settings') === '1';
function loadSettings() {
  try { return settings(JSON.parse(localStorage.getItem(KEY))); } catch { return settings(); }
}
function announce(value) { status = value; if (statusNode) statusNode.textContent = value; }
async function read(path, signal) {
  const response = await nativeFetch(path, {
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])
  });
  if (!response.ok) throw new Error(`traQ API ${response.status}`);
  return response.json();
}
async function plan(channel, body, signal) {
  if (!config.own || skipOnce) { skipOnce = false; return null; }
  let payload;
  try { payload = JSON.parse(body); } catch { return null; }
  if (!payload || Object.keys(payload).some(k => k !== 'content')) return null;
  try {
    const [me, messages] = await Promise.all([
      read('/api/v3/users/me', signal),
      read(`/api/v3/channels/${channel}/messages?limit=1&order=desc`, signal)
    ]);
    const latest = messages[0];
    const content = mergeContent(latest, me.id, channel, payload, config.seconds, Date.now(), recent.get(channel));
    if (content === null) return null;
    // Re-read both identity of latest post and target content immediately before editing.
    const [fresh, tail] = await Promise.all([
      read(`/api/v3/messages/${latest.id}`, signal),
      read(`/api/v3/channels/${channel}/messages?limit=1&order=desc`, signal)
    ]);
    if (tail[0]?.id !== latest.id || fresh.content !== latest.content ||
        fresh.updatedAt !== latest.updatedAt || fresh.pinned || fresh.userId !== me.id ||
        fresh.channelId !== channel) return null;
    const finalContent = mergeContent(fresh, me.id, channel, payload, config.seconds, Date.now(), recent.get(channel));
    return finalContent === null ? null : { id: latest.id, content: finalContent };
  } catch (error) {
    if (signal.aborted) throw error;
    announce('最新情報を確認できないため、通常の新規投稿にします');
    return null; // No write has happened yet: ordinary posting is safe.
  }
}
function lock(channel, signal, task) {
  // Without cross-tab serialization, deliberately preserve ordinary sending.
  if (!navigator.locks) return task(false);
  return navigator.locks.request(`traq-flow:${channel}`, { signal }, () => task(true));
}
proto.open = function(method, url, ...args) {
  const previous = requests.get(this);
  previous?.controller?.abort();
  requests.set(this, { method, url, args, headers: [], controller: new AbortController() });
  return native.open.call(this, method, url, ...args);
};
proto.setRequestHeader = function(name, value) {
  const result = native.header.call(this, name, value);
  requests.get(this)?.headers.push([name, value]);
  return result;
};
proto.abort = function() {
  const state = requests.get(this);
  state?.controller.abort();
  const pending = state?.preparing;
  if (state) state.preparing = false;
  const result = native.abort.call(this);
  if (pending) {
    this.dispatchEvent(new ProgressEvent('abort'));
    this.dispatchEvent(new ProgressEvent('loadend'));
  }
  return result;
};
proto.send = function(body) {
  const state = requests.get(this);
  const channel = state && channelPost(state.method, state.url, location.origin);
  if (!channel || state.args[0] === false || typeof body !== 'string' || !config.own || !navigator.locks)
    return native.send.call(this, body);
  if (state.preparing) throw new DOMException('Already sending', 'InvalidStateError');
  state.preparing = true;
  const xhr = this;
  void lock(channel, state.controller.signal, async () => {
    const edit = await plan(channel, body, state.controller.signal);
    if (state.controller.signal.aborted || requests.get(xhr) !== state) return;
    const timeout = xhr.timeout;
    const responseType = xhr.responseType;
    const withCredentials = xhr.withCredentials;
    if (edit) {
      native.open.call(xhr, 'PUT', `/api/v3/messages/${edit.id}`, ...state.args);
      xhr.timeout = timeout; xhr.responseType = responseType; xhr.withCredentials = withCredentials;
      for (const [name, value] of state.headers) native.header.call(xhr, name, value);
    }
    state.preparing = false;
    await new Promise((resolve, reject) => {
      const done = () => {
        xhr.removeEventListener('loadend', done);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (edit) {
            recent.set(channel, { ...edit, time: new Date().toISOString() });
            announce('直近のメッセージに追記しました');
          } else { recent.delete(channel); announce('新規メッセージを送信しました'); }
        } else {
          recent.delete(channel);
          announce('送信を確認できません。入力欄と履歴を確認してください');
        }
        resolve();
      };
      xhr.addEventListener('loadend', done);
      try { native.send.call(xhr, edit ? JSON.stringify({ content: edit.content }) : body); }
      catch (error) { xhr.removeEventListener('loadend', done); reject(error); }
    });
  }).catch(() => {
    if (state.controller.signal.aborted) return;
    state.preparing = false;
    announce('送信処理に失敗しました。入力欄を確認してください');
    xhr.dispatchEvent(new ProgressEvent('error'));
    xhr.dispatchEvent(new ProgressEvent('loadend'));
  });
};
window.fetch = async function(input, init) {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const url = input instanceof Request ? input.url : input;
  const channel = channelPost(method, url, location.origin);
  if (!channel || !config.own || !navigator.locks) return nativeFetch(input, init);
  const request = new Request(input, init);
  return lock(channel, request.signal, async () => {
    const body = await request.clone().text();
    const edit = await plan(channel, body, request.signal);
    let response;
    try {
      response = edit ? await nativeFetch(`/api/v3/messages/${edit.id}`, {
        method: 'PUT', headers: request.headers, body: JSON.stringify({ content: edit.content }),
        credentials: request.credentials, signal: request.signal
      }) : await nativeFetch(request);
    } catch (error) {
      recent.delete(channel);
      announce('送信結果が不明です。再送前に履歴を確認してください');
      throw error; // Never retry a possibly committed write as a new post.
    }
    if (response.ok && edit) {
      recent.set(channel, { ...edit, time: new Date().toISOString() });
      announce('直近のメッセージに追記しました');
    } else { recent.delete(channel); announce(response.ok ? '新規メッセージを送信しました' : '送信に失敗しました'); }
    return response;
  });
};

// The root container's _vnode exists in production Vue. Do not depend on
// __vueParentComponent or setupState, which may be absent in production builds.
function walk(vnode, visit, seen = new Set()) {
  if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return;
  seen.add(vnode);
  visit(vnode);
  if (vnode.component) walk(vnode.component.subTree, visit, seen);
  if (Array.isArray(vnode.children)) for (const child of vnode.children) walk(child, visit, seen);
  if (vnode.suspense) walk(vnode.suspense.activeBranch, visit, seen);
}
function collectRows(root) {
  const rows = new Map();
  walk(root, node => {
    const component = node.component;
    if (component?.type?.__name !== 'MessageElement') return;
    const element = component.subTree?.el;
    if (!(element instanceof HTMLElement) || !element.parentElement?.matches('[data-testid="channel-viewport"]')) return;
    let header;
    walk(component.subTree, child => {
      if (child.component?.type?.__name === 'MessageHeader') header = child.component.props;
    });
    if (!header?.userId || !header.createdAt) return;
    rows.set(element, {
      userId: header.userId, createdAt: header.createdAt,
      channelId: element.parentElement,
      special: ['data-is-pinned', 'data-is-entry', 'data-is-editing'].some(a => element.hasAttribute(a))
    });
  });
  return rows;
}
function refreshVisual() {
  document.documentElement.classList.toggle('tqf-hover-enabled', config.hover);
  const root = document.querySelector('#app')?._vnode;
  const rows = config.visual && root ? collectRows(root) : new Map();
  const desired = new Set();
  for (const [element, current] of rows) {
    const previous = rows.get(element.previousElementSibling);
    if (visualPair(previous, current, config.seconds)) desired.add(element);
  }
  for (const element of document.querySelectorAll('.tqf-continuation')) {
    if (!desired.has(element)) element.classList.remove('tqf-continuation');
  }
  for (const element of desired) if (!element.classList.contains('tqf-continuation')) element.classList.add('tqf-continuation');
}
function mount() {
  const style = document.createElement('style');
  style.textContent = `
    .tqf-continuation { padding-top: 1px !important; margin-top: 0 !important; }
    .tqf-continuation > [class*="messageContents"] > [class*="userIcon"] { visibility: hidden; }
    .tqf-continuation > [class*="messageContents"] > [class*="messageHeader"] { display: none; }
    .tqf-continuation > [class*="messageContents"] { grid-template-rows: 0 auto 1fr !important; }
    .tqf-hover-enabled .tqf-continuation:hover > [class*="messageContents"] > [class*="messageHeader"],
    .tqf-hover-enabled .tqf-continuation:focus-within > [class*="messageContents"] > [class*="messageHeader"] { display: inline-flex; }
    .tqf-hover-enabled .tqf-continuation:hover > [class*="messageContents"],
    .tqf-hover-enabled .tqf-continuation:focus-within > [class*="messageContents"] { grid-template-rows: 20px auto 1fr !important; }
  `;
  document.head.append(style);
  const host = document.createElement('div');
  host.id = 'traq-flow-panel';
  host.hidden = !settingsRequested;
  host.style.cssText = 'position:fixed;right:16px;top:64px;z-index:2147483646';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{font:14px/1.6 system-ui,sans-serif;color:#172b3a}button,input{font:inherit}
    button{cursor:pointer;border:1px solid #a7babc;border-radius:9px;padding:6px 12px;background:#f7fffc;color:#173e35}
    button:focus-visible,input:focus-visible{outline:3px solid #138a72;outline-offset:2px}
    #close{float:right}section{max-height:calc(100dvh - 120px);overflow:auto;width:min(300px,calc(100vw - 56px));padding:18px;background:#fff;border:1px solid #ccd8d8;border-radius:12px;box-shadow:0 8px 32px #0003}
    h2{font-size:18px;margin:0 0 10px}label{display:block;margin:12px 0}input[type=number]{width:70px;padding:4px}p{font-size:12px;color:#52626b;margin:10px 0}#status{color:#17614d} [hidden]{display:none}
  </style>
  <section id="panel" role="dialog" aria-label="traQ Flow設定"><button id="close" aria-label="設定を閉じる">閉じる</button><h2>traQ Flow</h2>
  <label><input id="own" type="checkbox"> 自分の連投を前の投稿に追記</label>
  <label><input id="visual" type="checkbox"> 連続した発言の表示をまとめる</label>
  <label><input id="hover" type="checkbox"> カーソルを当てると名前・時刻を表示する</label>
  <label>連投の間隔 <input id="seconds" type="number" min="1" max="600" step="1" required> 秒</label>
  <p>追記は全員に反映されます。表示の結合はこのブラウザだけに適用されます。</p>
  <button id="once">次の1回は新規投稿</button>
  <p id="status" role="status" aria-live="polite"></p>
  <p>変更は自動保存。ホバー表示は初期値OFFです。</p></section>`;
  document.body.append(host);
  const $ = id => shadow.getElementById(id);
  statusNode = $('status'); announce(navigator.locks ? status : 'このブラウザでは自動追記は利用できません');
  function sync() { $('own').checked = config.own; $('visual').checked = config.visual; $('hover').checked = config.hover; $('seconds').value = config.seconds; }
  sync();
  const closeSettings = () => { host.hidden = true; };
  $('close').onclick = closeSettings;
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape') closeSettings(); });
  if (settingsRequested) {
    const cleanURL = new URL(location.href);
    cleanURL.searchParams.delete('traq-flow-settings');
    history.replaceState(history.state, '', cleanURL);
    $('close').focus();
  }
  for (const id of ['own', 'visual', 'hover', 'seconds']) $(id).onchange = () => {
    if (!$('seconds').reportValidity()) return;
    config = settings({ own: $('own').checked, visual: $('visual').checked, hover: $('hover').checked, seconds: Number($('seconds').value) });
    try { localStorage.setItem(KEY, JSON.stringify(config)); announce('設定を保存しました'); }
    catch { announce('設定を保存できません。このタブだけに適用します'); }
    sync(); refreshVisual();
  };
  $('once').onclick = () => { skipOnce = true; announce('次の送信は新規投稿にします'); };
  window.addEventListener('storage', event => { if (event.key === KEY) { config = loadSettings(); sync(); refreshVisual(); } });
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; refreshVisual(); }, 100);
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-is-editing', 'data-is-pinned', 'data-is-entry'] });
  refreshVisual();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
