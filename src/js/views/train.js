/* Train tab: plans to start (or the workout in progress), and the workout screen itself: one card per
   exercise with a row per set, the progress bar and the rest timer. */

function updateSetInfo(s) {
  const it = workout.items[s.dataset.i];
  $('.inf>span', s).innerHTML = setInfoHtml(it, it.rows[s.dataset.j], exerciseById(it.exId));
}

// The % of the reference 1RM that `w` kg on the bar is (bodyweight included where it counts), as a whole
// number; '' when unknown.
const percentOfRef = (it, w) => {
  const t = (w === '' || w == null ? 0 : +w) + (it.bwo || 0);
  return it.ref > 0 && t > 0 && (w !== '' || it.bwo) ? Math.round((t / it.ref) * 100) : '';
};
function exerciseCard(it, i) {
  const ex = exerciseById(it.exId);
  if (!ex) return '';
  const P = it.mode == 'pct',
    pr = state.pr[ex.id];
  const ref = P
    ? it.ref > 0
      ? `${it.refEst ? 'Estimated 1RM' : '1RM'} ${fmt(it.ref)}${it.refEst ? '' : ' · ' + ageText(pr?.t)}`
      : 'No 1RM yet'
    : '';
  let h = `<div class=card><div class=hd><b style="flex:1">${esc(ex.name)}</b><span class=seg role=group aria-label="Track by"><button class="${P ? '' : 'on'}" data-a=mode data-i=${i} data-m=rir>RIR</button><button class="${P ? 'on' : ''}" data-a=mode data-i=${i} data-m=pct>% 1RM</button></span><button class=s style="width:40px" data-a=rmx data-i=${i} aria-label="Remove exercise">×</button></div><div class=m>${esc([ref, ex.bwl ? (it.bwo ? `incl. ${fmt(it.bwo)} kg bodyweight` : 'set your bodyweight in Settings (⚙)') : '', it.hint].filter(Boolean).join(' · '))}</div>`;
  h +=
    `<div class="set hdr"><span>Weight (kg)</span><span></span><span>Reps</span><span></span><span>${P ? 'RPE' : 'RIR'}</span><span></span></div>` +
    it.rows
      .map((r, j) => {
        const d = r.done ? 'disabled' : '';
        const kg = `<input data-f=w inputmode=decimal aria-label="Weight in kg, empty for bodyweight" value="${kgText(r)}" ${d}>`;
        // % view: the % of 1RM sits on the line below, directly under the kg (same column, same width);
        // both are editable and each updates the other as you type.
        const pct = P
          ? `<label class=pctin><input data-f=p inputmode=decimal aria-label="Percent of 1RM" value="${percentOfRef(it, r.w)}" ${it.ref > 0 ? d : 'disabled placeholder="–"'}><span aria-hidden="true">%</span></label>`
          : '';
        return `<div class="set${P ? ' pct' : ''} ${r.done ? 'dn' : ''}${r.wu ? ' wu' : ''}" data-i=${i} data-j=${j}>
  ${kg}
  <button class=s data-a=step data-d=-1 aria-label="One rep less" ${d}>−</button><input data-f=r inputmode=numeric placeholder=reps aria-label=Reps value="${fmt(r.r)}" ${d}><button class=s data-a=step data-d=1 aria-label="One rep more" ${d}>+</button>${rirSelect(`data-f=rir aria-label="${P ? 'RPE (10 = max effort)' : 'Reps in reserve'}" ${d}`, r.rir, { pct: P })}
  <button class="ck ${r.done ? 'on' : ''}" data-a=${r.done ? 'undo' : 'log'} aria-label="${r.done ? 'Undo set' : 'Log set'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg></button>
  ${pct}<div class=inf><span>${setInfoHtml(it, r, ex)}</span><span><button class=lk data-a=wu>${r.wu ? 'Make working set' : 'Mark as warm-up'}</button> <button class=lk data-a=rms>Remove set</button></span></div></div>`;
      })
      .join('');
  return (
    h +
    `<div class=row><button class=b data-a=addset data-i=${i}>+ Set</button><button class=b data-a=repl data-i=${i}>⇄ Replace</button></div></div>`
  );
}
// The kg field's text: weight on the bar (2 decimals at most), BW for a logged bodyweight set.
const kgText = r => (+r.w > 0 ? fmt(roundToStep(+r.w, 0.01)) : r.done ? 'BW' : '');

// The line under a set: its e1RM (RIR view) or only warnings (% view), and whether it was adjusted.
function setInfoHtml(it, r, ex) {
  const P = it.mode == 'pct',
    x = setInfo(r, ex, state.pr[ex.id]),
    adj = r.adj && !r.done ? 'adjusted' : '',
    note =
      x.s && (!P || x.w || isMaxTest(r) || r.wu) ? `<span class="${x.w ? 'wr' : ''}">${esc(x.s)}</span>` : '';
  return [note, adj].filter(Boolean).join(' · ');
}

function backupReminder() {
  const lb = lastBackupTime();
  return state.sets.length && Date.now() - lb > 6048e5
    ? `<div class=card><span class=wr>Back up your data</span><div class=m>${lb ? 'Last backup ' + ageText(lb) : 'No backup yet'}. Clearing browser data erases your history.</div><button class=b data-a=backup>Export backup</button></div>`
    : '';
}
function renderPlanCard(t) {
  if (!t.active)
    return `<div class=card><div class=hd><b>${esc(t.name)}</b><span class=m>${t.days.length} days/week · ${t.weeks} weeks</span></div><button class=b data-a=planStart data-i=${t.id}>Start plan</button></div>`;
  const p = planProgress(t);
  return (
    `<div class=card><div class=hd><b>${esc(t.name)}</b><span class=m>${t.days.length} days/week</span></div><div class=big-n>${p.done ? 'Complete' : `Week ${p.wk}<span> of ${t.weeks}</span>`}</div>${barbellProgress(t.weeks, Math.min(t.weeks, Math.floor(p.total / t.days.length)), !p.done, p.done ? 'Plan complete' : `Week ${p.wk} of ${t.weeks}`)}` +
    (p.done
      ? `<p>Plan complete: all ${t.weeks} weeks done.</p><div class=row><button class="b p" data-a=planStart data-i=${t.id}>Restart</button><button class=b data-a=planStop data-i=${t.id}>Close</button></div>`
      : t.days
          .map(
            (d, k) =>
              `<button class="b big" data-a=start data-i=${t.id} data-d=${k}>${p.wdays.has(k) ? '✓ ' : ''}${esc(d.name)}${k == p.nx ? ' · next' : ''}<small>${d.items.map(i => esc(exerciseById(i.exId)?.name || '?')).join(', ') || 'No exercises'}</small></button>`,
          )
          .join('') + `<button class=lk data-a=planStop data-i=${t.id}>End plan early</button>`) +
    `</div>`
  );
}

function progressCard() {
  const n = workout.items.length;
  if (!n) return '';
  const d = workout.items.filter(i => i.rows.length && i.rows.every(r => r.done)).length;
  return `<div class=card><div class=hd><span class=m>${d} of ${n} exercise${n == 1 ? '' : 's'} done</span><span class=m id=el>${elapsedText()}</span></div>${barbellProgress(n, d, d < n, `${d} of ${n} exercises done`)}</div>`;
}
let showTrainHome = false; // true = show the Train landing page even though a workout is in progress
let picker = null,
  pickerQuery = ''; // exercise picker state: {t:'add'|'rep', i, y}
function renderPicker() {
  const old = picker.t == 'rep' ? exerciseById(workout.items[picker.i]?.exId) : null;
  return `<div class=hd><h2>${picker.t == 'rep' ? 'Replace ' + esc(old?.name || 'exercise') : 'Add exercise'}</h2><button class=b data-a=pickCancel>Cancel</button></div><input id=pq placeholder="Type an exercise" value="${esc(pickerQuery)}" autocomplete=off enterkeyhint=done><div id=plist>${pickerResults()}</div>`;
}
function renderTrain() {
  if (!workout || showTrainHome) {
    const ps = [...state.tpl.filter(t => t.active), ...state.tpl.filter(t => !t.active)],
      cur = workout
        ? `<div class=card><div class=hd><b>Workout in progress</b><span class=m>${workout.items.reduce((n, i) => n + i.rows.filter(x => x.done).length, 0)} sets logged</span></div><div class=m>${esc(workout.name)}</div><div class=row><button class="b p" data-a=resume>Resume</button><button class=b data-a=finish>Finish</button></div></div>`
        : '';
    return (
      pageTitle('Train') +
      cur +
      backupReminder() +
      (ps.map(renderPlanCard).join('') ||
        '<p class=m>No plans yet. Build one in Plans, or start a quick workout.</p>') +
      `<button class=b data-a=start>Quick workout</button>`
    );
  }
  if (!workout.rest) workout.rest = +lsGet('rest') || 120;
  if (picker) return renderPicker();
  return (
    `<button class=b data-a=toLanding>‹ Back</button><div class=hd><h2>${esc(workout.name)}</h2><button class="b p" data-a=finish>Finish</button></div>` +
    progressCard() +
    workout.items.map(exerciseCard).join('') +
    (state.ex.length
      ? `<button class="b p" style="width:100%;margin-top:12px" data-a=pickAdd>+ Add exercise</button>`
      : '<p class=m>Create exercises first.</p>') +
    restTimerBar()
  );
}
