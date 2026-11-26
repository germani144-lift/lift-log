/* The training maths: how strong you are, what to lift next, and how to adjust after each set.
 *
 * Everything here is a plain function of its inputs: no screen, no database. The one outside value is
 * your current bodyweight (bodyweight(), from Settings), needed for lifts where the load includes it.
 * tests/unit.test.mjs runs these functions on their own.
 *
 * Terms
 *   set     a logged set: { w: kg added to the bar, r: reps, rir: reps in reserve (null = not tracked),
 *           sess: workout id, t: time, wu: true for a warm-up, bw: your bodyweight that day }
 *   RIR     reps in reserve: how many more reps you could have done. RPE = 10 − RIR. 6 is stored for "5+".
 *   e1RM    estimated one-rep max, worked out from a set's weight, reps and RIR
 *   step    the exercise's weight increment (ex.inc); 0 means a bodyweight-only exercise
 */

/* ---------- 1RM maths ---------- */

// The fraction of your 1RM you can lift for `reps` with `rir` reps still in the tank. This is Epley's
// formula, counting the reps you had left as reps you could have done: 1 / (1 + (reps + RIR) / 30).
const fractionOf1RM = (reps, rir) => 1 / (1 + (reps + rir) / 30);
const estimate1RM = (weight, reps, rir) => weight / fractionOf1RM(reps, rir);
// The same formula solved for reps: how many reps a lifter with this 1RM can do at `weight`, leaving `rir`.
const repsAt = (oneRM, weight, rir) => 30 * (oneRM / weight - 1) - rir;

const hasRir = set => set.rir !== '' && set.rir != null && +set.rir >= 0 && +set.rir <= 10;
// One rep with nothing left counts as a tested 1RM.
const isMaxTest = set => +set.r === 1 && hasRir(set) && +set.rir === 0;
// Sets that say something about your strength: not warm-ups, RIR known and under 5, weight on the bar.
const isWorkingSet = s => !s.wu && s.rir != null && s.rir < 5 && s.w > 0;

// Round to the exercise's weight step. Step 0 (bodyweight only) just tidies to 2 decimals.
const roundToStep = (x, step) => (step > 0 ? +(Math.round(x / step) * step).toFixed(3) : +(+x).toFixed(2));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Average where later values count more: weights 1, 2, 3, … from oldest to newest.
function recencyWeightedAverage(values) {
  let sum = 0,
    weights = 0;
  values.forEach((x, i) => {
    sum += x * (i + 1);
    weights += i + 1;
  });
  return sum / weights;
}

/* ---------- Bodyweight lifts ----------
   With "Load includes bodyweight" on (pull-ups, dips…), the maths uses you + the plate, while you always type
   and see only the added kg. Each logged set remembers your bodyweight at the time (set.bw). */

const bodyweightFor = ex => (ex?.bwl ? bodyweight() : 0);
// A set in total-load terms: added kg + bodyweight (that day's, or today's if it wasn't recorded).
const withBodyweight = (ex, s) =>
  ex?.bwl ? { ...s, w: (s.w === '' || s.w == null ? 0 : +s.w) + (s.bw ?? bodyweight()) } : s;
// Back from total load to what you put on the bar, rounded to the step. '' = bodyweight only / no suggestion.
const toLoadedWeight = (ex, total) => {
  if (ex?.bwl) {
    const added = roundToStep(+total - bodyweight(), ex.inc);
    return added > 0 ? added : '';
  }
  return total > 0 ? roundToStep(total, ex.inc) : '';
};

/* RIR is picked from a list: 0–5 in half steps, plus "5+" (stored as 6). A 5+ set stays in history and volume
   but, like a warm-up, never feeds suggestions, the strength estimate or the next-set adjustment. */
const RIR_CHOICES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6];

/* ---------- Strength ---------- */

// Your best e1RM in each session, oldest session first. `include` picks which working sets count.
function bestE1rmPerSession(sets, include) {
  const best = new Map();
  for (const s of sets)
    if (isWorkingSet(s) && include(s))
      best.set(s.sess, Math.max(best.get(s.sess) || 0, estimate1RM(s.w, s.r, s.rir)));
  return [...best.values()];
}

/* Strength = your best e1RM in each of your last 4 sessions, averaged with recent sessions counting more.
   Sets close to today's rep range (±3 reps) are preferred, so a heavy-triples day doesn't inflate a suggestion
   for a light day of 12s. Falls back to all working sets, and returns null with no history.
   `sets` must be sorted oldest first. */
function estimateStrength(sets, repsLo, repsHi) {
  const average = include => {
    const best = bestE1rmPerSession(sets, include).slice(-4);
    return best.length ? recencyWeightedAverage(best) : null;
  };
  return average(s => s.r >= repsLo - 3 && s.r <= repsHi + 3) ?? average(() => true);
}

/* How strong a lift has been lately compared with its longer-run level, at a similar rep count (±1):
   the last 3 sessions (recent ones counting more) against the plain average of the last 10.
   1.04 means 4% stronger than usual. Kept within ±10%. Used to nudge planned % sets. */
function strengthTrend(sets, reps) {
  const best = bestE1rmPerSession(sets, s => Math.abs(s.r - reps) <= 1);
  if (best.length < 2) return 1;
  const recent = recencyWeightedAverage(best.slice(-3));
  const longRun = best.slice(-10),
    mean = longRun.reduce((sum, x) => sum + x, 0) / longRun.length;
  return clamp(recent / mean, 0.9, 1.1);
}

// Working history: no warm-ups, oldest first.
const sortedHistory = history => history.filter(s => !s.wu).sort((a, b) => a.t - b.t);

/* The 1RM that % sets are based on: your tested 1RM if you have one, otherwise your estimated strength.
   Returns { w: kg (total load), est: true if estimated } or null when there's nothing to go on. */
function reference1RM(ex, testedPr, history) {
  if (testedPr) return { w: testedPr.w + bodyweightFor(ex), est: false };
  const sets = sortedHistory(history).map(s => withBodyweight(ex, s));
  const strength = estimateStrength(sets, -99, 999);
  return strength ? { w: Math.round(strength * 10) / 10, est: true } : null;
}

/* ---------- Suggestions for today's sets ----------
   Double progression: keep the weight and add a rep each session; past the top of the rep range, go heavier
   and start again at the bottom. Concretely, from the last session that had a working set in today's rep range:
     - reps you could do at today's target RIR = that set's reps + its RIR − target RIR; aim for one more,
     - but stay within what your averaged strength says you can do at that weight (between that and +2),
     - above the range: drop to the bottom of the range at a heavier weight (at least one step up),
     - below the range: bottom of the range at a lighter weight (at least one step down).
   With no set in range yet, the weight comes straight from your strength at the bottom of the range.
   Later sets aim for about one rep fewer every two sets, for fatigue. */

const fatigueReps = setIndex => Math.floor(setIndex / 2);

// n rows from makeRow(index). A plain loop on purpose: a set count that isn't a whole number (possible in an
// imported plan) rounds up, e.g. 2.5 -> 3 rows. Array.from({ length: n }) would round down.
function repeat(n, makeRow) {
  const out = [];
  for (let j = 0; j < n; j++) out.push(makeRow(j));
  return out;
}

// Aim one rep above last time, within [what the average says, average + 2].
const nextReps = (averageReps, lastTimeAtTarget) =>
  Math.min(averageReps + 2, Math.max(averageReps, Math.round(lastTimeAtTarget) + 1));

/* Suggested rows for `n` sets of `ex` (which carries today's target: lo–hi reps @ rir), from the exercise's
   full set history. Returns { rows: [{ w, r, rir }], hint: 'Last: … · 8–12 reps @ 2 RIR' }. */
function suggestSets(ex, n, history) {
  const sets = sortedHistory(history);
  const sessions = [...new Set(sets.map(s => s.sess))];
  const lastSession = sets.filter(s => s.sess == sessions[sessions.length - 1]);
  const hint = suggestionHint(ex, lastSession);
  const rows = (weight, reps) =>
    repeat(n, j => ({ w: weight, r: Math.max(ex.lo, reps - fatigueReps(j)), rir: ex.rir }));

  const bodyweightOnly = !(ex.inc > 0);
  const lastTimeAtBodyweight = !ex.bwl && lastSession.length && Math.max(...lastSession.map(s => s.w)) === 0;
  if (bodyweightOnly || lastTimeAtBodyweight) {
    const { weight, reps } = suggestReps(ex, sets, lastSession);
    return { rows: rows(weight, reps), hint };
  }

  const totals = sets.map(s => withBodyweight(ex, s));
  const strength = estimateStrength(totals, ex.lo, ex.hi);
  if (!strength) return { rows: repeat(n, () => ({ w: '', r: ex.lo, rir: ex.rir })), hint };

  // The heaviest working set in today's rep range, from the most recent session that has one.
  let lastInRange = null;
  for (let k = sessions.length - 1; k >= 0 && !lastInRange; k--)
    lastInRange =
      totals
        .filter(s => s.sess == sessions[k] && isWorkingSet(s) && s.r >= ex.lo && s.r <= ex.hi)
        .sort((a, b) => b.w - a.w || b.r - a.r)[0] || null;

  const weightAtBottomOfRange = roundToStep(strength * fractionOf1RM(ex.lo, ex.rir), ex.inc);
  let weight, reps;
  if (lastInRange) {
    const lastWeight = lastInRange.w;
    reps = nextReps(
      Math.round(repsAt(strength, lastWeight, ex.rir)),
      lastInRange.r + lastInRange.rir - ex.rir,
    );
    weight = lastWeight;
    if (reps > ex.hi) {
      reps = ex.lo;
      weight = Math.max(weightAtBottomOfRange, roundToStep(lastWeight + ex.inc, ex.inc));
    } else if (reps < ex.lo) {
      reps = ex.lo;
      weight = Math.min(weightAtBottomOfRange, roundToStep(lastWeight - ex.inc, ex.inc));
    }
  } else {
    reps = ex.lo;
    weight = weightAtBottomOfRange;
  }
  return { rows: rows(toLoadedWeight(ex, weight), reps), hint };
}

/* Bodyweight exercises (or ones you did at bodyweight last time) progress in reps only. "Capacity" is
   reps + RIR, the reps you could have done; it's averaged over the last 4 sessions like strength.
   Unlike isWorkingSet, sets at 0 kg count here (that's the point). */
function suggestReps(ex, sets, lastSession) {
  const capacity = new Map();
  for (const s of sets)
    if (!s.wu && s.rir != null && s.rir < 5 && (!(ex.inc > 0) || s.w === 0))
      capacity.set(s.sess, Math.max(capacity.get(s.sess) || 0, s.r + s.rir));
  const recent = [...capacity.values()].slice(-4);
  const lastBest = lastSession
    .filter(s => s.rir != null && s.rir < 5)
    .reduce((best, s) => Math.max(best, s.r + s.rir), 0);
  const weight = lastSession.length ? Math.max(...lastSession.map(s => s.w)) : '';
  let reps = ex.lo;
  if (recent.length) {
    const averageReps = Math.round(recencyWeightedAverage(recent) - ex.rir);
    reps = Math.max(ex.lo, lastBest ? nextReps(averageReps, lastBest - ex.rir) : averageReps + 1);
  }
  return { weight: weight || '', reps };
}

function suggestionHint(ex, lastSession) {
  const aim = `${ex.lo}–${ex.hi} reps @ ${ex.rir} RIR`;
  if (!lastSession.length) return `${aim} · no history yet`;
  const last = lastSession.map(
    s => `${weightLabel(s.w)}×${s.r}${s.rir != null ? ' @' + rirLabel(s.rir) : ''}`,
  );
  return `Last: ${last.join(', ')} · ${aim}`;
}

// Warm-up sets before the first working set: [fraction of the working weight, reps], by number of warm-ups.
const WARMUP_RAMP = {
  1: [[0.6, 5]],
  2: [
    [0.5, 8],
    [0.75, 4],
  ],
  3: [
    [0.45, 8],
    [0.65, 5],
    [0.85, 3],
  ],
  4: [
    [0.4, 8],
    [0.55, 5],
    [0.7, 3],
    [0.85, 2],
  ],
};

/* ---------- Adjusting the rest of the exercise after each set ----------
   After you log a set, the sets after it that you haven't edited adjust to how that set really went.
   They never move more than ±10% from the plan.
     % view:   the weights scale by today's strength compared with your usual strength at that rep count.
     RIR view: the weight stays and the reps move to hit the target RIR, unless they'd leave the rep range,
               in which case the weight moves towards the range and the reps are what you can do at the new
               weight (with no weight step, only the reps move).
               Each following set assumes you're about 1.5% weaker, for fatigue. A set never drops below the
               weight you just lifted (that floor can go past +10%).
   Rows: { w, r, rir, pw: planned weight (total load), auto: true until you edit it, done, wu, adj: adjusted }. */

// A logged set (in total load) that can tell us today's strength. Deliberately not the same test as
// isWorkingSet (that one is for history): here the RIR must be 0–5 (6 = "5+" doesn't count).
const tellsStrength = logged =>
  !(+logged.rir > 5 || logged.wu || !(+logged.w > 0) || !hasRir(logged) || !(+logged.r > 0));
// …and the % view also needs an exercise with a weight step, because it only moves weights.
const canAdjustFrom = (logged, ex) => tellsStrength(logged) && ex.inc > 0;

// % view. `history` is the exercise's logged sets; sets from `currentSession` (today) are left out of "usual".
function adjustRemainingSetsPct(item, j, ex, history, currentSession) {
  const logged = withBodyweight(ex, item.rows[j]);
  if (!canAdjustFrom(logged, ex)) return;
  const today = estimate1RM(+logged.w, +logged.r, +logged.rir);

  // Usual strength at this rep count (±1): best e1RM of each of the last 4 sessions, recent ones counting more.
  const best = new Map(); // session -> [time, best e1RM]
  for (const s of history.map(s => withBodyweight(ex, s)))
    if (s.sess != currentSession && isWorkingSet(s) && Math.abs(s.r - logged.r) <= 1)
      best.set(s.sess, [s.t, Math.max(best.get(s.sess)?.[1] || 0, estimate1RM(s.w, s.r, s.rir))]);
  const recent = [...best.values()]
    .sort((a, b) => a[0] - b[0])
    .slice(-4)
    .map(x => x[1]);
  let usual = null;
  if (recent.length) usual = recencyWeightedAverage(recent);
  else {
    // No history at this rep count yet: compare with today's first comparable set.
    const first = item.rows.find(
      r => r.done && !r.wu && +withBodyweight(ex, r).w > 0 && hasRir(r) && Math.abs(+r.r - logged.r) <= 1,
    );
    if (first && first !== item.rows[j]) {
      const f = withBodyweight(ex, first);
      usual = estimate1RM(+f.w, +f.r, +f.rir);
    }
  }
  if (!usual) return;

  const factor = clamp(today / usual, 0.9, 1.1);
  for (let q = j + 1; q < item.rows.length; q++) {
    const row = item.rows[q];
    if (row.done || row.wu || !row.auto || !(+row.pw > 0)) continue;
    const w = toLoadedWeight(ex, row.pw * factor);
    if (w !== row.w) {
      row.w = w;
      row.adj = true;
    }
  }
}

// RIR view.
// Also: never suggest less than you just lifted. If the logged set was heavier than a later set's weight, that
// set goes up to at least the logged weight (its reps follow from your strength at that weight). This applies
// even when the logged set can't say anything about your strength (no RIR, or 5+): then only the weight moves.
function adjustRemainingSetsRir(item, j, ex) {
  if (item.mode == 'pct') return;
  const loggedRow = item.rows[j],
    logged = withBodyweight(ex, loggedRow),
    loggedWeight = !loggedRow.wu && +logged.w > 0 ? +logged.w : 0, // total load
    canAdjust = tellsStrength(logged), // also without a weight step: then the weight stays and the reps adjust
    today = canAdjust ? estimate1RM(+logged.w, +logged.r, +logged.rir) : 0;

  let setsAhead = 0;
  for (let q = j + 1; q < item.rows.length; q++) {
    const row = item.rows[q];
    if (row.done || row.wu || !row.auto) continue;
    const weightBefore = +withBodyweight(ex, row).w || 0;
    // The weight this set must not go below: what you just lifted, if that's heavier than this set.
    const atLeast = loggedWeight > weightBefore ? loggedWeight : 0;

    if (!canAdjust || !(+row.r > 0) || !hasRir(row)) {
      if (atLeast) {
        row.w = toLoadedWeight(ex, atLeast);
        row.adj = true;
      }
      continue;
    }

    const strength = today * Math.pow(0.985, ++setsAhead); // about 1.5% weaker per set, for fatigue
    const planned = +row.pw || +row.w || 0;
    const withinPlan = w => {
      if (planned > 0)
        w = Math.min(
          Math.max(roundToStep(planned * 1.1, ex.inc), atLeast),
          Math.max(roundToStep(planned * 0.9, ex.inc), w),
        );
      return Math.max(atLeast, w);
    };
    const weightFor = reps => withinPlan(roundToStep(strength * fractionOf1RM(reps, +row.rir), ex.inc));

    const repsAtWeight = w => Math.max(1, Math.round(repsAt(strength, w, +row.rir)));

    let weight = Math.max(weightBefore, atLeast),
      reps = +row.r;
    if (!(weight > 0)) {
      if (ex.inc > 0) weight = weightFor(reps);
    } else {
      reps = repsAtWeight(weight);
      // Outside the rep range: move the weight towards it (only with a weight step) and then take the reps
      // you can really do at the weight it lands on. Big steps (dumbbells) or the ±10% limit can stop the
      // weight short, e.g. 4 kg x 22 @ 4 RIR with 2 kg steps: 6 kg is too far, so 4 kg x 23, not 4 kg x 12.
      if (ex.inc > 0 && (reps > item.hi || reps < item.lo)) {
        weight = weightFor(reps > item.hi ? item.hi : item.lo);
        reps = repsAtWeight(weight);
      }
    }
    if (reps !== +row.r || weight !== weightBefore) {
      row.r = reps;
      if (weight !== weightBefore) row.w = toLoadedWeight(ex, weight);
      row.adj = true;
    }
  }
}

/* ---------- What to show under a set ----------
   The set's e1RM and how it compares with your tested 1RM (`testedPr`, or undefined).
   Returns { s: text, w: 1 when the set suggests your 1RM is out of date (e1RM more than 3% above it) }. */
function setInfo(row, ex, testedPr) {
  const bw = bodyweightFor(ex),
    pr = testedPr && { ...testedPr, w: testedPr.w + bw };
  if (row.wu) return { s: 'Warm-up', w: 0 };
  const set = bw ? withBodyweight(ex, row) : row;
  if (+row.rir > 5 && row.rir !== '') return { s: '5+: not used for suggestions', w: 0 };
  if (!(set.w > 0 && set.r > 0 && hasRir(set))) return { s: '', w: 0 };
  const vs1RM = d => ` · ${d >= 0 ? '+' : ''}${d.toFixed(1)}% vs 1RM`;
  if (isMaxTest(set)) {
    let s = 'Counts as a 1RM';
    if (pr) s += vs1RM((set.w / pr.w - 1) * 100);
    return { s, w: 0 };
  }
  const e = estimate1RM(set.w, set.r, set.rir);
  let s = 'e1RM ' + fmt(e);
  if (pr) {
    const d = (e / pr.w - 1) * 100;
    s += vs1RM(d);
    if (d > 3) return { s: '⚠ ' + s, w: 1 };
  }
  return { s, w: 0 };
}
