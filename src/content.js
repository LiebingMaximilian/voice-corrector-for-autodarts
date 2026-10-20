// Content script (isolated world): speech recognition, overlay, and glue
// between the parser and the page hook.
(function () {
  'use strict';

  // Defaults; wakeWord, autoConfirm and vocab (the settings file) can be
  // changed on the settings page.
  const CONFIG = {
    wakeWord: 'correct',
    autoConfirm: true,
    vocab: window.AdvParser.DEFAULT_VOCAB,
    lang: 'en-US',
    toggleKey: 'v', // Alt+V toggles listening
  };

  function applySettings(stored) {
    if (stored.wakeWord) CONFIG.wakeWord = String(stored.wakeWord).toLowerCase();
    if (typeof stored.autoConfirm === 'boolean') CONFIG.autoConfirm = stored.autoConfirm;
    if ('vocab' in stored) {
      const { vocab } = window.AdvParser.validateVocab(stored.vocab || window.AdvParser.DEFAULT_VOCAB);
      CONFIG.vocab = vocab || window.AdvParser.DEFAULT_VOCAB;
    }
    overlay.status(); // storage callbacks are async, so overlay exists by now
  }
  try {
    chrome.storage.sync.get(['wakeWord', 'autoConfirm', 'vocab'], applySettings);
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

  function findConfirmButton() {
    const candidates = document.querySelectorAll('button, [role="button"]');
    for (const el of candidates) {
      if (!CONFIRM_LABELS.test(el.textContent.trim())) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (!el.getClientRects().length) continue; // not visible
      return el;
    }
    return null;
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
    if (cmd.type === 'correct') return correct(cmd);
  }

  // ---- Speech --------------------------------------------------------------

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let wanted = false;
  let running = false;

  function setupRecognition() {
    rec = new Recognition();
    rec.lang = CONFIG.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onstart = () => { running = true; overlay.status(); };
    rec.onend = () => {
      running = false;
      overlay.status();
      // Chrome stops after silence or network hiccups; keep going while wanted.
      if (wanted) setTimeout(() => { if (wanted && !running) safeStart(); }, 300);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setWanted(false);
        overlay.result(false, 'Microphone blocked - allow it for this site');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[autodarts-voice-corrector] speech error:', e.error);
      }
    };
    rec.onresult = (e) => {
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
    try { chrome.storage.local.set({ listening: on }); } catch { /* ignore */ }
    if (on) safeStart();
    else if (rec) rec.stop();
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
        .title { font-weight: 600; flex: 1; }
        .info { color: #999; font-size: 11px; }
        button { font: inherit; background: #333; color: #eee; border: 1px solid #555; border-radius: 6px;
                 padding: 2px 8px; cursor: pointer; }
        .transcript { margin-top: 6px; min-height: 1.4em; color: #ccc; }
        .transcript.interim { color: #888; font-style: italic; }
        .result { margin-top: 2px; min-height: 1.4em; }
        .ok { color: #5d5; } .err { color: #f77; }
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

    return {
      status() {
        $('.dot').classList.toggle('on', running);
        $('button').textContent = wanted ? 'Stop' : 'Start';
        const parts = [];
        parts.push(page.matchId ? 'match found' : 'no match open');
        if (page.matchId) parts.push(page.hasToken ? 'ready' : 'waiting for login');
        if (page.turn) parts.push(`${page.turn.throws.length} dart(s) this turn`);
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

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === CONFIG.toggleKey) setWanted(!wanted);
  });

  try {
    chrome.storage.local.get('listening', ({ listening }) => { if (listening) setWanted(true); });
  } catch { /* ignore */ }
})();
