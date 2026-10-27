/* Event handling. Listeners sit on the app container, not on each element, because screens are redrawn as
   HTML. Typing updates the data directly (and redraws only what depends on it); swiping left/right changes tab. */

const setPath = (o, p, v) => {
  const k = p.split('.'),
    l = k.pop();
  k.forEach(x => (o = o[x]));
  o[l] = v;
};
app.addEventListener('input', e => {
  const t = e.target,
    s = t.closest('.set');
  if (editedWorkout && state.view?.t == 'wed') {
    if (t.dataset.wf != null) {
      const e = t.closest('.eset');
      editedWorkout.items[e.dataset.k].rows[e.dataset.j][t.dataset.wf] = t.value === '' ? '' : +t.value;
      if (t.tagName == 'SELECT') t.classList.toggle('ph', t.value === '');
      return;
    }
    if (t.dataset.wn != null) {
      editedWorkout.wn = t.value;
      return;
    }
    if (t.dataset.wd != null) {
      editedWorkout.date = t.value;
      return;
    }
    if (t.id == 'wq') {
      editorAddQuery = t.value;
      $('#wqs').innerHTML = editorAddResults();
      return;
    }
  }
  if (t.id == 'bwi') {
    const v = +t.value;
    if (t.value === '') {
      lsSet('bw', '');
      markDataChanged();
    } else if (v >= 20 && v <= 400) {
      lsSet('bw', v);
      markDataChanged();
    }
    $('#bmi').innerHTML = bmiText();
    return;
  }
  if (t.id == 'hti') {
    const v = +t.value;
    if (t.value === '') {
      lsSet('ht', '');
      markDataChanged();
    } else if (v >= 100 && v <= 250) {
      lsSet('ht', v);
      markDataChanged();
    }
    $('#bmi').innerHTML = bmiText();
    return;
  }
  if (t.id == 'exq') {
    exerciseFilter = t.value;
    let any = false;
    document.querySelectorAll('.exr').forEach(b => {
      const h = matchesFilter(b.dataset.q);
      b.hidden = !h;
      any ||= h;
    });
    $('#exnone').hidden = any;
    return;
  }
  if (t.id == 'pq') {
    pickerQuery = t.value;
    $('#plist').innerHTML = pickerResults();
    return;
  }
  if (t.dataset.tr != null && planReplace) {
    planReplace.q = t.value;
    $('#trs').innerHTML = planReplaceResults();
    return;
  }
  if (t.dataset.tq != null) {
    planAddSearch = { k: +t.dataset.tq, q: t.value };
    $('#tqs' + t.dataset.tq).innerHTML = planAddResults(planAddSearch.k);
    return;
  }
  if (s && t.dataset.f) {
    const r = workout.items[s.dataset.i].rows[s.dataset.j],
      f = t.dataset.f;
    const it = workout.items[s.dataset.i],
      v = t.value === '' ? '' : +t.value;
    r.auto = false;
    delete r.adj;
    if (f == 'p') {
      // % of 1RM typed: work out the kg (minus bodyweight where it's included) and show it in the kg field.
      r.w = v === '' ? '' : it.ref > 0 ? Math.max(0, (v / 100) * it.ref - (it.bwo || 0)) : '';
      $('[data-f=w]', s).value = kgText(r);
    } else {
      r[f] = v;
      if (f == 'w' && it.mode == 'pct') $('[data-f=p]', s).value = percentOfRef(it, r.w);
    }
    if (t.tagName == 'SELECT') t.classList.toggle('ph', t.value === '');
    saveWorkout();
    updateSetInfo(s);
  } else if (t.dataset.b && draft) {
    setPath(
      draft,
      t.dataset.b,
      t.type == 'checkbox' ? t.checked : t.dataset.n != null ? (t.value === '' ? '' : +t.value) : t.value,
    );
    if (t.type == 'checkbox') render();
  }
});
app.addEventListener('change', e => {
  if (e.target.id == 'imp') importData(e.target.files[0]);
  else if (e.target.dataset.dpw != null) setDaysPerWeek(+e.target.value);
  else if (e.target.dataset.rr != null) render();
});
app.addEventListener('focusin', e => {
  const t = e.target;
  if (t.dataset?.tq == null || planAddSearch.k === +t.dataset.tq) return;
  const old = planAddSearch.k;
  planAddSearch = { k: +t.dataset.tq, q: t.value };
  if (old != null) {
    const ob = $('#tqs' + old);
    if (ob) ob.innerHTML = '';
  }
  $('#tqs' + planAddSearch.k).innerHTML = planAddResults(planAddSearch.k);
});
app.addEventListener('keydown', e => {
  if (e.key != 'Enter') return;
  const t = e.target,
    box =
      t.id == 'pq'
        ? $('#plist')
        : t.id == 'wq'
          ? $('#wqs')
          : t.dataset?.tr != null
            ? $('#trs')
            : t.dataset?.tq != null
              ? $('#tqs' + t.dataset.tq)
              : null;
  if (!box) return;
  e.preventDefault();
  box.querySelector('.sg,.chip')?.click();
});
app.addEventListener('submit', e => {
  if (e.target.id == 'ghf') {
    e.preventDefault();
    actions.ghSave();
  }
});
const TAB_ORDER = ['train', 'hist', 'tpl', 'ex'],
  TAB_NAMES = { train: 'Train', hist: 'History', tpl: 'Plans', ex: 'Exercises' };
let swipeX,
  swipeY,
  swipeState,
  swipeDx,
  slideDir = 0;
const SWIPE_DISTANCE = 70;
const swipeHint = () => {
  let h = $('#sh');
  if (!h) {
    h = document.createElement('div');
    h.id = 'sh';
    document.body.appendChild(h);
  }
  return h;
};
const endSwipe = () => {
  const m = $('main');
  if (m) {
    m.style.transition = 'transform .18s,opacity .18s';
    m.style.transform = '';
    m.style.opacity = '';
  }
  $('#sh')?.remove();
  document.querySelectorAll('nav button.nx').forEach(x => x.classList.remove('nx'));
  swipeState = 0;
};
document.addEventListener(
  'touchstart',
  e => {
    swipeState = 0;
    if (e.touches.length != 1 || state.view || e.target.closest('input,textarea,select,nav,[data-noswipe]'))
      return;
    const t = e.touches[0];
    swipeX = t.clientX;
    swipeY = t.clientY;
    swipeState = 1;
    swipeDx = 0;
    const m = $('main');
    if (m) m.style.transition = 'none';
  },
  { passive: true },
);
document.addEventListener(
  'touchmove',
  e => {
    if (!swipeState) return;
    const t = e.touches[0],
      dx = t.clientX - swipeX,
      dy = t.clientY - swipeY;
    if (swipeState == 1) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        swipeState = 0;
        return;
      }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      swipeState = 2;
    }
    const i = TAB_ORDER.indexOf(state.tab),
      j = i + (dx < 0 ? 1 : -1),
      ok = j >= 0 && j < TAB_ORDER.length,
      m = $('main');
    if (!m) return;
    const k = Math.min(1, Math.abs(dx) / SWIPE_DISTANCE);
    swipeDx = ok ? dx : 0;
    m.style.transform = `translateX(${dx * (ok ? 0.55 : 0.15)}px)`;
    m.style.opacity = ok ? 1 - 0.35 * k : 1;
    document
      .querySelectorAll('nav button')
      .forEach((x, n) => x.classList.toggle('nx', ok && n == j && k >= 1));
    const h = swipeHint();
    if (ok) {
      h.textContent = (dx < 0 ? '' : '‹ ') + TAB_NAMES[TAB_ORDER[j]] + (dx < 0 ? ' ›' : '');
      h.className = (dx < 0 ? 'r ' : 'l ') + (k >= 1 ? 'go' : '');
      h.style.opacity = Math.min(1, k * 1.4);
    } else h.style.opacity = 0;
  },
  { passive: true },
);
document.addEventListener(
  'touchend',
  e => {
    if (swipeState != 2) {
      swipeState = 0;
      return;
    }
    const dx = swipeDx,
      i = TAB_ORDER.indexOf(state.tab),
      j = i + (dx < 0 ? 1 : -1);
    if (Math.abs(dx) >= SWIPE_DISTANCE && j >= 0 && j < TAB_ORDER.length) {
      $('#sh')?.remove();
      swipeState = 0;
      slideDir = dx < 0 ? 1 : -1;
      actions.tab(null, { i: TAB_ORDER[j] });
    } else endSwipe();
  },
  { passive: true },
);
document.addEventListener('touchcancel', endSwipe, { passive: true });
app.addEventListener('click', e => {
  const b = e.target.closest('[data-a]');
  if (b && !b.disabled) actions[b.dataset.a]?.(b.closest('.set'), b.dataset);
});
