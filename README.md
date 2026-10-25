# Lift Log

Offline workout tracker that runs as a single-file web app on your phone: https://germani144-lift.github.io/lift-log/

Everything lives in the browser on your phone (IndexedDB), with optional automatic backup to a private GitHub repo.

## Features

- **Train:** start a day from your active plan or a quick workout. Log weight, reps and RIR per set: tap the weight to type it (leave it empty or 0 for a bodyweight set; it shows as BW once logged), and use **−/+** next to the reps to adjust them set by set (or tap to type). Tap the light checkmark to log a set; it turns into a filled red check; a rest timer starts after each set (tap the time to change it, ±15 s buttons). Add or replace exercises by typing a name.
- **Suggestions:** for RIR exercises, each set's weight and reps come from your estimated strength (average of your last 4 sessions, working sets only, preferring a similar rep range) and the target rep range and RIR. You get one more rep than last time; at the top of the range the weight goes up and reps reset. Later sets drop a rep every two sets for fatigue. If your last session of an exercise was all bodyweight, the suggestion stays at bodyweight and adds a rep.
- **RIR or % of 1RM, per plan slot and per workout:** every exercise in a plan has a **RIR | % 1RM** switch, and so does every exercise card in a workout. Exercises themselves have no tracking type: a new plan slot or quick-workout exercise starts in whichever mode you used last for it.
  - **RIR slots:** sets, this plan's rep range, and a target RIR for **each week** of the plan (W1, W2, …). Each workout uses the target for the current plan week and suggests weight and reps as above.
  - **% slots:** lines of sets × reps @ % of 1RM (number fields, e.g. 3 × 2 @ 80%). In the workout you see % of 1RM, reps and RPE, with the kg to load under each set; you fill in the RPE you felt.
  - **One history:** every set is stored as kg, reps and RIR (RPE = 10 − RIR), so switching view is lossless and both views feed the same history. % uses your tested 1RM, or your estimated 1RM if you haven't tested one.
- **Adjusting as you go:**
  - **% view:** after each set, the app compares your RPE with how that lift usually feels at a similar rep count in your history (or, with no history yet, with your first set today). Harder than usual and the remaining sets get lighter; easier and they get heavier. Each workout also starts from your recent trend at that rep count ("−4% vs plan from recent sessions"). Always within ±10% of the plan.
  - **RIR view:** after each set, the next sets keep their weight and move the reps toward the target RIR; the weight only moves if the reps would leave the range (max ±10%, about 1.5% easier per set for fatigue).
  - Sets you've edited yourself are never changed; adjusted sets say "adjusted".
- **RIR picker:** RIR is chosen from a list (0–5 in half steps, plus **5+**), never typed; in the % view the same list shows as RPE. Plan and exercise targets go up to 5. A **5+** set stays in history (shown as "5+") and counts toward volume, but like a warm-up it's never used for suggestions, the strength estimate, 1RM or the next-set adjustment.
- **Warm-ups:** set 0–4 warm-up sets per exercise to get a ramp before your working sets; any set can be marked as a warm-up. Warm-ups never count toward suggestions or 1RM/PB.
- **Bodyweight lifts:** set your bodyweight in **Settings** and tick **Load includes bodyweight** on exercises like pull-ups and dips. For those, % of 1RM, estimated 1RM, suggestions and adjustments all use bodyweight + added weight, while you only type and see the added kg (1RM "+40" with 80 kg bodyweight = 120 kg; 80% = +16 kg). Bodyweight-only sets count toward strength, and each set remembers your bodyweight at the time. Bodyweight is included in backups.
- **1RM and PB:** a set of 1 rep at 0 RIR counts as a tested 1RM; lifetime PB rises automatically.
- **Plans:** days per week, number of weeks, and per-day exercises planned by RIR or % of 1RM (see above). Old text-style % plans (`3*80%x5`) are converted automatically. Progress shows as a barbell bar on the Train page.
- **Check for updates:** button in Settings. It asks the server which version it's serving (read from `sw.js`, which the build keeps equal to the app's `vX.Y`): "You're on the latest version", "Couldn't reach the server", or "Version vX.Y is available… Update now?", which refreshes the service worker, clears only Lift Log's own caches and reloads. Also a quick way to see whether GitHub Pages actually published a push.
- **History:** month calendar of training days, every workout listed, and per-exercise charts (max weight and volume per session; touch, drag or hover to see each session's date and value). Tap **Edit workout** on any past workout to change its date or name, edit any set (weight, reps, RIR, warm-up), remove sets or exercises, or add sets and exercises. The workout in progress is edited from the Train tab instead.
- **Settings** (⚙ top right of every tab; hidden during a workout): your weight and height with BMI (WHO ranges; muscle counts as weight), automatic and manual backup, the app version and **Check for updates**. Weight and height are included in backups.
- **Exercises:** alphabetical list with a search box. Each exercise has its weight increment, warm-up sets, current 1RM and lifetime PB, plus the rep range and target RIR used for quick workouts (plans set their own).
- **Navigation:** swipe left/right between tabs; the phone's back gesture closes the open page. The bottom bar is fixed and only the page above it scrolls; each tab opens at the top, and going back from an exercise returns you to the same place in the list.
- **Backup:** automatic backup to a private GitHub repo (fine-grained token, Contents read/write on that repo only), plus manual export/import of a JSON file.

## How it works

**The problem.** Most workout loggers record what you did and show it back. Lift Log also tells you what to do next, and keeps adjusting during the workout: if a set was harder or easier than planned, the sets after it change. It does this from two numbers you already know when you finish a set: the reps, and how many more you could have done (reps in reserve, RIR).

**One strength number.** Every set with a known RIR gives an estimated one-rep max (e1RM), using Epley's formula with the reps you had left counted as reps you could have done: `e1RM = weight × (1 + (reps + RIR) / 30)`. Your *strength* for an exercise is the best e1RM of each of your last 4 sessions, averaged with recent sessions counting more. Warm-ups, sets at 5+ RIR and sets without RIR are left out, and sets close to today's rep range are preferred, so a heavy-triples day doesn't inflate a light day's suggestion.

**What to lift next (RIR plans).** Double progression: same weight, one more rep each session, until you pass the top of the rep range; then heavier and back to the bottom. The previous set says where you are (`reps + RIR − target RIR` = reps you could do at today's target), and the strength number keeps that honest (at most 2 reps above what it predicts). Later sets aim one rep lower every two sets, for fatigue. Bodyweight exercises progress in reps only.

**% of 1RM plans.** The plan says e.g. 3 × 2 @ 80%. The base is your tested 1RM, or your strength estimate if you haven't tested one, nudged (max ±10%) by your trend at that rep count: the last 3 sessions against the last 10.

**Adjusting during the workout.** After each logged set, the remaining sets you haven't touched are recalculated from that set's e1RM, never more than ±10% from the plan. In RIR view the weight stays and the reps move to hit the target RIR (assuming about 1.5% fatigue per set); in % view the weights scale by today's strength compared with your usual at that rep count. Sets you edit yourself are never changed.

**Design choices.**
- *Offline-first, no account.* Gyms have bad signal and training data is personal, so everything lives on the phone (IndexedDB); backup is opt-in, to a private GitHub repo you own.
- *A web app, not a store app.* Installable from the browser, updates on the next open, no app store. One self-contained HTML file with a strict hash-based Content-Security-Policy, so the page can only run its own code and talk to its own site and the GitHub API.
- *No framework or bundler.* The app is small enough that plain JavaScript and HTML strings keep it simple and fast to load; Python is the only build tool. The training maths is kept separate from the screens as plain functions, so it can be tested on its own (`tests/unit.test.mjs`).
- *One history, two views.* Every set is stored as kg, reps and RIR, so RIR and % of 1RM are just two ways of looking at the same data, and switching never loses anything.

The details, with the reasoning behind each formula, are in comments in `src/js/core/training.js`.

## Making changes

1. Edit the source in `src/` (see **Code layout** below). Don't edit `index.html` directly: it's generated.
2. Run the build, which assembles `index.html` from `src/` and updates the security hash and the offline-cache version:
   ```
   python3 tools/build.py
   ```
   Skipping this step leaves `index.html` out of date (`build.py --check` and CI fail), and a stale hash would blank the app, because the browser refuses to run a script whose hash doesn't match.
   It also bumps the version number (shown as e.g. **v1.4** on the startup screen and in Settings) whenever the app changed since the last commit, so every pushed update has its own number.
3. Run the tests:
   ```
   pip install playwright && python3 -m playwright install chromium   # once
   python3 tests/run.py            # browser tests: everything, ~1 min
   python3 tests/run.py suggest    # just the tests with "suggest" in the name
   node --test tests/unit.test.mjs # unit tests for the training maths (Node 18+), ~1 s
   ```
4. Commit and push. GitHub runs the same checks on every push (Actions → Tests), and emails you if one fails.
5. Check it's live: open https://germani144-lift.github.io/lift-log/sw.js and look for the new `const VER`. If GitHub Pages didn't publish it, push again to re-trigger the build.

## Code layout

```
src/index.html        page shell (head, splash screen); the build inlines the CSS and JS into it
src/styles.css        all styles
src/js/
  version.js          app version (written by the build)
  core/format.js      numbers and dates as text
  core/dom.js         small DOM helpers
  core/storage.js     localStorage (every key prefixed "lift-log:") and IndexedDB
  core/training.js    the training maths: e1RM, strength estimate, suggestions, next-set adjustment
                      (plain functions of their inputs: no screen, no database)
  core/state.js       the data model, app state, loading data, plans, building a workout
  core/rest-timer.js  rest timer between sets
  views/*.js          one file per screen (train, exercises, history, plans, settings) plus shared bits
  app/navigation.js   render() and the phone back gesture
  app/events.js       typing, keyboard, swipe and click handling
  app/actions.js      what every button does
  backup.js           export/import and automatic GitHub backup
  boot.js             start-up
tools/build.py        assembles index.html and runs the security checks
tests/run.py          browser tests (the whole app in headless Chromium)
tests/unit.test.mjs   unit tests for core/training.js
sw.js                 service worker (offline cache)
```

The JavaScript files are plain scripts that share one scope, loaded in the order listed in `JS_FILES` in `tools/build.py`. The build inlines them into a single `<script>` so the app stays one self-contained file with a strict, hash-based Content-Security-Policy, and needs no bundler: Python is the only build tool. Source is formatted with [Prettier](https://prettier.io) (`npx prettier --write "src/**/*.{js,css}"`, settings in `.prettierrc.json`).

## Offline and shared storage

Lift Log has its own address (`germani144-lift.github.io`, a free GitHub organization) because Chrome on Android installs only one app per address; it moved there from `germani144.github.io` on 2026-10-20. It still keeps strictly to its own storage:

- **Service worker:** its cache is named `lift-log-<hash>` (the build sets the hash). On activate it only deletes its *own* old caches (`lift-log-…`, and the old `liftlog-…`), never another app's. It reads only from its own cache and only handles requests inside its scope (`/lift-log/`); the GitHub API for backups is never touched.
- **Updates:** the app opens from its own cache (cache-first), so opening never waits for the network, even with bad signal at the gym. Network-first made every open wait for the server (changed 2026-10-25, the same in all of Pedro's apps). How a release reaches the phone: on every start, and whenever the app comes back to the screen, it asks in the background whether `sw.js` changed (registered with `updateViaCache: 'none'`). A release has a new cache name, so the new worker downloads every file fresh (`?v=` so GitHub's CDN can't hand out an old copy, and `cache: 'reload'`) and only takes over once all of them arrived; the app then reloads once (not while you're typing; the workout in progress reopens). The first open after a release still shows the old version for a moment.
- **localStorage:** every key starts with `lift-log:`. Older unprefixed keys are moved over once on first launch.
- **IndexedDB:** your data lives in a database named `liftlog`, separate from other apps' databases.
- **Install (manifest):** `scope` and `start_url` are `./` (only this app's folder) and `id` is `/lift-log/`. The build check enforces all three. Never change the `id` of an installed app: phones treat a new id as a different app.

## What the checks cover

- **Security** (`tools/build.py --check`): the service worker only touches its own caches and scope, localStorage keys are prefixed, strict Content-Security-Policy (no inline handlers, no `eval`, scripts only by hash, network only to this site (update check) and the GitHub API for backups), and every file needed offline is precached.
- **Training maths** (`tests/unit.test.mjs`): worked examples for the 1RM formula, rounding, the strength estimate and trend, every branch of the suggestions (no history, progression, top and bottom of the range, bodyweight), bodyweight-loaded lifts, and the after-set adjustments in both views.
- **Behaviour** (`tests/run.py`): main workout flow, weight/rep suggestions (progression, warm-ups, bad-day guard, bodyweight), warm-up sets, backup round trip and rejection of bad files, names can't inject HTML/script, offline use and other apps' caches surviving, opening without downloading the app and a release taking over by itself, storage keys prefixed and migrated, back gesture, search and ordering, swipe between tabs.

Fonts: Barlow and Barlow Condensed, SIL Open Font License (`fonts/OFL.txt`).
