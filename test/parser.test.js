const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../src/parser.js');

const seg = (text) => {
  const cmd = parseCommand(text);
  assert.equal(cmd && cmd.type, 'correct', `"${text}" -> ${JSON.stringify(cmd)}`);
  return `${cmd.dart}:${cmd.segment.name}`;
};

test('ignores speech without the wake word', () => {
  assert.equal(parseCommand('one hundred and eighty'), null);
  assert.equal(parseCommand('triple twenty'), null);
  assert.equal(parseCommand(''), null);
});

test('replaces the last dart by default', () => {
  assert.equal(seg('correct triple twenty'), 'last:T20');
  assert.equal(seg('Correct treble 19'), 'last:T19');
  assert.equal(seg('correct double 16'), 'last:D16');
  assert.equal(seg('correct single five'), 'last:S5');
  assert.equal(seg('correct 5'), 'last:S5');
});

test('positions', () => {
  assert.equal(seg('correct first triple 20'), '0:T20');
  assert.equal(seg('correct second double eight'), '1:D8');
  assert.equal(seg('correct 3rd single 1'), '2:S1');
  assert.equal(seg('correct the second dart to triple twenty'), '1:T20');
  assert.equal(seg('correct triple 20 second'), '1:T20');
  assert.equal(seg('correct the second dot to triple twenty'), '1:T20');
  assert.equal(seg('correct first dot double 5'), '0:D5');
  assert.equal(seg('correct last double 1'), 'last:D1');
});

test('glued forms Chrome sometimes returns', () => {
  assert.equal(seg('correct T20'), 'last:T20');
  assert.equal(seg('correct d-16'), 'last:D16');
  assert.equal(seg('correct triple20'), 'last:T20');
});

test('soundalikes in the number slot', () => {
  assert.equal(seg('correct double for'), 'last:D4');
  assert.equal(seg('correct triple to'), 'last:T2');
  assert.equal(seg('correct single won'), 'last:S1');
  assert.equal(seg('correct second to triple twenty'), '1:T20');
});

test('bulls and misses', () => {
  assert.equal(seg('correct bullseye'), 'last:Bull');
  assert.equal(seg("correct bull's eye"), 'last:Bull');
  assert.equal(seg('correct double bull'), 'last:Bull');
  assert.equal(seg('correct 50'), 'last:Bull');
  assert.equal(seg('correct outer bull'), 'last:25');
  assert.equal(seg('correct twenty five'), 'last:25');
  assert.equal(seg('correct single 25'), 'last:25');
  assert.equal(seg('correct double 25'), 'last:Bull');
  assert.equal(seg('correct second miss'), '1:Miss');
});

test('uses the last wake word', () => {
  assert.equal(seg('correct triple nineteen no correct triple twenty'), 'last:T20');
  assert.equal(seg('correction double 3'), 'last:D3');
});

test('next', () => {
  assert.deepEqual(parseCommand('correct next'), { type: 'next' });
  assert.deepEqual(parseCommand('correct next player'), { type: 'next' });
  assert.equal(parseCommand('correct next triple twenty please now').type, 'error');
});

test('board control', () => {
  assert.deepEqual(parseCommand('correct board calibrate'), { type: 'board', action: 'calibrate' });
  assert.deepEqual(parseCommand('correct board reset'), { type: 'board', action: 'reset' });
  assert.deepEqual(parseCommand('correct calibrate board'), { type: 'board', action: 'calibrate' });
  assert.deepEqual(parseCommand('correct bored calibration'), { type: 'board', action: 'calibrate' });
  assert.deepEqual(parseCommand('correct the board reset please'), { type: 'board', action: 'reset' });
  assert.equal(parseCommand('correct board').type, 'error');
  assert.equal(parseCommand('correct board triple twenty').type, 'error');
  // without the word "board" nothing happens to the board
  assert.equal(parseCommand('correct reset').type, 'error');
});

test('triple aliases, including phrases', () => {
  assert.equal(seg('correct of top of 20'), 'last:T20');
  assert.equal(seg('correct second dart of top of twenty'), '1:T20');
  assert.equal(seg('correct tripple 19'), 'last:T19');
  assert.equal(seg('correct tribble 18'), 'last:T18');
  assert.equal(seg('correct tribal 17'), 'last:T17');
});

test('settings file: phrases in every section', () => {
  const { validateVocab } = require('../src/parser.js');
  const { vocab, errors } = validateVocab({
    dartWords: ['dart', 'the dot'],
    multiplierWords: { double: ['the bull of'], triple: ['of top of'] },
    numberSoundalikes: { 'sick seen': 16 },
  });
  assert.deepEqual(errors, []);
  const cmd = (text) => parseCommand(text, { vocab });
  assert.equal(cmd('correct second the dot the bull of sick seen').segment.name, 'D16');
  assert.equal(cmd('correct second the dot the bull of sick seen').dart, 1);
  for (const bad of [{ dartWords: ['two  spaces'] }, { dartWords: ['Top Of'] }, { dartWords: ['say correct now'] },
    { dartWords: ['of top of'], multiplierWords: { triple: ['of top of'] } }, { dartWords: ['next'] }]) {
    assert.equal(validateVocab(bad).vocab, null, JSON.stringify(bad));
  }
});

test('undo', () => {
  assert.deepEqual(parseCommand('correct undo'), { type: 'undo' });
  assert.deepEqual(parseCommand('correct undo that'), { type: 'undo' });
});

test('rejects nonsense instead of guessing', () => {
  for (const text of ['correct', 'correct banana', 'correct triple 25', 'correct triple 21',
    'correct second', 'correct triple', 'correct triple twenty five six']) {
    const cmd = parseCommand(text);
    assert.equal(cmd.type, 'error', `"${text}" -> ${JSON.stringify(cmd)}`);
  }
});

test('wake word validation', () => {
  const { checkWakeWord } = require('../src/parser.js');
  assert.equal(checkWakeWord('oche'), null);
  assert.notEqual(checkWakeWord('board'), null); // used by "board calibrate"
  assert.equal(checkWakeWord('Correct'), null);
  assert.notEqual(checkWakeWord('triple'), null);
  assert.notEqual(checkWakeWord('twenty'), null);
  assert.notEqual(checkWakeWord('two words'), null);
  assert.notEqual(checkWakeWord('ok'), null);
  assert.notEqual(checkWakeWord('next'), null);
  assert.notEqual(checkWakeWord('top'), null); // part of the "of top of" phrase
});

test('settings file: defaults are valid', () => {
  const { validateVocab, DEFAULT_VOCAB } = require('../src/parser.js');
  assert.deepEqual(validateVocab(DEFAULT_VOCAB).errors, []);
});

test('settings file: custom words are used', () => {
  const { validateVocab } = require('../src/parser.js');
  const { vocab } = validateVocab({
    dartWords: ['dart', 'dark'],
    multiplierWords: { triple: ['trouble'] },
    numberSoundalikes: { sex: 6 },
  });
  const cmd = (text) => parseCommand(text, { vocab });
  assert.equal(cmd('correct second dark trouble sex').segment.name, 'T6');
  assert.equal(cmd('correct second dark trouble sex').dart, 1);
  assert.equal(cmd('correct trouble20').segment.name, 'T20');
  assert.equal(cmd('correct triple twenty').segment.name, 'T20'); // base words always work
  assert.equal(cmd('correct treble twenty').type, 'error');        // removed from the file
  assert.equal(cmd('correct second dot T20').type, 'error');       // "dot" removed too
});

test('settings file: rejects broken input', () => {
  const { validateVocab } = require('../src/parser.js');
  const bad = [
    [],
    { dartWords: 'dot' },
    { dartWords: ['Dot'] },
    { dartWords: ['dot'], numberSoundalikes: { dot: 3 } },
    { numberSoundalikes: { sex: 25 } },
    { multiplierWords: { quadruple: ['quad'] } },
    { dartWords: ['twenty'] },
    { dartWords: ['correct'] },
    { colour: 'red' },
  ];
  for (const input of bad) {
    const r = validateVocab(input);
    assert.equal(r.vocab, null, JSON.stringify(input));
    assert.ok(r.errors.length > 0);
  }
  assert.equal(validateVocab({ _usage: ['ignored'], dartWords: [] }).vocab.dartWords.length, 0);
});

test('custom wake word', () => {
  const cmd = parseCommand('oche triple twenty', { wakeWord: 'oche' });
  assert.equal(cmd.segment.name, 'T20');
});
