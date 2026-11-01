/* ParkWatch Quartier v2.0 – Anwendungslogik (offline-first, keine Build-Abhängigkeit zur Laufzeit) */
const APP_VERSION = "2.2.0";
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEMSBACH = { lat: 49.5884, lng: 8.6492 }; // nur Kartenmitte vor dem ersten Fix – wird NIE als Fall-Standort gespeichert
const NARROW_CM = 150;                           // App-Schwelle (keine gesetzliche Grenze) für „Engstelle Rollstuhl/Kinderwagen"
const MAX_PHOTOS = 6;
const MAX_ORIG_PX = 2000, MAX_OUT_PX = 1600;

/* ---------- Zustand ---------- */
function emptyCase() {
  return {
    photos: [],            // {orig: canvas|null, origUrl, boxes:[{x,y,w,h}], ts: ms, out: dataURL|null}
    active: 0,
    ts: Date.now(),        // Tatzeit (EXIF des ersten Fotos oder Erfassungszeit)
    coords: null, locSource: null, accuracy: null,
    address: '', road: '', houseNumber: '', city: '',
    plate: '', plateSource: '',
    brand: '', model: '', vtype: 'PKW', color: '', aiFilled: false, manual: {},
    group: 'gehweg', beh: false, gef: false, extra: false, dur: 0, durManual: false,
    custom: { tbnr: '', text: '', euro: '', pts: '' },
    school: false, rescue: false, restCm: '', notes: ''
  };
}
const S = { dbg: null, ocrErr: null, db: null, cur: emptyCase(), editId: null, savedId: null, dirty: true, records: [], map: null, marker: null, mapBig: false,
            settings: { aiOn: false, aiKey: '', aiModel: 'claude-sonnet-5-5', aiAuto: false, keepOrig: true }, ocr: null, ocrBusy: 0 };

/* ---------- Hilfen ---------- */
let toastTimer;
function toast(msg, ms = 2200) {
  $('toastText').textContent = msg; const t = $('toast'); t.classList.remove('opacity-0'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('opacity-0'), ms);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtDT = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
const group = (id) => TATBESTAENDE.find((g) => g.id === id);

/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ParkWatch_StVO_DB', 5);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('incidents')) db.createObjectStore('incidents', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('originals')) db.createObjectStore('originals', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const idb = (store, mode, fn) => new Promise((resolve, reject) => {
  const tx = S.db.transaction([store], mode); const r = fn(tx.objectStore(store));
  tx.oncomplete = () => resolve(r.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
});
const dbAll = () => idb('incidents', 'readonly', (s) => s.getAll()).then((r) => r || []);
const dbPut = (rec) => idb('incidents', 'readwrite', (s) => s.put(rec));
const dbAdd = (rec) => idb('incidents', 'readwrite', (s) => s.add(rec));
const dbDel = (id) => idb('incidents', 'readwrite', (s) => s.delete(id));
const dbClear = () => idb('incidents', 'readwrite', (s) => s.clear()).then(() => idb('originals', 'readwrite', (s) => s.clear()));
/* Originale (unzensiert) – nur lokal auf diesem Gerät, getrennt von den Fällen; Exporte/Berichte enthalten sie nie */
const origRange = (id) => IDBKeyRange.bound(id + ':', id + ':\uffff');
const origGet = (id) => idb('originals', 'readonly', (s) => s.getAll(origRange(id))).then((r) => (r || []).sort((a, b) => a.i - b.i));
const origDel = (id) => idb('originals', 'readwrite', (s) => s.delete(origRange(id)));
const origPut = (o) => idb('originals', 'readwrite', (s) => s.put(o));
const draftPut = (d) => idb('draft', 'readwrite', (s) => s.put({ key: 'current', ...d }));
const draftGet = () => idb('draft', 'readonly', (s) => s.get('current'));
const draftDel = () => idb('draft', 'readwrite', (s) => s.delete('current'));

/* ---------- Dirty / Entwurf ---------- */
function setSaveButton() {
  const b = $('btnSave'), t = $('btnSaveText');
  if (!S.dirty && S.savedId) {
    b.disabled = true; b.className = 'flex-1 py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 bg-slate-800 text-emerald-400 border border-emerald-500/40 opacity-90';
    t.textContent = 'Gespeichert ✓';
  } else {
    b.disabled = false; b.className = 'flex-1 py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 bg-emerald-600 text-white shadow-lg shadow-emerald-950/60 active:scale-[0.98] transition';
    t.textContent = S.editId || S.savedId ? 'Änderungen speichern' : 'Speichern';
  }
}
const saveDraftSoon = debounce(async () => {
  if (S.savedId && !S.dirty) return;
  const c = S.cur; const hasContent = c.photos.length || c.plate || c.notes || c.model || c.brand;
  if (!hasContent) { try { await draftDel(); } catch (e) {} $('draftBadge').classList.add('hidden'); return; }
  try {
    const cc = { ...c, photos: c.photos.map((p) => ({ origUrl: p.origUrl, boxes: p.boxes, ts: p.ts, locked: !!p.locked, doc: !!p.doc })) };
    await draftPut({ cur: cc, editId: S.editId, savedAt: Date.now() });
    $('draftBadge').classList.remove('hidden');
  } catch (e) { console.warn('Entwurf nicht speicherbar', e); }
}, 700);
function markDirty() { S.dirty = true; setSaveButton(); saveDraftSoon(); }

/* ---------- Karte / Standort ---------- */
function initMap() {
  S.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([HEMSBACH.lat, HEMSBACH.lng], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(S.map);
  S.map.on('click', (e) => setLocation(e.latlng.lat, e.latlng.lng, 'manual'));
}
function placeMarker(lat, lng) {
  if (!S.marker) {
    const icon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#10b981;border:3px solid #fff;box-shadow:0 0 10px rgba(16,185,129,.9)"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    S.marker = L.marker([lat, lng], { icon, draggable: true }).addTo(S.map);
    S.marker.on('dragend', (e) => { const p = e.target.getLatLng(); setLocation(p.lat, p.lng, 'manual', null, true); });
  } else S.marker.setLatLng([lat, lng]);
}
const geoCache = new Map(); let geoCtl = null;
const reverseGeocode = debounce(async (lat, lng) => {
  const key = lat.toFixed(5) + ',' + lng.toFixed(5);
  const apply = (r) => {
    S.cur.road = r.road; S.cur.houseNumber = r.house; S.cur.city = r.city;
    S.cur.address = `${r.city}, ${r.road}${r.house ? ' ' + r.house : ''}`; renderLocation(); saveDraftSoon();
  };
  if (geoCache.has(key)) return apply(geoCache.get(key));
  try {
    geoCtl?.abort(); geoCtl = new AbortController();
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=de`, { signal: geoCtl.signal });
    if (!res.ok) throw new Error(res.status);
    const a = (await res.json()).address || {};
    const r = { road: a.road || a.pedestrian || a.footway || a.path || 'Unbenannte Straße', house: a.house_number || '', city: a.city || a.town || a.village || a.municipality || 'Hemsbach' };
    geoCache.set(key, r); apply(r);
  } catch (e) {
    if (e.name === 'AbortError') return;
    S.cur.address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`; S.cur.road = S.cur.road || 'Ohne Straßenname'; renderLocation();
  }
}, 600);

function setLocation(lat, lng, source, accuracy = null, keepView = false) {
  S.cur.coords = { lat, lng }; S.cur.locSource = source; S.cur.accuracy = accuracy;
  placeMarker(lat, lng); if (!keepView) S.map.setView([lat, lng], Math.max(S.map.getZoom(), 17));
  renderLocation(); reverseGeocode(lat, lng); markDirty();
}
function renderLocation() {
  const c = S.cur, lab = { gps: 'Live-GPS', exif: 'Foto-EXIF', manual: 'Karte (manuell)' };
  $('locAddress').textContent = c.address || (c.coords ? 'Adresse wird gesucht …' : 'Noch kein Standort');
  $('locCoords').textContent = c.coords ? `${c.coords.lat.toFixed(5)}, ${c.coords.lng.toFixed(5)}` : '–';
  $('locTime').textContent = fmtDT(c.ts);
  const sb = $('locSource'); sb.textContent = (lab[c.locSource] || 'kein Standort') + (c.accuracy ? ` ±${Math.round(c.accuracy)} m` : '');
  sb.className = 'px-1.5 rounded border text-[9px] ' + (c.coords ? 'bg-emerald-950 border-emerald-800 text-emerald-300' : 'bg-rose-950 border-rose-800 text-rose-300');
  $('locIcon').className = 'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ' + (c.coords ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-rose-950 text-rose-300 border-rose-800');
  $('gmaps').href = c.coords ? `https://www.google.com/maps?q=${c.coords.lat},${c.coords.lng}` : '#';
}
function locate() {
  if (!navigator.geolocation) { toast('GPS nicht verfügbar – Ort per Karte setzen'); return; }
  $('locAddress').textContent = 'Ermittle Live-Position …';
  navigator.geolocation.getCurrentPosition(
    (p) => setLocation(p.coords.latitude, p.coords.longitude, 'gps', p.coords.accuracy),
    () => { renderLocation(); toast('GPS nicht verfügbar – Ort per Karte setzen', 3500); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 });
}

/* ---------- Foto-Pipeline ---------- */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild nicht lesbar')); };
    img.src = url;
  });
}
function scaledCanvas(src, maxPx) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, k = Math.min(1, maxPx / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
}
function canvasFromUrl(url) {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(scaledCanvas(i, MAX_ORIG_PX)); i.onerror = reject; i.src = url; });
}

async function addPhoto(file) {
  if (!file) return;
  if (S.cur.photos.length >= MAX_PHOTOS) { toast(`Maximal ${MAX_PHOTOS} Fotos je Fall`); return; }
  setOcrStatus('busy', 'Foto wird verarbeitet …');
  let meta = null;
  try { meta = await exifr.parse(file, ['latitude', 'longitude', 'DateTimeOriginal', 'CreateDate']); } catch (e) { /* kein EXIF */ }
  let img;
  try { img = await loadImage(file); } catch (e) { setOcrStatus('hide'); toast('Foto konnte nicht gelesen werden'); return; }
  const canvas = scaledCanvas(img, MAX_ORIG_PX);
  const ts = (meta && (meta.DateTimeOriginal || meta.CreateDate)) ? new Date(meta.DateTimeOriginal || meta.CreateDate).getTime() : Date.now();
  S.peek = false;
  const first = S.cur.photos.length === 0;
  const photo = { orig: canvas, origUrl: canvas.toDataURL('image/jpeg', 0.9), boxes: [], ts, out: null, doc: !first };   // doc = Zusatzfoto nur zur Dokumentation (keine Kennzeichen-Suche)
  S.cur.photos.push(photo); S.cur.active = S.cur.photos.length - 1;

  if (first) {
    S.cur.ts = ts;
    if (meta && Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude)) {
      setLocation(meta.latitude, meta.longitude, 'exif');
    } else if (file.__fromGallery && Math.abs(Date.now() - ts) > 3 * 60000) {
      // Mediathek-Foto ohne Standort und nicht gerade erst aufgenommen: aktuelle GPS-Position wäre FALSCH -> manuell setzen
      S.cur.coords = null; S.cur.locSource = null; S.cur.accuracy = null; S.cur.address = ''; S.cur.road = ''; renderLocation();
      toast('Foto ohne Standort – bitte Ort auf der Karte setzen (siehe Hinweis „Standort behalten")', 4500);
      if (!S.mapBig) $('btnMapSize').click();
      locateHint();
    } else if (!S.cur.coords || file.__fromGallery) locate();
  }
  renderPhoto(); renderThumbs(); updateObservation(); renderViolation(); markDirty();
  if (photo.doc) { setOcrStatus('ok', 'Zusatzfoto hinzugefügt – keine Kennzeichen-Suche'); setTimeout(() => { if (!S.ocrBusy) $('ocrStatus').classList.add('hidden'); }, 3500); }
  else runOcr(photo);
}
function locateHint() { $('mapWrap').scrollIntoView({ behavior: 'smooth', block: 'center' }); }

/* Zeichnen: Original + schwarze Balken. `out` ist die einzige Fassung, die gespeichert/exportiert wird. */
function drawPhoto(canvas, p, withMarks = true, withBars = true) {
  const o = p.orig; canvas.width = o.width; canvas.height = o.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(o, 0, 0);
  ctx.fillStyle = '#000';
  if (withBars) for (const b of p.boxes) { ctx.fillRect(b.x, b.y, b.w, b.h); }
  if (withMarks && withBars) {
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = Math.max(2, o.width * 0.003);
    for (const b of p.boxes) ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
}
function renderPhoto() {
  const p = S.cur.photos[S.cur.active]; const cv = $('photoCanvas');
  const has = !!p;
  cv.classList.toggle('hidden', !has); $('photoPlaceholder').classList.toggle('hidden', has);
  $('photoTools').classList.toggle('hidden', !has); $('tapHint').classList.toggle('hidden', !has);
  if (has) drawPhoto(cv, p, !S.peek, !S.peek);
  $('btnPeek').classList.toggle('text-amber-300', !!S.peek); $('tapHint').innerHTML = S.peek ? '<i class="fa-solid fa-eye text-amber-300 mr-1"></i>Ansicht ohne Balken – zum Bearbeiten wieder einblenden' : (p && p.boxes.length ? '<i class="fa-solid fa-hand-pointer text-emerald-400 mr-1"></i>Balken antippen = entfernen · sonst Kennzeichen antippen' : '<i class="fa-solid fa-hand-pointer text-emerald-400 mr-1"></i>Aufs Kennzeichen tippen = Balken setzen + lesen');
}
function renderThumbs() {
  const box = $('thumbs'); const ph = S.cur.photos;
  box.classList.toggle('hidden', ph.length === 0);
  box.innerHTML = ph.map((p, i) => {
    const cv = document.createElement('canvas'); const k = 120 / Math.max(p.orig.width, p.orig.height); cv.width = Math.round(p.orig.width * k); cv.height = Math.round(p.orig.height * k);
    const g = cv.getContext('2d'); g.drawImage(p.orig, 0, 0, cv.width, cv.height); g.fillStyle = '#000';
    p.boxes.forEach((b) => g.fillRect(b.x * k, b.y * k, b.w * k, b.h * k));
    return `<button data-i="${i}" class="relative w-20 h-16 rounded-lg overflow-hidden border-2 ${i === S.cur.active ? 'border-emerald-500' : 'border-slate-700'} bg-slate-950"><img src="${cv.toDataURL('image/jpeg', 0.6)}" class="w-full h-full object-cover" alt=""><span class="absolute bottom-0 inset-x-0 text-[9px] bg-slate-950/80 text-slate-300">${p.doc ? 'Doku · ' : ''}${new Date(p.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span></button>`;
  }).join('');
}
function updateObservation() {
  const ts = S.cur.photos.map((p) => p.ts).sort((a, b) => a - b); const badge = $('obsBadge');
  if (ts.length < 2) { badge.classList.add('hidden'); S.cur.obsMin = 0; } else {
    const min = Math.round((ts[ts.length - 1] - ts[0]) / 60000); S.cur.obsMin = min;
    badge.textContent = `beobachtet: ${min < 120 ? min + ' min' : (min / 60).toFixed(1) + ' Std.'}`; badge.classList.remove('hidden');
    if (!S.cur.durManual) S.cur.dur = min >= 180 ? 3 : min >= 60 ? 1 : 0;
  }
  $('durAuto').textContent = (!S.cur.durManual && ts.length >= 2) ? '(aus Foto-Zeiten)' : '';
}
function setOcrStatus(kind, text = '') {
  const el = $('ocrStatus'); if (kind === 'hide') { el.classList.add('hidden'); return; }
  const icon = kind === 'busy' ? '<span class="w-3 h-3 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin inline-block"></span>'
    : kind === 'ok' ? '<i class="fa-solid fa-shield-halved text-emerald-400"></i>' : '<i class="fa-solid fa-hand-pointer text-amber-400"></i>';
  el.innerHTML = `${icon}<span>${esc(text)}</span>`; el.classList.remove('hidden');
}

/* ---------- Kennzeichen-OCR (Tesseract.js, lokal gehostet, Lazy-Load) ---------- */
const TO_L = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G' }, TO_D = { O: 0, Q: 0, D: 0, I: 1, L: 1, S: 5, B: 8, Z: 2, G: 6 };
const fixL = (t) => t.replace(/[0-9]/g, (c) => TO_L[c] || c);
const fixD = (t) => t.replace(/[A-Z]/g, (c) => (TO_D[c] !== undefined ? TO_D[c] : c));
function normTok(t) { return t.toUpperCase().replace(/[^A-ZÄÖÜ0-9]/g, ''); }
function plateCandidates(words, strict = false) {
  // words: [{text, conf, bbox:{x0,y0,x1,y1}}] -> Kennzeichen-Kandidaten (Teilfolgen je Zeile, Rauschen dazwischen erlaubt)
  const toks = words.map((w) => ({ t: normTok(w.text), conf: w.conf, b: w.bbox })).filter((w) => w.t.length > 0);
  toks.sort((a, b) => (a.b.y0 + a.b.y1) - (b.b.y0 + b.b.y1));
  const lines = [];
  for (const t of toks) {
    const cy = (t.b.y0 + t.b.y1) / 2, h = Math.max(t.b.y1 - t.b.y0, 8);
    const ln = lines.find((l) => Math.abs(l.cy - cy) < h * 0.7);
    if (ln) { ln.t.push(t); ln.cy = (ln.cy * (ln.t.length - 1) + cy) / ln.t.length; } else lines.push({ cy, t: [t] });
  }
  const out = [];
  for (const ln of lines) {
    const row = ln.t.sort((a, b) => a.b.x0 - b.b.x0).slice(0, 10), n = row.length;
    const tryseq = (seq) => {
      const p = parsePlate(seq.map((q) => q.t), strict); if (!p) return;
      const skip = row.indexOf(seq[seq.length - 1]) - row.indexOf(seq[0]) + 1 - seq.length;
      const hgt = Math.max(...seq.map((q) => q.b.y1 - q.b.y0), 8);
      for (let i = 1; i < seq.length; i++) if (seq[i].b.x0 - seq[i - 1].b.x1 > hgt * 3.5) return; // zu weit auseinander
      const x0 = Math.min(...seq.map((q) => q.b.x0)), y0 = Math.min(...seq.map((q) => q.b.y0)), x1 = Math.max(...seq.map((q) => q.b.x1)), y1 = Math.max(...seq.map((q) => q.b.y1));
      out.push({ text: p, conf: seq.reduce((a, q) => a + q.conf, 0) / seq.length, box: { x0, y0, x1, y1 }, area: (x1 - x0) * (y1 - y0), len: seq.length, skip });
    };
    for (let i = 0; i < n; i++) { tryseq([row[i]]);
      for (let j = i + 1; j < n; j++) { tryseq([row[i], row[j]]); for (let k = j + 1; k < n; k++) tryseq([row[i], row[j], row[k]]); } }
  }
  out.sort((a, b) => (a.skip - b.skip) || (b.len - a.len) || (b.conf * Math.sqrt(b.area) - a.conf * Math.sqrt(a.area)));
  const kept = [];
  for (const c of out) if (!kept.some((k) => overlap(k.box, c.box) > 0.3)) kept.push(c);
  return kept;
}
function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy, ua = (a.x1 - a.x0) * (a.y1 - a.y0), ub = (b.x1 - b.x0) * (b.y1 - b.y0);
  return inter / Math.min(ua, ub || 1);
}
/* Tokens -> „HD AM 2330"; null, wenn kein deutsches Kennzeichenmuster. OCR-Verwechslungen (0/O, 1/I, 5/S, 8/B …) werden je Position korrigiert. */
function parsePlate(tin, strict = false) {
  const fl = strict ? (x) => x : fixL, fd = strict ? (x) => x : fixD;
  // Plakette zwischen Ortskürzel und Buchstaben wird oft als Ziffer/Zeichen gelesen („HD2AM") -> Token aufspalten
  let t = [];
  for (const x of tin) { const m = x.match(/^([A-ZÄÖÜ]{1,3})[0-9OSQ]([A-Z]{1,2})([0-9OIQDLSBZG]{0,5}[A-Z0-9]?)$/); if (m && !strict) { t.push(m[1], m[2]); if (m[3]) t.push(m[3]); } else t.push(x); }
  // Ziffernblock: bis 4 Ziffern (+E/H); ein Zusatzzeichen dahinter (Randlinie als „8"/„N" gelesen) wird verworfen
  const dig = (x) => { const m = x.match(/^([0-9OIQDLSBZG]{1,4})([EH]?)([A-Z0-9])?$/); if (!m) return null; if (!/[0-9]/.test(m[1])) return null; /* mind. eine echt gelesene Ziffer */ const d = fd(m[1]); return /^\d{1,4}$/.test(d) ? d + (m[3] ? '' : m[2]) + (m[3] && m[2] ? m[2] : '') : null; };
  const let1 = (x, max) => { const y = fl(x); return new RegExp('^[A-ZÄÖÜ]{1,' + max + '}$').test(y) ? y : null; };
  let a, b, c;
  if (t.length === 3) { a = let1(t[0], 3); b = let1(t[1], 2); c = dig(t[2]); if (a && b && c) return `${a} ${b} ${c}`; }
  if (t.length === 2) {
    a = let1(t[0], 3);
    if (a) { const m = t[1].match(/^([A-Z0-9]{1,2}?)([0-9OIQDLSBZG]{1,5}[A-Z]?)$/); if (m) { b = let1(m[1], 2); c = dig(m[2]); if (b && c && /\d/.test(c)) return `${a} ${b} ${c}`; } }
    const m2 = t[0].match(/^([A-ZÄÖÜ]{3,5})$/); c = dig(t[1]);
    if (m2 && c && /^\d/.test(c)) { const l = m2[1]; return `${l.slice(0, 2)} ${l.slice(2)} ${c}`; }
  }
  if (t.length === 1) {
    const m = t[0].match(/^([A-ZÄÖÜ]{3,5})([0-9OIS]{1,5}[A-Z]?)$/); c = m && dig(m[2]);
    if (m && c && /^\d/.test(c)) { const l = m[1]; return `${l.slice(0, 2)} ${l.slice(2)} ${c}`; }
  }
  return null;
}
/* Häufiger OCR-Fehler: das „D“ des EU-Streifens klebt am Ortskürzel („DHD AM 2330“) oder steht als Einzelbuchstabe davor. */
const KZ2 = new Set('AA AB AC AE AH AK AM AN AP AS AW AZ BA BB BC BD BE BI BL BM BN BO BS BT BZ CB CE CO CW DA DD DE DH DL DM DN DO DU DW DZ EA EB ED EE EF EH EI EL EM EN ER ES EU FB FD FF FG FL FN FO FR FS FT FU FW GA GC GD GE GF GG GI GL GM GN GP GR GS GT GZ HA HB HC HD HE HF HG HH HI HK HL HM HN HO HP HR HS HU HV HX HY HZ IK IN IZ JE JL KA KB KC KE KF KG KH KI KL KM KN KO KR KS KT KU KW KY LA LB LC LD LDS LG LH LI LL LM LN LO LP LR LU MA MB MC MD ME MG MH MI MK ML MM MN MO MQ MR MS MT MW MY MZ NB ND NE NF NH NI NK NM NN NO NP NR NT NU NW NY NZ OA OB OC OD OE OF OG OH OK OL OM ON OP OS OT OZ PA PB PE PF PI PL PM PN PR PS RA RB RC RD RE RG RH RL RM RN RO RP RS RT RV RW RZ SB SC SE SG SH SI SK SL SM SN SO SP SR ST SU SW SY SZ TF TG TO TP TS TT TÜ UE UH UL UM UN VB VG VK VR VS WA WB WD WE WF WG WI WK WL WM WN WO WR WS WT WN WU WW WZ ZE ZI ZW'.split(' '));
const KZ_D3 = new Set(['DAH', 'DAN', 'DAU', 'DBR', 'DEG', 'DEL', 'DGF', 'DIL', 'DIN', 'DIZ', 'DLG', 'DON', 'DUD', 'DÜW']);
function cleanPlate(t) {
  let m = String(t).match(/^([A-ZÄÖÜ]{1,3}) ([A-Z]{1,2}) (\d{1,4}[EH]?)$/);
  if (m) { const c = m[1]; if (c.length === 3 && c[0] === 'D' && !KZ_D3.has(c) && KZ2.has(c.slice(1))) return c.slice(1) + ' ' + m[2] + ' ' + m[3]; return t; }
  m = String(t).match(/^([A-ZÄÖÜ]) ([A-ZÄÖÜ]{1,3}) ([A-Z]{1,2}) (\d{1,4}[EH]?)$/);       // vierteilig = nie gültig -> führenden Einzelbuchstaben entfernen
  return m ? m[2] + ' ' + m[3] + ' ' + m[4] : t;
}
function plateFromText(text, conf = 60, strict = false) {
  const toks = String(text).split(/\s+/).map(normTok).filter(Boolean);
  return plateCandidates(toks.map((t, i) => ({ text: t, conf, bbox: { x0: i * 100, y0: 0, x1: i * 100 + 80, y1: 40 } })), strict).map((c) => ({ ...c, text: cleanPlate(c.text) }));
}

/* --- Kennzeichen lokalisieren (klassische Bildverarbeitung) + Region-OCR ---
 * Vollbild-OCR findet Kennzeichen in Straßenszenen kaum zuverlässig. Daher: helle Rechtecke mit dichten
 * senkrechten Kanten (= Schriftband) suchen, nur diese Ausschnitte lesen und strikt gegen das deutsche
 * Kennzeichen-Muster prüfen. Fehlalarme fallen durch die Muster-Prüfung heraus. */
function findPlateRegions(src) {
  const sc = Math.min(1, 1100 / src.width), w = Math.max(8, Math.round(src.width * sc)), h = Math.max(8, Math.round(src.height * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) { const i = y * w + x; if (Math.abs(gray[i + 1] - gray[i]) > 40) edge[i] = 1; }
  // horizontales Zusammenziehen: >=2 Kanten innerhalb von 41 px -> Schriftband
  const R = 20, mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0; const row = y * w;
    for (let x = 0; x < w + R; x++) {
      if (x < w) sum += edge[row + x];
      const o = x - 2 * R - 1; if (o >= 0) sum -= edge[row + o];
      const cx = x - R; if (cx >= 0 && cx < w && sum >= 2) mask[row + cx] = 1;
    }
  }
  // vertikales Schließen (Lücken bis 3 Zeilen)
  for (let x = 0; x < w; x++) { let last = -99; for (let y = 0; y < h; y++) { if (mask[y * w + x]) { if (y - last > 1 && y - last <= 4) for (let k = last + 1; k < y; k++) mask[k * w + x] = 1; last = y; } } }
  const seen = new Uint8Array(w * h), regs = [], stack = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!mask[s0] || seen[s0]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0; stack.push(s0); seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop(), y = (i / w) | 0, x = i - y * w; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ar = bw / bh;
    if (bh < 9 || bh > 110 || bw < 36 || bw > 520 || ar < 1.8 || ar > 9.5 || area / (bw * bh) < 0.28) continue;
    // Helligkeit des Ausschnitts (Kennzeichen sind überwiegend hell)
    let br = 0, n = 0; for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { br += gray[y * w + x]; n++; }
    br /= n; const score = (area / (bw * bh)) * (0.4 + br / 255) * Math.min(1, bw / 90);
    regs.push({ x: x0 / sc, y: y0 / sc, w: bw / sc, h: bh / sc, score });
  }
  return regs.sort((a, b) => b.score - a.score);
}
function enhanceCanvas(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true }), im = g.getImageData(0, 0, cv.width, cv.height), d = im.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; d[i] = v; hist[v]++; }
  const total = cv.width * cv.height; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
  const span = Math.max(40, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)); d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(im, 0, 0);
}
function blueStripEnd(cv) {
  const W = Math.floor(cv.width * 0.35), h = cv.height; if (W < 4) return 0;
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, h).data; let start = -1, end = 0, gap = 0;
  for (let x = 0; x < W; x++) {
    let c = 0; for (let y = 0; y < h; y += 2) { const i = (y * W + x) * 4; if (d[i + 2] > d[i] + 30 && d[i + 2] > d[i + 1] + 8) c++; }
    const blue = c > (h / 2) * 0.3;
    if (blue) { if (start < 0) start = x; end = x + 1; gap = 0; } else if (start >= 0 && ++gap > 3) break;
  }
  return start >= 0 && end - start > cv.width * 0.03 ? end : 0;
}
function otsu(d) {
  const hist = new Uint32Array(256); let n = 0; for (let i = 0; i < d.length; i += 4) { hist[d[i]]++; n++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]; let sB = 0, wB = 0, best = 0, th = 128;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = i; } }
  return th;
}
/* Mehrere Aufbereitungen eines Kennzeichen-Ausschnitts. Der blaue EU-Streifen und dunkle Randlinien werden abgeschnitten
 * (sonst als „E"/„8" gelesen); weiße Ränder helfen Tesseract; mehrere Maßstäbe/Kontraste, danach Abstimmung. */
function plateVariants(canvas, r) {
  const sx = Math.max(0, r.x - r.w * 0.04), sy = Math.max(0, r.y - r.h * 0.12), sw = Math.min(canvas.width - sx, r.w * 1.08), sh = Math.min(canvas.height - sy, r.h * 1.24);
  const base = document.createElement('canvas'); base.width = Math.max(8, Math.round(sw)); base.height = Math.max(8, Math.round(sh));
  const bg = base.getContext('2d', { willReadFrequently: true }); bg.drawImage(canvas, sx, sy, sw, sh, 0, 0, base.width, base.height);
  let x0 = 0, x1 = base.width; const be = blueStripEnd(base); if (be > 0 && be < base.width * 0.3) x0 = be;
  const bd = bg.getImageData(0, 0, base.width, base.height).data;
  const colLum = (x) => { let a = 0, n = 0; for (let y = Math.round(base.height * 0.3); y < base.height * 0.7; y += 2) { const i = (y * base.width + x) * 4; a += (bd[i] * 77 + bd[i + 1] * 150 + bd[i + 2] * 29) >> 8; n++; } return a / n; };
  let cut = 0; while (cut < base.width * 0.05 && x1 - 1 > x0 + 10 && colLum(x1 - 1) < 90) { x1--; cut++; }
  const vars = [];
  for (const [target, mode] of [[140, 'enh'], [140, 'raw'], [100, 'enh'], [200, 'raw'], [140, 'bin']]) {
    const k = Math.max(0.5, Math.min(6, target / r.h)), pad = 12, w = Math.round((x1 - x0) * k), h = Math.round(base.height * k);
    const cr = document.createElement('canvas'); cr.width = w + 2 * pad; cr.height = h + 2 * pad;
    const g = cr.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, cr.width, cr.height); g.imageSmoothingQuality = 'high';
    g.drawImage(base, x0, 0, x1 - x0, base.height, pad, pad, w, h);
    if (mode !== 'raw') { enhanceCanvas(cr); if (mode === 'bin') { const im = g.getImageData(0, 0, cr.width, cr.height), th = otsu(im.data); for (let i = 0; i < im.data.length; i += 4) { const v = im.data[i] > th ? 255 : 0; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; } g.putImageData(im, 0, 0); } }
    vars.push(cr);
  }
  return vars;
}
async function readPlateRegion(canvas, r) {
  const w = await getOcr(), votes = new Map();
  for (const v of plateVariants(canvas, r)) {
    const { data } = await w.recognize(v); const txt = (data.text || '').trim().replace(/\s+/g, ' '); (S.dbg ||= { regions: 0, reads: [], tiles: 0 }).reads.push(txt);
    const c = plateFromText(txt, data.confidence || 0)[0];
    if (c) { const e = votes.get(c.text) || { n: 0, conf: 0 }; e.n++; e.conf = Math.max(e.conf, data.confidence || 0); votes.set(c.text, e); if (e.n >= 2) break; }
  }
  if (!votes.size) return null;
  const [text, e] = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || b[1].conf - a[1].conf)[0];
  return { text, conf: e.conf, votes: e.n };
}
async function ocrPlatesIn(canvas, maxRegions = 4) {
  const regs = findPlateRegions(canvas).slice(0, maxRegions), found = [];
  S.dbg = { regions: regs.length, reads: [], tiles: 0 };
  for (const r of regs) {
    const res = await readPlateRegion(canvas, r); if (!res) continue;
    if (res.votes < 2 && res.text.replace(/ /g, '').length < 6) continue;   // Einzeltreffer nur bei ausreichend langem Kennzeichen (Fehlalarme)
    found.push({ ...res, box: { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h } });
  }
  found.sort((a, b) => b.votes - a.votes || b.conf - a.conf); const kept = [];
  for (const f of found) if (!kept.some((q) => overlap(q.box, f.box) > 0.3)) kept.push(f);
  return kept;
}

/* Fallback, wenn die Lokalisierung nichts findet: überlappende Kacheln, hochskaliert, Mehrzeilen-Modus */
async function ocrTiles(canvas) {
  const w = await getOcr(), found = []; await w.setParameters({ tessedit_pageseg_mode: '11' });
  try {
    const cols = 3, rows = 2, tw = canvas.width / cols * 1.5, th = canvas.height / rows * 1.4;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const sx = Math.min(canvas.width - tw, c * (canvas.width - tw) / (cols - 1)), sy = Math.min(canvas.height - th, r * (canvas.height - th) / Math.max(1, rows - 1));
      const k = Math.min(3, 1400 / tw), cr = document.createElement('canvas'); cr.width = Math.round(tw * k); cr.height = Math.round(th * k);
      const g = cr.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(canvas, sx, sy, tw, th, 0, 0, cr.width, cr.height); enhanceCanvas(cr);
      setOcrStatus('busy', `Suche Kennzeichen (Kachel ${r * cols + c + 1}/${cols * rows}) …`); S.dbg.tiles++;
      const { data } = await w.recognize(cr);
      for (const cand of plateCandidates((data.words || []).map((q) => ({ text: q.text, conf: Math.max(q.confidence, data.confidence || 0), bbox: q.bbox })), true)) {
        if (cand.conf < 55) continue;
        found.push({ text: cand.text, conf: cand.conf, box: { x0: sx + cand.box.x0 / k, y0: sy + cand.box.y0 / k, x1: sx + cand.box.x1 / k, y1: sy + cand.box.y1 / k } });
      }
    }
  } finally { await w.setParameters({ tessedit_pageseg_mode: '7' }); }
  found.sort((a, b) => b.conf - a.conf); const kept = [];
  for (const f of found) if (!kept.some((q) => overlap(q.box, f.box) > 0.3)) kept.push(f);
  return kept.slice(0, 3);
}

async function getOcr() {
  if (S.ocr) return S.ocr;
  if (!window.Tesseract) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/tess/tesseract.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const base = new URL('vendor/tess/', document.baseURI).href;
  const worker = await Tesseract.createWorker('deu', 1, {
    workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', gzip: true, workerBlobURL: false, cacheMethod: 'none'
  });
  await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789 -', tessedit_pageseg_mode: '7' });
  S.ocr = worker; return worker;
}
async function runOcr(photo) {
  S.ocrBusy++; setOcrStatus('busy', 'Suche Kennzeichen …');
  try {
    let cands = await ocrPlatesIn(photo.orig);
    if (!cands.length) cands = await ocrTiles(photo.orig);
    if (cands.length) {
      for (const c of cands) photo.boxes.push(padBox(c.box, photo.orig, 0.15, 0.25));
      const main = cands[0].text;
      if (!S.cur.plate) { S.cur.plate = main; S.cur.plateSource = 'ocr'; $('inPlate').value = main; renderPlateBadge(); }
      setOcrStatus('ok', `${cands.length} Kennzeichen erkannt & geschwärzt – bitte prüfen`);
    } else setOcrStatus('warn', 'Kein Kennzeichen erkannt – tippe aufs Kennzeichen');
    S.ocrErr = null;
  } catch (e) {
    console.warn('OCR fehlgeschlagen', e); S.ocrErr = String((e && e.message) || e); setOcrStatus('warn', 'OCR-Fehler: ' + S.ocrErr.slice(0, 80) + ' (Einstellungen → OCR-Test)');
  } finally {
    S.ocrBusy--; renderPhoto(); renderThumbs(); markDirty();
    setTimeout(() => { if (!S.ocrBusy) $('ocrStatus').classList.add('hidden'); }, 6000);
    if (S.settings.aiOn && S.settings.aiAuto && S.settings.aiKey) aiRecognize(true);
  }
}
function padBox(b, o, px, py) {
  const w = b.x1 - b.x0, h = b.y1 - b.y0, x = Math.max(0, b.x0 - w * px), y = Math.max(0, b.y0 - h * py);
  return { x, y, w: Math.min(o.width - x, w * (1 + 2 * px)), h: Math.min(o.height - y, h * (1 + 2 * py)) };
}
/* Tippen: Balken setzen + Region per OCR lesen */
async function tapCensor(ev) {
  const p = S.cur.photos[S.cur.active]; if (!p) return;
  if (S.peek) { toast('Ansicht ohne Balken – oben das Auge antippen, um zu bearbeiten'); return; }
  const cv = $('photoCanvas'), r = cv.getBoundingClientRect();
  const x = (ev.clientX - r.left) * (cv.width / r.width), y = (ev.clientY - r.top) * (cv.height / r.height);
  // vorhandenen Balken antippen = entfernen
  const hit = p.boxes.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  if (hit >= 0) { p.boxes.splice(hit, 1); renderPhoto(); renderThumbs(); markDirty(); return; }
  const w = Math.round(p.orig.width * 0.2), h = Math.round(w / 4.2);
  const box = { x: Math.max(0, Math.min(p.orig.width - w, x - w / 2)), y: Math.max(0, Math.min(p.orig.height - h, y - h / 2)), w, h };
  p.boxes.push(box); renderPhoto(); renderThumbs(); markDirty();
  // Kennzeichen-Region unter dem Finger suchen (ganzes Bild), sonst Bereich um den Tipp-Punkt
  try {
    setOcrStatus('busy', 'Lese Kennzeichen …'); S.dbg = { regions: 0, reads: [], tiles: 0 };
    const regs = findPlateRegions(p.orig);
    const hit = regs.filter((r) => x >= r.x - r.w * 0.15 && x <= r.x + r.w * 1.15 && y >= r.y - r.h * 0.8 && y <= r.y + r.h * 1.8).sort((a, b) => b.score - a.score)[0];
    const tries = hit ? [hit] : [{ x: box.x, y: box.y, w: box.w, h: box.h }, { x: box.x - box.w * 0.25, y: box.y - box.h * 0.2, w: box.w * 1.5, h: box.h * 1.4 }];
    let res = null, used = null;
    for (const r of tries) { res = await readPlateRegion(p.orig, r); if (res) { used = r; break; } }
    if (res) {
      p.boxes[p.boxes.indexOf(box)] = padBox({ x0: used.x, y0: used.y, x1: used.x + used.w, y1: used.y + used.h }, p.orig, 0.15, 0.25);
      $('inPlate').value = res.text; S.cur.plate = res.text; S.cur.plateSource = 'ocr'; renderPlateBadge();
      setOcrStatus('ok', `Gelesen: ${res.text} – bitte prüfen`);
    } else setOcrStatus('warn', hit ? 'Balken gesetzt – Kennzeichen nicht lesbar, bitte eintippen' : 'Balken gesetzt – Kennzeichen bitte von Hand eintippen');
  } catch (e) { S.ocrErr = String((e && e.message) || e); setOcrStatus('warn', 'Balken gesetzt – Kennzeichen von Hand eintippen'); }
  renderPhoto(); renderThumbs(); markDirty();
  setTimeout(() => { if (!S.ocrBusy) $('ocrStatus').classList.add('hidden'); }, 5000);
}
function renderPlateBadge() {
  const b = $('plateBadge'); const src = S.cur.plateSource;
  if (!S.cur.plate) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.textContent = src === 'ocr' ? 'automatisch gelesen' : 'manuell'; b.className = 'text-[10px] px-2 py-0.5 rounded-full border ' + (src === 'ocr' ? 'bg-amber-950 border-amber-800 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-300');
}
function adjustLastBox(f) {
  const p = S.cur.photos[S.cur.active]; if (!p || !p.boxes.length) return;
  const b = p.boxes[p.boxes.length - 1], cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  b.w *= f; b.h *= f; b.x = cx - b.w / 2; b.y = cy - b.h / 2; renderPhoto(); renderThumbs(); markDirty();
}

/* ---------- Tatbestand (Zuordnung) ---------- */
function matchEntry() {
  const c = S.cur, g = group(c.group); if (!g) return null;
  if (g.custom) {
    const t = c.custom; if (!t.tbnr && !t.text) return null;
    return { entry: { tbnr: t.tbnr || '—', text: t.text || 'Sonstiger Verstoß', euro: parseInt(t.euro, 10) || 0, pts: parseInt(t.pts, 10) || 0, verified: false }, exact: true, group: g };
  }
  const wantBeh = c.beh || c.gef, wantGef = c.gef, wantExtra = g.extra ? c.extra : false, wantDur = c.dur;
  let best = null, bestScore = -1e9;
  for (const e of g.items) {
    let s = 0;
    if (!!e.beh === wantBeh) s += 4; else s += e.beh ? -6 : -4;
    if (!!e.gef === wantGef) s += 4; else s += e.gef ? -6 : -4;
    if (!!e.rettung === wantExtra) s += 6; else s += e.rettung ? -8 : -6;
    if (e.dur <= wantDur) s += e.dur === wantDur ? 3 : e.dur * 0.5 - (wantDur - e.dur) * 0.4; else s -= 10;
    if (s > bestScore) { bestScore = s; best = e; }
  }
  const exact = !!best.beh === wantBeh && !!best.gef === wantGef && !!best.rettung === wantExtra && best.dur === wantDur;
  return { entry: best, exact, group: g };
}
function renderViolation() {
  const c = S.cur, g = group(c.group);
  $('groupChips').innerHTML = TATBESTAENDE.map((x) => `<button type="button" data-g="${x.id}" class="chip text-left flex items-center gap-2 ${x.id === c.group ? 'on' : ''}"><i class="fa-solid ${x.icon} w-4 text-center"></i><span class="whitespace-normal leading-tight">${esc(x.label)}</span></button>`).join('');
  $('flagBox').classList.toggle('hidden', !!g.custom); $('customBox').classList.toggle('hidden', !g.custom);
  $('togBehLabel').textContent = g.behLabel || 'Behinderung'; $('togBeh').checked = c.beh || c.gef; $('togGef').checked = c.gef;
  $('togGefWrap').classList.toggle('hidden', g.id === 'feuerwehr');
  $('togExtraWrap').classList.toggle('hidden', !g.extra); if (g.extra) { $('togExtraLabel').textContent = g.extra.label; $('togExtra').checked = c.extra; }
  document.querySelectorAll('#durChips .chip').forEach((b) => b.classList.toggle('on', +b.dataset.dur === c.dur));
  const m = matchEntry();
  if (!m) { $('tbNr').textContent = '–'; $('tbFine').textContent = '–'; $('tbText').textContent = 'Bitte TBNR und Text eintragen.'; $('tbNote').classList.add('hidden'); $('tbVerified').textContent = ''; return; }
  const e = m.entry;
  $('tbNr').textContent = `TBNR ${e.tbnr}`; $('tbFine').textContent = `${e.euro} €${e.pts ? ' · ' + e.pts + ' Pkt' : ''}`; $('tbText').textContent = e.text;
  const note = $('tbNote');
  if (!m.exact) { note.textContent = 'Diese Kombination gibt es im Katalog nicht exakt – nächstliegender Tatbestand gewählt.'; note.classList.remove('hidden'); }
  else if (e.hint) { note.textContent = e.hint; note.classList.remove('hidden'); } else note.classList.add('hidden');
  $('tbVerified').innerHTML = g.custom ? 'Freier Eintrag – ungeprüft.' : e.verified ? `<i class="fa-solid fa-circle-check text-emerald-500"></i> TBNR/Betrag gegen BKat (weg.li) geprüft · ${esc(g.law)}` : `<i class="fa-solid fa-triangle-exclamation text-amber-400"></i> Nicht vollständig geprüft – vor Behördenkontakt kontrollieren · ${esc(g.law)}`;
}

/* ---------- Fahrzeug ---------- */
function getRecentBrands() { try { return JSON.parse(localStorage.getItem('pw_recent_brands') || '[]'); } catch (e) { return []; } }
function pushRecentBrand(b) { if (!b) return; try { const r = [b, ...getRecentBrands().filter((x) => x !== b)].slice(0, 6); localStorage.setItem('pw_recent_brands', JSON.stringify(r)); } catch (e) { /* privat */ } }
function renderVehicle() {
  const c = S.cur;
  const top = ['Volkswagen', 'Mercedes-Benz', 'BMW', 'Audi', 'Opel', 'Ford', 'Škoda', 'Renault', 'Toyota', 'Hyundai'];
  const names = [...new Set([...getRecentBrands(), ...top])].slice(0, 12);
  $('brandPills').innerHTML = names.map((n) => `<button type="button" data-brand="${esc(n)}" class="chip ${c.brand === n ? 'on' : ''}">${esc(n)}</button>`).join('');
  const models = (BRANDS[c.brand] || [null, []])[1];
  $('modelPills').innerHTML = models.slice(0, 14).map((m) => `<button type="button" data-model="${esc(m)}" class="chip ${c.model === m ? 'on' : ''}">${esc(m)}</button>`).join('') || '<span class="text-[11px] text-slate-500">Marke wählen für Modellvorschläge</span>';
  $('dlModels').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
  $('typeChips').innerHTML = VEHICLE_TYPES.map((t) => `<button type="button" data-vt="${t}" class="chip ${c.vtype === t ? 'on' : ''}">${t}</button>`).join('');
  $('colorChips').innerHTML = VEHICLE_COLORS.map(([n, hex]) => `<button type="button" data-color="${n}" aria-label="${n}" class="w-11 h-11 rounded-full border-2 ${c.color === n ? 'border-emerald-400 ring-2 ring-emerald-500/50' : 'border-slate-700'}" style="background:${hex}"></button>`).join('');
  $('inBrand').value = c.brand; $('inModel').value = c.model;
}
function ensureBrandList() { $('dlBrands').innerHTML = Object.keys(BRANDS).map((b) => `<option value="${esc(b)}">`).join(''); }
function pickBrand(name, byUser = true) {
  S.cur.brand = name; const b = BRANDS[name]; if (b && byUser && !S.cur.manual.vtype) S.cur.vtype = b[0];
  if (byUser) { S.cur.manual.brand = true; S.cur.model = ''; } pushRecentBrand(name); renderVehicle(); markDirty();
}

/* ---------- Optionale KI (nur geschwärztes Foto) ---------- */
async function aiRecognize(silent = false) {
  const s = S.settings, p = S.cur.photos[0];
  if (!s.aiOn || !s.aiKey) { if (!silent) toast('KI in den Einstellungen aktivieren'); return; }
  if (!p) { if (!silent) toast('Zuerst ein Foto aufnehmen'); return; }
  if (!p.boxes.length && !silent && !confirm('Es ist noch kein Kennzeichen geschwärzt. Foto trotzdem an die KI senden?')) return;
  if (!p.boxes.length && silent) return;           // automatisch nie ungeschwärzt senden
  if (!navigator.onLine) { if (!silent) toast('Offline – KI nicht erreichbar'); return; }
  const btn = $('btnAI'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-1"></i>erkenne …';
  try {
    const cv = document.createElement('canvas'); const k = Math.min(1, 1100 / Math.max(p.orig.width, p.orig.height)); cv.width = Math.round(p.orig.width * k); cv.height = Math.round(p.orig.height * k);
    const g = cv.getContext('2d'); g.drawImage(p.orig, 0, 0, cv.width, cv.height); g.fillStyle = '#000'; p.boxes.forEach((b) => g.fillRect(b.x * k, b.y * k, b.w * k, b.h * k));
    const b64 = cv.toDataURL('image/jpeg', 0.8).split(',')[1];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': s.aiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: s.aiModel || 'claude-sonnet-5-5', max_tokens: 300, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: 'Bestimme das am deutlichsten sichtbare, geparkte Fahrzeug. Antworte NUR mit JSON: {"marke":"","modell":"","klasse":"PKW|Transporter|LKW|Anhänger|Wohnmobil|Zweirad","farbe":"Weiß|Schwarz|Grau/Silber|Blau|Rot|Grün|Gelb/Orange|Braun/Beige","sicherheit":"hoch|mittel|niedrig"}. Unbekanntes als leeren String.' }
      ] }] })
    });
    if (!res.ok) { let m = ''; try { m = (await res.json()).error?.message || ''; } catch (e) { /* kein JSON */ } throw new Error('HTTP ' + res.status + (m ? ': ' + m.slice(0, 90) : '')); }
    const txt = (await res.json()).content?.map((x) => x.text || '').join('') || '';
    const j = JSON.parse(txt.match(/\{[\s\S]*\}/)[0]); const c = S.cur;
    const brandKey = Object.keys(BRANDS).find((n) => n.toLowerCase() === String(j.marke || '').toLowerCase()) || j.marke || '';
    if (brandKey && !c.manual.brand) c.brand = brandKey;
    if (j.modell && !c.manual.model) c.model = j.modell;
    if (VEHICLE_TYPES.includes(j.klasse) && !c.manual.vtype) c.vtype = j.klasse;
    if (VEHICLE_COLORS.some(([n]) => n === j.farbe) && !c.manual.color) c.color = j.farbe;
    c.aiFilled = true; renderVehicle(); markDirty();
    const n = $('aiNote'); n.textContent = `KI-Vorschlag (Sicherheit: ${j.sicherheit || '?'}) – bitte prüfen und ggf. korrigieren.`; n.classList.remove('hidden');
  } catch (e) { console.warn(e); if (!silent) toast('KI-Erkennung fehlgeschlagen (' + e.message + ')', 3500); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles mr-1"></i>KI-Erkennung'; }
}

/* ---------- Speichern ---------- */
function renderFinalPhoto(p) {
  const k = Math.min(1, MAX_OUT_PX / Math.max(p.orig.width, p.orig.height)); const cv = document.createElement('canvas');
  cv.width = Math.round(p.orig.width * k); cv.height = Math.round(p.orig.height * k);
  const g = cv.getContext('2d'); g.drawImage(p.orig, 0, 0, cv.width, cv.height); g.fillStyle = '#000'; p.boxes.forEach((b) => g.fillRect(b.x * k, b.y * k, b.w * k, b.h * k));
  return cv.toDataURL('image/jpeg', 0.82);
}
function collectForm() {
  const c = S.cur;
  c.plate = $('inPlate').value.trim().toUpperCase(); c.brand = $('inBrand').value.trim(); c.model = $('inModel').value.trim();
  c.notes = $('inNotes').value.trim(); c.restCm = $('inRest').value.trim();
}
async function save() {
  collectForm(); const c = S.cur;
  if (!c.photos.length) { toast('Ohne Foto kann nicht gespeichert werden – bitte zuerst ein Foto aufnehmen oder laden', 3500); return; }
  if (!c.coords) { toast('Kein Standort – bitte Ort auf der Karte setzen', 3500); locateHint(); return; }
  const m = matchEntry(); if (!m) { toast('Bitte TBNR/Text eintragen'); return; }
  if (c.photos.some((p) => !p.locked && !p.doc && p.boxes.length === 0) && !confirm('Auf mindestens einem Foto ist kein Kennzeichen geschwärzt. Trotzdem speichern?')) return;
  if (c.photos.some((p) => !p.locked && p.doc && p.boxes.length === 0) && !confirm('Zusatzfotos werden nicht automatisch geprüft. Ist auf keinem davon ein Kennzeichen oder Gesicht erkennbar? (Sonst: Foto antippen und aufs Kennzeichen tippen.)')) return;
  const e = m.entry; const outs = c.photos.map((p) => ({ img: renderFinalPhoto(p), ts: p.ts }));
  const times = c.photos.map((p) => p.ts).sort((a, b) => a - b);
  const rec = {
    schema: 2, timestamp: new Date(c.ts).toISOString(), observedUntil: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    durationMin: c.obsMin || 0, coords: c.coords, locSource: c.locSource, accuracy: c.accuracy,
    address: c.address, road: c.road || (c.address.split(',')[1] || '').trim(), houseNumber: c.houseNumber, city: c.city,
    licensePlate: c.plate, plateSource: c.plateSource,
    vehicleBrand: c.brand, vehicleModel: [c.brand, c.model].filter(Boolean).join(' ') || 'Unbekannt', vehicleType: c.vtype, vehicleColor: c.color, aiFilled: c.aiFilled,
    group: c.group, tbnr: e.tbnr, tbnrDesc: e.text, fine: e.euro, points: e.pts, tbVerified: !!e.verified,
    flags: { behinderung: c.beh || c.gef, gefaehrdung: c.gef, rettung: c.extra, dauer: c.dur },
    isSchoolRoute: c.school, rescueRoute: c.rescue, restCm: c.restCm === '' ? null : parseInt(c.restCm, 10),
    notes: c.notes, photos: outs, blurredPhoto: outs[0]?.img || null
  };
  try {
    if (S.editId) { rec.id = S.editId; await dbPut(rec); S.savedId = S.editId; }
    else if (S.savedId) { rec.id = S.savedId; await dbPut(rec); }
    else S.savedId = await dbAdd(rec);
    if (S.settings.keepOrig !== false) {
      const rid = S.editId || S.savedId; const ps = c.photos; let any = false;
      if (ps.some((p) => !p.locked)) { await origDel(rid); for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (p.locked) continue; await origPut({ key: rid + ':' + i, i, img: p.origUrl, boxes: p.boxes, ts: p.ts, doc: !!p.doc }); any = true; } }
      if (any && !rec.hasOrig) { rec.id = rid; rec.hasOrig = true; await dbPut(rec); }
    }
    await draftDel(); $('draftBadge').classList.add('hidden'); S.peek = false;
    S.dirty = false; setSaveButton(); toast('Gespeichert'); refreshStats();
  } catch (err) { console.error(err); toast('Speichern fehlgeschlagen: ' + (err && err.name === 'QuotaExceededError' ? 'Speicher voll' : 'Datenbankfehler'), 4500); }
}
function newCase(silent) {
  S.cur = emptyCase(); S.editId = null; S.savedId = null; S.dirty = true;
  $('inPlate').value = ''; $('inNotes').value = ''; $('inRest').value = ''; $('togSchool').checked = false; $('togRescue').checked = false;
  $('inCamera').value = ''; $('inGallery').value = ''; $('aiNote').classList.add('hidden'); $('ocrStatus').classList.add('hidden');
  ['cuTbnr', 'cuText', 'cuEuro', 'cuPts'].forEach((i) => ($(i).value = ''));
  if (S.marker) { S.map.removeLayer(S.marker); S.marker = null; }
  renderAll(); draftDel().catch(() => {}); $('draftBadge').classList.add('hidden'); setSaveButton();
  locate(); if (!silent) toast('Neuer Fall');
  $('scroller').scrollTo({ top: 0 });
}
function renderAll() {
  renderPhoto(); renderThumbs(); renderLocation(); renderViolation(); renderVehicle(); renderPlateBadge(); updateObservation();
  $('inPlate').value = S.cur.plate; $('inNotes').value = S.cur.notes; $('inRest').value = S.cur.restCm; $('togSchool').checked = S.cur.school; $('togRescue').checked = S.cur.rescue;
  restNote(); setSaveButton();
}
function restNote() {
  const v = parseInt($('inRest').value, 10); const n = $('restNote');
  n.textContent = Number.isFinite(v) ? (v < NARROW_CM ? `Unter ${NARROW_CM} cm: wird im Bericht als Engstelle für Rollstuhl/Kinderwagen gezählt (App-Schwelle).` : `Ab ${NARROW_CM} cm: nicht als Engstelle gezählt.`) : '';
}

/* ---------- Bericht ---------- */
const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
function bar(label, count, total, extra = '') {
  const p = pct(count, total);
  return `<div class="bg-slate-950/60 p-2 rounded-xl border border-slate-800"><div class="flex justify-between text-xs"><span class="font-semibold text-slate-200 truncate pr-2">${esc(label)}</span><span class="font-mono text-emerald-400 font-bold shrink-0">${count} <span class="text-slate-500 font-normal">(${p}%)</span></span></div><div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1"><div class="bg-emerald-500 h-full" style="width:${p}%"></div></div>${extra}</div>`;
}
async function refreshStats() {
  const rs = (S.records = (await dbAll()).sort((a, b) => a.timestamp.localeCompare(b.timestamp))); const n = rs.length;
  $('countBadge').textContent = n;
  const empty = '<div class="text-slate-500 italic text-xs py-1">Keine Daten.</div>';
  if (!n) { $('kpis').innerHTML = ''; ['repHotspots', 'repTbnr', 'repTime', 'repTypes'].forEach((i) => ($(i).innerHTML = empty)); $('repRecords').innerHTML = '<div class="text-center py-8 text-slate-500 text-xs">Noch keine Fälle.</div>'; $('repFines').textContent = '0 €'; $('repPeriod').textContent = 'Noch keine Daten'; return; }
  const narrow = rs.filter((r) => (r.restCm != null && r.restCm < NARROW_CM) || r.flags?.behinderung).length;
  const school = rs.filter((r) => r.isSchoolRoute).length, rescue = rs.filter((r) => r.rescueRoute || r.flags?.rettung || r.group === 'feuerwehr' || r.group === 'enge').length;
  const heavy = rs.filter((r) => r.vehicleType === 'LKW' || r.vehicleType === 'Anhänger' || r.vehicleType === 'Wohnmobil' || r.vehicleType === 'Transporter').length;
  const plates = {}; rs.forEach((r) => { if (r.licensePlate) plates[r.licensePlate] = (plates[r.licensePlate] || 0) + 1; });
  const repeat = Object.values(plates).filter((x) => x >= 2).length;
  const kpi = (t, v, sub, col) => `<div class="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5"><div class="text-[10px] ${col} uppercase font-medium">${t}</div><div class="text-xl font-black font-mono ${col}">${v}</div><div class="text-[9px] text-slate-500">${sub}</div></div>`;
  $('kpis').innerHTML = kpi('Fälle', n, 'dokumentiert', 'text-white') + kpi('Fußgänger-Hindernis', pct(narrow, n) + '%', `${narrow} ${narrow === 1 ? 'Fall' : 'Fälle'} (Behinderung / Engstelle)`, 'text-rose-400') + kpi('Schul-/Kitaweg', pct(school, n) + '%', `${school} ${school === 1 ? 'Fall' : 'Fälle'}`, 'text-amber-400') + kpi('Rettungsweg', pct(rescue, n) + '%', `${rescue} ${rescue === 1 ? 'Fall' : 'Fälle'}`, 'text-orange-400') + kpi('Gewerbl./Groß', pct(heavy, n) + '%', `${heavy} Fahrzeuge`, 'text-cyan-400') + kpi('Wiederholt', repeat, 'Fahrzeuge ≥ 2×', 'text-violet-300');
  $('repFines').textContent = rs.reduce((s, r) => s + (r.fine || 0), 0).toLocaleString('de-DE') + ' €';
  const d0 = new Date(rs[0].timestamp), d1 = new Date(rs[n - 1].timestamp);
  $('repPeriod').textContent = `${d0.toLocaleDateString('de-DE')} – ${d1.toLocaleDateString('de-DE')} · ${n} ${n === 1 ? 'Fall' : 'Fälle'}`;

  const roads = {}; rs.forEach((r) => { const k = r.road || (r.address || '').split(',')[1]?.replace(/\s\d+\w?$/, '').trim() || 'Unbekannt'; roads[k] = (roads[k] || 0) + 1; });
  $('repHotspots').innerHTML = Object.entries(roads).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => bar(k, v, n)).join('');
  const tb = {}; rs.forEach((r) => { const k = `${r.tbnr} · ${r.tbnrDesc || ''}`; tb[k] = (tb[k] || 0) + 1; });
  $('repTbnr').innerHTML = Object.entries(tb).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="flex justify-between gap-2 py-1.5 border-b border-slate-800/80 last:border-none text-[11px]"><span class="text-slate-300">${esc(k)}</span><span class="font-mono font-bold text-amber-400 shrink-0">${v}×</span></div>`).join('');
  const buckets = { 'Nacht (22–6 Uhr)': 0, 'Morgens (6–10)': 0, 'Tagsüber (10–17)': 0, 'Abends (17–22)': 0 };
  rs.forEach((r) => { const h = new Date(r.timestamp).getHours(); buckets[h >= 22 || h < 6 ? 'Nacht (22–6 Uhr)' : h < 10 ? 'Morgens (6–10)' : h < 17 ? 'Tagsüber (10–17)' : 'Abends (17–22)']++; });
  $('repTime').innerHTML = Object.entries(buckets).map(([k, v]) => bar(k, v, n)).join('');
  const ty = {}; rs.forEach((r) => { ty[r.vehicleType || '?'] = (ty[r.vehicleType || '?'] || 0) + 1; });
  $('repTypes').innerHTML = Object.entries(ty).sort((a, b) => b[1] - a[1]).map(([k, v]) => bar(k, v, n)).join('');
  $('repRecords').innerHTML = rs.slice().reverse().map((r) => `
    <button data-open="${r.id}" class="w-full text-left bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex items-center gap-3 active:scale-[0.99]">
      <div class="w-14 h-14 rounded-lg bg-slate-950 overflow-hidden flex-shrink-0 border border-slate-800">${r.blurredPhoto ? `<img src="${r.blurredPhoto}" class="w-full h-full object-cover" alt="">` : '<div class="w-full h-full flex items-center justify-center text-slate-600"><i class="fa-solid fa-image"></i></div>'}</div>
      <div class="min-w-0 flex-1"><div class="text-xs font-semibold text-slate-200 truncate">${esc(r.vehicleModel)} <span class="font-mono text-emerald-400 text-[10px]">${esc(r.licensePlate || '')}</span></div>
      <div class="text-[10px] text-amber-400 font-mono">TBNR ${esc(r.tbnr)} · ${r.fine} €${r.tbVerified ? '' : ' ⚠'}</div>
      <div class="text-[10px] text-slate-400 truncate">${esc(r.address)} · ${fmtDT(Date.parse(r.timestamp))}${r.isSchoolRoute ? ' · <span class="text-rose-400">Schulweg</span>' : ''}</div>
      ${r.notes ? `<div class="text-[10px] text-slate-300 mt-0.5" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden"><i class="fa-solid fa-note-sticky text-slate-500 mr-1"></i>${esc(r.notes)}</div>` : ''}</div>
      <i class="fa-solid fa-chevron-right text-xs text-slate-500"></i></button>`).join('');
}
function openDetail(id) {
  const r = S.records.find((x) => x.id === id); if (!r) return;
  const pics = (r.photos?.length ? r.photos : r.blurredPhoto ? [{ img: r.blurredPhoto }] : []);
  $('mImgs').innerHTML = pics.map((p, i) => `<img data-zoom="${i}" src="${p.img}" class="h-40 rounded-xl border border-slate-800 flex-shrink-0 cursor-zoom-in" alt="Foto vergrößern">`).join('');
  $('mImgs').onclick = (e) => { const t = e.target.closest('[data-zoom]'); if (t) openLightbox(pics[+t.dataset.zoom].img, 'Foto (Kennzeichen geschwärzt)'); };
  $('mOrig').classList.toggle('hidden', !r.hasOrig);
  $('mOrig').onclick = async () => { const os = await origGet(r.id).catch(() => []); if (!os.length) return toast('Kein Original gespeichert'); openLightbox(os.map((o) => o.img), 'ORIGINAL – nur auf diesem Gerät, nicht für Weitergabe'); };
  const row = (k, v) => `<div class="flex justify-between gap-3"><span class="text-slate-400 shrink-0">${k}</span><span class="text-slate-200 text-right">${v}</span></div>`;
  $('mBody').innerHTML = row('Kennzeichen', `<span class="font-mono font-bold text-emerald-300">${esc(r.licensePlate || '—')}</span>`) + row('Fahrzeug', `${esc(r.vehicleModel)} (${esc(r.vehicleType)}${r.vehicleColor ? ', ' + esc(r.vehicleColor) : ''})${r.aiFilled ? ' · KI' : ''}`) +
    row('Tatbestand', `<span class="font-mono text-amber-300">TBNR ${esc(r.tbnr)} · ${r.fine} €${r.points ? ' · ' + r.points + ' Pkt' : ''}</span>`) + `<p class="text-[11px] text-slate-400">${esc(r.tbnrDesc)}</p>` +
    row('Ort', esc(r.address)) + row('Zeit', fmtDT(Date.parse(r.timestamp)) + (r.durationMin ? ` (+${r.durationMin} min)` : '')) + row('Standort-Quelle', esc(r.locSource || '—')) +
    (r.restCm != null ? row('Restbreite', r.restCm + ' cm') : '') + (r.notes ? `<p class="pt-1 border-t border-slate-800 text-[11px] text-slate-300">${esc(r.notes)}</p>` : '');
  $('mMaps').href = `https://www.google.com/maps?q=${r.coords.lat},${r.coords.lng}`;
  $('mDel').onclick = async () => { if (!confirm('Fall endgültig löschen?')) return; await dbDel(id); await origDel(id).catch(() => {}); $('modal').classList.add('hidden'); toast('Gelöscht'); refreshStats(); };
  $('mEdit').onclick = () => editRecord(r);
  $('modal').classList.remove('hidden');
}
async function editRecord(r) {
  $('modal').classList.add('hidden');
  const c = emptyCase();
  c.ts = Date.parse(r.timestamp); c.coords = r.coords; c.locSource = r.locSource; c.accuracy = r.accuracy; c.address = r.address; c.road = r.road; c.houseNumber = r.houseNumber; c.city = r.city;
  c.plate = r.licensePlate || ''; c.plateSource = r.plateSource || 'manual'; c.brand = r.vehicleBrand || ''; c.model = (r.vehicleModel || '').replace(r.vehicleBrand || '', '').trim(); c.vtype = r.vehicleType || 'PKW'; c.color = r.vehicleColor || '';
  c.group = r.group || 'gehweg'; c.beh = !!r.flags?.behinderung && !r.flags?.gefaehrdung; c.gef = !!r.flags?.gefaehrdung; c.extra = !!r.flags?.rettung; c.dur = r.flags?.dauer || 0; c.durManual = true;
  c.school = !!r.isSchoolRoute; c.rescue = !!r.rescueRoute; c.restCm = r.restCm ?? ''; c.notes = r.notes || '';
  if (c.group === 'sonst') c.custom = { tbnr: r.tbnr, text: r.tbnrDesc, euro: String(r.fine), pts: String(r.points || '') };
  const os = r.hasOrig ? await origGet(r.id).catch(() => []) : [];
  if (os.length) for (const o of os) { const cv = await canvasFromUrl(o.img); c.photos.push({ orig: cv, origUrl: o.img, boxes: o.boxes || [], ts: o.ts, out: null, locked: false, doc: !!o.doc }); }
  else for (const p of (r.photos || [])) { const cv = await canvasFromUrl(p.img); c.photos.push({ orig: cv, origUrl: p.img, boxes: [], ts: p.ts, out: p.img, locked: true }); }
  S.peek = false; S.cur = c; S.editId = r.id; S.savedId = r.id; S.dirty = false;
  if (c.coords) { placeMarker(c.coords.lat, c.coords.lng); S.map.setView([c.coords.lat, c.coords.lng], 17); }
  switchTab('capture'); renderAll(); setSaveButton(); toast('Fall geladen – ändern und speichern');
}

/* ---------- Export / Import ---------- */
async function shareOrDownload(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
/* Bericht als eigenständige HTML-Datei (druckfreundlich, anonym: ohne Kennzeichen). iOS-PWA kann window.print() nicht zuverlässig. */
function buildReportHtml(rs) {
  const sorted = rs.slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)), n = sorted.length;
  const d0 = fmtDT(Date.parse(sorted[0].timestamp)).split(',')[0], d1 = fmtDT(Date.parse(sorted[n - 1].timestamp)).split(',')[0];
  const cnt = (f) => sorted.filter(f).length, roads = {};
  sorted.forEach((r) => { const k = r.road || r.address || 'unbekannt'; roads[k] = (roads[k] || 0) + 1; });
  const hot = Object.entries(roads).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${v}</td><td class="r">${Math.round(v / n * 100)} %</td></tr>`).join('');
  const sum = sorted.reduce((t, r) => t + (+r.fine || 0), 0);
  const noKz = (t) => esc((t || '').replace(/\b[A-ZÄÖÜ]{1,3}[ -]?[A-Z]{1,2}[ -]?\d{1,4}[EH]?\b/g, '[Kz]'));
  const cases = sorted.map((r, i) => `<section class="case"><h3>Fall ${i + 1} · ${esc(fmtDT(Date.parse(r.timestamp)))}</h3>
    <div class="grid"><div>${(r.photos && r.photos.length ? r.photos : (r.blurredPhoto ? [{ img: r.blurredPhoto }] : [])).map((ph) => `<img src="${ph.img}" alt="Foto (Kennzeichen geschwärzt)">`).join('')}</div>
    <table class="kv"><tr><td>Ort</td><td>${esc(r.address || '')}${r.coords ? ` <span class="m">(${(+r.coords.lat).toFixed(5)}, ${(+r.coords.lng).toFixed(5)})</span>` : ''}</td></tr>
    <tr><td>Fahrzeug</td><td>${esc([r.vehicleModel, r.vehicleType, r.vehicleColor].filter(Boolean).join(' · '))}</td></tr>
    <tr><td>Tatbestand</td><td>TBNR ${esc(r.tbnr)} · ${r.fine} €${r.points ? ' · ' + r.points + ' Pkt' : ''}${r.tbVerified ? '' : ' (nicht verifiziert)'}<br>${esc(r.tbnrDesc || '')}</td></tr>
    <tr><td>Umstände</td><td>${[r.flags?.behinderung && 'Behinderung', r.flags?.gefaehrdung && 'Gefährdung', (r.rescueRoute || r.flags?.rettung) && 'Rettungsweg', r.isSchoolRoute && 'Schul-/Kitaweg', r.flags?.dauer && `Dauer > ${r.flags.dauer} Std.`, r.restCm != null && r.restCm !== '' && `Restbreite ${r.restCm} cm`].filter(Boolean).join(' · ') || '–'}</td></tr>
    ${r.notes ? `<tr><td>Notiz</td><td>${noKz(r.notes)}</td></tr>` : ''}</table></div></section>`).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ParkWatch Bericht</title><style>
  body{font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif;color:#111;max-width:820px;margin:0 auto;padding:16px}h1{margin:0 0 4px;font-size:22px}h2{font-size:16px;margin:18px 0 6px;border-bottom:1px solid #999}h3{font-size:14px;margin:0 0 6px}
  .m{color:#555;font-size:12px}table{border-collapse:collapse;width:100%}td{padding:3px 6px;vertical-align:top;border-bottom:1px solid #ddd}.r{text-align:right}.kv td:first-child{width:90px;color:#555}
  .kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.kpi div{border:1px solid #bbb;border-radius:6px;padding:6px}.kpi b{display:block;font-size:20px}
  .case{break-inside:avoid;border:1px solid #bbb;border-radius:6px;padding:8px;margin:10px 0}.grid{display:grid;grid-template-columns:200px 1fr;gap:10px}.grid img{width:100%;margin-bottom:6px;border-radius:4px;cursor:zoom-in}img.big{position:fixed;inset:0;width:100%!important;height:100%;object-fit:contain;background:#000;z-index:9;margin:0!important;border-radius:0;cursor:zoom-out}
  button{padding:8px 14px;font-size:14px;margin:8px 0}@media print{button{display:none}body{padding:0}}@media(max-width:560px){.grid{grid-template-columns:1fr}.kpi{grid-template-columns:1fr 1fr}}</style></head><body>
  <button onclick="window.print()">Drucken / Als PDF sichern</button> <span class="m">Fotos antippen = vergrößern</span>
  <h1>ParkWatch Quartier – Verkehrs- &amp; Sicherheitsbericht</h1><div class="m">Zeitraum ${esc(d0)} – ${esc(d1)} · ${n} Fall${n === 1 ? '' : 'e'} · erstellt ${esc(new Date().toLocaleDateString('de-DE'))} · Kennzeichen anonymisiert</div>
  <h2>Auswertung</h2><div class="kpi"><div><b>${n}</b>Fälle</div><div><b>${cnt((r) => r.flags?.behinderung || r.flags?.gefaehrdung)}</b>mit Behinderung/Gefährdung</div><div><b>${cnt((r) => r.isSchoolRoute)}</b>Schul-/Kitaweg</div><div><b>${cnt((r) => r.rescueRoute || r.flags?.rettung)}</b>Rettungsweg</div><div><b>${cnt((r) => /LKW|Transporter|Anhänger|Wohnmobil/.test(r.vehicleType || ''))}</b>gewerbl./groß</div><div><b>${sum} €</b>Summe Regelsätze (Orientierung)</div></div>
  <h2>Hotspots (Straßen)</h2><table>${hot}</table><h2>Erfasste Fälle</h2>${cases}
  <script>document.addEventListener('click',function(e){var t=e.target;if(t.tagName==='IMG')t.classList.toggle('big')})</script><p class="m">Hinweis: Die App ist eine private Dokumentationshilfe. Tatbestände und Beträge sind Orientierungswerte; die Bewertung obliegt der zuständigen Behörde.</p></body></html>`;
}
async function printReport() {
  if (!S.records.length) return toast('Keine Fälle vorhanden');
  const html = buildReportHtml(S.records), blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const touch = navigator.maxTouchPoints > 1 && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  if (!touch) { const w = window.open(URL.createObjectURL(blob), '_blank'); if (w) { setTimeout(() => { try { w.print(); } catch (e) { /* manuell */ } }, 800); return; } }
  await shareOrDownload(`ParkWatch_Bericht_${new Date().toISOString().slice(0, 10)}.html`, blob);
  toast('Bericht-Datei geöffnet/geteilt – dort „Drucken / Als PDF sichern“ wählen', 4500);
}
/* Vollbild-Ansicht (Antippen = Zoom, Wischen = verschieben); mehrere Bilder nacheinander */
function openLightbox(srcs, caption) {
  const list = Array.isArray(srcs) ? srcs : [srcs]; let idx = 0, zoom = false; const lb = $('lightbox'), im = $('lbImg');
  const show = () => { im.src = list[idx]; im.style.width = zoom ? '250%' : '100%'; $('lbCap').textContent = (caption || '') + (list.length > 1 ? ` · ${idx + 1}/${list.length}` : ''); $('lbNext').style.display = list.length > 1 ? '' : 'none'; };
  im.onclick = () => { zoom = !zoom; show(); };
  $('lbNext').onclick = () => { idx = (idx + 1) % list.length; zoom = false; show(); lb.scrollTo(0, 0); };
  $('lbShare').onclick = async () => { const b = await (await fetch(list[idx])).blob(); await shareOrDownload(`ParkWatch_Foto_${Date.now()}.jpg`, b); };
  $('lbClose').onclick = () => { lb.classList.add('hidden'); im.src = ''; };
  show(); lb.classList.remove('hidden'); lb.scrollTo(0, 0);
}
function openCurrentFull() {
  const p = S.cur.photos[S.cur.active]; if (!p) return; const cv = document.createElement('canvas'); drawPhoto(cv, p, false, !S.peek);
  openLightbox(cv.toDataURL('image/jpeg', 0.92), S.peek ? 'Original (ohne Balken) – nur lokal' : 'Foto mit Balken');
}
async function exportCsv(withPlate) {
  if (!S.records.length) return toast('Keine Daten vorhanden');
  const head = ['ID', 'Zeit', 'Straße', 'Hausnr', 'Ort', 'Lat', 'Lon', 'Standort-Quelle', ...(withPlate ? ['Kennzeichen'] : []), 'Fahrzeug', 'Klasse', 'Farbe', 'TBNR', 'Tatbestand', 'Euro', 'Punkte', 'TBNR_geprüft', 'Behinderung', 'Gefährdung', 'Dauer_h', 'Schulweg', 'Rettungsweg', 'Restbreite_cm', 'Notiz'];
  const rows = S.records.map((r) => [r.id, r.timestamp, r.road, r.houseNumber, r.city, r.coords.lat, r.coords.lng, r.locSource, ...(withPlate ? [r.licensePlate] : []), r.vehicleModel, r.vehicleType, r.vehicleColor, r.tbnr, r.tbnrDesc, r.fine, r.points || 0, r.tbVerified ? 'ja' : 'nein', r.flags?.behinderung ? 'ja' : 'nein', r.flags?.gefaehrdung ? 'ja' : 'nein', r.flags?.dauer || 0, r.isSchoolRoute ? 'ja' : 'nein', r.rescueRoute || r.flags?.rettung ? 'ja' : 'nein', r.restCm ?? '', withPlate ? r.notes : (r.notes || '').replace(/\b[A-ZÄÖÜ]{1,3}[ -]?[A-Z]{1,2}[ -]?\d{1,4}[EH]?\b/g, '[Kz]')]);
  const csv = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  await shareOrDownload(`ParkWatch_${withPlate ? 'mitKz' : 'anonym'}_${new Date().toISOString().slice(0, 10)}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}
async function exportBackup() {
  if (!S.records.length) return toast('Keine Daten vorhanden');
  await shareOrDownload(`ParkWatch_Backup_${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ app: 'ParkWatch', version: 2, exported: new Date().toISOString(), records: S.records })], { type: 'application/json' }));
}
async function importBackup(file) {
  try {
    const j = JSON.parse(await file.text()); const recs = Array.isArray(j) ? j : j.records; if (!Array.isArray(recs)) throw new Error('Format');
    let n = 0; for (const r of recs) { if (!r.timestamp || !r.coords) continue; const { id, ...rest } = r; await dbAdd(rest); n++; }
    toast(`${n} Fälle importiert`); refreshStats();
  } catch (e) { toast('Backup nicht lesbar'); }
}

/* ---------- Tabs / Einstellungen ---------- */
function switchTab(t) {
  const cap = t === 'capture';
  $('view-capture').classList.toggle('hidden', !cap); $('view-stats').classList.toggle('hidden', cap); $('saveRow').classList.toggle('hidden', !cap);
  $('tabCapture').className = 'py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ' + (cap ? 'bg-slate-800 text-emerald-400' : 'text-slate-400');
  $('tabStats').className = 'py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ' + (!cap ? 'bg-slate-800 text-emerald-400' : 'text-slate-400');
  $('scroller').scrollTo({ top: 0 }); if (cap && S.map) setTimeout(() => S.map.invalidateSize(), 120); else refreshStats();
}
function loadSettings() { try { Object.assign(S.settings, JSON.parse(localStorage.getItem('pw_settings') || '{}')); } catch (e) {} }
function saveSettings() { try { localStorage.setItem('pw_settings', JSON.stringify(S.settings)); } catch (e) {} }
async function openSettings() {
  $('sAiOn').checked = S.settings.aiOn; $('sAiKey').value = S.settings.aiKey; $('sAiModel').value = S.settings.aiModel; $('sAiAuto').checked = S.settings.aiAuto; $('sKeepOrig').checked = S.settings.keepOrig !== false; $('sStand').textContent = CATALOG_STAND; $('sVer').textContent = 'v' + APP_VERSION;
  try { const e = await navigator.storage.estimate(); const p = navigator.storage.persisted ? await navigator.storage.persisted() : false; $('sStorage').textContent = `Belegt: ${(e.usage / 1048576).toFixed(1)} MB von ca. ${(e.quota / 1048576).toFixed(0)} MB · Dauerhaft geschützt: ${p ? 'ja' : 'nein'}`; } catch (e) { $('sStorage').textContent = 'Speicherinfo nicht verfügbar'; }
  $('settings').classList.remove('hidden');
}
function applyAiVisibility() { $('btnAI').classList.toggle('hidden', !(S.settings.aiOn && S.settings.aiKey)); }


async function ocrSelfTest() {
  const out = $('sOcrOut'); const log = (m) => { out.textContent += m + '\n'; }; out.textContent = '';
  const base = new URL('vendor/tess/', document.baseURI).href;
  for (const f of ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'lang/deu.traineddata.gz']) {
    try { const r = await fetch(base + f, { method: 'GET', cache: 'no-store' }); const n = (await r.arrayBuffer()).byteLength; log(`${r.ok ? 'OK ' : 'FEHLER'} ${r.status} ${f} (${(n / 1048576).toFixed(1)} MB)`); } catch (e) { log(`FEHLER ${f}: ${e.message}`); }
  }
  log('WebAssembly: ' + (typeof WebAssembly !== 'undefined' ? 'ja' : 'NEIN'));
  try {
    const t0 = performance.now(); await getOcr(); log(`Engine geladen (${Math.round(performance.now() - t0)} ms)`);
    const c = document.createElement('canvas'); c.width = 520; c.height = 130; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 520, 130); g.fillStyle = '#003399'; g.fillRect(0, 0, 60, 130); g.fillStyle = '#000'; g.font = 'bold 72px sans-serif'; g.textBaseline = 'middle'; g.fillText('HD  AM 2330', 80, 68);
    const w = await getOcr(); const { data } = await w.recognize(c); log('Testkennzeichen gelesen als: "' + data.text.trim() + '" → ' + (plateCandidates((data.words || []).map((q) => ({ text: q.text, conf: 90, bbox: q.bbox })))[0]?.text || 'KEIN MUSTER'));
  } catch (e) { log('ENGINE-FEHLER: ' + (e && e.message || e)); }
  if (S.dbg) log(`Letzte Foto-Suche: ${S.dbg.regions} Region(en), ${S.dbg.tiles} Kachel(n). Gelesen: ${S.dbg.reads.map((x) => '"' + x + '"').join(' | ') || '–'}`);
  if (S.ocrErr) log('Letzter Fehler: ' + S.ocrErr);
}

/* ---------- Start ---------- */
async function init() {
  loadSettings(); ensureBrandList(); applyAiVisibility();
  try { S.db = await openDB(); } catch (e) { toast('Datenbank nicht verfügbar (privater Modus?)', 6000); }
  initMap(); renderAll();
  window.addEventListener('online', () => ($('netState').textContent = 'Online · Daten bleiben auf diesem Gerät'));
  window.addEventListener('offline', () => ($('netState').textContent = 'Offline · alles wird lokal gespeichert'));
  if (!navigator.onLine) $('netState').textContent = 'Offline · alles wird lokal gespeichert';

  // Entwurf wiederherstellen
  let restored = false;
  if (S.db) {
    try {
      const d = await draftGet();
      if (d && d.cur) {
        const c = Object.assign(emptyCase(), d.cur); c.photos = [];
        for (const p of d.cur.photos || []) { const cv = await canvasFromUrl(p.origUrl); c.photos.push({ orig: cv, origUrl: p.origUrl, boxes: p.boxes || [], ts: p.ts, out: null, locked: !!p.locked, doc: !!p.doc }); }
        S.cur = c; S.editId = d.editId || null; restored = true;
        if (c.coords) { placeMarker(c.coords.lat, c.coords.lng); S.map.setView([c.coords.lat, c.coords.lng], 17); }
        renderAll(); $('draftBadge').classList.remove('hidden'); toast('Entwurf wiederhergestellt');
      }
    } catch (e) { console.warn('Entwurf nicht lesbar', e); }
  }
  if (!restored) locate();
  refreshStats();
  navigator.storage?.persist?.().catch(() => {});

  /* Events */
  $('inCamera').addEventListener('change', (e) => { addPhoto(e.target.files[0]); e.target.value = ''; });
  $('inGallery').addEventListener('change', async (e) => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) { f.__fromGallery = true; await addPhoto(f); } });
  $('photoCanvas').addEventListener('click', tapCensor);
  $('btnUndoBox').onclick = () => { const p = S.cur.photos[S.cur.active]; if (p?.boxes.length) { p.boxes.pop(); renderPhoto(); renderThumbs(); markDirty(); } };
  $('btnBoxBigger').onclick = () => adjustLastBox(1.15); $('btnBoxSmaller').onclick = () => adjustLastBox(0.87);
  $('btnRemovePhoto').onclick = () => { if (!confirm('Dieses Foto entfernen?')) return; S.cur.photos.splice(S.cur.active, 1); S.cur.active = 0; renderPhoto(); renderThumbs(); updateObservation(); renderViolation(); markDirty(); };
  $('thumbs').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; S.cur.active = +b.dataset.i; renderPhoto(); renderThumbs(); });

  $('inPlate').addEventListener('input', (e) => { S.cur.plate = e.target.value.toUpperCase(); S.cur.plateSource = 'manual'; renderPlateBadge(); markDirty(); });
  $('btnLocate').onclick = locate;
  $('btnMapSize').onclick = () => { S.mapBig = !S.mapBig; $('mapWrap').style.height = S.mapBig ? '22rem' : ''; $('mapWrap').classList.toggle('h-36', !S.mapBig); setTimeout(() => S.map.invalidateSize(), 250); };

  $('groupChips').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; S.cur.group = b.dataset.g; S.cur.extra = false; renderViolation(); markDirty(); });
  $('togBeh').addEventListener('change', (e) => { S.cur.beh = e.target.checked; if (!e.target.checked) S.cur.gef = false; renderViolation(); markDirty(); });
  $('togGef').addEventListener('change', (e) => { S.cur.gef = e.target.checked; if (e.target.checked) S.cur.beh = true; renderViolation(); markDirty(); });
  $('togExtra').addEventListener('change', (e) => { S.cur.extra = e.target.checked; renderViolation(); markDirty(); });
  $('durChips').addEventListener('click', (e) => { const b = e.target.closest('[data-dur]'); if (!b) return; S.cur.dur = +b.dataset.dur; S.cur.durManual = true; $('durAuto').textContent = ''; renderViolation(); markDirty(); });
  [['cuTbnr', 'tbnr'], ['cuText', 'text'], ['cuEuro', 'euro'], ['cuPts', 'pts']].forEach(([id, k]) => $(id).addEventListener('input', (e) => { S.cur.custom[k] = e.target.value; renderViolation(); markDirty(); }));

  $('brandPills').addEventListener('click', (e) => { const b = e.target.closest('[data-brand]'); if (b) pickBrand(b.dataset.brand); });
  $('modelPills').addEventListener('click', (e) => { const b = e.target.closest('[data-model]'); if (!b) return; S.cur.model = b.dataset.model; S.cur.manual.model = true; renderVehicle(); markDirty(); });
  $('inBrand').addEventListener('change', (e) => { const v = e.target.value.trim(); const key = Object.keys(BRANDS).find((n) => n.toLowerCase() === v.toLowerCase()) || v; pickBrand(key); });
  $('inModel').addEventListener('input', (e) => { S.cur.model = e.target.value; S.cur.manual.model = true; markDirty(); });
  $('typeChips').addEventListener('click', (e) => { const b = e.target.closest('[data-vt]'); if (!b) return; S.cur.vtype = b.dataset.vt; S.cur.manual.vtype = true; renderVehicle(); markDirty(); });
  $('colorChips').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (!b) return; S.cur.color = S.cur.color === b.dataset.color ? '' : b.dataset.color; S.cur.manual.color = true; renderVehicle(); markDirty(); });
  $('btnAI').onclick = () => aiRecognize(false);

  $('togSchool').addEventListener('change', (e) => { S.cur.school = e.target.checked; markDirty(); });
  $('togRescue').addEventListener('change', (e) => { S.cur.rescue = e.target.checked; markDirty(); });
  $('inRest').addEventListener('input', (e) => { S.cur.restCm = e.target.value; restNote(); markDirty(); });
  $('inNotes').addEventListener('input', (e) => { S.cur.notes = e.target.value; markDirty(); });

  $('btnSave').onclick = save; $('btnNew').onclick = () => { if (S.dirty && !S.savedId && (S.cur.photos.length || S.cur.plate) && !confirm('Ungespeicherten Fall verwerfen?')) return; newCase(); };
  $('tabCapture').onclick = () => switchTab('capture'); $('tabStats').onclick = () => switchTab('stats');
  $('btnPrint').onclick = printReport;
  $('btnPeek').onclick = () => { S.peek = !S.peek; renderPhoto(); }; $('btnFull').onclick = openCurrentFull;
  $('btnCsvAnon').onclick = () => exportCsv(false); $('btnCsvFull').onclick = () => exportCsv(true); $('btnBackup').onclick = exportBackup;
  $('inImport').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  $('repRecords').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openDetail(+b.dataset.open); });
  $('mClose').onclick = () => $('modal').classList.add('hidden');
  $('btnSettings').onclick = openSettings;
  $('sClose').onclick = $('sSave').onclick = () => {
    S.settings.aiOn = $('sAiOn').checked; S.settings.aiKey = $('sAiKey').value.trim(); S.settings.aiModel = $('sAiModel').value.trim() || 'claude-sonnet-5-5'; S.settings.aiAuto = $('sAiAuto').checked; S.settings.keepOrig = $('sKeepOrig').checked;
    saveSettings(); applyAiVisibility(); $('settings').classList.add('hidden');
  };
  $('sOcrTest').onclick = ocrSelfTest;
  $('sPersist').onclick = async () => { try { const ok = await navigator.storage.persist(); toast(ok ? 'Speicher ist jetzt geschützt' : 'Vom Browser nicht gewährt (App zum Home-Bildschirm hinzufügen)', 4000); openSettings(); } catch (e) { toast('Nicht unterstützt'); } };
  $('sWipe').onclick = async () => { if (confirm('ALLE gespeicherten Fälle löschen? Das ist nicht rückgängig zu machen.') && confirm('Wirklich alle löschen? (Backup vorhanden?)')) { await dbClear(); toast('Alles gelöscht'); refreshStats(); } };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  window.addEventListener('pagehide', () => { collectForm(); });
}
window.addEventListener('DOMContentLoaded', init);
