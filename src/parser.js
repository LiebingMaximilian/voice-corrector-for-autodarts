// Turns a speech transcript into a command.
//
//   "correct triple twenty"               -> { type: 'correct', dart: 'last', segment: T20 }
//   "correct the second dart to double 16" -> { type: 'correct', dart: 1, segment: D16 }
//   "correct undo"                        -> { type: 'undo' }
//   "nice one"                            -> null   (not addressed to us)
//   "correct banana"                      -> { type: 'error', reason }
//
// Rule of thumb: when in doubt, reject. A wrong correction is worse than none.
//
// The words that speech recognition tends to mishear live in a "vocabulary"
// (the settings file). DEFAULT_VOCAB is used until the user saves their own.
(function (root) {
  'use strict';

  const Seg = typeof module !== 'undefined' && module.exports
    ? require('./segments.js')
    : root.AdvSegments;

  // ---- User-editable vocabulary (settings file) ---------------------------

  const DEFAULT_VOCAB = {
    // Words for "dart". They are simply skipped, so "the second dot to T20" works.
    dartWords: ['dart', 'darts', 'dot', 'dots', 'dirt', 'arrow'],
    // Extra words for single / double / triple, on top of those three words themselves.
    // Entries may be phrases of several words, e.g. "of top of" (heard instead of "triple").
    multiplierWords: {
      single: ['singles'],
      double: ['doubles'],
      triple: ['triples', 'treble', 'trebles', 'tripple', 'tribble', 'tribal', 'of top of'],
    },
    // What is heard instead of a number. Only used where a number is expected.
    numberSoundalikes: { won: 1, to: 2, too: 2, tree: 3, free: 3, for: 4, fore: 4, ate: 8 },
  };

  const VOCAB_USAGE = [
    'Settings file for Voice Corrector for Autodarts: words speech recognition tends to mishear.',
    "dartWords: words that mean 'dart' (they are ignored), e.g. add 'dark' if you get that a lot.",
    "multiplierWords: extra words for single / double / triple, e.g. 'of top of' for triple.",
    "numberSoundalikes: word -> number (1-20) for words heard instead of a number, e.g. 'sicks': 6.",
    "Every entry can be one word or a phrase of several words, e.g. 'of top of'.",
    'Words must be lowercase letters. An entry may only appear once in the whole file.',
    'Check the panel on the Autodarts page: it shows what was heard, so you can see which words to add.',
  ];

  // ---- Fixed vocabulary -----------------------------------------------------

  const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  };

  const BASE_MULTIPLIERS = { single: 1, s: 1, double: 2, d: 2, triple: 3, t: 3 };
  const MULTIPLIER_VALUE = { single: 1, double: 2, triple: 3 };

  const POSITIONS = {
    first: 0, '1st': 0,
    second: 1, '2nd': 1,
    third: 2, '3rd': 2,
    last: 'last',
  };

  const UNDO = new Set(['undo', 'revert', 'back']);
  const NEXT = new Set(['next']); // presses the Next / Weiter button
  // "board calibrate" / "board reset" (either order); "board" is often heard as "bored" or "bord".
  const BOARD_WORDS = new Set(['board', 'bored', 'bord', 'boards']);
  const BOARD_ACTIONS = {
    calibrate: 'calibrate', calibration: 'calibrate', calibrated: 'calibrate', calibrates: 'calibrate',
    reset: 'reset', resets: 'reset', restart: 'reset',
  };

  // Dropped everywhere (together with the dart words).
  const FILLERS = ['the', 'a', 'an', 'please', 'it', 'that', 'number', 'make'];
  // Dropped only when something follows ("second to triple 20"), because a
  // trailing "to" is more likely a misheard "two".
  const CONNECTORS = new Set(['to', 'too', 'into', 'with', 'as', 'is', 'was', 'should', 'be']);

  const BULL_WORDS = ['bull', 'bullseye', 'outer', 'inner', 'miss', 'missed', 'outside', 'zero', 'fifty'];

  // ---- Vocabulary handling ----------------------------------------------------

  const isCommandWord = (w) => w in NUMBER_WORDS || w in BASE_MULTIPLIERS || w in POSITIONS
    || UNDO.has(w) || NEXT.has(w) || BULL_WORDS.includes(w) || BOARD_WORDS.has(w) || w in BOARD_ACTIONS;

  // Checks a user vocabulary. Returns { vocab, errors }; vocab is null if invalid.
  function validateVocab(input, { wakeWord = 'correct' } = {}) {
    const errors = [];
    // One lowercase word, or a phrase of several separated by single spaces.
    const isEntry = (w) => typeof w === 'string' && /^[a-z']+( [a-z']+)*$/.test(w);
    const seen = new Map(); // entry -> where it was used
    const use = (word, where) => {
      if (!isEntry(word)) return errors.push(`${where}: "${word}" must be lowercase words separated by single spaces`);
      if (seen.has(word)) return errors.push(`"${word}" appears twice (${seen.get(word)} and ${where})`);
      if (word === wakeWord) return errors.push(`${where}: "${word}" is your wake word`);
      if (word.includes(' ')) {
        if (word.split(' ').includes(wakeWord)) return errors.push(`${where}: "${word}" contains your wake word`);
      } else if (isCommandWord(word)) {
        return errors.push(`${where}: "${word}" is already a command word`);
      }
      seen.set(word, where);
    };

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { vocab: null, errors: ['The file must be a JSON object { ... }'] };
    }
    for (const key of Object.keys(input)) {
      if (!(key in DEFAULT_VOCAB) && key !== '_usage') errors.push(`Unknown setting "${key}"`);
    }

    const dartWords = input.dartWords ?? [];
    if (!Array.isArray(dartWords)) errors.push('dartWords must be a list ["…", "…"]');
    else dartWords.forEach((w) => use(w, 'dartWords'));

    const mw = input.multiplierWords ?? {};
    if (typeof mw !== 'object' || Array.isArray(mw)) errors.push('multiplierWords must be { "single": [...], ... }');
    else {
      for (const [kind, words] of Object.entries(mw)) {
        if (!(kind in MULTIPLIER_VALUE)) { errors.push(`multiplierWords: unknown "${kind}" (single, double or triple)`); continue; }
        if (!Array.isArray(words)) { errors.push(`multiplierWords.${kind} must be a list`); continue; }
        words.forEach((w) => use(w, `multiplierWords.${kind}`));
      }
    }

    const ns = input.numberSoundalikes ?? {};
    if (typeof ns !== 'object' || Array.isArray(ns)) errors.push('numberSoundalikes must be { "word": number, ... }');
    else {
      for (const [w, n] of Object.entries(ns)) {
        use(w, 'numberSoundalikes');
        if (!Number.isInteger(n) || n < 1 || n > 20) errors.push(`numberSoundalikes: "${w}" must map to a number 1-20`);
      }
    }

    if (errors.length) return { vocab: null, errors };
    return {
      vocab: {
        dartWords: [...dartWords],
        multiplierWords: { single: [], double: [], triple: [], ...mw },
        numberSoundalikes: { ...ns },
      },
      errors: [],
    };
  }

  // Lookup tables built from a vocabulary, cached per vocabulary object.
  const compiled = new WeakMap();
  // Single words go into lookup tables; phrases ("of top of") are rewritten to
  // one token before parsing (null = drop the phrase, like a dart word).
  function compile(vocab) {
    if (compiled.has(vocab)) return compiled.get(vocab);
    const multipliers = { ...BASE_MULTIPLIERS };
    const soundalikes = {};
    const fillers = new Set(FILLERS);
    const phrases = [];
    const phrase = (p, replacement) => phrases.push({ words: p.split(' '), replacement });

    for (const w of vocab.dartWords || []) {
      if (w.includes(' ')) phrase(w, null); else fillers.add(w);
    }
    for (const [kind, words] of Object.entries(vocab.multiplierWords || {})) {
      for (const w of words) {
        if (w.includes(' ')) phrase(w, kind); else multipliers[w] = MULTIPLIER_VALUE[kind];
      }
    }
    for (const [w, n] of Object.entries(vocab.numberSoundalikes || {})) {
      if (w.includes(' ')) phrase(w, String(n)); else soundalikes[w] = n;
    }
    phrases.sort((a, b) => b.words.length - a.words.length); // longest match first

    const t = { fillers, multipliers, soundalikes, phrases };
    compiled.set(vocab, t);
    return t;
  }

  function replacePhrases(tokens, phrases) {
    if (!phrases.length) return tokens;
    const out = [];
    for (let i = 0; i < tokens.length;) {
      const hit = phrases.find((p) => p.words.every((w, k) => tokens[i + k] === w));
      if (hit) {
        if (hit.replacement !== null) out.push(hit.replacement);
        i += hit.words.length;
      } else {
        out.push(tokens[i]);
        i += 1;
      }
    }
    return out;
  }

  // ---- Parsing ----------------------------------------------------------------

  function tokenize(text) {
    return String(text)
      .toLowerCase()
      .replace(/bull'?s[\s-]*eye/g, 'bullseye')
      .replace(/\b([sdt])-(\d)/g, '$1$2')
      .replace(/[^a-z0-9' ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function readNumber(tokens, t) {
    if (tokens.length === 1) {
      const w = tokens[0];
      if (/^\d{1,2}$/.test(w)) return Number(w);
      if (w in NUMBER_WORDS) return NUMBER_WORDS[w];
      if (Object.prototype.hasOwnProperty.call(t.soundalikes, w)) return t.soundalikes[w];
      return null;
    }
    if (tokens.length === 2 && tokens[0] === 'twenty' && tokens[1] === 'five') return 25;
    return null;
  }

  // Returns a segment, or a string describing why it isn't one.
  function parseSegment(tokens, t) {
    const text = tokens.join(' ');

    if (['bull', 'bullseye', 'double bull', 'double bullseye', 'inner bull', 'fifty', '50'].includes(text)) return Seg.bull();
    if (['outer bull', 'single bull', '25', 'twenty five'].includes(text)) return Seg.outerBull();
    if (['miss', 'missed', 'outside', 'zero', '0', 'no score'].includes(text)) return Seg.miss();

    let multiplier = 1;
    let rest = tokens;

    // Glued forms: "t20", "triple20"
    if (tokens.length === 1) {
      const m = /^([a-z]+)(\d{1,2})$/.exec(tokens[0]);
      if (m && m[1] in t.multipliers) {
        multiplier = t.multipliers[m[1]];
        rest = [m[2]];
      }
    }
    if (rest === tokens && tokens.length > 1 && tokens[0] in t.multipliers) {
      multiplier = t.multipliers[tokens[0]];
      rest = tokens.slice(1);
    }

    const number = readNumber(rest, t);
    if (number === null) return `don't understand "${text}"`;
    if (number !== 25 && (number < 1 || number > 20)) return `there is no ${number}`;
    try {
      return Seg.fromMultiplier(multiplier, number);
    } catch (e) {
      return e.message;
    }
  }

  function isWake(token, wakeWord) {
    return token === wakeWord || token === `${wakeWord}s` || token === `${wakeWord}ion`;
  }

  function parseCommand(transcript, { wakeWord = 'correct', vocab = DEFAULT_VOCAB } = {}) {
    const t = compile(vocab);
    const tokens = tokenize(transcript);

    // Use the last wake word, so "correct ... no, correct T19" takes the second one.
    let wake = -1;
    tokens.forEach((tok, i) => { if (isWake(tok, wakeWord)) wake = i; });
    if (wake === -1) return null;

    let rest = replacePhrases(tokens.slice(wake + 1), t.phrases).filter((tok) => !t.fillers.has(tok));
    const error = (reason) => ({ type: 'error', reason, text: transcript });

    if (rest.length === 0) return error('nothing after the wake word');
    if (UNDO.has(rest[0]) && rest.length <= 2) return { type: 'undo' };
    if (NEXT.has(rest[0]) && rest.length <= 2) return { type: 'next' }; // "next", "next player"
    if (rest.some((w) => BOARD_WORDS.has(w))) {
      const others = rest.filter((w) => !BOARD_WORDS.has(w));
      if (others.length === 1 && others[0] in BOARD_ACTIONS) return { type: 'board', action: BOARD_ACTIONS[others[0]] };
      return error('board command: say "board calibrate" or "board reset"');
    }

    let dart = 'last';
    if (rest[0] in POSITIONS) {
      dart = POSITIONS[rest[0]];
      rest = rest.slice(1);
    } else if (rest.length > 1 && rest[rest.length - 1] in POSITIONS) {
      dart = POSITIONS[rest[rest.length - 1]];
      rest = rest.slice(0, -1);
    }

    while (rest.length > 1 && CONNECTORS.has(rest[0])) rest = rest.slice(1);
    if (rest.length === 0) return error('which segment?');

    const segment = parseSegment(rest, t);
    if (typeof segment === 'string') return error(segment);
    return { type: 'correct', dart, segment };
  }

  // Checks a wake word for the settings page. Returns an error message or null.
  function checkWakeWord(word, vocab = DEFAULT_VOCAB) {
    const w = String(word).trim().toLowerCase();
    const t = compile(vocab);
    if (!/^[a-z]{3,}$/.test(w)) return 'Use a single word, letters only, at least 3 letters.';
    if (isCommandWord(w) || w in t.soundalikes || w in t.multipliers || t.fillers.has(w) || CONNECTORS.has(w)
      || t.phrases.some((p) => p.words.includes(w))) {
      return `"${w}" is part of the commands themselves.`;
    }
    return null;
  }

  const api = { parseCommand, tokenize, checkWakeWord, validateVocab, DEFAULT_VOCAB, VOCAB_USAGE };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdvParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
