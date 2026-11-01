// Content script (isolated world): speech recognition, overlay, and glue
// between the parser and the page hook.
(function () {
  'use strict';

  // Defaults; wakeWord, autoConfirm and vocab (the settings file) can be
  // changed on the settings page.
  const CONFIG = {
    wakeWord: 'correct',
    autoConfirm: true,
    autoReload: true, // reload the page if the login expired, then retry the command
    nextLabels: ['Next', 'Weiter'], // label(s) of the button "correct next" presses
    vocab: window.AdvParser.DEFAULT_VOCAB,
    lang: 'en-US',
    toggleKey: 'v', // Alt+V toggles listening
  };

  function applySettings(stored) {
    if (stored.wakeWord) CONFIG.wakeWord = String(stored.wakeWord).toLowerCase();
    if (typeof stored.autoConfirm === 'boolean') CONFIG.autoConfirm = stored.autoConfirm;
    if (typeof stored.autoReload === 'boolean') CONFIG.autoReload = stored.autoReload;
    if (Array.isArray(stored.nextLabels) && stored.nextLabels.length) CONFIG.nextLabels = stored.nextLabels;
    if ('vocab' in stored) {
      const { vocab } = window.AdvParser.validateVocab(stored.vocab || window.AdvParser.DEFAULT_VOCAB);
      CONFIG.vocab = vocab || window.AdvParser.DEFAULT_VOCAB;
    }
    overlay.status(); // storage callbacks are async, so overlay exists by now
  }
  try {
    chrome.storage.sync.get(['wakeWord', 'autoConfirm', 'autoReload', 'nextLabels', 'vocab'], applySettings);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const fresh = {};
      for (const [k, v] of Object.entries(changes)) fresh[k] = v.newValue;
      applySettings(fresh);
    });
  } catch { /* ignore */ }

  // ---- Auto-confirm --------------------------------------------------------

  // After a correction the Autodarts UI waits for its OK button. Look for it
  // for a short while and click it. Only exact labels, only right after our
  // own correction, so we don't press some unrelated OK.
  const CONFIRM_LABELS = /^(ok|okay|confirm|bestätigen|übernehmen)$/i;

  // A visible, enabled button whose text matches exactly (case-insensitive).
  function findButton(matches) {
    const candidates = document.querySelectorAll('button, [role="button"]');
    for (const el of candidates) {
      if (!matches(el.textContent.trim())) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (!el.getClientRects().length) continue; // not visible
      return el;
    }
    return null;
  }

  const findConfirmButton = () => findButton((text) => CONFIRM_LABELS.test(text));

  // ---- Next ----------------------------------------------------------------

  // "correct next": press the button that moves on to the next player, for
  // when the board doesn't notice the darts being pulled out. Its label depends
  // on the Autodarts language, so the labels are a setting.
  function pressNext() {
    const labels = CONFIG.nextLabels.map((l) => l.toLowerCase());
    const btn = findButton((text) => labels.includes(text.toLowerCase()));
    if (!btn) return overlay.result(false, `"${CONFIG.nextLabels.join('" / "')}" button not found`);
    btn.click();
    overlay.result(true, `Pressed "${btn.textContent.trim()}"`);
  }

  // ---- Board control -------------------------------------------------------
  //
  // "correct board calibrate" / "correct board reset": open the Board control
  // dialog (gear button at the bottom of the match screen), press the button,
  // close the dialog again. Buttons are found by their icon, so this works in
  // every Autodarts language; the labels are a second way to find them.
  const BOARD_BUTTONS = {
    calibrate: { icon: 'fa-bullseye', labels: ['calibrate', 'kalibrieren'] },
    reset: { icon: 'fa-rotate-left', labels: ['reset', 'zurücksetzen'] },
  };

  const visible = (el) => !!el && el.getClientRects().length > 0;

  function findBoardDialog() {
    return [...document.querySelectorAll('[role="dialog"]')].find((d) => visible(d)
      && (d.querySelector('svg.fa-bullseye, svg.fa-rotate-left') || /board control|board-?steuerung/i.test(d.textContent)));
  }

  // The gear at the bottom of the screen (the one at the top is the app settings).
  function findBoardControlButton() {
    const gears = [...document.querySelectorAll('button, [role="button"]')]
      .filter((b) => visible(b) && b.querySelector('svg.fa-gear'));
    gears.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    const bottom = gears[0];
    return bottom && bottom.getBoundingClientRect().top > window.innerHeight / 2 ? bottom : null;
  }

  function findBoardButton(dialog, spec) {
    return [...dialog.querySelectorAll('button, [role="button"]')].find((b) => visible(b) && !b.disabled
      && (b.querySelector(`svg.${spec.icon}`) || spec.labels.includes(b.textContent.trim().toLowerCase())));
  }

  function closeDialog(dialog) {
    const close = [...dialog.querySelectorAll('button')].find((b) => b.querySelector('svg.fa-xmark'));
    if (close) close.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function waitFor(find, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const hit = find();
        if (hit || Date.now() - started > timeoutMs) return resolve(hit || null);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  async function boardAction(action) {
    const spec = BOARD_BUTTONS[action];
    let dialog = findBoardDialog();
    const openedByUs = !dialog;
    if (!dialog) {
      const gear = findBoardControlButton();
      if (!gear) return overlay.result(false, 'Board control button (gear at the bottom) not found');
      gear.click();
      dialog = await waitFor(findBoardDialog, 3000);
      if (!dialog) return overlay.result(false, 'Board control did not open');
    }
    const btn = await waitFor(() => findBoardButton(dialog, spec), 2000);
    if (!btn) {
      if (openedByUs) closeDialog(dialog);
      return overlay.result(false, `"${spec.labels[0]}" button not found in Board control`);
    }
    btn.click();
    overlay.result(true, `Board: ${btn.textContent.trim() || action}`);
    // Close the dialog again if we opened it, once the click has gone through.
    if (openedByUs) setTimeout(() => { if (visible(dialog)) closeDialog(dialog); }, 1500);
  }

  function autoConfirm(timeoutMs = 3000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const btn = findConfirmButton();
        if (btn) { btn.click(); return resolve(true); }
        if (Date.now() - started > timeoutMs) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  const Seg = window.AdvSegments;
  const Parser = window.AdvParser;

  // ---- Bridge to page-hook.js ---------------------------------------------

  let page = { matchId: null, hasToken: false, turn: null, turnKey: null };
  let nextId = 1;
  const pending = new Map();

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'adv-hook') return;
    const msg = e.data;
    if (msg.type === 'state') onState(msg.state);
    if (msg.type === 'reply' && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });

  function ask(type, payload) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      window.postMessage({ source: 'adv-content', id, type, payload }, location.origin);
      setTimeout(() => {
        if (pending.delete(id)) resolve({ ok: false, error: 'page hook did not answer' });
      }, 8000);
    });
  }

  function onState(state) {
    if (state.turnKey !== page.turnKey) history.length = 0; // undo only within the same turn
    page = state;
    overlay.status();
  }

  // ---- Corrections ---------------------------------------------------------

  const history = []; // [{ dartIndex, before: { segment, coords, type } }]
  const name = (seg) => (seg ? seg.name : '?');

  // ---- Expired login: reload and retry ----------------------------------
  //
  // Normally the page hook always has a fresh token. If it doesn't, reloading
  // the page makes Autodarts log in again. The command is parked in
  // sessionStorage (survives the reload, per tab) and run once the page is back.
  // At most one automatic reload every 2 minutes, so this can never loop.

  const PENDING_KEY = 'voiceCorrector.pending';
  const RELOADED_KEY = 'voiceCorrector.reloadedAt';
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function loginExpired(cmd) {
    const lastReload = Number(store.get(RELOADED_KEY) || 0);
    if (!CONFIG.autoReload || Date.now() - lastReload < 2 * 60 * 1000) {
      return overlay.result(false, 'Autodarts login expired - reload the page (F5) and say it again');
    }
    const parked = store.set(PENDING_KEY, JSON.stringify({ cmd, matchId: page.matchId, at: Date.now() }));
    store.set(RELOADED_KEY, String(Date.now()));
    if (!parked) return overlay.result(false, 'Autodarts login expired - reload the page (F5) and say it again');
    overlay.info('Login expired - reloading the page, then repeating your command…');
    // The page hook reloads, so Chrome's "Reload site?" prompt is skipped.
    setTimeout(() => window.postMessage({ source: 'adv-content', type: 'reload' }, location.origin), 700);
  }

  // After a reload: wait until the match and a valid login are back, then run the parked command.
  async function resumeParkedCommand() {
    const raw = store.get(PENDING_KEY);
    if (!raw) return;
    store.del(PENDING_KEY);
    let parked;
    try { parked = JSON.parse(raw); } catch { return; }
    if (!parked || !parked.cmd || Date.now() - parked.at > 60 * 1000) return;

    overlay.info(`Repeating "${parked.cmd.segment.name}" after reload…`);
    const started = Date.now();
    while (Date.now() - started < 30 * 1000) {
      const state = await ask('get-state');
      if (state && 'matchId' in state) onState(state);
      const ready = state && state.hasToken && state.matchId === parked.matchId;
      const knowsDarts = parked.cmd.dart !== 'last' || (state && state.turn && state.turn.throws.length)
        || Date.now() - started > 10 * 1000;
      if (ready && knowsDarts) return correct(parked.cmd);
      await new Promise((r) => setTimeout(r, 500));
    }
    overlay.result(false, 'Could not repeat the command after reload - please say it again');
  }

  async function correct(cmd) {
    // An empty list may just mean we didn't see the live update, so treat it as unknown.
    const throws = page.turn && page.turn.throws.length ? page.turn.throws : null;
    let idx = cmd.dart;

    if (idx === 'last') {
      if (!throws) return overlay.result(false, 'Not sure which dart is last - say first, second or third');
      idx = throws.length - 1;
    }
    if (throws && idx >= throws.length) {
      return overlay.result(false, `Only ${throws.length} dart(s) this turn`);
    }

    const before = throws ? throws[idx] : null;
    const res = await ask('correct', {
      dartIndex: idx,
      change: { coords: Seg.coordsFor(cmd.segment), segment: cmd.segment, type: 'normal' },
    });

    if (!res.ok && (res.code === 'token-expired' || res.code === 'no-token')) return loginExpired(cmd);
    if (!res.ok) return overlay.result(false, `Dart ${idx + 1}: failed (${res.status || ''} ${res.error || ''})`);
    history.push({ dartIndex: idx, before });
    const text = `Dart ${idx + 1}: ${name(before && before.segment)} → ${cmd.segment.name}`;
    overlay.result(true, text);
    await confirmIfWanted(text);
  }

  async function confirmIfWanted(text) {
    if (!CONFIG.autoConfirm) return;
    const clicked = await autoConfirm();
    overlay.result(clicked, clicked ? `${text} · confirmed` : `${text} · OK button not found, press it by hand`);
  }

  async function undo() {
    const last = history.pop();
    if (!last) return overlay.result(false, 'Nothing to undo');
    if (!last.before || !last.before.segment) return overlay.result(false, 'Original dart unknown, undo by hand');

    const res = await ask('correct', {
      dartIndex: last.dartIndex,
      change: { coords: last.before.coords, segment: last.before.segment, type: last.before.type || 'normal' },
    });
    if (!res.ok) {
      history.push(last);
      return overlay.result(false, `Undo failed (${res.status || ''} ${res.error || ''})`);
    }
    const text = `Undone: dart ${last.dartIndex + 1} is ${last.before.segment.name} again`;
    overlay.result(true, text);
    await confirmIfWanted(text);
  }

  function handle(cmd) {
    if (cmd.type === 'error') return overlay.result(false, cmd.reason);
    if (cmd.type === 'undo') return undo();
    if (cmd.type === 'next') return pressNext();
    if (cmd.type === 'board') return boardAction(cmd.action);
    if (cmd.type === 'correct') return correct(cmd);
  }

  // ---- Speech --------------------------------------------------------------

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let wanted = false;   // listening switched on (Start / Alt+V), remembered across page loads
  let running = false;
  let yielded = false;  // another Autodarts tab took over the microphone
  let stopping = false; // we are stopping it ourselves, so an "aborted" error is expected
  let failures = 0;     // consecutive speech errors, for the retry delay
  let aborts = 0;       // "aborted" errors we did not cause

  // ---- One listening tab at a time ----------------------------------------
  //
  // Chrome runs only one speech recognition at a time. When several Autodarts
  // tabs listen (lobby + match, two windows, …) they keep aborting each other
  // and none of them hears anything. So only the tab you are looking at
  // listens: a tab that starts listening tells the others to pause, and a
  // hidden tab stops until it is shown again.
  const TAB_ID = Math.random().toString(36).slice(2);
  const channel = (() => {
    try { return new BroadcastChannel('voice-corrector-for-autodarts'); } catch { return null; }
  })();

  const shouldListen = () => wanted && !yielded && document.visibilityState === 'visible';

  if (channel) {
    channel.onmessage = (e) => {
      if (!e.data || e.data.type !== 'claim' || e.data.from === TAB_ID) return;
      yielded = true;
      stopRecognition();
      overlay.status();
    };
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      yielded = false;
      beginListening();
    } else {
      stopRecognition();
    }
    overlay.status();
  });

  function beginListening() {
    if (!shouldListen()) return;
    if (channel) channel.postMessage({ type: 'claim', from: TAB_ID });
    safeStart();
  }

  function stopRecognition() {
    if (!rec) return;
    stopping = true;
    try { rec.abort(); } catch { /* not running */ }
  }

  // Shown in the panel instead of failing silently.
  const SPEECH_ERRORS = {
    'not-allowed': 'Microphone blocked - allow it for this site (lock icon left of the address)',
    'service-not-allowed': 'Chrome\'s speech recognition is blocked or not available',
    'audio-capture': 'No microphone input - check that a microphone is connected, selected in Windows and not used by another app',
    network: 'Speech service not reachable - Chrome\'s speech recognition needs an internet connection',
    'language-not-supported': 'Speech recognition does not support English (en-US) here',
    'bad-grammar': 'Speech recognition error (grammar)',
  };
  const FATAL_SPEECH_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported']);

  function setupRecognition() {
    rec = new Recognition();
    rec.lang = CONFIG.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onstart = () => { running = true; stopping = false; overlay.status(); };
    rec.onend = () => {
      running = false;
      stopping = false;
      overlay.status();
      // Chrome stops after silence or network hiccups; keep going while wanted.
      // After repeated errors wait longer (0.3 s, 0.6 s, … up to 10 s) instead of
      // hammering the microphone several times a second.
      const delay = Math.min(300 * 2 ** failures, 10000);
      if (shouldListen()) setTimeout(() => { if (shouldListen() && !running) safeStart(); }, delay);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech') return; // normal: silence
      if (e.error === 'aborted') {
        if (stopping) return; // we stopped it ourselves
        // Something else took Chrome's speech recognition away from us.
        aborts += 1;
        failures += 1;
        console.warn('[autodarts-voice-corrector] speech recognition aborted by something else');
        if (aborts >= 3) {
          overlay.result(false, 'Speech recognition keeps being taken over - another tab, window or app is using it. '
            + 'Close other tabs or apps that listen to the microphone (retrying…)');
        }
        return;
      }
      console.warn('[autodarts-voice-corrector] speech error:', e.error);
      const message = SPEECH_ERRORS[e.error] || `Speech recognition error: ${e.error}`;
      if (FATAL_SPEECH_ERRORS.has(e.error)) {
        setWanted(false);
        overlay.result(false, message);
        return;
      }
      failures += 1;
      overlay.result(false, `${message} (retrying…)`);
    };
    rec.onresult = (e) => {
      failures = 0;
      aborts = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        overlay.transcript(result[0].transcript, !result.isFinal);
        if (result.isFinal) onFinal(result);
      }
    };
  }

  // Try each alternative Chrome offers; the first one that is a real command wins.
  function onFinal(result) {
    let firstError = null;
    for (let i = 0; i < result.length; i++) {
      const cmd = Parser.parseCommand(result[i].transcript, { wakeWord: CONFIG.wakeWord, vocab: CONFIG.vocab });
      if (!cmd) continue;
      if (cmd.type !== 'error') return handle(cmd);
      firstError = firstError || cmd;
    }
    if (firstError) handle(firstError);
  }

  function safeStart() {
    try { rec.start(); } catch { /* already started */ }
  }

  function setWanted(on) {
    wanted = on;
    failures = 0;
    aborts = 0;
    try { chrome.storage.local.set({ listening: on }); } catch { /* ignore */ }
    if (on) {
      yielded = false; // pressing Start here takes the microphone over from other tabs
      beginListening();
    } else {
      stopRecognition();
    }
    overlay.status();
  }

  // ---- Overlay -------------------------------------------------------------

  const overlay = (() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .box { font: 13px/1.4 system-ui, sans-serif; color: #eee; background: rgba(20,20,24,.92);
               border: 1px solid #444; border-radius: 10px; padding: 8px 10px; width: 280px;
               box-shadow: 0 4px 16px rgba(0,0,0,.4); }
        .row { display: flex; align-items: center; gap: 8px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: #666; flex: none; }
        .dot.on { background: #e33; box-shadow: 0 0 6px #e33; }
        .title { font-weight: 600; flex: 1; cursor: move; user-select: none; touch-action: none; }
        .info { color: #999; font-size: 11px; }
        button { font: inherit; background: #333; color: #eee; border: 1px solid #555; border-radius: 6px;
                 padding: 2px 8px; cursor: pointer; }
        .transcript { margin-top: 6px; min-height: 1.4em; color: #ccc; }
        .transcript.interim { color: #888; font-style: italic; }
        .result { margin-top: 2px; min-height: 1.4em; }
        .ok { color: #5d5; } .err { color: #f77; } .note { color: #8cf; }
      </style>
      <div class="box">
        <div class="row">
          <span class="dot"></span>
          <span class="title">Voice Corrector for Autodarts</span>
          <button type="button">Start</button>
        </div>
        <div class="info"></div>
        <div class="transcript"></div>
        <div class="result"></div>
      </div>`;
    const $ = (sel) => shadow.querySelector(sel);
    $('button').addEventListener('click', () => setWanted(!wanted));
    document.documentElement.appendChild(host);

    // ---- Drag to move (by the title), position remembered; double-click resets.
    const title = $('.title');
    title.title = 'Drag to move · double-click to put back in the corner';
    let drag = null;
    let pos = null; // { x, y } top-left in px, or null = default corner

    function place(x, y) {
      const maxX = Math.max(0, window.innerWidth - host.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - host.offsetHeight);
      pos = { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
      host.style.left = `${pos.x}px`;
      host.style.top = `${pos.y}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }
    function resetPosition() {
      pos = null;
      host.style.left = host.style.top = 'auto';
      host.style.right = host.style.bottom = '16px';
    }
    const savePosition = () => { try { chrome.storage.local.set({ panelPos: pos }); } catch { /* ignore */ } };

    title.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = host.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      title.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    title.addEventListener('pointermove', (e) => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
    const endDrag = () => { if (drag) { drag = null; savePosition(); } };
    title.addEventListener('pointerup', endDrag);
    title.addEventListener('pointercancel', endDrag);
    title.addEventListener('dblclick', () => { resetPosition(); savePosition(); });
    window.addEventListener('resize', () => { if (pos) place(pos.x, pos.y); }); // keep it on screen

    try {
      chrome.storage.local.get('panelPos', ({ panelPos }) => {
        if (panelPos && Number.isFinite(panelPos.x) && Number.isFinite(panelPos.y)) place(panelPos.x, panelPos.y);
      });
    } catch { /* ignore */ }

    return {
      status() {
        $('.dot').classList.toggle('on', running);
        $('button').textContent = wanted ? 'Stop' : 'Start';
        const parts = [];
        parts.push(page.matchId ? 'match found' : 'no match open');
        if (page.matchId) parts.push(page.hasToken ? 'ready' : 'waiting for login');
        if (page.turn) parts.push(`${page.turn.throws.length} dart(s) this turn`);
        if (wanted && yielded) parts.push('paused: another Autodarts tab is listening (press Start to listen here)');
        else if (wanted && document.visibilityState !== 'visible') parts.push('paused while this tab is hidden');
        parts.push(`say "${CONFIG.wakeWord} …" · Alt+${CONFIG.toggleKey.toUpperCase()}`);
        $('.info').textContent = parts.join(' · ');
      },
      transcript(text, interim) {
        const el = $('.transcript');
        el.textContent = `“${text.trim()}”`;
        el.classList.toggle('interim', interim);
      },
      result(ok, text) {
        const el = $('.result');
        el.textContent = (ok ? '✓ ' : '✗ ') + text;
        el.className = 'result ' + (ok ? 'ok' : 'err');
      },
      info(text) {
        const el = $('.result');
        el.textContent = '↻ ' + text;
        el.className = 'result note';
      },
    };
  })();

  // ---- Start ---------------------------------------------------------------

  if (!Recognition) {
    overlay.result(false, 'This browser has no speech recognition (use Chrome)');
    return;
  }
  setupRecognition();
  overlay.status();
  ask('get-state').then((state) => { if (state && 'matchId' in state) onState(state); });
  resumeParkedCommand();

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === CONFIG.toggleKey) setWanted(!wanted);
  });

  try {
    chrome.storage.local.get('listening', ({ listening }) => { if (listening) setWanted(true); });
  } catch { /* ignore */ }
})();
