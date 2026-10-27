const VER='2.16';   // app version, kept equal to index.html by tools/build.py (read by "Check for updates")
const C='lift-log-6ff0ff6cb2';
// Every app on germani144.github.io shares one CacheStorage. This worker only ever touches caches whose
// name starts with its own prefix ("liftlog-" was this app's old prefix), and only requests inside its scope.
const OWN=['lift-log-','liftlog-'];
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png','./fonts/barlow-condensed-latin-600-normal.woff2','./fonts/barlow-condensed-latin-700-normal.woff2','./fonts/barlow-latin-400-normal.woff2','./fonts/barlow-latin-500-normal.woff2','./fonts/barlow-latin-600-normal.woff2','./fonts/barlow-latin-700-normal.woff2'];
// Opening the app never waits for the network: everything comes from this version's cache (C is a hash of the app, so
// a release names a new cache), so the phone runs one complete version and opens instantly, even offline. The browser
// checks sw.js on every open (updateViaCache:'none'; boot.js also asks when the app comes back to the screen); the new
// worker downloads every file fresh ('?v=' so GitHub's CDN can't hand out an old copy, cache:'reload' skips the phone's
// HTTP cache) and takes over only once all arrived, then boot.js reloads once. If any file fails, the install fails and
// the phone stays on the current version. (Network-first made opening wait on the network: changed 2026-10-25.)
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(SHELL.map(async u=>{const r=await fetch(u+'?v='+C,{cache:'reload',credentials:'same-origin'});if(!r.ok)throw new Error('could not save '+u);await c.put(u,r)}))));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C&&OWN.some(p=>x.startsWith(p))).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
// Cache first; anything not cached yet comes from the server once (revalidated) and is kept if it worked.
// Requests outside this app's scope (other apps, the GitHub API for backups) are never touched.
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!='GET'||q.cache=='no-store'||!q.url.startsWith(self.registration.scope))return;   // no-store = the update check: straight to the server
 e.respondWith((async()=>{const c=await caches.open(C),nav=q.mode=='navigate';const hit=(await c.match(q,{ignoreSearch:nav}))||(nav&&await c.match('./index.html'));if(hit)return hit;
  try{const r=await fetch(q,{cache:'no-cache'});if(r.ok)await c.put(q,r.clone());return r}catch{return Response.error()}})())});
