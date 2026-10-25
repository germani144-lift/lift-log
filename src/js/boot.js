/* Start-up: register the service worker (offline use), open the database, draw the first screen. */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // The app opens from the worker's cache (sw.js). When a new version's worker takes over, reload once so the screen
  // runs the new version; not on the very first install, and not while a field is being typed in (the workout in
  // progress is saved and reopens after the reload).
  const hadWorker = !!navigator.serviceWorker.controller;
  let reloading = false;
  const reloadWhenIdle = () => {
    if (document.activeElement?.matches?.('input,textarea,select')) return setTimeout(reloadWhenIdle, 1500);
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker || reloading) return;
    reloading = true;
    reloadWhenIdle();
  });
  navigator.serviceWorker
    .register('sw.js', { scope: './', updateViaCache: 'none' })
    .then(reg => {
      // look for a new version in the background on every start (browsers don't always check on their own) and
      // whenever the app comes back to the screen (an installed app is often resumed rather than reopened)
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}
navigator.storage?.persist?.();
$('#sver').textContent = 'v' + VER;
const hideSplash = () => {
  const e = $('#splash');
  if (!e) return;
  e.classList.add('out');
  setTimeout(() => e.remove(), 500);
};
setTimeout(hideSplash, 5000);
openDatabase()
  .then(async d => {
    db = d;
    await loadState();
    render();
    setTimeout(hideSplash, Math.max(0, 1000 - performance.now()));
    if (githubConfig() && lsGet('dirty') != '0') setTimeout(autoBackup, 3000);
  })
  .catch(e => {
    hideSplash();
    app.innerHTML = '<main><p class=wr>IndexedDB is unavailable: ' + esc(e.message || e) + '</p></main>';
  });
