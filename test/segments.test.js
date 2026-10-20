const test = require('node:test');
const assert = require('node:assert/strict');
const Seg = require('../src/segments.js');

test('the captured S9 correction lies in S9', () => {
  // From the real request: coords {x: -0.495, y: 0.442}, segment S9 / SingleOuter
  const s = Seg.segmentAt(-0.49499356595937566, 0.442234853725766);
  assert.equal(s.name, 'S9');
  assert.equal(s.bed, 'SingleOuter');
});

test('more captured corrections match the board model', () => {
  // Real UI requests, 2026-10-20
  assert.deepEqual(Seg.segmentAt(0.17945417646814985, 0.667050671112874),
    { name: 'S1', number: 1, bed: 'SingleOuter', multiplier: 1 });
  assert.deepEqual(Seg.segmentAt(-0.002127941523822485, -0.003073701375138168),
    { name: 'Bull', number: 25, bed: 'Double', multiplier: 2 });
  assert.deepEqual(Seg.segmentAt(-0.0540083807979851, 0.027190033334557648),
    { name: '25', number: 25, bed: 'Single', multiplier: 1 });
});

test('bull segments are built exactly like the UI sends them', () => {
  assert.deepEqual(Seg.bull(), { name: 'Bull', number: 25, bed: 'Double', multiplier: 2 });
  assert.deepEqual(Seg.outerBull(), { name: '25', number: 25, bed: 'Single', multiplier: 1 });
});

test('coordsFor lands inside the segment it is for', () => {
  for (const n of Seg.BOARD_ORDER) {
    for (const make of [Seg.single, Seg.double, Seg.triple]) {
      const seg = make(n);
      const { x, y } = Seg.coordsFor(seg);
      assert.deepEqual(Seg.segmentAt(x, y), seg, seg.name);
    }
  }
  for (const make of [Seg.bull, Seg.outerBull, Seg.miss]) {
    const { x, y } = Seg.coordsFor(make());
    assert.equal(Seg.segmentAt(x, y).name, make().name);
  }
});

test('20 is at the top, 6 on the right, 3 at the bottom, 11 on the left', () => {
  assert.equal(Seg.segmentAt(0, 0.8).number, 20);
  assert.equal(Seg.segmentAt(0.8, 0).number, 6);
  assert.equal(Seg.segmentAt(0, -0.8).number, 3);
  assert.equal(Seg.segmentAt(-0.8, 0).number, 11);
});

test('scores', () => {
  assert.equal(Seg.score(Seg.triple(20)), 60);
  assert.equal(Seg.score(Seg.bull()), 50);
  assert.equal(Seg.score(Seg.outerBull()), 25);
  assert.equal(Seg.score(Seg.miss()), 0);
});
