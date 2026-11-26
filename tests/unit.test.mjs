// Unit tests for the training maths (src/js/core/training.js), run without a browser:
//     node --test tests/unit.test.mjs
// Each test is a small worked example; the comments show the arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const NAMES = [
  'fractionOf1RM', 'estimate1RM', 'repsAt', 'hasRir', 'isMaxTest', 'isWorkingSet', 'roundToStep', 'clamp',
  'recencyWeightedAverage', 'withBodyweight', 'toLoadedWeight', 'estimateStrength', 'strengthTrend',
  'reference1RM', 'suggestSets', 'adjustRemainingSetsPct', 'adjustRemainingSetsRir', 'setInfo',
];
// training.js reads one value from outside: your current bodyweight (from Settings).
let currentBodyweight = 0;
const src = ['format.js', 'training.js'].map(f => readFileSync(new URL(`../src/js/core/${f}`, import.meta.url), 'utf8'));
const T = vm.runInNewContext(src.join('\n') + `\n;({ ${NAMES.join(', ')} })`, { bodyweight: () => currentBodyweight });

// Objects made inside the sandbox have their own prototypes; compare plain copies.
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} expected ${b}, got ${a}`);
const DAY = 864e5;
// A history of sessions, oldest first. Each session: [[kg, reps, rir], ...]; a 4th item true marks a warm-up.
function history(sessions, exId = 1) {
  const out = [];
  let id = 1;
  sessions.forEach((sets, i) => {
    const sess = (i + 1) * DAY;
    sets.forEach(([w, r, rir, wu], k) => out.push({ id: id++, exId, sess, t: sess + k * 60000, w, r, rir, ...(wu ? { wu } : {}) }));
  });
  return out;
}
const bench = { id: 1, name: 'Bench', inc: 2.5, lo: 8, hi: 12, rir: 2 };

test('1RM maths: Epley with reps in reserve counted as reps', () => {
  near(T.fractionOf1RM(1, 0), 30 / 31);
  near(T.estimate1RM(100, 8, 2), 100 * (1 + 10 / 30)); // 133.33
  near(T.repsAt(T.estimate1RM(100, 8, 2), 100, 2), 8, 'repsAt is the inverse');
  assert.equal(T.isMaxTest({ r: 1, rir: 0 }), true);
  assert.equal(T.isMaxTest({ r: 1, rir: 1 }), false);
  assert.equal(T.hasRir({ rir: '' }), false);
  assert.equal(T.hasRir({ rir: 11 }), false);
});

test('rounding to the weight step', () => {
  assert.equal(T.roundToStep(101.3, 2.5), 102.5); // 40.52 steps -> 41
  assert.equal(T.roundToStep(101.2, 2.5), 100);
  assert.equal(T.roundToStep(33.333333, 0), 33.33); // step 0: just 2 decimals
  assert.equal(T.roundToStep(0.1 + 0.2, 0.1), 0.3); // no floating-point dust
});

test('recent sessions count more: weights 1, 2, 3, …', () => {
  near(T.recencyWeightedAverage([100, 110]), (100 * 1 + 110 * 2) / 3);
  near(T.recencyWeightedAverage([100]), 100);
});

test('strength: best e1RM per session, last 4 sessions, working sets only', () => {
  const h = history([
    [[200, 1, 0]], // too old: only the last 4 sessions count
    [[100, 8, 2], [90, 8, 2]], // best of the session: 100x8@2 -> 133.33
    [[100, 8, 2], [60, 8, 2, true]], // warm-up ignored
    [[100, 8, 2], [140, 8, 5]], // RIR 5+ ignored
    [[105, 8, 2], [150, 3, null]], // RIR not tracked: ignored
  ]);
  const e = T.estimate1RM;
  near(T.estimateStrength(h, 8, 12), (e(100, 8, 2) * (1 + 2 + 3) + e(105, 8, 2) * 4) / 10);
});

test('strength prefers sets near today’s rep range, so a heavy triple doesn’t inflate a light day', () => {
  const h = history([[[100, 10, 2]], [[150, 3, 0]]]);
  near(T.estimateStrength(h, 8, 12), T.estimate1RM(100, 10, 2), 'only the 10-rep set is within ±3 of 8–12');
  near(T.estimateStrength(h, 20, 30), T.recencyWeightedAverage([T.estimate1RM(100, 10, 2), T.estimate1RM(150, 3, 0)]), 'nothing near 20–30: use everything');
  assert.equal(T.estimateStrength([], 8, 12), null);
});

test('trend: last 3 sessions vs the last 10, capped at ±10%', () => {
  assert.equal(T.strengthTrend(history([[[100, 5, 2]]]), 5), 1, 'needs 2 sessions');
  const flat = history([[[100, 5, 2]], [[100, 5, 2]], [[100, 5, 2]]]);
  near(T.strengthTrend(flat, 5), 1);
  const jump = history([[[100, 5, 2]], [[100, 5, 2]], [[200, 5, 2]]]);
  assert.equal(T.strengthTrend(jump, 5), 1.1, 'capped');
});

test('suggestion with no history: bottom of the range, no weight yet', () => {
  const g = T.suggestSets(bench, 3, []);
  assert.deepEqual(plain(g.rows), [
    { w: '', r: 8, rir: 2 },
    { w: '', r: 8, rir: 2 },
    { w: '', r: 8, rir: 2 },
  ]);
  assert.equal(g.hint, '8–12 reps @ 2 RIR · no history yet');
});

test('double progression: same weight, one more rep, and fewer reps on later sets', () => {
  // Last time 100x8 @ 2 RIR. Strength 133.33 says 8 reps @ 2 RIR at 100; aim one more: 9.
  // Fatigue: about one rep fewer every two sets -> 9, 9, 8.
  const g = T.suggestSets(bench, 3, history([[[100, 8, 2]]]));
  assert.deepEqual(plain(g.rows.map(r => [r.w, r.r])), [[100, 9], [100, 9], [100, 8]]);
  assert.equal(g.hint, 'Last: 100×8 @2 · 8–12 reps @ 2 RIR');
});

test('a set count that isn’t a whole number rounds up (possible in imported plans)', () => {
  assert.equal(T.suggestSets(bench, 2.5, history([[[100, 8, 2]]])).rows.length, 3);
  assert.equal(T.suggestSets(bench, 2.5, []).rows.length, 3);
});

test('double progression: past the top of the range, heavier and back to the bottom', () => {
  // Last time 100x12 @ 2: next would be 13 > 12. Strength = 100 x (1 + 14/30) = 146.67.
  // At 8 reps @ 2 RIR you can lift 146.67 x 0.75 = 110 -> 110 kg x 8.
  const g = T.suggestSets(bench, 1, history([[[100, 12, 2]]]));
  assert.deepEqual(plain(g.rows.map(r => [r.w, r.r])), [[110, 8]]);
});

test('double progression: below the bottom of the range, lighter and back to the bottom', () => {
  // Last time 100x8 @ 0 RIR (a grind): at target 2 RIR that's 6 reps, which is below 8 ->
  // bottom of the range at a lower weight: min(strength x 0.75, 100 - 2.5).
  const g = T.suggestSets(bench, 1, history([[[100, 8, 0]]]));
  const strength = T.estimate1RM(100, 8, 0); // 126.67 -> x 0.75 = 95 -> 95
  assert.deepEqual(plain(g.rows.map(r => [r.w, r.r])), [[Math.min(T.roundToStep(strength * 0.75, 2.5), 97.5), 8]]);
});

test('bodyweight exercises progress in reps', () => {
  // Pull-ups (step 0): last time 10 reps @ 2 RIR = capacity 12; at target 2 RIR that's 10; aim 11.
  const pullUps = { id: 2, inc: 0, lo: 5, hi: 15, rir: 2 };
  const g = T.suggestSets(pullUps, 2, history([[[0, 10, 2]]], 2));
  assert.deepEqual(plain(g.rows.map(r => [r.w, r.r])), [['', 11], ['', 11]]);
});

test('loads that include bodyweight: the maths uses you + the plate, you see the plate', () => {
  currentBodyweight = 80;
  const dips = { inc: 2.5, bwl: true };
  assert.deepEqual(T.withBodyweight(dips, { w: 20, bw: 78 }).w, 98, 'uses the bodyweight logged with the set');
  assert.deepEqual(T.withBodyweight(dips, { w: '' }).w, 80, 'no bodyweight logged: today’s');
  assert.equal(T.toLoadedWeight(dips, 101), 20); // 101 - 80 = 21 -> 20 (step 2.5)
  assert.equal(T.toLoadedWeight(dips, 79), '', 'less than bodyweight: just bodyweight');
  assert.equal(T.toLoadedWeight({ inc: 2.5 }, 101), 100);
  currentBodyweight = 0;
});

test('reference 1RM: tested if you have one, otherwise estimated', () => {
  assert.deepEqual(plain(T.reference1RM(bench, { w: 140 }, [])), { w: 140, est: false });
  const est = T.reference1RM(bench, undefined, history([[[100, 8, 2]]]));
  assert.deepEqual(plain(est), { w: 133.3, est: true });
  assert.equal(T.reference1RM(bench, undefined, []), null);
});

// A workout item as the app builds it: rows with planned weight `pw`, untouched by you (auto).
const item = (mode, rows) => ({ mode, lo: 8, hi: 12, rows: rows.map(([w, r, rir]) => ({ w, r, rir, pw: w, auto: true })) });

test('RIR view: a set that was harder than planned moves the next sets', () => {
  // Planned 3 x 100 kg x 10 @ 2 RIR. Set 1 done at 0 RIR: strength 100 x (1 + 10/30) = 133.33.
  // Set 2 assumes 1.5% fatigue: 131.33 -> at 100 kg, 30 x (1.3133 - 1) - 2 = 7.4 -> 7 reps, below 8:
  // keep 8 reps and lower the weight to 131.33 x 0.75 = 98.5 -> 97.5 (within the plan's ±10%).
  // Set 3: 133.33 x 0.985² = 129.36 -> 6.8 reps at 100 -> 8 reps at 129.36 x 0.75 = 97.0 -> 97.5.
  const it = item('rir', [[100, 10, 0], [100, 10, 2], [100, 10, 2]]);
  it.rows[0].done = true;
  T.adjustRemainingSetsRir(it, 0, bench);
  assert.deepEqual(plain(it.rows.slice(1).map(r => [r.w, r.r, !!r.adj])), [[97.5, 8, true], [97.5, 8, true]]);
});

test('RIR view: an easier set adds reps at the same weight', () => {
  const it = item('rir', [[100, 10, 4], [100, 10, 2]]);
  it.rows[0].done = true;
  T.adjustRemainingSetsRir(it, 0, bench); // 100 x (1 + 14/30) x 0.985 = 144.5 -> 30 x 0.445 - 2 = 11.3 -> 11
  assert.deepEqual([it.rows[1].w, it.rows[1].r], [100, 11]);
});

test('RIR view: sets you edited, warm-ups and 5+ sets are left alone', () => {
  const it = item('rir', [[100, 10, 0], [100, 10, 2]]);
  it.rows[1].auto = false;
  T.adjustRemainingSetsRir(it, 0, bench);
  assert.deepEqual([it.rows[1].w, it.rows[1].r], [100, 10]);
  const five = item('rir', [[100, 10, 6], [100, 10, 2]]);
  T.adjustRemainingSetsRir(five, 0, bench);
  assert.equal(five.rows[1].adj, undefined, 'a 5+ set never drives adjustments');
});

test('RIR view: a set heavier than planned lifts the next sets to at least that weight', () => {
  // Planned 3 x 5 kg x 20 @ 2 RIR (range 15–25, 1 kg steps). Set 1 done at 6 kg x 22 @ 2: strength 6 x (1 + 24/30) = 10.8.
  // Set 2 (1.5% fatigue): 10.64 -> at 6 kg, 30 x (10.64/6 - 1) - 2 = 21.2 -> 6 kg x 21.
  // Set 3: 10.8 x 0.985² = 10.48 -> 20.4 -> 6 kg x 20.
  const ex = { inc: 1, lo: 15, hi: 25, rir: 2 };
  const it = { ...item('rir', [[6, 22, 2], [5, 20, 2], [5, 20, 2]]), lo: 15, hi: 25 };
  it.rows[0].done = true;
  T.adjustRemainingSetsRir(it, 0, ex);
  assert.deepEqual(plain(it.rows.slice(1).map(r => [r.w, r.r])), [[6, 21], [6, 20]]);
});

test('RIR view: the floor can go past the usual +10% limit', () => {
  // Planned 100 x 10 @ 2, but you did 110 x 10 @ 2 (strength 154). Before, set 2 was capped at 102.5 x 12;
  // now it stays at 110: 30 x (151.69/110 - 1) - 2 = 9.4 -> 110 x 9.
  const it = item('rir', [[110, 10, 2], [100, 10, 2]]);
  it.rows[0].done = true;
  T.adjustRemainingSetsRir(it, 0, bench);
  assert.deepEqual([it.rows[1].w, it.rows[1].r], [110, 9]);
});

test('RIR view: without RIR on the logged set, only the weight moves up', () => {
  const ex = { inc: 1, lo: 15, hi: 25, rir: 2 };
  const it = { ...item('rir', [[6, 22, ''], [5, 20, 2]]), lo: 15, hi: 25 };
  T.adjustRemainingSetsRir(it, 0, ex);
  assert.deepEqual([it.rows[1].w, it.rows[1].r, it.rows[1].adj], [6, 20, true]);
  const lighter = { ...item('rir', [[4, 22, ''], [5, 20, 2]]), lo: 15, hi: 25 };
  T.adjustRemainingSetsRir(lighter, 0, ex);
  assert.deepEqual([lighter.rows[1].w, lighter.rows[1].adj], [5, undefined], 'a lighter set never pulls the next ones down by itself');
});

test('RIR view: when the weight can’t move enough, the reps follow what you can really do', () => {
  // Lateral raises, 2 kg steps, 8–12 reps. Planned 4 kg x 12 @ 2; set 1 done at 4 kg x 22 @ 4 RIR.
  // Strength 4 x (1 + 26/30) = 7.47, set 2: 7.35. 23 reps at 4 kg is above 12, but 12 reps needs 5.0 kg -> 6 kg,
  // past +10% of the plan, so the weight stays at 4 kg and the reps become 30 x (7.35/4 - 1) - 2 = 23.
  const raises = { inc: 2, lo: 8, hi: 12, rir: 2 };
  const it = item('rir', [[4, 22, 4], [4, 12, 2]]);
  it.rows[0].done = true;
  T.adjustRemainingSetsRir(it, 0, raises);
  assert.deepEqual([it.rows[1].w, it.rows[1].r, it.rows[1].adj], [4, 23, true]);
  // No weight step set: the weight never moves, the reps do.
  const fixed = item('rir', [[4, 22, 4], [4, 12, 2]]);
  T.adjustRemainingSetsRir(fixed, 0, { inc: 0, lo: 8, hi: 12, rir: 2 });
  assert.deepEqual([fixed.rows[1].w, fixed.rows[1].r], [4, 23]);
});

test('% view: weights follow today’s strength vs your usual at that rep count, max ±10%', () => {
  // Usually 100 x 5 @ 2 (e1RM 123.33). Today 105 x 5 @ 2: +5% -> the next set's planned 100 becomes 105.
  const past = history([[[100, 5, 2]]]);
  const it = item('pct', [[105, 5, 2], [100, 5, '']]);
  it.rows[0].done = true;
  T.adjustRemainingSetsPct(it, 0, bench, past, 999);
  assert.equal(it.rows[1].w, 105);
  const big = item('pct', [[150, 5, 2], [100, 5, '']]);
  T.adjustRemainingSetsPct(big, 0, bench, past, 999);
  assert.equal(big.rows[1].w, 110, 'capped at +10%');
});

test('set info: e1RM, comparison with your 1RM, and a warning when it looks out of date', () => {
  assert.deepEqual(plain(T.setInfo({ w: 100, r: 8, rir: 2 }, bench, undefined)), { s: 'e1RM 133.33', w: 0 });
  assert.deepEqual(plain(T.setInfo({ w: 100, r: 8, rir: 2 }, bench, { w: 130 })), { s: 'e1RM 133.33 · +2.6% vs 1RM', w: 0 });
  assert.deepEqual(plain(T.setInfo({ w: 100, r: 8, rir: 2 }, bench, { w: 125 })), { s: '⚠ e1RM 133.33 · +6.7% vs 1RM', w: 1 });
  assert.deepEqual(plain(T.setInfo({ w: 140, r: 1, rir: 0 }, bench, { w: 130 })), { s: 'Counts as a 1RM · +7.7% vs 1RM', w: 0 });
  assert.deepEqual(plain(T.setInfo({ w: 60, r: 8, rir: '', wu: true }, bench)), { s: 'Warm-up', w: 0 });
  assert.deepEqual(plain(T.setInfo({ w: 100, r: 8, rir: 6 }, bench)), { s: '5+: not used for suggestions', w: 0 });
});
