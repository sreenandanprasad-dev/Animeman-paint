import { initialPose } from './pose/data';

export const asset = path => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
const DB = 'komastudio-v1';
let connection;
function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', { keyPath: 'id' });
      request.result.createObjectStore('models', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(request.error); };
  });
  return connection;
}
async function transaction(store, mode, run) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error || req.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction cancelled'));
  });
}
export const listProjects = () => transaction('projects', 'readonly', s => s.getAll());
export const getProject = id => transaction('projects', 'readonly', s => s.get(id));
export const putProject = project => transaction('projects', 'readwrite', s => s.put(project));
export const removeProject = id => transaction('projects', 'readwrite', s => s.delete(id));
export const getModel = id => transaction('models', 'readonly', s => s.get(id));
export const putModel = model => transaction('models', 'readwrite', s => s.put(model));
const setting = key => transaction('settings', 'readonly', s => s.get(key));
const setSetting = (key, value) => transaction('settings', 'readwrite', s => s.put(value, key));
export const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const SAMPLES = [
  { id: 'study-moonlit', title: 'Moonlit Reverie', file: 'moonlit', label: 'Illustration', w: 1600, h: 1194, paper: '#f7f1eb' },
  { id: 'study-character', title: 'Character Notes', file: 'character', label: 'Character design', w: 1400, h: 1045, paper: '#f5e6ce' },
  { id: 'study-gesture', title: 'Gesture Studies', file: 'gesture', label: 'Pose study', w: 1200, h: 896, paper: '#122b32' },
].map((item, i) => ({ ...item, date: Date.UTC(2025, 4, 21 - i), thumbUrl: asset(`art/${item.file}.webp`), starter: true }));

export function canvas(w, h) {
  const el = document.createElement('canvas');
  el.width = w; el.height = h;
  return el;
}
export function png(el) {
  return new Promise((resolve, reject) => el.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
}
export async function imageFrom(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* Some WebView decoders only support the image element path. */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

export function makeProject({ title = 'Untitled illustration', w = 1080, h = 1520, paper = '#f7f4ee', pose, reference } = {}) {
  return {
    id: uid(), title, w, h, paper, pose: pose ?? initialPose(), reference: reference ?? null, date: Date.now(), label: 'Illustration',
    layers: [{ id: uid(), name: 'Lineart', visible: true, opacity: 1, blend: 'source-over', alphaLock: false, clip: false, png: null }],
  };
}

let seeding;
export function seedProjects() {
  seeding ??= (async () => {
    if (await setting('starter-installed')) return;
    const existing = new Set((await listProjects()).map(p => p.id));
    for (const sample of SAMPLES) {
      if (existing.has(sample.id)) continue;
      const response = await fetch(sample.thumbUrl);
      if (!response.ok) throw new Error('Starter artwork is unavailable');
      const image = await imageFrom(await response.blob());
      const surface = canvas(sample.w, sample.h);
      surface.getContext('2d').drawImage(image, 0, 0, sample.w, sample.h);
      image.close?.();
      const art = await png(surface);
      surface.width = 1; surface.height = 1;
      const record = makeProject(sample);
      record.layers.unshift({ id: uid(), name: 'Artwork', visible: true, opacity: 1, blend: 'source-over', alphaLock: false, clip: false, png: art });
      await putProject({ ...record, ...sample });
    }
    await setSetting('starter-installed', true);
  })();
  return seeding;
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function exportFile(blob, name, share = false) {
  if (window.KomaAndroid) {
    const bridge = window.KomaAndroid, token = bridge.beginExport(name, blob.type, share);
    if (!token) throw new Error('Could not prepare Android export');
    let complete = false;
    try {
      for (let i = 0; i < blob.size; i += 256 * 1024) {
        const uri = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob.slice(i, i + 256 * 1024, blob.type));
        });
        if (!bridge.appendExport(token, uri.split(',')[1])) throw new Error('Android export failed');
      }
      complete = true;
    } finally { bridge.finishExport(token, complete); }
    return 'android';
  }
  const file = new File([blob], name, { type: blob.type });
  if (share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] }); return 'shared';
  }
  download(blob, name); return 'downloaded';
}
