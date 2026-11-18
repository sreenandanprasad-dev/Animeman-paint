import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../dist/', import.meta.url);
const hash = createHash('sha256');
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter(f => f.isFile() && f.name !== 'studio-sw.js')
  .map(f => './' + (f.parentPath || f.path).replace(root.pathname.replace(/\/$/, ''), '').replace(/^\//, '').split('/').filter(Boolean).concat(f.name).join('/')).sort();
for (const file of files) hash.update(await readFile(new URL(file, root)));
await writeFile(new URL('studio-sw.js', root), `
const cache = 'komastudio-${hash.digest('hex').slice(0, 12)}';
const files = ${JSON.stringify(['./', ...files])};
self.addEventListener('install', event => event.waitUntil(caches.open(cache).then(c => c.addAll(files)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('komastudio-') && k !== cache).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(caches.open(cache).then(async c => (await c.match(event.request)) || (event.request.mode === 'navigate' ? (await c.match('./index.html')) : null) || fetch(event.request)));
});
`);
