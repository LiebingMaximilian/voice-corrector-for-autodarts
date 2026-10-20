// Dartboard model: segments in the shape Autodarts sends them, plus board
// coordinates, so a correction can carry plausible "coords" like the UI does.
(function (root) {
  'use strict';

  // Sector numbers clockwise, starting at the top.
  const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  // Ring edges of a regulation board in mm, normalised so that the outer edge
  // of the double ring is 1.0. The one captured request (S9 at r ≈ 0.66,
  // y pointing up) fits this scale.
  const MM = 170;
  const EDGE = {
    bull: 6.35 / MM,
    outerBull: 15.9 / MM,
    tripleIn: 99 / MM,
    tripleOut: 107 / MM,
    doubleIn: 162 / MM,
    doubleOut: 1,
  };

  // Where a corrected dart is placed: the middle of its bed.
  const PLACE = {
    outerBull: (EDGE.bull + EDGE.outerBull) / 2,
    singleInner: (EDGE.outerBull + EDGE.tripleIn) / 2,
    triple: (EDGE.tripleIn + EDGE.tripleOut) / 2,
    singleOuter: (EDGE.tripleOut + EDGE.doubleIn) / 2,
    double: (EDGE.doubleIn + EDGE.doubleOut) / 2,
    miss: 1.15,
  };

  // Bed names as Autodarts sends them. Seen in real requests: SingleOuter (S9, S1),
  // Double (Bull), Single (outer bull "25"). Triple, SingleInner and miss are
  // still guesses (PLAN.md). Bulls reuse the generic Single/Double beds and are
  // told apart from sectors by number 25.
  const BED = {
    singleInner: 'SingleInner', // unverified
    singleOuter: 'SingleOuter',
    double: 'Double',
    triple: 'Triple',           // unverified
    outerBull: 'Single',
    bull: 'Double',
    miss: 'Outside',            // unverified
  };

  function checkNumber(n) {
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new RangeError(`No sector ${n}`);
  }

  const single = (n) => (checkNumber(n), { name: `S${n}`, number: n, bed: BED.singleOuter, multiplier: 1 });
  const double = (n) => (checkNumber(n), { name: `D${n}`, number: n, bed: BED.double, multiplier: 2 });
  const triple = (n) => (checkNumber(n), { name: `T${n}`, number: n, bed: BED.triple, multiplier: 3 });
  const outerBull = () => ({ name: '25', number: 25, bed: BED.outerBull, multiplier: 1 });
  const bull = () => ({ name: 'Bull', number: 25, bed: BED.bull, multiplier: 2 });
  const miss = () => ({ name: 'Miss', number: 0, bed: BED.miss, multiplier: 0 });

  function fromMultiplier(multiplier, number) {
    if (number === 25) {
      if (multiplier === 1) return outerBull();
      if (multiplier === 2) return bull();
      throw new RangeError('There is no triple bull');
    }
    return [single, double, triple][multiplier - 1](number);
  }

  function sectorAngle(number) {
    return ((90 - BOARD_ORDER.indexOf(number) * 18) * Math.PI) / 180;
  }

  const round = (v) => Math.round(v * 1e6) / 1e6;

  function polar(number, radius) {
    const a = sectorAngle(number);
    return { x: round(radius * Math.cos(a)), y: round(radius * Math.sin(a)) };
  }

  // Board position for a segment.
  function coordsFor(seg) {
    if (seg.number === 25) {
      return seg.multiplier === 2 ? { x: 0, y: 0 } : { x: 0, y: round(PLACE.outerBull) };
    }
    switch (seg.bed) {
      case BED.miss: return polar(20, PLACE.miss);
      case BED.singleInner: return polar(seg.number, PLACE.singleInner);
      case BED.singleOuter: return polar(seg.number, PLACE.singleOuter);
      case BED.double: return polar(seg.number, PLACE.double);
      case BED.triple: return polar(seg.number, PLACE.triple);
      default: throw new Error(`Unknown bed ${seg.bed}`);
    }
  }

  // Inverse of coordsFor: which segment a board position lies in.
  function segmentAt(x, y) {
    const r = Math.hypot(x, y);
    if (r <= EDGE.bull) return bull();
    if (r <= EDGE.outerBull) return outerBull();
    if (r > EDGE.doubleOut) return miss();

    const deg = (Math.atan2(y, x) * 180) / Math.PI;
    const idx = (((Math.round((90 - deg) / 18)) % 20) + 20) % 20;
    const n = BOARD_ORDER[idx];

    if (r <= EDGE.tripleIn) return { ...single(n), bed: BED.singleInner };
    if (r <= EDGE.tripleOut) return triple(n);
    if (r <= EDGE.doubleIn) return single(n);
    return double(n);
  }

  const score = (seg) => seg.number * seg.multiplier;

  const api = {
    BOARD_ORDER, BED, EDGE,
    single, double, triple, outerBull, bull, miss, fromMultiplier,
    coordsFor, segmentAt, score,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdvSegments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
