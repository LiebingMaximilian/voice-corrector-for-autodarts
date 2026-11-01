// Runs in the page's own JS world (manifest: "world": "MAIN") at document_start.
//
// Jobs:
//  1. Watch the page's own API requests and remember the latest bearer token,
//     so corrections are sent exactly like the page sends them.
//  2. Watch WebSocket / HTTP responses for match state, to know which darts
//     the current turn has (needed for "last dart" and for undo).
//  3. Send corrections when the content script asks.
//
// The token never leaves this page: it is only used for requests to the
// Autodarts API origin it was captured from.
(function () {
  'use strict';
  if (window.__autodartsVoice) return;

  const TAG_IN = 'adv-content';
  const TAG_OUT = 'adv-hook';

  const s = {
    token: null,      // "Bearer eyJ…"
    tokenExp: 0,      // unix seconds
    tokenSource: null,
    apiOrigin: 'https://api.autodarts.com',
    state: null,
    turn: null,
    turnKey: null,
    rawTurn: null,
    wsUrls: new Set(),
    wsLog: [],    // last raw WebSocket messages, for figuring out the format
    stateLog: [], // when / where match state was found
  };

  const clip = (obj, n) => {
    const text = JSON.stringify(obj);
    return text && text.length > n ? text.slice(0, n) + '…' : text;
  };

  const summary = () => ({
    matchId: matchId(),
    hasToken: tokenValid(),
    tokenExpiresIn: s.token ? Math.round(s.tokenExp - nowSec()) + 's' : null,
    tokenSource: s.tokenSource,
    apiOrigin: s.apiOrigin,
    turn: s.turn,
    turnKey: s.turnKey,
  });

  // Debug handle for the DevTools console. Deliberately does not expose the token.
  window.__autodartsVoice = {
    summary,
    state: () => s.state,
    wsLog: () => s.wsLog,
    // copy(__autodartsVoice.dump())  -> paste the clipboard
    dump: () => JSON.stringify({
      summary: summary(),
      wsUrls: [...s.wsUrls],
      stateKeys: s.state && Object.keys(s.state),
      stateLog: s.stateLog.slice(-10),
      lastTurnRaw: clip(s.rawTurn, 3000),
      lastWsMessages: s.wsLog.slice(-8).map((m) => ({ url: m.url, data: clip(m.data, 2500) })),
    }, null, 1),
  };

  const isApi = (url) => {
    try { return /^api\.autodarts\./.test(new URL(url, location.href).hostname); }
    catch { return false; }
  };

  function matchId() {
    const m = /\/matches\/([0-9a-f-]{36})/i.exec(location.pathname);
    return m ? m[1] : (s.state && s.state.id) || null;
  }

  // ---- Login token ---------------------------------------------------------
  //
  // The access token lives ~15 minutes. During a match the page talks mostly
  // over its WebSocket, so it may renew its token without sending a request we
  // can see. We therefore pick up a token from three places:
  //  1. the Authorization header of the page's API requests,
  //  2. token responses (JSON with "access_token") when the page renews it,
  //  3. the page's own web storage, searched when our copy has expired.
  // The newest one (latest expiry) wins.

  const nowSec = () => Date.now() / 1000;
  const MARGIN = 30; // treat a token as expired 30 s early

  const isAutodartsHost = (url) => {
    try { return /(^|\.)autodarts\.(com|io)$/.test(new URL(url, location.href).hostname); }
    catch { return false; }
  };

  function jwtPayload(jwt) {
    try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return null; }
  }

  function offerToken(jwt, source) {
    const p = jwtPayload(jwt);
    if (!p || typeof p.exp !== 'number' || !/autodarts/i.test(String(p.iss || ''))) return;
    if (s.token && p.exp < s.tokenExp) return; // keep the newer one
    s.token = `Bearer ${jwt}`;
    s.tokenExp = p.exp;
    s.tokenSource = source;
  }

  const tokenValid = () => !!s.token && s.tokenExp - MARGIN > nowSec();

  // Access tokens only: refresh / ID tokens are rejected by the API.
  function tokenFromStorage() {
    let best = null;
    for (const store of [sessionStorage, localStorage]) {
      try {
        for (let i = 0; i < store.length; i++) {
          const value = store.getItem(store.key(i)) || '';
          for (const m of value.matchAll(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)) {
            const p = jwtPayload(m[0]);
            if (!p || typeof p.exp !== 'number' || !/autodarts/i.test(String(p.iss || ''))) continue;
            if (/^(refresh|offline|id)$/i.test(String(p.typ || '')) || typeof p.scope !== 'string') continue;
            if (!best || p.exp > best.exp) best = { jwt: m[0], exp: p.exp };
          }
        }
      } catch { /* storage blocked */ }
    }
    return best;
  }

  // The freshest valid token, or null.
  function freshToken() {
    if (tokenValid()) return s.token;
    const stored = tokenFromStorage();
    if (stored) offerToken(stored.jwt, 'storage');
    return tokenValid() ? s.token : null;
  }

  function rememberToken(value, url) {
    if (!value || !/^Bearer\s/i.test(value)) return;
    offerToken(value.replace(/^Bearer\s+/i, ''), 'request');
    if (isApi(url)) s.apiOrigin = new URL(url, location.href).origin;
  }

  // Token responses from the page's own login renewals.
  function inspectAuthResponse(j) {
    if (j && typeof j.access_token === 'string') offerToken(j.access_token, 'renewal');
  }

  function headerFrom(headers, name) {
    if (!headers) return null;
    if (headers instanceof Headers) return headers.get(name);
    if (Array.isArray(headers)) {
      const hit = headers.find(([k]) => k.toLowerCase() === name);
      return hit ? hit[1] : null;
    }
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return key ? headers[key] : null;
  }

  // ---- Match state -------------------------------------------------------

  // Assumed shape (to verify, see PLAN.md): { id, players, turns: [{ id?, throws: [{ segment, coords, type? }] }] }
  function findMatchState(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 5) return null;
    if (Array.isArray(obj.turns) && (obj.players || obj.variant || obj.id)) return obj;
    for (const v of Object.values(obj)) {
      const hit = findMatchState(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  function onPayload(data, src) {
    const state = findMatchState(data);
    if (!state) return;
    const id = matchId();
    if (id && state.id && state.id !== id) return; // some other match

    s.state = state;
    const turn = state.turns[state.turns.length - 1] || null;
    const throws = (turn && (turn.throws || turn.darts)) || [];
    s.rawTurn = turn;
    s.stateLog.push({
      time: new Date().toLocaleTimeString(),
      src,
      turns: state.turns.length,
      lastTurnKeys: turn && Object.keys(turn),
      throws: throws.length,
    });
    if (s.stateLog.length > 30) s.stateLog.shift();
    s.turn = {
      throws: throws.map((t) => ({ segment: t.segment, coords: t.coords, type: t.type })),
    };
    s.turnKey = turn && turn.id ? turn.id : `${state.round}-${state.player}-${state.turns.length}`;
    post({ type: 'state', state: publicState() });
  }

  function publicState() {
    return { matchId: matchId(), hasToken: !!freshToken(), turn: s.turn, turnKey: s.turnKey };
  }

  function tryJson(text) {
    if (typeof text !== 'string' || !/^\s*[[{]/.test(text)) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  // ---- fetch ---------------------------------------------------------------

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    if (url && isApi(url)) {
      const auth = headerFrom(init && init.headers, 'authorization')
        || (input instanceof Request ? input.headers.get('authorization') : null);
      rememberToken(auth, url);
    }
    const res = await nativeFetch(input, init);
    if (url && isAutodartsHost(url)) {
      const api = isApi(url);
      res.clone().text().then((t) => {
        const j = tryJson(t);
        if (!j) return;
        inspectAuthResponse(j);
        if (api) onPayload(j, 'fetch');
      }).catch(() => {});
    }
    return res;
  };

  // ---- XMLHttpRequest ------------------------------------------------------

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__advUrl = String(url);
    if (isAutodartsHost(this.__advUrl)) {
      const api = isApi(this.__advUrl);
      this.addEventListener('load', () => {
        try {
          const j = this.responseType === 'json' ? this.response
            : (this.responseType === '' || this.responseType === 'text') ? tryJson(this.responseText) : null;
          if (!j) return;
          inspectAuthResponse(j);
          if (api) onPayload(j, 'xhr');
        } catch { /* ignore */ }
      });
    }
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (/^authorization$/i.test(name) && isApi(this.__advUrl)) rememberToken(value, this.__advUrl);
    return xhrSetHeader.apply(this, arguments);
  };

  // ---- WebSocket -----------------------------------------------------------

  // Every socket is watched (not just api.*), and binary frames are decoded,
  // because we don't know yet where the live dart updates come from.
  async function onWsMessage(url, data) {
    let text = data;
    if (data instanceof Blob) text = await data.text();
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    const j = tryJson(text);
    if (!j) return;
    s.wsLog.push({ url, data: j });
    if (s.wsLog.length > 30) s.wsLog.shift();
    onPayload(j, 'ws');
  }

  const NativeWS = window.WebSocket;
  window.WebSocket = class extends NativeWS {
    constructor(...args) {
      super(...args);
      const url = String(args[0]).split('?')[0]; // drop query, it may carry credentials
      s.wsUrls.add(url);
      this.addEventListener('message', (e) => { onWsMessage(url, e.data).catch(() => {}); });
    }
  };

  // ---- Corrections ---------------------------------------------------------

  // Mirrors the request the UI sends (captured 2026-10-20):
  // POST /gs/v0/matches/{id}/corrections
  // { "activated": 0, "changes": { "0": { coords, segment, type: "normal" } } }
  async function sendCorrection({ dartIndex, change }) {
    const id = matchId();
    if (!id) return { ok: false, error: 'not on a match page' };
    const token = freshToken();
    if (!token) {
      return s.token
        ? { ok: false, code: 'token-expired', error: 'login expired' }
        : { ok: false, code: 'no-token', error: 'no login seen yet' };
    }

    const body = { activated: dartIndex, changes: { [dartIndex]: change } };
    try {
      const res = await nativeFetch(`${s.apiOrigin}/gs/v0/matches/${id}/corrections`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json',
          authorization: token,
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const text = await res.text();
      if (res.status === 401) {
        s.tokenExp = 0; // the server no longer accepts it
        return { ok: false, status: 401, code: 'token-expired', error: 'login expired' };
      }
      return { ok: res.ok, status: res.status, error: res.ok ? null : text.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ---- Reload without "Reload site?" prompt --------------------------------
  //
  // Autodarts registers a beforeunload handler, so a reload shows Chrome's own
  // "Reload site? / Seite neu laden?" dialog. That dialog is part of the browser
  // and can't be clicked by an extension (in any language). Instead we stop the
  // page's handlers from running, but only for a reload we start ourselves.
  // Registered at document_start, before any page script, and in the capture
  // phase, so this listener always runs first.
  let ownReload = false;
  window.addEventListener('beforeunload', (e) => {
    if (ownReload) e.stopImmediatePropagation();
  }, true);

  function reloadWithoutPrompt() {
    ownReload = true;
    window.onbeforeunload = null;
    location.reload();
  }

  // ---- Bridge to the content script ---------------------------------------

  function post(msg) {
    window.postMessage({ source: TAG_OUT, ...msg }, location.origin);
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.source !== TAG_IN) return;
    const { id, type, payload } = e.data;
    if (type === 'get-state') post({ type: 'reply', id, result: publicState() });
    if (type === 'correct') post({ type: 'reply', id, result: await sendCorrection(payload) });
    if (type === 'reload') reloadWithoutPrompt();
  });

  // The app is a single-page app: tell the content script when the match changes.
  let lastMatch = null;
  setInterval(() => {
    const id = matchId();
    if (id !== lastMatch) {
      lastMatch = id;
      post({ type: 'state', state: publicState() });
    }
  }, 1000);
})();
