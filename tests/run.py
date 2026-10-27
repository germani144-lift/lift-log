#!/usr/bin/env python3
"""Lift Log test suite. Runs the real app in headless Chromium and checks that nothing broke.

    pip install playwright && python3 -m playwright install chromium   # once
    python3 tests/run.py                  # run everything
    python3 tests/run.py suggest backup   # run tests whose name contains any of these words

Each test gets a fresh browser profile (empty IndexedDB). Exit code 0 = all passed.
"""
import functools, http.server, json, pathlib, re, socket, subprocess, sys, threading, time, traceback
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def serve():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    H = functools.partial(Quiet, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}/index.html"


class App:
    """A fresh app instance in its own browser context."""

    def __init__(self, browser, url):
        self.ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, service_workers="block")
        self.pg = self.ctx.new_page()
        self.errors, self.dialogs = [], []
        self.pg.on("pageerror", lambda e: self.errors.append(str(e)))
        self.pg.on("console", lambda m: m.type == "error" and self.errors.append(m.text))
        self.pg.on("dialog", lambda d: (self.dialogs.append(d.message), d.accept("90")))
        self.pg.goto(url)
        try:
            self.pg.wait_for_function("typeof state!=='undefined'&&document.querySelector('nav')", timeout=8000)
        except Exception:
            raise AssertionError("app didn't start (blocked script? wrong CSP hash?) " + "; ".join(self.errors)[:300])

    def js(self, expr, arg=None):
        return self.pg.evaluate(expr, arg)

    def click(self, sel):
        self.pg.locator(sel).first.click(); self.pg.wait_for_timeout(120)

    def fill(self, sel, v):
        loc = self.pg.locator(sel).first
        if loc.evaluate("e=>e.tagName") == "SELECT":   # RIR/RPE are picked from a list
            loc.select_option(value=str(v))
        else:
            loc.fill(str(v))

    def tab(self, name):
        self.click(f'nav button:has-text("{name}")')

    def settings(self):
        self.tab("Exercises"); self.click("[data-a=settings]")

    def state(self):
        return self.js("({tab:state.tab,ex:state.ex.length,tpl:state.tpl.length,sets:state.sets.length,w:!!workout,"
                       "rows:workout?workout.items.map(i=>i.rows.length+':'+i.rows.filter(r=>r.done).length).join(','):'',"
                       "view:state.view&&state.view.t,pick:!!picker})")

    def new_exercise(self, name, **f):
        self.tab("Exercises"); self.click("[data-a=exNew]"); self.fill("input[data-b=name]", name)
        mode = f.pop("mode", None)
        for k, v in f.items():
            self.fill(f"input[data-b={k}]", v)
        self.click("[data-a=exSave]")
        self.pg.wait_for_function("n=>!state.view&&state.ex.some(e=>e.name==n)", arg=name, timeout=5000)  # saving is async
        if mode:   # last-used mode (no longer a setting in the editor)
            self.js("async([n,m])=>{const e=state.ex.find(x=>x.name==n);e.mode=m;await dbPut('exercises',e)}", [name, mode])

    def seed_sets(self, ex_name, sessions):
        """sessions: list of lists of (w, r, rir[, warmup]) — oldest first, one day apart."""
        self.js("""async([n,ss])=>{const ex=state.ex.find(e=>e.name==n);let t=Date.now()-(ss.length+1)*864e5;
          for(const s of ss){t+=864e5;let k=0;for(const [w,r,rir,wu] of s){const o={exId:ex.id,sess:t,wn:'Seed',t:t+(k++)*1000,w,r,rir};if(wu)o.wu=true;await dbPut('sets',o)}}
          await loadState();render()}""", [ex_name, sessions])

    def suggest(self, ex_name, n=3, **over):
        return self.js("async([n,k,o])=>{const ex={...state.ex.find(e=>e.name==n),...o};const g=suggestSets(ex,k,await getAll('sets','ex',ex.id));return g.rows.map(r=>[r.w,r.r])}",
                       [ex_name, n, over])

    def close(self):
        self.ctx.close()


def eq(a, b, msg=""):
    if a != b:
        raise AssertionError(f"{msg}\n    expected: {b!r}\n    got:      {a!r}")


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ---------------------------------------------------------------- tests

@test
def build_and_security_checks(app):
    r = subprocess.run([sys.executable, str(ROOT / "tools/build.py"), "--check"], capture_output=True, text=True)
    ok(r.returncode == 0, r.stdout + r.stderr)


@test
def loads_without_errors(app):
    eq(app.errors, [], "console errors on load (a wrong CSP hash shows up here)")
    eq(app.js("document.querySelectorAll('nav button').length"), 4)
    app.pg.wait_for_selector("#splash", state="detached", timeout=6000)


@test
def version_is_shown(app):
    v = app.js("VER")
    ok(__import__("re").fullmatch(r"\d+\.\d+", v), f"VER should look like 1.4, got {v!r}")
    eq(app.js("document.getElementById('sver')?.textContent"), "v" + v, "splash shows the version")
    app.settings()
    ok(f"Lift Log v{v}" in app.pg.inner_text("main"), "Settings shows the version")


@test
def main_flow(app):
    """Exercises -> plan -> workout (log, undo, add/remove set, rest timer, replace) -> finish -> history."""
    app.new_exercise("Weighted dips", inc=2)
    app.new_exercise("Deadlift", mode="pct", cur=170, pb=216)
    app.new_exercise("Bench")
    eq(app.state()["ex"], 3)
    eq(app.js("state.pr[state.ex.find(e=>e.name=='Deadlift').id].w"), 170, "current 1RM saved")
    app.tab("Plans"); app.click("[data-a=tplNew]"); app.fill("input[data-b=name]", "Upper lower")
    app.pg.select_option("select[data-dpw]", "2"); app.fill('input[data-b="days.0.name"]', "Upper")
    app.click('[data-tq="0"]'); app.pg.keyboard.type("Weighted"); app.pg.keyboard.press("Enter"); app.pg.wait_for_timeout(150)
    app.click("[data-a=tplSave]")
    eq(app.js("state.tpl[0].days[0].items.map(i=>exerciseById(i.exId).name)"), ["Weighted dips"])
    app.tab("Train"); app.click("[data-a=planStart]"); app.click('[data-a=start][data-d="0"]')
    eq(app.state()["rows"], "3:0", "plan day starts with 3 sets")
    app.click("[data-a=pickAdd]"); app.pg.keyboard.type("Bench"); app.pg.keyboard.press("Enter"); app.pg.wait_for_timeout(200)
    eq(app.state()["rows"], "3:0,3:0")
    row = '.set[data-j="0"] >> nth=0 >> '
    app.fill(row + "input[data-f=w]", 40); app.fill(row + "input[data-f=r]", 10); app.fill(row + "[data-f=rir]", 2)
    app.click(row + "[data-a=step][data-d='1']"); app.click(row + "[data-a=step][data-d='1']"); app.click(row + "[data-a=step][data-d='-1']")
    eq((app.pg.input_value(row + "input[data-f=r]"), app.pg.input_value(row + "input[data-f=w]")), ("11", "40"), "−/+ change the reps, not the weight")
    eq(app.js("workout.items[0].rows[0].r"), 11, "stepped reps are saved")
    app.click(row + "[data-a=log]")
    eq(app.state()["rows"], "3:1,3:0", "set logged")
    ok(app.js("workout.restEnd>Date.now()"), "rest timer starts after logging")
    rest = app.js("workout.rest"); app.click("[data-a=rinc]"); eq(app.js("workout.rest"), rest + 15, "+15 s")
    app.click("[data-a=undo]"); eq(app.state()["rows"], "3:0,3:0", "undo")
    app.click(row + "[data-a=log]"); app.click("[data-a=addset]"); eq(app.state()["rows"], "4:1,3:0", "add set")
    app.click(".card:has([data-a=addset]) >> nth=1 >> [data-a=rms] >> nth=-1"); eq(app.state()["rows"], "4:1,2:0", "remove set")
    app.click("[data-a=toLanding]"); ok(app.js("showTrainHome"), "back to landing"); app.click("[data-a=resume]")
    app.click("[data-a=finish]"); app.pg.wait_for_timeout(200)
    st = app.state(); eq((st["w"], st["sets"]), (False, 1), "finish saves the logged set")
    app.tab("History"); app.click(".cd.tr"); ok("Weighted dips" in app.pg.inner_text("main"), "history shows the workout")
    eq(app.js("planProgress(state.tpl[0]).total"), 1, "plan progress counts the workout")
    eq(app.errors, [])


@test
def suggestions_progress_and_ignore_warmups(app):
    app.new_exercise("Squat", lo=5, hi=8)
    # steady progress, with a warm-up ladder each session
    app.seed_sets("Squat", [[(40, 8, None, 1), (60, 5, None, 1)] + [(100 + 2 * i, 6, 2)] * 3 for i in range(4)])
    rows = app.suggest("Squat")
    eq(rows[0], [106, 7], "one more rep at last session's weight (warm-ups ignored)")
    eq([r[1] for r in rows], [7, 7, 6], "fatigue: a rep fewer from the 3rd set")
    eq(len({r[0] for r in rows}), 1, "same weight on all working sets")


@test
def suggestions_never_use_warmup_weights(app):
    app.new_exercise("Deadlift", lo=5, hi=8)
    # a heavy warm-up (94x5) sits inside today's 5-8 range; the working sets (100x4) are below it.
    # Counting the warm-up would suggest 94x7; from the working sets alone it's 98x5.
    app.seed_sets("Deadlift", [[(94, 5, 3, 1), (100, 4, 2), (100, 4, 2)]] * 3)
    eq(app.suggest("Deadlift")[0], [98, 5], "suggestion must come from the working sets, not the warm-up")


@test
def suggestions_move_weight_at_range_edges(app):
    app.new_exercise("Row", lo=6, hi=10)
    app.seed_sets("Row", [[(60, 10, 2)] * 3] * 3)  # top of range at target RIR -> heavier, reset reps
    w, r = app.suggest("Row")[0]
    ok(w > 60 and r == 6, f"expected heavier weight at 6 reps, got {w}x{r}")
    app.new_exercise("Press", lo=8, hi=12)
    app.seed_sets("Press", [[(50, 6, 0)] * 3] * 3)  # couldn't reach the range -> lighter
    w, r = app.suggest("Press")[0]
    ok(w < 50 and r == 8, f"expected lighter weight at 8 reps, got {w}x{r}")


@test
def suggestions_guard_against_one_bad_day(app):
    app.new_exercise("Bench", lo=5, hi=8)
    app.seed_sets("Bench", [[(80, 7, 2)] * 3] * 3 + [[(80, 4, 0)] * 3])  # last session was awful
    w, r = app.suggest("Bench")[0]
    ok(w == 80 and r >= 5, f"one bad day shouldn't crater the suggestion, got {w}x{r}")


@test
def suggestions_bodyweight_and_no_history(app):
    app.new_exercise("Pull-ups", inc=0, lo=6, hi=12)
    eq(app.suggest("Pull-ups")[0], ["", 6], "no history: bottom of range, no weight")
    app.seed_sets("Pull-ups", [[(0, 8, 2)] * 3] * 3)
    eq(app.suggest("Pull-ups")[0][1], 9, "bodyweight: one more rep")


@test
def empty_weight_means_bodyweight(app):
    app.new_exercise("Pull-ups", inc=2, lo=6, hi=10)        # an exercise that *can* take weight
    app.tab("Train"); app.click("[data-a=start]"); app.click("[data-a=pickAdd]"); app.click("#plist .chip")
    row = '.set[data-j="0"] >> '
    eq((app.pg.input_value(row + "input[data-f=w]"), app.pg.get_attribute(row + "input[data-f=w]", "placeholder")), ("", None), "an unlogged empty weight stays empty")
    app.fill(row + "input[data-f=w]", ""); app.fill(row + "input[data-f=r]", 8); app.fill(row + "[data-f=rir]", 2)
    app.click(row + "[data-a=log]")
    eq(app.dialogs, [], "no prompt")
    ok(app.js("workout.items[0].rows[0].done"), "a set with no weight logs as bodyweight")
    last = app.js("(async()=>(await getAll('sets')).pop())()")
    eq((last["w"], last["r"]), (0, 8), "saved as 0 kg")
    eq(app.pg.input_value(row + "input[data-f=w]"), "BW", "once logged, an empty weight shows BW")
    app.click("[data-a=finish]"); app.tab("History"); app.click(".cd.tr")
    ok("BW × 8" in app.pg.inner_text("main"), "history shows BW")
    app.seed_sets("Pull-ups", [[(0, 8, 2)] * 3] * 2)
    eq(app.suggest("Pull-ups")[0], ["", 9], "after bodyweight sessions: no weight, one more rep")


@test
def edit_a_past_workout(app):
    app.new_exercise("Squat"); app.new_exercise("Curl", inc=1)
    app.seed_sets("Squat", [[(100, 5, 2), (100, 5, 2), (60, 8, None, 1)]])
    before = app.js("(async()=>(await getAll('sets')).sort((a,b)=>a.t-b.t))()")
    sess = before[0]["sess"]
    app.tab("History"); app.click(f'[data-a=wedOpen][data-i="{sess}"]'); eq(app.state()["view"], "wed")
    # cancel discards
    app.fill('.eset[data-k="0"][data-j="0"] input[data-wf=w]', 999); app.click("[data-a=wedCancel]")
    eq(app.js("(async()=>(await getAll('sets')).map(s=>s.w))()"), [100, 100, 60], "Cancel changes nothing")
    app.click(f'[data-a=wedOpen][data-i="{sess}"]')
    app.fill('.eset[data-k="0"][data-j="0"] input[data-wf=w]', 105)      # change a weight
    app.fill('.eset[data-k="0"][data-j="0"] [data-wf=rir]', 1)      # and its RIR
    app.click('[data-a=wedRm][data-k="0"][data-j="1"]')                   # remove the 2nd set
    app.click('[data-a=wedAddSet][data-k="0"]')                           # add a set (copies the last working set)
    app.click('#wq'); app.pg.keyboard.type("Curl"); app.pg.keyboard.press("Enter"); app.pg.wait_for_timeout(150)
    app.fill('.eset[data-k="1"][data-j="0"] input[data-wf=w]', 12); app.fill('.eset[data-k="1"][data-j="0"] input[data-wf=r]', 10)
    app.fill("input[data-wn]", "Leg day")
    app.pg.fill("input[data-wd]", app.js(f"dayKey({sess}-864e5)"))           # moved to the day before
    app.click("[data-a=wedSave]"); app.pg.wait_for_timeout(300)
    after = app.js("(async()=>(await getAll('sets')).sort((a,b)=>a.t-b.t).map(s=>[exerciseById(s.exId).name,s.w,s.r,s.rir,!!s.wu,s.wn,s.sess]))()")
    new_sess = sess - 86400000
    eq(after, [["Squat", 105, 5, 1, False, "Leg day", new_sess], ["Squat", 60, 8, None, True, "Leg day", new_sess],
               ["Squat", 105, 5, 1, False, "Leg day", new_sess], ["Curl", 12, 10, None, False, "Leg day", new_sess]], "saved edits")
    eq(app.js("(async()=>(await getAll('sets')).sort((a,b)=>a.t-b.t)[0].id)()"), before[0]["id"], "edited set keeps its id")
    app.click(f'[data-a=wedOpen][data-i="{new_sess}"]'); app.fill('.eset[data-k="1"][data-j="0"] input[data-wf=r]', "")
    app.click("[data-a=wedSave]"); ok(app.state()["view"] == "wed", "can't save a set without reps")
    app.pg.go_back(); app.pg.wait_for_timeout(150); eq(app.state()["view"], None, "back gesture closes the editor")


def _plan_one(app, name, mode=None, line=None):
    """Make an active one-day plan with a single exercise and start its workout."""
    app.tab("Plans"); app.click("[data-a=tplNew]"); app.fill("input[data-b=name]", "P")
    app.click('[data-tq="0"]'); app.pg.keyboard.type(name); app.pg.keyboard.press("Enter"); app.pg.wait_for_timeout(150)
    if mode:
        app.click(f'[data-a=tplMode][data-m={mode}]')
    if line:
        for k, v in line.items():
            app.fill(f'input[data-b="days.0.items.0.lines.0.{k}"]', v)
    app.click("[data-a=tplSave]")
    app.tab("Train"); app.click("[data-a=planStart]"); app.click('[data-a=start][data-d="0"]')


@test
def percent_plan_and_switching_views(app):
    app.new_exercise("Clean", inc=2, cur=100)             # default tracking: RIR
    _plan_one(app, "Clean", "pct", {"n": 3, "r": 2, "p": 70})
    eq(app.js("state.tpl[0].days[0].items[0].mode"), "pct")
    eq(app.js("state.tpl[0].days[0].items[0].lines"), [{"n": 3, "r": 2, "p": 70}], "plan lines: sets x reps @ %")
    eq(app.js("workout.items[0].mode"), "pct", "workout starts in the plan's mode")
    eq([r["w"] for r in app.js("workout.items[0].rows")], [70, 70, 70], "no history yet: exactly the plan, 70% of 100")
    hdr = app.pg.inner_text(".set.hdr")
    ok("Weight (kg)" in hdr and "RPE" in hdr, f"% view headers, got {hdr!r}")
    row = lambda j: f'.set[data-j="{j}"] >> '
    eq((app.pg.input_value(row(0) + "input[data-f=w]"), app.pg.input_value(row(0) + "input[data-f=p]"), app.pg.input_value(row(0) + "[data-f=rir]")),
       ("70", "70", ""), "shows kg first, the % under it, and an empty RPE to fill in")
    def log(j, rpe):
        app.fill(row(j) + "[data-f=rir]", 10 - rpe); app.pg.locator(row(j) + "[data-f=rir]").dispatch_event("input"); app.click(row(j) + "[data-a=log]")
    log(0, 7)
    saved = app.js("(async()=>(await getAll('sets')).pop())()")
    eq((saved["w"], saved["r"], saved["rir"]), (70, 2, 3), "RPE 7 is stored as RIR 3")
    eq(app.js("workout.items[0].rows[1].w"), 70, "first set with no history: nothing to compare with yet")
    app.click("[data-a=mode][data-m=rir]")
    eq((app.pg.input_value(row(0) + "input[data-f=w]"), app.pg.input_value(row(0) + "[data-f=rir]")), ("70", "3"), "RIR view: same set as kg and RIR")
    app.click("[data-a=mode][data-m=pct]")
    log(1, 9)                                              # same weight felt much harder than set 1
    w = app.js("workout.items[0].rows[2].w")
    ok(63 <= w < 70 and app.js("workout.items[0].rows[2].adj"), f"harder than the first set: the next one gets lighter (max -10%), got {w}")
    ok("adjusted" in app.pg.inner_text(row(2) + ".inf"), "shows that it adjusted")


@test
def percent_view_kg_and_percent_update_each_other(app):
    app.new_exercise("Clean", inc=2.5, cur=120)
    _plan_one(app, "Clean", "pct", {"n": 2, "r": 2, "p": 75})
    row = '.set[data-j="0"] >> '
    kg, pc = row + "input[data-f=w]", row + "input[data-f=p]"
    eq((app.pg.input_value(kg), app.pg.input_value(pc)), ("90", "75"), "75% of 120 = 90 kg")
    app.pg.locator(kg).fill("96")                            # typing kg (fill sends input events like a phone)
    eq((app.pg.input_value(pc), app.js("workout.items[0].rows[0].w")), ("80", 96), "kg typed: the % follows as you type")
    app.pg.locator(pc).fill("85")
    eq((app.pg.input_value(kg), app.js("workout.items[0].rows[0].w")), ("102", 102), "% typed: the kg follows")
    app.pg.locator(pc).fill("82.5")
    eq(app.pg.input_value(kg), "99", "82.5% of 120 = 99 kg")
    app.pg.locator(pc).fill("81")
    eq((app.pg.input_value(kg), app.js("workout.items[0].rows[0].w")), ("97", 97), "81% of 120 = 97.2: kg from a % is whole kilos")
    app.pg.locator(kg).fill("97"); app.pg.locator(kg).fill("100")
    eq(app.pg.input_value(pc), "83", "% has no decimals (100/120 = 83.3)")
    app.pg.locator(pc).fill("")
    eq((app.pg.input_value(kg), app.js("workout.items[0].rows[0].w")), ("", ""), "clearing the % clears the kg")
    app.pg.locator(kg).fill("100"); app.click(row + "[data-a=log]")
    eq(app.js("(async()=>(await getAll('sets')).pop().w)()"), 100, "the kg is what gets logged")
    eq(app.pg.input_value(pc), "83", "logged set still shows its %")
    eq(app.errors, [])


@test
def percent_sets_follow_your_history(app):
    app.new_exercise("Clean", inc=2, cur=100)
    app.seed_sets("Clean", [[(70, 2, 3)] * 3] * 4)          # 70x2 usually feels like RPE 7
    _plan_one(app, "Clean", "pct", {"n": 4, "r": 2, "p": 70})
    eq([r["w"] for r in app.js("workout.items[0].rows")], [70] * 4, "steady history: start at the plan")
    row = lambda j: f'.set[data-j="{j}"] >> '
    app.fill(row(1) + "input[data-f=w]", 74); app.pg.locator(row(1) + "input[data-f=w]").dispatch_event("input")   # my own choice for set 2
    app.fill(row(0) + "[data-f=rir]", 1); app.pg.locator(row(0) + "[data-f=rir]").dispatch_event("input")
    app.click(row(0) + "[data-a=log]")                      # today 70x2 is an RPE 9 (= 1 RIR)
    rows = app.js("workout.items[0].rows")
    ok(63 <= rows[2]["w"] < 70, f"harder than usual: later sets get lighter, got {rows[2]['w']}")
    eq(round(rows[1]["w"], 2), 74, "a set you edited yourself is left alone")
    # next time: recent sessions felt harder than the longer run, so the plan starts lighter
    app.click("[data-a=finish]")
    app.seed_sets("Clean", [[(70, 2, 0)] * 3] * 2)
    app.tab("Train"); app.click('[data-a=start][data-d="0"]')
    w0 = app.js("workout.items[0].rows[0].w")
    ok(63 <= w0 < 70, f"recent sessions harder than usual: start below the plan, got {w0}")
    ok("vs plan from recent sessions" in app.pg.inner_text(".card:has([data-a=addset])"), "says why")


@test
def rir_plan_targets_change_by_week(app):
    app.new_exercise("Bench", lo=8, hi=12)
    app.tab("Plans"); app.click("[data-a=tplNew]"); app.fill("input[data-b=name]", "P"); app.fill("input[data-b=weeks]", 2)
    app.pg.locator("input[data-b=weeks]").dispatch_event("input")
    app.click('[data-tq="0"]'); app.pg.keyboard.type("Bench"); app.pg.keyboard.press("Enter"); app.pg.wait_for_timeout(150)
    eq(app.pg.locator(".wkr select").count(), 2, "one RIR box per week")
    app.fill('input[data-b="days.0.items.0.lo"]', 5); app.fill('input[data-b="days.0.items.0.hi"]', 6)
    app.fill('[data-b="days.0.items.0.rirW.0"]', 3); app.fill('[data-b="days.0.items.0.rirW.1"]', 1)
    app.click("[data-a=tplSave]")
    it = app.js("state.tpl[0].days[0].items[0]")
    eq((it["lo"], it["hi"], it["rirW"]), (5, 6, [3, 1]), "the plan keeps its own rep range and weekly RIR")
    app.tab("Train"); app.click("[data-a=planStart]"); app.click('[data-a=start][data-d="0"]')
    eq((app.js("workout.items[0].rirT"), app.js("workout.items[0].lo"), app.js("workout.items[0].hi")), (3, 5, 6), "week 1 uses W1")
    row = '.set[data-j="0"] >> '
    app.fill(row + "input[data-f=w]", 80); app.pg.locator(row + "input[data-f=w]").dispatch_event("input"); app.click(row + "[data-a=log]")
    app.click("[data-a=finish]"); app.tab("Train"); app.click('[data-a=start][data-d="0"]')
    eq(app.js("workout.items[0].rirT"), 1, "week 2 uses W2")


@test
def rir_view_adjusts_next_sets_too(app):
    app.new_exercise("Squat", lo=5, hi=8)
    app.seed_sets("Squat", [[(100, 6, 2)] * 3] * 2)
    app.tab("Train"); app.click("[data-a=start]"); app.click("[data-a=pickAdd]"); app.click("#plist .chip")
    row = lambda j: f'.set[data-j="{j}"] >> '
    app.fill(row(0) + "input[data-f=w]", 100); app.fill(row(0) + "input[data-f=r]", 8); app.fill(row(0) + "[data-f=rir]", 4)
    for f in ("w", "r", "rir"):
        app.pg.locator(row(0) + f"[data-f={f}]").dispatch_event("input")
    app.click(row(0) + "[data-a=log]")                     # way easier than the 2-RIR target
    w, r = app.js("[workout.items[0].rows[1].w,workout.items[0].rows[1].r]")
    ok(w > 100 and r <= 8, f"next set should get heavier within the rep range, got {w}x{r}")


@test
def old_text_plans_and_backups_keep_working(app):
    app.new_exercise("Clean", mode="pct", cur=100)
    app.js("(async()=>{await dbPut('templates',{name:'Old',weeks:8,days:[{name:'D',items:[{exId:state.ex[0].id,text:'3*80%x2\\n2*85%x1'}]}]});await loadState();render()})()")
    app.pg.wait_for_timeout(200)
    it = app.js("state.tpl[0].days[0].items[0]")
    eq((it["mode"], it["lines"]), ("pct", [{"n": 3, "p": 80, "r": 2}, {"n": 2, "p": 85, "r": 1}]), "old text turns into lines")
    app.js("(async()=>{const t=state.tpl[0];await dbPut('templates',t)})()")
    d = app.js("(async()=>{const d={app:'liftlog',v:1};for(const n of STORES)d[n]=await getAll(n);return sanitizeBackup(d)})()")
    ci = d["templates"][0]["days"][0]["items"][0]
    eq((ci["mode"], ci["lines"][1]), ("pct", {"n": 2, "r": 1, "p": 85}), "backup keeps mode and lines")


@test
def exercises_have_no_tracking_type_but_remember_the_last_one(app):
    app.new_exercise("Clean", cur=100)
    app.click("[data-a=exOpen]")
    eq(app.pg.locator("select[data-b=mode]").count(), 0, "no tracking setting on the exercise")
    app.click("[data-a=back]")
    ok("RIR" not in app.pg.inner_text(".exr") and "% of 1RM" not in app.pg.inner_text(".exr"), "the list doesn't show a tracking type")
    app.tab("Train"); app.click("[data-a=start]"); app.click("[data-a=pickAdd]"); app.click("#plist .chip")
    eq(app.js("workout.items[0].mode"), "rir", "starts in RIR")
    app.click("[data-a=mode][data-m=pct]"); app.pg.wait_for_timeout(150)
    app.click("[data-a=pickAdd]"); app.click("#plist .chip")
    eq(app.js("workout.items[1].mode"), "pct", "next time it starts in the mode you used last")


@test
def chart_shows_date_and_value_on_touch(app):
    app.new_exercise("Squat")
    app.seed_sets("Squat", [[(80, 5, 2)], [(90, 5, 2)], [(100, 5, 2)]])
    app.click("[data-a=exOpen]")
    sv = app.pg.locator("svg.chart").first
    sv.scroll_into_view_if_needed(); app.pg.wait_for_timeout(150)
    eq(app.js("document.querySelector('svg.chart .tip').getAttribute('visibility')"), "hidden", "no label until you touch")
    box = sv.bounding_box()
    app.pg.mouse.move(box["x"] + box["width"] * 0.97, box["y"] + box["height"] * 0.5)   # far right = newest session
    label = app.js("document.querySelector('svg.chart .tip text').textContent")
    ok(label.endswith("· 100 kg"), f"label shows the value, got {label!r}")
    ok(any(m in label for m in ("Oct", "Nov", "Dec", "Jan", "Sep")) or label[0].isdigit(), f"label shows the date, got {label!r}")
    app.pg.mouse.move(box["x"] + box["width"] * 0.13, box["y"] + box["height"] * 0.5)   # far left = oldest
    ok(app.js("document.querySelector('svg.chart .tip text').textContent").endswith("· 80 kg"), "follows your finger")
    app.pg.mouse.click(box["x"] + 5, box["y"] - 40)
    eq(app.js("document.querySelector('svg.chart .tip').getAttribute('visibility')"), "hidden", "tap elsewhere hides it")


@test
def bodyweight_lifts_use_total_load(app):
    app.settings(); app.fill("#bwi", 80); app.pg.locator("#bwi").dispatch_event("input")
    eq(app.js("bodyweight()"), 80, "bodyweight saved")
    app.new_exercise("Pull-ups", inc=2, lo=6, hi=10, cur=40)          # 1RM is +40 kg
    app.click("[data-a=exOpen]"); app.click("input[data-b=bwl]"); app.click("[data-a=exSave]")
    eq(app.js("state.ex[0].bwl"), True)
    ok("+40" in app.pg.inner_text(".exr"), "list shows the 1RM as added kg")
    # % plan: 80% of (80 + 40) = 96 kg total = +16 kg on the belt
    _plan_one(app, "Pull-ups", "pct", {"n": 3, "r": 3, "p": 80})
    eq([r["w"] for r in app.js("workout.items[0].rows")], [16, 16, 16], "80% of 120 kg total, minus 80 kg bodyweight")
    row = '.set[data-j="0"] >> '
    eq((app.pg.input_value(row + "input[data-f=w]"), app.pg.input_value(row + "input[data-f=p]")), ("16", "80"), "kg to add (16), and 80% of the total")
    ok("incl. 80 kg bodyweight" in app.pg.inner_text(".card:has([data-a=addset])"), "says bodyweight is included")
    app.click(row + "[data-a=log]")
    eq(app.js("(async()=>(await getAll('sets')).pop().bw)()"), 80, "logged set remembers the bodyweight")


@test
def bodyweight_sets_count_toward_strength(app):
    app.settings(); app.fill("#bwi", 80); app.pg.locator("#bwi").dispatch_event("input")
    app.new_exercise("Dips", inc=2, lo=6, hi=10)
    app.js("(async()=>{const e=state.ex[0];e.bwl=true;await dbPut('exercises',e);await loadState()})()")
    app.seed_sets("Dips", [[(0, 10, 2)] * 3] * 2)                     # 10 bodyweight dips @ 2 RIR, twice
    eq(app.suggest("Dips")[0], [8, 6], "top of the range at bodyweight: add weight (+8 kg x 6), not just reps")
    d = app.js("(async()=>{const d={app:'liftlog',v:1};for(const n of STORES)d[n]=await getAll(n);d.bw=bodyweight();return sanitizeBackup(d)})()")
    eq((d["bw"], d["exercises"][0]["bwl"]), (80, True), "backup keeps bodyweight and the flag")


@test
def rir_is_picked_and_5plus_is_ignored_for_suggestions(app):
    app.new_exercise("Squat", lo=5, hi=8)
    app.seed_sets("Squat", [[(100, 6, 2)] * 3] * 2)
    before = app.suggest("Squat")
    app.tab("Train"); app.click("[data-a=start]"); app.click("[data-a=pickAdd]"); app.click("#plist .chip")
    row = '.set[data-j="0"] >> '
    opts = app.js("[...document.querySelector('.set[data-j=\"0\"] [data-f=rir]').options].map(o=>o.textContent)")
    eq(opts, ["RIR", "0", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5+"], "0-5 in half steps, then 5+")
    app.fill(row + "[data-f=w]", 60); app.pg.locator(row + "[data-f=w]").dispatch_event("input")
    app.fill(row + "[data-f=rir]", 6); app.click(row + "[data-a=log]")
    eq(app.js("(async()=>(await getAll('sets')).pop().rir)()"), 6, "5+ is stored")
    ok("not used for suggestions" in app.pg.inner_text(row + ".inf"), "says it's not used")
    eq(app.js("workout.items[0].rows[1].adj||false"), False, "a 5+ set doesn't adjust the next sets")
    app.click("[data-a=finish]"); app.tab("History"); app.click(".cd.td")
    ok("RIR 5+" in app.pg.inner_text("main"), "history shows 5+")
    eq(app.suggest("Squat"), before, "and suggestions ignore it, like a warm-up")


def _sw_context(app):
    """A browser profile with the service worker switched on (the other tests block it)."""
    ctx = app.ctx.browser.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    return ctx, pg, app.pg.url.rsplit("/", 1)[0] + "/"


@test
def offline_works_and_other_apps_caches_survive(app):
    ctx, pg, base = _sw_context(app)
    try:
        pg.goto(base + "README.md")    # any page on the same origin, before Lift Log's worker exists
        pg.evaluate("""async()=>{for(const n of ['nap-log-v3','cart-v6','rideguide-1','lift-log-old','liftlog-old'])await (await caches.open(n)).put('/x-'+n,new Response('x'))}""")
        pg.goto(base + "index.html")
        pg.evaluate("navigator.serviceWorker.ready")
        if not pg.evaluate("!!navigator.serviceWorker.controller"):
            pg.reload()
        pg.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000)
        pg.wait_for_function("typeof state!=='undefined'&&document.querySelector('nav')", timeout=10000)
        keys = pg.evaluate("caches.keys()")
        cur = [k for k in keys if k.startswith("lift-log-") and k != "lift-log-old"]
        eq(len(cur), 1, f"exactly one current Lift Log cache, got {keys}")
        for other in ("nap-log-v3", "cart-v6", "rideguide-1"):
            ok(other in keys, f"another app's cache {other} must survive, got {keys}")
        for old in ("lift-log-old", "liftlog-old"):
            ok(old not in keys, f"this app's old cache {old} should be cleaned up, got {keys}")
        ok(pg.evaluate("navigator.serviceWorker.controller.scriptURL").endswith("/sw.js"), "Lift Log's worker controls the page")
        ctx.set_offline(True)
        pg.reload(); pg.wait_for_function("typeof state!=='undefined'&&document.querySelector('nav')", timeout=10000)
        ok("Train" in pg.inner_text("nav"), "the app opens offline")
        ok(pg.evaluate("[...document.fonts].some(f=>f.status=='loaded')"), "fonts come from the cache offline")
    finally:
        ctx.close()


@test
def opens_without_downloading_and_a_release_takes_over(app):
    """Opening the app must not wait for the server (cache-first, 2026-10-25), and a new release must still reach the
    phone by itself. Runs on a copy of the app with its own server, so the test can "release" a version (a new cache name
    in sw.js, as tools/build.py writes on every release)."""
    import os, shutil, tempfile
    copy = pathlib.Path(tempfile.mkdtemp(prefix="lift-log-release-"))
    for f in ("index.html", "sw.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"):
        shutil.copy(ROOT / f, copy / f)
    shutil.copytree(ROOT / "fonts", copy / "fonts")
    asked = []
    class Logged(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
        def end_headers(self):
            self.send_header("Cache-Control", "no-cache"); super().end_headers()
        def do_GET(self):
            asked.append(self.path.split("?")[0].lstrip("/")); super().do_GET()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Logged, directory=str(copy)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    ctx = app.ctx.browser.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    started = "typeof state!=='undefined'&&document.querySelector('nav')"
    try:
        pg.goto(base + "index.html"); pg.wait_for_function(started)
        pg.evaluate("navigator.serviceWorker.ready")
        if not pg.evaluate("!!navigator.serviceWorker.controller"):
            pg.reload()
        pg.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000)
        pg.reload(); pg.wait_for_function(started)        # anything not saved at install is kept from here on
        asked.clear()
        pg.reload(); pg.wait_for_function(started)
        app_files = [u for u in asked if (u == "" or re.search(r"\.(html|js|css|woff2)$", u)) and u != "sw.js"]
        eq(app_files, [], "opening the app downloaded app files")

        sw = (copy / "sw.js").read_text()
        (copy / "sw.js").write_text(re.sub(r"const C='[^']*';", "const C='lift-log-release-test';", sw))
        t = time.time() + 60                              # the test server compares times to the second
        os.utime(copy / "sw.js", (t, t))
        loads = []
        pg.on("load", lambda p: loads.append(p.url))
        pg.reload()                                       # opens as usual (old version); the new one installs meanwhile
        for _ in range(150):                              # ... and then the app reloads itself into it
            if len(loads) >= 2:
                break
            pg.wait_for_timeout(100)
        ok(len(loads) >= 2, f"the app reloaded by itself after the release (page loads: {len(loads)})")
        pg.wait_for_function(started)
        keys = [k for k in pg.evaluate("caches.keys()") if k.startswith("lift-log-")]
        eq(keys, ["lift-log-release-test"], "the app reloaded into the new version by itself and keeps only its cache")
    finally:
        ctx.close(); srv.shutdown(); shutil.rmtree(copy, ignore_errors=True)


@test
def storage_keys_are_prefixed_and_old_ones_move_over(app):
    ctx = app.ctx.browser.new_context(service_workers="block"); pg = ctx.new_page()
    base = app.pg.url.rsplit("/", 1)[0] + "/"
    try:
        pg.goto(base + "README.md")
        pg.evaluate("""()=>{const L=localStorage;L.clear();
          L.setItem('gh',JSON.stringify({repo:'Germani144/lift-log-data',token:'t0k'}));
          L.setItem('w',JSON.stringify({sess:Date.now(),name:'Quick workout',rest:90,restEnd:0,items:[]}));
          L.setItem('rest','150');L.setItem('bw','81');L.setItem('dirty','1');
          L.setItem('cl_items','[]')}""")          # another app's key
        pg.goto(base + "index.html"); pg.wait_for_function("typeof state!=='undefined'&&document.querySelector('nav')")
        st = pg.evaluate("Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))")
        eq(json.loads(st["lift-log:gh"])["token"], "t0k", "backup settings moved")
        ok("lift-log:w" in st and pg.evaluate("!!workout"), "workout in progress moved and still open")
        eq((st.get("lift-log:rest"), st.get("lift-log:bw")), ("150", "81"), "rest default and bodyweight moved")
        ok("gh" not in st and "w" not in st, "keys that are clearly Lift Log's are removed after moving")
        eq(st.get("cl_items"), "[]", "another app's keys are untouched")
        pg.evaluate("lsSet('rest',120)")
        bad = [k for k in pg.evaluate("Object.keys(localStorage)") if not k.startswith("lift-log:") and k not in ("rest", "bw", "dirty", "cl_items")]
        eq(bad, [], "Lift Log writes only prefixed keys")
    finally:
        ctx.close()


@test
def settings_page_body_and_bmi(app):
    """⚙ on every tab opens Settings (bodyweight, height, BMI, backups, version); hidden during a workout."""
    for t in ("Train", "History", "Plans", "Exercises"):
        app.tab(t); eq(app.pg.locator("[data-a=settings]").count(), 1, f"cog on {t}")
    ok("#bwi" and app.pg.locator("#bwi").count() == 0, "bodyweight is no longer on the Exercises tab")
    app.click("[data-a=settings]")
    txt = app.pg.inner_text("main")
    for w in ("Settings", "Automatic backup", "Manual backup", "Check for updates"):
        ok(w in txt, f"Settings shows {w}")
    ok("Enter weight and height" in app.pg.inner_text("#bmi"), "no BMI without height")
    app.fill("#bwi", 80); app.pg.locator("#bwi").dispatch_event("input")
    app.fill("#hti", 180); app.pg.locator("#hti").dispatch_event("input")
    ok(app.pg.inner_text("#bmi").startswith("BMI 24.7"), "BMI = 80 / 1.8² = 24.7: " + app.pg.inner_text("#bmi"))
    eq((app.js("localStorage.getItem('lift-log:ht')"), app.js("height()")), ("180", 180), "height saved, prefixed")
    app.fill("#hti", 30); app.pg.locator("#hti").dispatch_event("input")
    eq(app.js("height()"), 180, "implausible height ignored")
    app.click("[data-a=back]"); ok(app.pg.locator("#bwi").count() == 0 and app.js("state.view") is None, "Back leaves Settings")
    app.settings(); app.pg.go_back(); app.pg.wait_for_timeout(200); eq(app.js("state.view"), None, "back gesture leaves Settings")
    d = app.js("(async()=>{const d={app:'liftlog',v:1,t:Date.now()};for(const n of STORES)d[n]=await getAll(n);d.bw=bodyweight();d.ht=height();return sanitizeBackup(d)})()")
    eq((d["bw"], d["ht"]), (80, 180), "backups carry bodyweight and height")
    app.tab("Train"); app.click("[data-a=start]")
    eq(app.pg.locator("[data-a=settings]").count(), 0, "no cog during a workout (Finish sits there)")
    eq(app.errors, [])


@test
def check_for_updates(app):
    """Settings button: same version, newer version on the server (reload, only own caches cleared), offline."""
    sw = (ROOT / "sw.js").read_text()
    eq(re.search(r"const VER='([\d.]+)';", sw).group(1), app.js("VER"), "sw.js serves the same version as the app")
    app.settings()
    app.click("[data-a=upd]"); app.pg.wait_for_function("!document.querySelector('#toast').hidden")
    eq(app.pg.inner_text("#toast"), f"You're on the latest version (v{app.js('VER')}).", "up to date")
    eq(app.dialogs, [], "no prompt when up to date")
    app.js("Promise.all(['lift-log-old','liftlog-older','nap-log-abc'].map(k=>caches.open(k)))")
    newer = re.sub(r"const VER='[\d.]+';", "const VER='99.0';", sw)
    app.pg.route("**/sw.js?check=*", lambda r: r.fulfill(status=200, body=newer, content_type="text/javascript"))
    app.js("window.__before=1")
    with app.pg.expect_navigation():
        app.click("[data-a=upd]")
    app.pg.wait_for_function("typeof state!=='undefined'&&document.querySelector('nav')")
    ok(app.dialogs and app.dialogs[-1].startswith("Version v99.0 is available"), "asks to update: " + str(app.dialogs[-1:]))
    eq(app.js("window.__before"), None, "the app reloaded")
    eq(sorted(app.js("caches.keys()")), ["nap-log-abc"], "only this app's caches are cleared")
    app.pg.unroute("**/sw.js?check=*")
    app.pg.route("**/sw.js?check=*", lambda r: r.abort())
    app.settings(); app.click("[data-a=upd]"); app.pg.wait_for_function("!document.querySelector('#toast').hidden")
    ok(app.pg.inner_text("#toast").startswith("Couldn't reach the server"), "offline message")
    eq(app.pg.inner_text("#updb"), "Check for updates", "button resets")
    eq([e for e in app.errors if "ERR_FAILED" not in e], [], "no errors besides the simulated offline request")


@test
def manifest_claims_only_this_app(app):
    """Chrome resolves the manifest id from the site root; it must come out as /lift-log/, not the whole site."""
    m = app.ctx.new_cdp_session(app.pg).send("Page.getAppManifest").get("manifest") or {}
    base = app.pg.url.rsplit("/", 1)[0] + "/"
    eq((m.get("scope"), m.get("startUrl")), (base, base), "scope and start_url are this app's folder")
    ok(m.get("id", "").endswith("/lift-log/"), f"id must be .../lift-log/, got {m.get('id')!r}")


@test
def warmup_sets(app):
    app.new_exercise("Squat", lo=5, hi=8, wu=3)
    eq(app.js("state.ex[0].wu"), 3)
    app.seed_sets("Squat", [[(100, 6, 2)] * 3] * 3)
    app.tab("Train"); app.click("[data-a=start]"); app.click("[data-a=pickAdd]"); app.click("#plist .chip")
    rows = app.js("workout.items[0].rows")
    eq([bool(r.get("wu")) for r in rows], [True, True, True, False, False, False], "3 warm-ups before 3 working sets")
    ok(rows[0]["w"] < rows[1]["w"] < rows[2]["w"] < rows[3]["w"], "warm-up ramp climbs to the working weight")
    app.click('.set[data-j="0"] [data-a=log]')
    last = app.js("(async()=>(await getAll('sets')).sort((a,b)=>a.t-b.t).pop())()")
    eq((last.get("wu"), last["test"]), (True, False), "logged warm-up is flagged")
    app.click('.set[data-j="0"] [data-a=wu]')
    last = app.js("(async()=>(await getAll('sets')).sort((a,b)=>a.t-b.t).pop())()")
    ok("wu" not in last, "toggling a logged set updates the saved record")


@test
def backup_round_trip_and_validation(app):
    app.new_exercise("Squat", wu=2, pb=150)
    app.seed_sets("Squat", [[(40, 8, None, 1), (100, 5, 2)]])
    d = app.js("(async()=>{const d={app:'liftlog',v:1,t:Date.now()};for(const n of STORES)d[n]=await getAll(n);return d})()")
    c = app.js("d=>sanitizeBackup(d)", d)
    eq((c["exercises"][0]["wu"], c["exercises"][0]["pb"]), (2, 150), "exercise settings survive backup")
    eq(sum(1 for s in c["sets"] if s.get("wu")), 1, "warm-up flag survives backup")
    for bad in ({**d, "sets": "nope"}, {**d, "exercises": [{"id": 1, "name": "x", "mode": "evil", "inc": 2}]}):
        ok(app.js("async d=>(await applyBackup(d))===false", bad), "invalid backup must be rejected")
    eq(app.js("state.ex.length"), 1, "a rejected backup changes nothing")


@test
def user_text_cannot_inject_html(app):
    """Security: names you type are shown as text, never run as code (XSS)."""
    evil = '<img src=x onerror="window.__pwned=1">'
    app.new_exercise(evil)
    app.seed_sets(evil, [[(50, 5, 2)]])
    app.tab("Plans"); app.click("[data-a=tplNew]"); app.fill("input[data-b=name]", evil)
    app.click('[data-tq="0"]'); app.pg.keyboard.type("img"); app.pg.wait_for_timeout(100)
    app.pg.keyboard.press("Enter"); app.pg.wait_for_timeout(100); app.click("[data-a=tplSave]")
    def clean(where):
        eq(app.js("document.querySelectorAll('main img[src=x]').length"), 0, f"{where}: an <img> tag from a name was rendered")
        ok(not app.js("window.__pwned"), f"{where}: injected script ran")
    for t in ("Exercises", "Plans", "Train", "History"):
        app.tab(t); clean(t + " tab")
    app.click(".cd.tr"); clean("history day")
    app.tab("Exercises"); app.click("[data-a=exOpen]"); clean("exercise page"); app.click("[data-a=back]")
    app.tab("Plans"); app.click("[data-a=tplEdit]"); clean("plan editor"); app.click("[data-a=back]")
    app.tab("Train"); app.click("[data-a=start]"); app.click("[data-a=pickAdd]"); clean("picker chips")
    app.pg.keyboard.type("img"); app.pg.wait_for_timeout(200); clean("picker search")
    app.pg.keyboard.press("Enter"); app.pg.wait_for_timeout(200); clean("workout card")


@test
def back_gesture_closes_pages(app):
    app.new_exercise("Bench")
    app.click("[data-a=exOpen]"); eq(app.state()["view"], "exd")
    app.pg.go_back(); app.pg.wait_for_timeout(200)
    eq((app.state()["view"], app.pg.url.endswith("index.html")), (None, True), "back closes the exercise page, stays in app")
    app.tab("Train"); app.click("[data-a=start]"); app.click("[data-a=pickAdd]"); eq(app.state()["pick"], True)
    app.pg.go_back(); app.pg.wait_for_timeout(200); eq((app.state()["pick"], app.state()["w"]), (False, True), "back closes the picker")
    app.pg.go_back(); app.pg.wait_for_timeout(200); ok(app.js("showTrainHome"), "back from a workout goes to the Train page")


@test
def search_and_order(app):
    for n in ["Squats", "front squats", "Bench", "Deadlift", "Pause Back Squats"]:
        app.new_exercise(n)
    names = lambda: [x.split("\n")[0] for x in app.pg.locator(".exr:visible .l").all_inner_texts()]
    eq(names(), ["Bench", "Deadlift", "front squats", "Pause Back Squats", "Squats"], "alphabetical, case-insensitive")
    app.fill("#exq", "squ"); app.pg.locator("#exq").dispatch_event("input")
    eq(names(), ["front squats", "Pause Back Squats", "Squats"], "filter as you type")
    app.fill("#exq", "zzz"); app.pg.locator("#exq").dispatch_event("input"); ok(app.pg.is_visible("#exnone"), "no-match message")
    app.tab("Train"); app.click("[data-a=start]"); app.click("[data-a=pickAdd]"); app.pg.keyboard.type("squ")
    app.pg.wait_for_timeout(100)
    eq(app.pg.locator("#plist .sg").all_inner_texts()[0].split("\n")[0], "Squats", "starts-with ranks first")
    app.pg.keyboard.press("Enter"); app.pg.wait_for_timeout(150)
    eq(app.js("workout.items.map(i=>exerciseById(i.exId).name)"), ["Squats"])


@test
def bottom_bar_is_never_rebuilt(app):
    """The bar used to be rebuilt on every render, which made it flicker on tab changes."""
    app.js("window.__nav=document.querySelector('nav')")
    for t in ("History", "Plans", "Exercises", "Train", "History"):
        app.tab(t)
        ok(app.js("document.querySelector('nav')===window.__nav"), f"bottom bar was rebuilt when opening {t}")
        eq(app.js("[...document.querySelectorAll('nav button.on')].map(b=>b.dataset.i)"), [app.state()["tab"]], "exactly the current tab is highlighted")
    app.new_exercise("Bench"); app.click("[data-a=exOpen]"); app.pg.go_back(); app.pg.wait_for_timeout(150)
    ok(app.js("document.querySelector('nav')===window.__nav"), "bottom bar rebuilt by opening a page")


@test
def only_the_content_scrolls(app):
    """The bar is part of a fixed frame; only <main> scrolls, so changing tabs never moves the bar."""
    for i in range(30):
        app.js(f"dbPut('exercises',{{name:'Ex {i:02d}',mode:'rir',inc:2,lo:8,hi:12,rir:2}})")
    app.js("loadState().then(render)"); app.tab("Exercises")
    nav = "(r=>[Math.round(r.bottom),innerHeight])(document.querySelector('nav').getBoundingClientRect())"
    app.js("document.querySelector('main').scrollTop=1500")
    eq(app.js("scrollY"), 0, "the window itself must never scroll")
    b, h = app.js(nav); eq(b, h, "bar sits at the bottom of the screen")
    app.click("[data-a=exOpen] >> nth=20"); eq(app.js("document.querySelector('main').scrollTop"), 0, "a page opens at the top")
    app.click("[data-a=back]"); eq(app.js("document.querySelector('main').scrollTop"), 1500, "Back returns to the same place in the list")
    app.tab("History"); eq(app.js("document.querySelector('main').scrollTop"), 0, "a tab opens at the top")
    b, h = app.js(nav); eq(b, h, "bar still at the bottom after changing tabs")


@test
def swipe_changes_tabs(app):
    cdp = app.ctx.new_cdp_session(app.pg)

    def swipe(x0, x1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": 150}]})
        for k in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * k / 8, "y": 152}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); app.pg.wait_for_timeout(300)

    swipe(300, 100); eq(app.state()["tab"], "hist")
    eq(app.js("(m=>[m.style.transform,m.style.opacity])(document.querySelector('main'))"), ["", ""], "no leftover drag offset after a swipe")
    swipe(300, 100); swipe(300, 100); swipe(300, 100); eq(app.state()["tab"], "ex", "stops at the last tab")
    swipe(100, 300); eq(app.state()["tab"], "tpl")
    swipe(200, 230); eq(app.state()["tab"], "tpl", "a short drag does nothing")


# ---------------------------------------------------------------- runner

def main():
    words = [w.lower() for w in sys.argv[1:]]
    chosen = [t for t in TESTS if not words or any(w in t.__name__ for w in words)]
    url, failed = serve(), []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for t in chosen:
            t0, app = time.time(), None
            try:
                app = App(browser, url); t(app); print(f"  ok    {t.__name__} ({time.time() - t0:.1f}s)")
            except Exception as e:
                failed.append(t.__name__)
                print(f"  FAIL  {t.__name__}\n{''.join(traceback.format_exception_only(e)).rstrip()}")
            finally:
                app and app.close()
        browser.close()
    print(f"\n{len(chosen) - len(failed)}/{len(chosen)} passed" + (f" — failed: {', '.join(failed)}" if failed else ""))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
