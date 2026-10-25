# Working on Lift Log

- This repo is Lift Log only. Don't attach or edit other repos (cart-log, nap-log) from a Lift Log chat.
- The app's source is in `src/` (README → Code layout). Never edit `index.html` by hand: `tools/build.py` generates it from `src/`.
- After any edit to app files: `python3 tools/build.py`, then `python3 tests/run.py` and `node --test tests/unit.test.mjs`. Don't push if any fails.
- Keep `src/js/core/training.js` free of DOM, storage and state: plain functions of their inputs (the only outside value is `bodyweight()`). Callers fetch history and pass it in. Changes to the training maths get a worked example in `tests/unit.test.mjs`.
- Format edited source with `npx prettier --write "src/**/*.{js,css}"` (config in `.prettierrc.json`).
- Keep the README up to date: whenever a change adds, removes or changes a feature, a setting, the build/test steps or the backup setup, update README.md in the same commit.
- Add or adjust a test in `tests/run.py` for new behaviour.
- The user tests on an Android phone; after pushing, tell them the new version number (e.g. v1.4, from `tools/build.py` output) and to close the app from recent apps and reopen it to pick up the update.
- After pushing, fetch https://germani144-lift.github.io/lift-log/sw.js and check the new `const VER` is live (GitHub Pages has silently failed to publish before; another push re-triggers it).
- Versions: `tools/build.py` bumps the minor number (v1.4 -> v1.5) on every app change. Claude decides when to go to the next major (set `const VER='2.0';` by hand; the build keeps it): a big redesign, a change in how the app is used day to day, or a change to the data/backup format that older versions can't read. Fixes and normal features stay minor.

## Address and storage rules

Lift Log lives at https://germani144-lift.github.io/lift-log/ (repo `germani144-lift/lift-log`, moved from `Germani144/lift-log` on 2026-10-20). Backups still go to `Germani144/lift-log-data`.

**One installable app per address.** Chrome on Android lets only one app per address (origin) be installed: a second app on the same address shows "This app is already installed" and can't be installed (found 2026-10-20). So every app Pedro installs needs its own address. Nap Log is the installed app on `germani144.github.io`; Lift Log moved to `germani144-lift.github.io` and Home log to `germani144-home.github.io` (each its own free GitHub organization). Changes that apply to every app at once are made from Pedro's orchestration chat; they never touch UI or calculations. Never move Lift Log back onto an address another installable app uses. The rules below still apply, so Lift Log stays clean if it ever shares an address again.

- **Service worker:** Cache names start with `lift-log-` (the old `liftlog-` prefix is also cleaned up); `tools/build.py` sets the hash. On activate, delete only caches with that prefix (never "every cache but the current one"). Read from this app's own cache (`caches.open(C).then(c => c.match(...))`), never the global `caches.match()`. Only handle requests whose URL starts with `self.registration.scope`; leave other apps, the GitHub API and other origins alone.
- **Updates (cache-first, same in all of Pedro's apps since 2026-10-25):** open the app from this version's own cache, never network-first (it made every open wait for the server). The install downloads every app file fresh (`?v=` plus `cache: 'reload'`) into the new version's cache and fails as a whole if one file fails; files not in the cache are fetched with `{cache: 'no-cache'}`; store only `r.ok` responses. Register the worker with `{scope: './', updateViaCache: 'none'}`, call `reg.update()` on every start and when the app becomes visible, and reload once on `controllerchange` (not on the first install, not while a field is focused). `tests/run.py` (`opens_without_downloading_and_a_release_takes_over`) checks that opening downloads no app files and that a release takes over by itself.
- **Storage:** every `localStorage` key starts with `lift-log:` (the `LSP` helper); the IndexedDB database is `liftlog`.
- **Manifest:** `scope` and `start_url` are `./`. **Never change the manifest `id`**, not even to fix an install problem, unless Pedro explicitly asks for it in that chat. The id is how Android recognises the installed app: changing it orphans the installed copy. If installing fails on the phone, investigate and report; don't change the id.
- `python3 tools/build.py --check` and `tests/run.py` fail if the service worker or storage break these rules, so keep them passing.
- The manifest `id` is `/lift-log/`.
