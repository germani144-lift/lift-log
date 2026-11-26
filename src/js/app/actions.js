/* What every button does. A button says which action it runs with data-a="name" and passes values with other
   data- attributes; the click handler (events.js) calls actions[name](setRow, button.dataset), where setRow
   is the workout set row the button is in, if any. */

const closePage = () => {
  state.view = null;
  draft = null;
  render();
};

const actions = {
  upd: async () => {
    const b = $('#updb'); // ask the server which version it serves (sw.js carries the same VER); update on demand
    b.textContent = 'Checking…';
    b.disabled = true;
    let v = null;
    try {
      const r = await fetch('sw.js?check=' + Date.now(), { cache: 'no-store' });
      if (r.ok) v = (/const VER='(\d+\.\d+)';/.exec(await r.text()) || [])[1] || null;
    } catch {}
    b.textContent = 'Check for updates';
    b.disabled = false;
    if (!v) return toast("Couldn't reach the server. Check the connection and try again.");
    const n = x => x.split('.').map(Number),
      [a1, a2] = n(v),
      [c1, c2] = n(VER);
    if (a1 < c1 || (a1 == c1 && a2 <= c2)) return toast(`You're on the latest version (v${VER}).`);
    if (!confirm(`Version v${v} is available (you have v${VER}). Update now?`)) return;
    b.textContent = 'Updating…';
    b.disabled = true;
    try {
      const g = await navigator.serviceWorker?.getRegistration();
      if (g) await g.update();
    } catch {}
    try {
      for (const k of await caches.keys())
        if (k.startsWith('lift-log-') || k.startsWith('liftlog-')) await caches.delete(k);
    } catch {} // only this app's caches
    location.reload();
  },
  backup: () => exportData(),
  restore: () => $('#imp').click(),
  tab: async (s, d) => {
    picker = null;
    state.tab = d.i;
    state.view = null;
    draft = null;
    await loadState();
    render();
    scrollMainTo(0, 0);
  },
  back: closePage,
  start: (s, d) => {
    if (
      workout &&
      !confirm(
        `You have a workout in progress (${workout.name}). Start a new one instead? Sets you already logged stay in History.`,
      )
    )
      return;
    startWorkout(+d.i || null, +d.d || 0);
  },
  toLanding: () => {
    showTrainHome = true;
    render();
    scrollMainTo(0, 0);
  },
  resume: () => {
    showTrainHome = false;
    render();
    scrollMainTo(0, 0);
  },
  finish: async () => {
    if (confirm('Finish workout?')) {
      workout = null;
      showTrainHome = false;
      saveWorkout();
      await loadState();
      render();
    }
  },
  pickAdd: () => {
    picker = { t: 'add', y: mainScrollY() };
    pickerQuery = '';
    pickerShowAll = false;
    render();
    scrollMainTo(0, 0);
    $('#pq')?.focus();
  },
  pickAll: () => {
    pickerShowAll = true;
    $('#plist').innerHTML = pickerResults();
  },
  pickNew: async () => {
    const id = await createExercise($('#pq').value);
    if (id) actions.pickGo(null, { x: id });
  },
  tplMode: (s, d) => {
    const it = draft.days[+d.k].items[+d.i],
      x = exerciseById(it.exId);
    it.mode = d.m;
    rememberTrackingMode(x, d.m);
    if (d.m == 'pct' && !it.lines?.length) it.lines = [newPctLine()];
    if (d.m == 'rir') {
      it.n ??= 3;
      it.lo ??= x?.lo ?? 8;
      it.hi ??= x?.hi ?? 12;
    }
    render();
  },
  tplAddLine: (s, d) => {
    const it = draft.days[+d.k].items[+d.i],
      l = it.lines[it.lines.length - 1];
    it.lines.push(l ? { ...l } : newPctLine());
    render();
  },
  tplRmLine: (s, d) => {
    const it = draft.days[+d.k].items[+d.i];
    it.lines.splice(+d.l, 1);
    if (!it.lines.length) it.lines.push(newPctLine());
    render();
  },
  tplSwap: (s, d) => {
    planReplace = { k: +d.k, j: +d.i, q: '' };
    render();
    const q = $('[data-tr]');
    if (q) {
      q.focus();
      q.scrollIntoView({ block: 'center' });
    }
  },
  tplSwapX: () => {
    planReplace = null;
    render();
  },
  tplSet: (s, d) => {
    draft.days[planReplace.k].items[planReplace.j].exId = +d.x;
    planReplace = null;
    render();
  },
  tplSetNew: async () => {
    const id = await createExercise($('[data-tr]').value);
    if (id) actions.tplSet(null, { x: id });
  },
  tplPick: (s, d) => {
    const x = exerciseById(+d.x),
      pm = x?.mode == 'pct';
    draft.days[+d.k].items.push(
      pm
        ? { exId: +d.x, mode: 'pct', lines: [newPctLine()] }
        : {
            exId: +d.x,
            mode: 'rir',
            n: 3,
            lo: x?.lo ?? 8,
            hi: x?.hi ?? 12,
            rirW: Array(Math.max(1, Math.round(+draft.weeks || 8))).fill(x?.rir ?? 2),
          },
    );
    planAddSearch = { k: +d.k, q: '' };
    render();
    const q = $(`[data-tq="${d.k}"]`);
    if (q) {
      q.focus();
      q.scrollIntoView({ block: 'center' });
    }
  },
  tplPickNew: async (s, d) => {
    const id = await createExercise($(`[data-tq="${d.k}"]`).value);
    if (id) actions.tplPick(null, { k: d.k, x: id });
  },
  repl: (s, d) => {
    picker = { t: 'rep', i: +d.i, y: mainScrollY() };
    pickerQuery = '';
    pickerShowAll = false;
    render();
    scrollMainTo(0, 0);
    $('#pq')?.focus();
  },
  pickCancel: () => {
    const y = picker.y;
    picker = null;
    render();
    scrollMainTo(0, y);
  },
  pickGo: async (s, d) => {
    const exId = +d.x,
      P = picker;
    if (P.t == 'add') {
      await addExerciseToWorkout({ exId, n: 3 });
      picker = null;
      saveWorkout();
      render();
      scrollMainTo(0, 1e9);
      return;
    }
    const it = workout.items[P.i],
      done = it.rows.filter(x => x.done);
    if (
      done.length &&
      !confirm(
        `Replace ${exerciseById(it.exId)?.name || 'this exercise'} with ${exerciseById(exId).name}? Its ${done.length} logged set${done.length > 1 ? 's' : ''} in this workout will be deleted.`,
      )
    )
      return;
    for (const x of done) if (x.id) await dbDelete('sets', x.id);
    await addExerciseToWorkout({ exId, n: it.rows.filter(x => !x.wu).length || 3 });
    workout.items[P.i] = workout.items.pop(); // swap the new item into the old one's place
    picker = null;
    saveWorkout();
    render();
    scrollMainTo(0, P.y);
  },
  rdec: () => setRest(workout.rest - 15),
  rinc: () => setRest(workout.rest + 15),
  rstop: () => {
    workout.restEnd = 0;
    saveWorkout();
    tickRest();
  },
  redit: () => {
    const v = prompt('Rest time (seconds or m:ss)', clockText(workout.rest));
    if (v == null) return;
    const m = v.trim().match(/^(\d+):(\d{1,2})$/),
      n = m ? +m[1] * 60 + +m[2] : +v;
    n >= 15 && n <= 1800 ? setRest(n) : toast('Enter 15–1800 seconds, or m:ss');
  },
  planStart: async (s, d) => {
    const t = state.tpl.find(x => x.id == d.i),
      o = state.tpl.find(x => x.active && x.id != t.id);
    if (o && !confirm(`Switch from "${o.name}" to "${t.name}"? The current plan will be closed.`)) return;
    if (o) {
      o.active = false;
      await dbPut('templates', o);
    }
    t.active = true;
    t.runStart = Date.now();
    await dbPut('templates', t);
    await loadState();
    render();
  },
  planStop: async (s, d) => {
    const t = state.tpl.find(x => x.id == d.i);
    if (!planProgress(t).done && !confirm('End this plan now? Your logged workouts stay in History.')) return;
    t.active = false;
    await dbPut('templates', t);
    await loadState();
    render();
  },
  rms: async s => {
    const it = workout.items[s.dataset.i],
      r = it.rows[s.dataset.j];
    if (r.done && !confirm('Remove this logged set?')) return;
    if (r.id) await dbDelete('sets', r.id);
    it.rows.splice(+s.dataset.j, 1);
    saveWorkout();
    render();
  },
  rmx: async (s, d) => {
    const it = workout.items[d.i],
      done = it.rows.filter(x => x.done);
    if (
      !confirm(
        done.length
          ? `Remove ${exerciseById(it.exId)?.name || 'this exercise'} and delete its ${done.length} logged set(s) from this workout?`
          : 'Remove this exercise from the workout?',
      )
    )
      return;
    for (const x of done) if (x.id) await dbDelete('sets', x.id);
    workout.items.splice(+d.i, 1);
    saveWorkout();
    render();
  },
  addset: (s, d) => {
    const rows = workout.items[d.i].rows,
      l = rows[rows.length - 1] || {};
    // A copy of the last set that adjusts like the suggested ones (until you edit it).
    rows.push({ w: l.w ?? '', r: l.r ?? '', rir: l.rir ?? '', pw: l.pw ?? (+l.w || 0), auto: true });
    saveWorkout();
    render();
  },
  step: (s, d) => {
    const it = workout.items[s.dataset.i],
      r = it.rows[s.dataset.j]; // −/+ change the reps; the weight is typed
    if (r.r === '' || r.r == null) {
      if (+d.d < 0) return;
      r.r = 0;
    }
    r.r = Math.max(1, Math.round(+r.r) + +d.d);
    r.auto = false;
    delete r.adj;
    $('[data-f=r]', s).value = fmt(r.r);
    saveWorkout();
    updateSetInfo(s);
  },
  log: async s => {
    const it = workout.items[s.dataset.i],
      r = it.rows[s.dataset.j],
      ex = exerciseById(it.exId);
    if (!(r.r > 0)) return toast('Enter reps'); // empty or 0 weight = bodyweight (BW)
    if (r.rir !== '' && r.rir != null && !(+r.rir >= 0 && +r.rir <= 10))
      return toast(
        it.mode == 'pct'
          ? "RPE must be between 0 and 10. Leave it blank if you don't track it."
          : "RIR must be between 0 and 10. Leave it blank if you don't track it.",
      );
    const test = !r.wu && isMaxTest(r);
    const rec = {
      exId: ex.id,
      sess: workout.sess,
      wn: workout.name,
      pd: workout.pd,
      t: Date.now(),
      w: Math.round((+r.w || 0) * 100) / 100,
      r: r.r,
      rir: hasRir(r) ? +r.rir : null,
      test,
    };
    if (r.wu) rec.wu = true;
    if (ex.bwl && bodyweight()) rec.bw = bodyweight();
    r.id = await dbPut('sets', rec);
    r.done = true;
    delete r.adj;
    if (it.mode == 'pct') {
      // Read the history only when this set can tell us anything (not a warm-up, 5+ or without weight).
      if (canAdjustFrom(withBodyweight(ex, r), ex))
        await adjustRemainingSetsPct(it, +s.dataset.j, ex, await getAll('sets', 'ex', ex.id), workout.sess);
    } else adjustRemainingSetsRir(it, +s.dataset.j, ex);
    saveWorkout();
    startRest();
    const x = setInfo(r, ex, state.pr[ex.id]),
      pr = state.pr[ex.id];
    if (test) {
      const pb = ex.pb || 0,
        beat = r.w > pb;
      if (beat) await dbPut('exercises', { ...ex, pb: r.w });
      if (
        confirm(
          `Save ${fmt(r.w)} as your current 1RM for ${ex.name}?` +
            (pr ? `\nCurrent 1RM: ${fmt(pr.w)} (tested ${ageText(pr.t)})` : '') +
            (beat ? '\nNew lifetime PB!' : ''),
        )
      )
        await dbPut('pr_history', { exId: ex.id, w: r.w, t: rec.t, setId: r.id });
      await loadState();
    } else if (x.w) toast(`${x.s}. This e1RM is over 3% above your 1RM. Consider testing a new max.`);
    render();
  },
  mode: async (s, d) => {
    const it = workout.items[+d.i],
      ex = exerciseById(it.exId);
    if (it.mode == d.m) return;
    if (d.m == 'pct' && !(it.ref > 0)) {
      const ref = await loadReference1RM(ex);
      if (!ref)
        return toast(
          `No 1RM for ${ex.name} yet. Add a tested 1RM in Exercises, or log a few RIR sets first.`,
        );
      it.ref = ref.w;
      it.refEst = ref.est;
    }
    it.mode = d.m;
    saveWorkout();
    render();
    rememberTrackingMode(ex, d.m);
  },
  wu: async s => {
    const r = workout.items[s.dataset.i].rows[s.dataset.j];
    r.wu = !r.wu;
    if (!r.wu) delete r.wu;
    if (r.done && r.id) {
      const x = await request(store('sets').get(r.id));
      if (x) {
        if (r.wu) {
          x.wu = true;
          x.test = false;
        } else {
          delete x.wu;
          x.test = isMaxTest(x);
        }
        await dbPut('sets', x);
      }
    }
    saveWorkout();
    render();
  },
  undo: async s => {
    const r = workout.items[s.dataset.i].rows[s.dataset.j];
    if (r.id) await dbDelete('sets', r.id);
    r.done = false;
    delete r.id;
    saveWorkout();
    render();
  },
  settings: () => {
    picker = null;
    state.view = { t: 'set' };
    render();
  },
  exNew: () => {
    draft = { name: '', mode: 'rir', inc: 2, lo: 8, hi: 12, rir: 2 };
    state.prl = [];
    state.hist = [];
    state.view = { t: 'exd' };
    render();
  },
  exOpen: async (s, d) => {
    draft = structuredClone(exerciseById(+d.i));
    state.view = { t: 'exd' };
    await openExerciseHistory(draft.id);
  },
  exSave: async () => {
    if (!draft.name.trim()) return toast('Name required');
    draft.inc = +draft.inc || 0;
    if (draft.inc < 0) return toast("Increment can't be negative");
    draft.mode = draft.mode == 'pct' ? 'pct' : 'rir';
    if (draft.bwl) draft.bwl = true;
    else delete draft.bwl;
    draft.lo ||= 8;
    draft.hi ||= Math.max(draft.lo, 12);
    draft.rir ??= 2;
    if (draft.hi < draft.lo) return toast('Reps max must be at least reps min');
    draft.wu = Math.min(4, Math.max(0, Math.round(+draft.wu || 0)));
    if (!draft.wu) delete draft.wu;
    const cur = +draft.cur || 0;
    delete draft.cur;
    if (draft.pb === '' || draft.pb == null || !(+draft.pb > 0)) delete draft.pb;
    else draft.pb = +draft.pb;
    if (cur > 0 && !(draft.pb >= cur)) draft.pb = cur; // PB can't be below your current 1RM
    const id = await dbPut('exercises', draft);
    if (cur > 0 && cur !== state.pr[id]?.w) await dbPut('pr_history', { exId: id, w: cur, t: Date.now() });
    await loadState();
    closePage();
  },
  exDel: async () => {
    if (!confirm('Delete exercise with its PRs and set history?')) return;
    for (const s of await getAll('sets', 'ex', draft.id)) await dbDelete('sets', s.id);
    for (const p of await getAll('pr_history', 'ex', draft.id)) await dbDelete('pr_history', p.id);
    await dbDelete('exercises', draft.id);
    await loadState();
    closePage();
  },
  prAdd: async () => {
    const w = +$('#prw').value,
      d = $('#prd').value;
    if (!(w > 0)) return toast('Enter the tested weight');
    await dbPut('pr_history', { exId: draft.id, w, t: new Date(d + 'T12:00').getTime() });
    const ex = exerciseById(draft.id);
    if (ex && w > (ex.pb || 0)) await dbPut('exercises', { ...ex, pb: w });
    await openExerciseHistory(draft.id);
    draft.pb = exerciseById(draft.id)?.pb;
    draft.cur = state.pr[draft.id]?.w ?? '';
    render();
  },
  prDel: async (s, d) => {
    await dbDelete('pr_history', +d.i);
    await openExerciseHistory(draft.id);
    draft.cur = state.pr[draft.id]?.w ?? '';
    render();
  },
  calnav: (s, d) => {
    let m = calendar.m + +d.d,
      y = calendar.y;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    calendar.m = m;
    calendar.y = y;
    calendar.sel = null;
    render();
  },
  caltoday: () => {
    const n = new Date();
    calendar.y = n.getFullYear();
    calendar.m = n.getMonth();
    calendar.sel = null;
    render();
  },
  calday: (s, d) => {
    calendar.sel = calendar.sel == d.k ? null : d.k;
    render();
  },
  wedOpen: (s, d) => openWorkoutEditor(+d.i),
  wedCancel: () => {
    editedWorkout = null;
    closePage();
  },
  wedSave: () => saveEditedWorkout(),
  wedRm: (s, d) => {
    editedWorkout.items[+d.k].rows.splice(+d.j, 1);
    render();
  },
  wedWu: (s, d) => {
    const r = editedWorkout.items[+d.k].rows[+d.j];
    r.wu = !r.wu;
    render();
  },
  wedRmx: (s, d) => {
    editedWorkout.items.splice(+d.k, 1);
    render();
  },
  wedAddSet: (s, d) => {
    const rs = editedWorkout.items[+d.k].rows,
      l = rs.filter(x => !x.wu).pop() || rs[rs.length - 1] || {};
    rs.push({ w: l.w ?? '', r: l.r ?? '', rir: l.rir ?? '', wu: false });
    render();
  },
  wedAdd: (s, d) => {
    editedWorkout.items.push({ exId: +d.x, rows: [{ w: '', r: '', rir: '', wu: false }] });
    editorAddQuery = '';
    render();
    const q = $('#wq');
    if (q) {
      q.scrollIntoView({ block: 'center' });
    }
  },
  wedAddNew: async () => {
    const id = await createExercise($('#wq').value);
    if (id) actions.wedAdd(null, { x: id });
  },
  wdel: async (s, d) => {
    if (!confirm('Delete this workout?')) return;
    for (const x of state.sets.filter(x => x.sess == d.i)) await dbDelete('sets', x.id);
    await loadState();
    render();
  },
  sdel: async (s, d) => {
    await dbDelete('sets', +d.i);
    await openExerciseHistory(draft.id);
  },
  tplNew: () => {
    planAddSearch = { k: null, q: '' };
    planReplace = null;
    draft = { name: '', weeks: 8, days: [{ name: 'Day 1', items: [] }] };
    state.view = { t: 'tple' };
    render();
  },
  tplEdit: (s, d) => {
    planAddSearch = { k: null, q: '' };
    planReplace = null;
    draft = structuredClone(state.tpl.find(t => t.id == d.i));
    state.view = { t: 'tple' };
    render();
  },
  tplAdd: (s, d) => {
    if (!state.ex.length) return toast('Create an exercise first');
    draft.days[+d.i].items.push({ exId: state.ex[0].id, n: 3, text: '' });
    render();
  },
  tplDelItem: (s, d) => {
    draft.days[+d.k].items.splice(+d.i, 1);
    render();
  },
  tplSave: async () => {
    if (!draft.name.trim()) return toast('Name required');
    draft.weeks = Math.min(52, Math.max(1, Math.round(+draft.weeks || 8)));
    for (const dy of draft.days) {
      if (!dy.name.trim()) dy.name = 'Day';
      for (const it of dy.items) {
        const x = exerciseById(it.exId),
          nm = x?.name || 'an exercise';
        delete it.text;
        if (it.mode != 'pct') {
          delete it.lines;
          const pk = (a, b) => (a === '' || a == null ? b : a);
          it.n = Math.round(+pk(it.n, 3));
          it.lo = Math.round(+pk(it.lo, x?.lo ?? 8));
          it.hi = Math.round(+pk(it.hi, x?.hi ?? 12));
          it.rirW = weeklyRirTargets(it, draft.weeks, x).map(v =>
            v === '' || v == null ? (x?.rir ?? 2) : +v,
          );
          delete it.rir;
          if (!(it.n >= 1 && it.n <= 20 && it.lo >= 1 && it.hi >= it.lo && it.hi <= 50))
            return toast(`Check ${nm}: sets 1–20, and reps min ≤ reps max`);
          if (!it.rirW.every(v => v >= 0 && v <= 10))
            return toast(`Check ${nm}: target RIR must be 0–10 each week`);
          continue;
        }
        for (const l of it.lines || []) {
          l.n = Math.round(+l.n);
          l.r = Math.round(+l.r);
          l.p = +l.p;
          delete l.rpe;
          if (!(l.n >= 1 && l.n <= 20 && l.r >= 1 && l.r <= 50 && l.p > 0 && l.p <= 150))
            return toast(`Check the % lines for ${nm}: sets 1–20, reps 1–50, % up to 150`);
        }
      }
    }
    await dbPut('templates', draft);
    await loadState();
    closePage();
  },
  tplDel: async () => {
    if (confirm('Delete this plan?')) {
      await dbDelete('templates', draft.id);
      await loadState();
      closePage();
    }
  },
};
