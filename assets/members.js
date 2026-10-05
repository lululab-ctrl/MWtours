/* MW Photo Tours · expedition members (Supabase)
 *
 * Loaded by every expedition page. It adds, without changing the page's own code:
 *  • "Your name" on the code screen. Code + name joins the expedition; on any other browser or phone the
 *    same code + name opens it again with the traveler's lists and field progress restored.
 *  • Progress sync: the page keeps its lists in localStorage ("mw-tour-<slug>-check/-field/-seen");
 *    every change is saved to Supabase, and merged back on the next device.
 *  • Group photos on each "animal to look for" and "photo exercise": add your own, see everyone's in
 *    the expedition, delete your own.
 * If Supabase can't be reached (no signal in the park) or the expedition isn't connected yet, the page
 * simply works as before with its code.
 */
(() => {
const CFG = {
  url: 'https://uiydebfzuxnxjqcnrylv.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpeWRlYmZ6dXhueGpxY25yeWx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNzY2MjksImV4cCI6MjEwNjc1MjYyOX0.JwQ2bAjMrZZCnhFq79V8W5lnzcNz-zpf8IW6xFC4Mko',
};
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const BUCKET = 'tour-photos';

const vaultEl = document.getElementById('vault');
let SLUG = null; try { SLUG = JSON.parse(vaultEl.textContent).slug; } catch (e) {}
if (!SLUG) return;
const KEY = 'mw-tour-' + SLUG, PARTS = ['check', 'field', 'seen'], ME = KEY + '-member', NAME = 'mw-tour-name';

// ---------- storage helpers (raw, so our own writes don't trigger a save) ----------
const raw = { get: Storage.prototype.getItem, set: Storage.prototype.setItem };
const ls = {
  get: k => { try { return raw.get.call(localStorage, k); } catch (e) { return null; } },
  set: (k, v) => { try { raw.set.call(localStorage, k, v); } catch (e) {} },
};
const norm = c => String(c || '').toUpperCase().replace(/[\s\-–_.]/g, '');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));
const timeout = (p, ms) => Promise.race([p, wait(ms).then(() => { throw new Error('timeout'); })]);
let member = null; try { member = JSON.parse(ls.get(ME) || 'null'); } catch (e) {}

// ---------- words ----------
const T = {
  he: { name: 'השם שלכם', namePh: 'שם פרטי ושם משפחה', needName: 'הקלידו את השם שלכם.', busy: 'פותחים…', wrong: 'הקוד לא תואם. בדקו אותו בהודעה ונסו שוב.',
        many: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.', nameHint: 'באותו קוד ושם תוכלו להיכנס מכל טלפון או מחשב.',
        photos: 'תמונות הקבוצה', add: 'הוספת תמונה', adding: 'מעלים…', none: 'עדיין אין תמונות. אולי שלכם תהיה הראשונה?', you: 'אתם',
        del: 'מחיקה', delQ: 'למחוק את התמונה?', close: 'סגירה', prev: 'הקודמת', next: 'הבאה', failed: 'ההעלאה לא הצליחה. נסו שוב כשיש קליטה.',
        offline: 'אין חיבור כרגע. התמונות יופיעו כשתחזור הקליטה.', added: 'התמונה נוספה לקבוצה', of: (a, b) => `${a} מתוך ${b}` },
  en: { name: 'Your name', namePh: 'First and last name', needName: 'Type your name.', busy: 'Opening…', wrong: "That code doesn't match. Check it in the message and try again.",
        many: 'Too many tries. Please wait a few minutes.', nameHint: 'With the same code and name you can open it on any phone or computer.',
        photos: 'Group photos', add: 'Add photo', adding: 'Uploading…', none: 'No photos yet. Yours could be the first.', you: 'You',
        del: 'Delete', delQ: 'Delete this photo?', close: 'Close', prev: 'Previous', next: 'Next', failed: "The upload didn't work. Try again when you have signal.",
        offline: "You're offline. Photos will appear when you have signal again.", added: 'Photo added for the group', of: (a, b) => `${a} of ${b}` },
};
const W = () => T[(document.documentElement.lang || 'he').startsWith('en') ? 'en' : 'he'];

// ---------- Supabase ----------
let sb = null, readyP = null;
function ready() {
  if (readyP) return readyP;
  readyP = new Promise((res, rej) => {
    const go = () => {
      try {
        sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'mw-tours-session' } });
        res(sb);
      } catch (e) { rej(e); }
    };
    if (window.supabase && window.supabase.createClient) return go();
    const s = document.createElement('script'); s.src = LIB; s.async = true; s.onload = go; s.onerror = () => { readyP = null; rej(new Error('lib')); };
    document.head.appendChild(s);
  });
  return readyP;
}
// every browser gets its own silent session; joining links it to the traveler
async function session() {
  await ready();
  const { data } = await sb.auth.getSession();
  if (data && data.session) return data.session;
  const r = await sb.auth.signInAnonymously();
  if (r.error) throw r.error;
  return r.data.session;
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

// ---------- progress: merge, apply, save ----------
const obj = x => x && typeof x === 'object' && !Array.isArray(x);
function mergeVal(server, local) {
  if (server == null) return local; if (local == null) return server;
  try {
    const a = JSON.parse(server), b = JSON.parse(local);
    const deep = (x, y) => { const r = { ...x }; for (const [k, v] of Object.entries(y)) r[k] = obj(v) && obj(r[k]) ? deep(r[k], v) : (v || r[k]); return r; };
    if (obj(a) && obj(b)) return JSON.stringify(deep(a, b));
  } catch (e) {}
  return local;
}
const collect = () => { const o = {}; PARTS.forEach(p => { const v = ls.get(KEY + '-' + p); if (v != null) o[p] = v; }); return o; };
function applyState(state) {
  let changed = false;
  for (const p of PARTS) {
    const local = ls.get(KEY + '-' + p), v = mergeVal(state && state[p] != null ? String(state[p]) : null, local);
    if (v != null && v !== local) { ls.set(KEY + '-' + p, v); changed = true; }
  }
  return changed;
}
let saveT = 0;
async function save() {
  if (!member) return;
  try { await session(); await rpc('save_progress', { p_slug: SLUG, p_state: collect() }); } catch (e) {}
}
// the page saves through localStorage: notice its own lists changing
Storage.prototype.setItem = function (k, v) {
  raw.set.call(this, k, v);
  if (this === localStorage && member && typeof k === 'string' && k.startsWith(KEY + '-') && PARTS.includes(k.slice(KEY.length + 1))) {
    clearTimeout(saveT); saveT = setTimeout(save, 1200);
  }
};
addEventListener('online', () => { if (member) save(); });

const gateOpen = () => { const g = $('#gate'); return !!g && !g.hidden; };
// reload once so the page opens with the code and reads the restored lists (it reads them at start)
function reopen() {
  const flag = 'mw-reopen-' + SLUG, last = +sessionStorage.getItem(flag) || 0;
  if (Date.now() - last < 15000) return false;
  sessionStorage.setItem(flag, String(Date.now())); location.reload(); return true;
}

// ---------- the code screen: code + name ----------
let bypass = false;
function mountGate() {
  const form = $('#gate-form'), code = $('#code');
  if (!form || !code || $('#mw-name')) return;
  const w = W();
  const lab = document.createElement('label'); lab.htmlFor = 'mw-name'; lab.id = 'mw-name-l'; lab.textContent = w.name;
  const inp = document.createElement('input');
  Object.assign(inp, { id: 'mw-name', name: 'name', type: 'text', autocomplete: 'name', spellcheck: false, placeholder: w.namePh, value: ls.get(NAME) || '' });
  inp.setAttribute('autocapitalize', 'words'); inp.className = 'mw-name';
  const first = form.querySelector('label[for="code"]');
  form.insertBefore(inp, first); form.insertBefore(lab, inp);
  const hint = document.createElement('p'); hint.className = 'mw-hint'; hint.id = 'mw-hint'; hint.textContent = w.nameHint;
  $('#gate-err').after(hint);

  form.addEventListener('submit', async e => {
    if (bypass) { bypass = false; return; }               // let the page open it with the key
    e.preventDefault(); e.stopImmediatePropagation();
    const err = $('#gate-err'), btn = $('#gate-btn'), label = btn.firstElementChild, w = W();
    const local = () => { bypass = true; form.requestSubmit(); };   // no Supabase: the page tries the code itself
    if (!norm(code.value)) return local();
    const name = inp.value.trim().replace(/\s+/g, ' ');
    if (!name) { err.textContent = w.needName; inp.focus(); return; }
    btn.disabled = true; const was = label.textContent; label.textContent = w.busy; err.textContent = '';
    try {
      await timeout(session(), 9000);
      const r = await timeout(rpc('join_tour', { p_slug: SLUG, p_code: code.value, p_name: name }), 9000);
      if (r && r.error) {
        btn.disabled = false; label.textContent = was;
        if (r.error === 'tour_not_ready') return local();
        err.textContent = r.error === 'too_many_attempts' ? w.many : r.error === 'bad_name' ? w.needName : w.wrong;
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); code.select();
        return;
      }
      ls.set(NAME, name);
      member = { id: r.member_id, name: r.name }; ls.set(ME, JSON.stringify(member));
      applyState(r.state);
      ls.set(KEY + '-code', norm(r.secret));
      await save();
      sessionStorage.removeItem('mw-reopen-' + SLUG);
      if (!reopen()) { code.value = r.secret; local(); }
    } catch (ex) {
      btn.disabled = false; label.textContent = was;
      local();
    }
  }, true);
}

// already joined on this browser: open straight away and bring the latest lists
async function resume() {
  try {
    await timeout(session(), 9000);
    const r = await timeout(rpc('resume_tour', { p_slug: SLUG }), 9000);
    if (!r) { if (member) { member = null; ls.set(ME, 'null'); } return; }
    member = { id: r.member_id, name: r.name }; ls.set(ME, JSON.stringify(member));
    const changed = applyState(r.state);
    const codeNow = norm(ls.get(KEY + '-code')), key = norm(r.secret);
    if (key && codeNow !== key) { ls.set(KEY + '-code', key); if (gateOpen() || changed) return reopen(); }
    if (changed) return reopen();
    save();
    decorate(); loadPhotos();
  } catch (e) { /* offline: the page carries on with what this device has */ }
}

// ---------- group photos on the Field cards ----------
let photos = [], urls = {}, loadedAt = 0, decoT = 0;
const thumbOf = p => p.replace(/\.jpg$/, '_t.jpg');
const itemOf = el => el.id.startsWith('fa-') ? { kind: 'animal', id: el.id.slice(3) } : { kind: 'exercise', id: el.id.slice(3) };
const forItem = it => photos.filter(p => p.item_kind === it.kind && p.item_id === it.id);

async function loadPhotos(force) {
  if (!member || !sb) return;
  if (!force && Date.now() - loadedAt < 20000) return;
  loadedAt = Date.now();
  try {
    const { data, error } = await sb.from('photos').select('id,item_kind,item_id,path,created_at,member_id,members(name)')
      .eq('tour_slug', SLUG).order('created_at', { ascending: false });
    if (error) throw error;
    photos = data || [];
    const need = photos.flatMap(p => [p.path, thumbOf(p.path)]).filter(x => !urls[x]);
    for (let i = 0; i < need.length; i += 100) {
      const { data: s } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), 60 * 60 * 12);
      (s || []).forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; });
    }
    decorate(true);
  } catch (e) { loadedAt = 0; }
}

function tileBlock(tile) {
  const it = itemOf(tile), list = forItem(it), w = W(), max = 5;
  const th = list.slice(0, max).map((p, i) => `<button type="button" class="mwp-t" data-mwp-open="${i}" style="background-image:url('${esc(urls[thumbOf(p.path)] || urls[p.path] || '')}')" aria-label="${esc((p.member_id === member.id ? w.you : p.members?.name || '') + ' · ' + w.photos)}"></button>`).join('')
    + (list.length > max ? `<button type="button" class="mwp-t more" data-mwp-open="${max}">+${list.length - max}</button>` : '');
  return `<div class="mwp-h"><span>${esc(w.photos)}</span>${list.length ? `<small>${list.length}</small>` : ''}</div>
    ${list.length ? `<div class="mwp-row">${th}</div>` : `<p class="mwp-none">${esc(w.none)}</p>`}
    <button type="button" class="mwp-add" data-mwp-add><svg viewBox="0 0 24 24"><path d="M3.5 8.5a2 2 0 0 1 2-2h2.2L9.5 4h5l1.8 2.5h2.2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.4"/></svg><span>${esc(w.add)}</span></button>`;
}
function decorate(refresh) {
  if (!member) return;
  document.querySelectorAll('#field .ftile[id^="fa-"], #field .ftile[id^="fx-"]').forEach(tile => {
    let b = tile.querySelector(':scope > .mwp');
    if (b && !refresh) return;
    if (!b) { b = document.createElement('div'); b.className = 'mwp'; tile.appendChild(b); }
    if (b.dataset.busy) return;
    b.innerHTML = tileBlock(tile);
  });
}

// make a phone photo light enough to send from the field: 1600 px long side, and a small thumbnail
async function shrink(file, max, q) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const src = bmp || await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
let toastT = 0;
function toast(t) {
  let el = $('.mwp-toast'); if (!el) { el = document.createElement('div'); el.className = 'mwp-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200);
}
async function upload(tile, file) {
  const it = itemOf(tile), w = W(), b = tile.querySelector('.mwp'), btn = b.querySelector('[data-mwp-add] span');
  if (!navigator.onLine) return toast(w.offline);
  b.dataset.busy = '1'; btn.textContent = w.adding;
  try {
    await session();
    const [full, small] = await Promise.all([shrink(file, 1600, 0.84), shrink(file, 420, 0.78)]);
    const path = `${SLUG}/${member.id}/${it.kind}-${it.id}-${Date.now()}.jpg`;
    const up1 = await sb.storage.from(BUCKET).upload(path, full, { contentType: 'image/jpeg', upsert: false });
    if (up1.error) throw up1.error;
    await sb.storage.from(BUCKET).upload(thumbOf(path), small, { contentType: 'image/jpeg', upsert: false });
    const ins = await sb.from('photos').insert({ tour_slug: SLUG, member_id: member.id, item_kind: it.kind, item_id: it.id, path });
    if (ins.error) { await sb.storage.from(BUCKET).remove([path, thumbOf(path)]); throw ins.error; }
    toast(w.added);
  } catch (e) { toast(w.failed); }
  delete b.dataset.busy;
  await loadPhotos(true);
}

// full-screen viewer for one item's photos
function viewer(tile, start) {
  const it = itemOf(tile), list = forItem(it), title = tile.querySelector('h4')?.textContent || '';
  if (!list.length) return;
  let i = Math.min(start, list.length - 1);
  const v = document.createElement('div'); v.className = 'mwp-v'; v.dir = document.documentElement.dir || 'rtl';
  v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true');
  const draw = () => {
    const p = list[i], w = W(), mine = p.member_id === member.id;
    const when = new Date(p.created_at).toLocaleDateString(document.documentElement.lang || 'he', { day: 'numeric', month: 'short' });
    v.innerHTML = `<figure><img src="${esc(urls[p.path] || urls[thumbOf(p.path)] || '')}" alt="${esc(title)}"></figure>
      <div class="mwp-bar"><div><b>${esc(title)}</b><small>${esc(mine ? w.you : p.members?.name || '')} · ${esc(when)}${list.length > 1 ? ' · ' + esc(w.of(i + 1, list.length)) : ''}</small></div>
      ${mine ? `<button type="button" class="mwp-del">${esc(w.del)}</button>` : ''}</div>
      <button type="button" class="mwp-x" aria-label="${esc(w.close)}">×</button>
      ${list.length > 1 ? `<button type="button" class="mwp-nav p" aria-label="${esc(w.prev)}">‹</button><button type="button" class="mwp-nav n" aria-label="${esc(w.next)}">›</button>` : ''}`;
    v.querySelector('.mwp-x').onclick = close;
    const step = d => { i = (i + d + list.length) % list.length; draw(); };
    const rtl = v.dir === 'rtl';
    v.querySelector('.mwp-nav.p')?.addEventListener('click', () => step(rtl ? 1 : -1));
    v.querySelector('.mwp-nav.n')?.addEventListener('click', () => step(rtl ? -1 : 1));
    v.querySelector('.mwp-del')?.addEventListener('click', async () => {
      if (!confirm(W().delQ)) return;
      try { await sb.from('photos').delete().eq('id', p.id); await sb.storage.from(BUCKET).remove([p.path, thumbOf(p.path)]); } catch (e) {}
      close(); loadPhotos(true);
    });
  };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') v.querySelector(e.key === 'ArrowLeft' ? '.mwp-nav.p' : '.mwp-nav.n')?.click(); };
  function close() { v.remove(); removeEventListener('keydown', key); }
  addEventListener('keydown', key);
  v.addEventListener('click', e => { if (e.target === v || e.target.tagName === 'FIGURE') close(); });
  draw(); document.body.appendChild(v);
}

const picker = document.createElement('input');
picker.type = 'file'; picker.accept = 'image/*'; picker.hidden = true;
let pickFor = null;
picker.addEventListener('change', () => { const f = picker.files && picker.files[0]; if (f && pickFor) upload(pickFor, f); picker.value = ''; });

document.addEventListener('click', e => {
  const add = e.target.closest('[data-mwp-add]'), open = e.target.closest('[data-mwp-open]');
  if (!add && !open) return;
  const tile = e.target.closest('.ftile'); if (!tile) return;
  e.preventDefault(); e.stopPropagation();
  if (add) { if (tile.querySelector('.mwp').dataset.busy) return; pickFor = tile; picker.click(); }
  else viewer(tile, +open.dataset.mwpOpen);
}, true);

// ---------- look ----------
const css = `
.gate-form .mw-name{width:100%;height:54px;border-radius:64px;border:1px solid rgba(254,251,241,.32);background:rgba(10,9,8,.45);text-align:center;font:600 17px/1 "Google Sans",Arial,sans-serif;letter-spacing:0;text-transform:none;color:#FEFBF1;transition:border-color .3s}
.gate-form .mw-name::placeholder{color:rgba(254,251,241,.3);font-weight:400;letter-spacing:0;text-transform:none}
.gate-form .mw-name:focus{outline:none;border-color:#F4AF56}
.mw-hint{margin:-4px 0 0;font-size:13px;color:rgba(244,244,244,.5)}
.mwp{display:grid;gap:8px;margin-top:6px;padding-top:12px;border-top:1px solid rgba(254,251,241,.12)}
.mwp-h{display:flex;align-items:center;gap:8px;font:600 11px/1 Montserrat,"Google Sans",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#E4AA7C}
[dir=rtl] .mwp-h{font:600 13px/1 "Google Sans",sans-serif;letter-spacing:0}
.mwp-h small{min-width:20px;height:20px;padding-inline:6px;border-radius:20px;display:grid;place-items:center;background:rgba(228,170,124,.16);color:#FEFBF1;font-size:11px;letter-spacing:0}
.mwp-row{display:flex;flex-wrap:wrap;gap:6px}
.mwp-t{width:52px;height:52px;padding:0;border-radius:12px;border:1px solid rgba(254,251,241,.18);background:#1A1714 center/cover no-repeat;cursor:pointer;color:#FEFBF1;font:700 13px "Google Sans",sans-serif;transition:transform .25s}
.mwp-t:hover{transform:scale(1.05)}
.mwp-t.more{background:rgba(254,251,241,.08)}
.mwp-none{margin:0;font-size:13.5px;color:rgba(244,244,244,.5)}
.mwp-add{justify-self:start;display:inline-flex;align-items:center;gap:8px;min-height:38px;padding-inline:14px;border-radius:64px;border:1px dashed rgba(244,175,86,.6);background:rgba(244,175,86,.06);color:#FEFBF1;font:700 13px "Google Sans",sans-serif;cursor:pointer}
.mwp-add svg{width:16px;height:16px;fill:none;stroke:#F4AF56;stroke-width:1.6;stroke-linejoin:round}
.mwp-v{position:fixed;inset:0;z-index:120;display:grid;grid-template-rows:minmax(0,1fr) auto;background:rgba(5,5,4,.94);animation:mwpIn .25s ease;color:#F4F4F4;font-family:"Google Sans",Arial,sans-serif}
@keyframes mwpIn{from{opacity:0}}
.mwp-v figure{margin:0;min-height:0;display:grid;place-items:center;padding:calc(56px + env(safe-area-inset-top)) 12px 8px}
.mwp-v img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px}
.mwp-bar{display:flex;align-items:center;gap:12px;padding:14px 18px calc(18px + env(safe-area-inset-bottom))}
.mwp-bar>div{flex:1;min-width:0;display:grid;gap:3px}
.mwp-bar b{font-size:17px;color:#FEFBF1}
.mwp-bar small{font-size:13.5px;color:rgba(244,244,244,.6)}
.mwp-del{min-height:38px;padding-inline:16px;border-radius:64px;border:1px solid rgba(240,138,122,.6);background:none;color:#F7B2A6;font:700 13px "Google Sans",sans-serif;cursor:pointer}
.mwp-x{position:absolute;top:calc(12px + env(safe-area-inset-top));inset-inline-end:12px;width:42px;height:42px;border-radius:50%;border:1px solid rgba(254,251,241,.2);background:rgba(10,9,8,.6);color:#FEFBF1;font-size:22px;line-height:1;cursor:pointer}
.mwp-nav{position:absolute;top:50%;width:44px;height:44px;margin-top:-22px;border-radius:50%;border:1px solid rgba(254,251,241,.2);background:rgba(10,9,8,.55);color:#FEFBF1;font-size:24px;line-height:1;cursor:pointer}
.mwp-nav.p{left:10px}.mwp-nav.n{right:10px}
.mwp-toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));z-index:130;transform:translate(-50%,20px);opacity:0;padding:10px 16px;border-radius:64px;background:rgba(10,9,8,.92);border:1px solid rgba(254,251,241,.16);color:#FEFBF1;font:600 14px "Google Sans",sans-serif;transition:opacity .3s,transform .3s;pointer-events:none;white-space:nowrap}
.mwp-toast.on{opacity:1;transform:translate(-50%,0)}
`;

// ---------- start ----------
function relabel() {
  const w = W(), l = $('#mw-name-l'), i = $('#mw-name'), h = $('#mw-hint');
  if (l) l.textContent = w.name; if (i) i.placeholder = w.namePh; if (h) h.textContent = w.nameHint;
  decorate(true);
}
function boot() {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  document.body.appendChild(picker);
  mountGate();
  // the Field room is redrawn by the page (language, ticks): put the galleries back each time
  const field = $('#field');
  if (field) {
    new MutationObserver(() => { clearTimeout(decoT); decoT = setTimeout(() => decorate(false), 60); }).observe(field, { childList: true, subtree: true });
    new MutationObserver(() => { if (!field.hidden) loadPhotos(); }).observe(field, { attributes: true, attributeFilter: ['hidden'] });
  }
  new MutationObserver(relabel).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  resume();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
