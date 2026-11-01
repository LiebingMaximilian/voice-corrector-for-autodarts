// Settings page (also the toolbar popup). Settings live in chrome.storage.sync;
// the content script picks up changes immediately.
(function () {
  'use strict';

  const Parser = window.AdvParser;
  const DEFAULTS = { wakeWord: 'correct', autoConfirm: true, autoReload: true, nextLabels: ['Next', 'Weiter'], vocab: null };
  const $ = (id) => document.getElementById(id);
  let vocab = Parser.DEFAULT_VOCAB;

  function show(ok, text) {
    $('msg').textContent = text;
    $('msg').className = ok ? 'ok' : 'err';
  }

  function showWakeWord(word) {
    for (const el of document.querySelectorAll('.w')) el.textContent = word || '…';
  }

  chrome.storage.sync.get(DEFAULTS, (s) => {
    $('wakeWord').value = s.wakeWord;
    $('autoConfirm').checked = s.autoConfirm;
    $('autoReload').checked = s.autoReload;
    $('nextLabels').value = s.nextLabels.join(', ');
    if (s.vocab) vocab = Parser.validateVocab(s.vocab).vocab || vocab;
    showWakeWord(s.wakeWord);
  });

  $('wakeWord').addEventListener('input', () => showWakeWord($('wakeWord').value.trim().toLowerCase()));

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const wakeWord = $('wakeWord').value.trim().toLowerCase();
    const problem = Parser.checkWakeWord(wakeWord, vocab);
    if (problem) return show(false, problem);

    const nextLabels = $('nextLabels').value.split(',').map((l) => l.trim()).filter(Boolean);
    if (!nextLabels.length) return show(false, 'Enter at least one label for the Next button, e.g. "Weiter".');
    if (nextLabels.some((l) => l.length > 40)) return show(false, 'Button labels are short, e.g. "Next" or "Weiter".');

    chrome.storage.sync.set({
      wakeWord, nextLabels,
      autoConfirm: $('autoConfirm').checked,
      autoReload: $('autoReload').checked,
    }, () => {
      show(true, 'Saved. Active immediately on open Autodarts tabs.');
    });
  });

  $('openFile').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings-file.html') });
  });
})();
