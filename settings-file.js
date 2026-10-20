// Editor for the settings file (the vocabulary). Stored in chrome.storage.sync
// under "vocab"; null means "use the defaults from parser.js".
(function () {
  'use strict';

  const Parser = window.AdvParser;
  const $ = (id) => document.getElementById(id);
  let wakeWord = 'correct';

  function show(ok, text) {
    $('msg').textContent = text;
    $('msg').className = ok ? 'ok' : 'err';
  }

  // The usage text is written into the file itself, at the top.
  function toText(vocab) {
    return JSON.stringify({ _usage: Parser.VOCAB_USAGE, ...vocab }, null, 2);
  }

  chrome.storage.sync.get({ vocab: null, wakeWord: 'correct' }, (s) => {
    wakeWord = s.wakeWord;
    $('file').value = toText(s.vocab || Parser.DEFAULT_VOCAB);
  });

  $('save').addEventListener('click', () => {
    let parsed;
    try {
      parsed = JSON.parse($('file').value);
    } catch (e) {
      return show(false, `Not valid JSON: ${e.message}`);
    }
    const { vocab, errors } = Parser.validateVocab(parsed, { wakeWord });
    if (!vocab) return show(false, errors.join('\n'));

    chrome.storage.sync.set({ vocab }, () => {
      if (chrome.runtime.lastError) return show(false, `Could not save: ${chrome.runtime.lastError.message}`);
      $('file').value = toText(vocab);
      show(true, 'Saved. Active immediately on open Autodarts tabs.');
    });
  });

  $('reset').addEventListener('click', () => {
    chrome.storage.sync.set({ vocab: null }, () => {
      $('file').value = toText(Parser.DEFAULT_VOCAB);
      show(true, 'Back to defaults.');
    });
  });

  // Ctrl+S saves
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      $('save').click();
    }
  });
})();
