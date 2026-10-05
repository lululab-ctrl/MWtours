/* MW Photo Tours · account sync
 * Optional email sign-in (a link by email, no password). Signed in, a traveler's expeditions follow them to any
 * browser or phone: the codes they unlocked, packing lists, field progress, stories read, and their language.
 *
 * How: every tour already keeps its state in localStorage under "mw-tour-<slug>-<thing>". This script mirrors
 * those keys to Supabase (table public.tour_progress, one row per traveler per expedition) and writes them back
 * on another device. Tours need no changes beyond loading this file. Offline or without Supabase, nothing breaks:
 * the site simply keeps working on this device as before.
 */
(() => {
const CFG = { url: 'https://yrjybeehfhksdhsctwbk.supabase.co', key: 'sb_publishable_WWBu40cItv4X0n3RKDlWRw_QQD3EjW7' };
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const PRE = 'mw-tour-', LANG_KEY = 'mw-tour-lang', DIRTY = 'mw-sync-dirty', PREFS = '_prefs';

const raw = { get: Storage.prototype.getItem, set: Storage.prototype.setItem, del: Storage.prototype.removeItem };
const ls = {
  get: k => { try { return raw.get.call(localStorage, k); } catch (e) { return null; } },
  set: (k, v) => { try { raw.set.call(localStorage, k, v); } catch (e) {} },
  del: k => { try { raw.del.call(localStorage, k); } catch (e) {} },
  keys: () => { try { return Object.keys(localStorage); } catch (e) { return []; } },
};

// "mw-tour-assam-2026-check" → { slug: "assam-2026", part: "check" };  "mw-tour-lang" → prefs
function parse(k) {
  if (k === LANG_KEY) return { slug: PREFS, part: 'lang' };
  if (!k || !k.startsWith(PRE)) return null;
  const rest = k.slice(PRE.length), i = rest.lastIndexOf('-');
  return i > 0 ? { slug: rest.slice(0, i), part: rest.slice(i + 1) } : null;
}
const keyOf = (slug, part) => slug === PREFS ? LANG_KEY : PRE + slug + '-' + part;
function collect(slug) {
  const o = {};
  for (const k of ls.keys()) { const p = parse(k); if (p && p.slug === slug) o[p.part] = ls.get(k); }
  return o;
}
const dirty = () => { try { return new Set(JSON.parse(ls.get(DIRTY) || '[]')); } catch (e) { return new Set(); } };
const setDirty = s => ls.set(DIRTY, JSON.stringify([...s]));

// two versions of the same list (checklists, field progress): keep everything ticked on either device
function mergeVal(server, local) {
  if (server == null) return local; if (local == null) return server;
  try {
    const a = JSON.parse(server), b = JSON.parse(local);
    const obj = x => x && typeof x === 'object' && !Array.isArray(x);
    const deep = (x, y) => { const r = { ...x }; for (const [k, v] of Object.entries(y)) r[k] = obj(v) && obj(r[k]) ? deep(r[k], v) : (v || r[k]); return r; };
    if (obj(a) && obj(b)) return JSON.stringify(deep(a, b));
  } catch (e) {}
  return local;
}

// ---------- which page are we on ----------
const vaultEl = document.getElementById('vault');
let SLUG = null; try { SLUG = vaultEl ? JSON.parse(vaultEl.textContent).slug : null; } catch (e) {}
const isTour = !!SLUG;

// ---------- watch the tour's own saves, without touching the tour's code ----------
let sb = null, user = null, pushT = 0;
Storage.prototype.setItem = function (k, v) {
  raw.set.call(this, k, v);
  if (this === localStorage) touched(k);
};
Storage.prototype.removeItem = function (k) {
  raw.del.call(this, k);
  if (this === localStorage) touched(k);
};
function touched(k) {
  const p = parse(k); if (!p) return;
  const d = dirty(); d.add(p.slug); setDirty(d);
  clearTimeout(pushT); pushT = setTimeout(pushDirty, 1500);
}

async function pushDirty() {
  if (!sb || !user) return;
  const d = dirty(); if (!d.size) return;
  const rows = [...d].map(slug => ({ user_id: user.id, slug, state: collect(slug), updated_at: new Date().toISOString() }));
  const { error } = await sb.from('tour_progress').upsert(rows, { onConflict: 'user_id,slug' });
  if (!error) { const now = dirty(); rows.forEach(r => now.delete(r.slug)); setDirty(now); setStatus('synced'); }
  else setStatus('error');
}

// bring this traveler's expeditions to this device; local changes not yet sent are merged, not lost
async function pull() {
  if (!sb || !user) return;
  setStatus('syncing');
  const { data, error } = await sb.from('tour_progress').select('slug,state');
  if (error) { setStatus('error'); return; }
  const d = dirty(); let changedHere = false, any = false;
  for (const row of data || []) {
    const local = collect(row.slug), merged = {};
    for (const part of new Set([...Object.keys(row.state || {}), ...Object.keys(local)])) {
      merged[part] = d.has(row.slug) ? mergeVal(row.state?.[part], local[part]) : (row.state?.[part] ?? local[part]);
    }
    for (const [part, v] of Object.entries(merged)) {
      if (v != null && v !== local[part]) { ls.set(keyOf(row.slug, part), v); any = true; if (row.slug === SLUG || (row.slug === PREFS && part === 'lang')) changedHere = true; }
    }
    if (d.has(row.slug) || JSON.stringify(merged) !== JSON.stringify(row.state || {})) d.add(row.slug);
  }
  // expeditions opened on this device but never saved to the account yet
  const onServer = new Set((data || []).map(r => r.slug));
  for (const k of ls.keys()) { const p = parse(k); if (p && !onServer.has(p.slug)) d.add(p.slug); }
  setDirty(d); await pushDirty(); setStatus('synced');
  if (any) dispatchEvent(new CustomEvent('mw-sync'));
  // a tour reads its saved state once at start: reload once so the newly arrived code / lists take effect
  const flag = 'mw-sync-reloaded-' + (SLUG || 'home');
  if (changedHere && isTour && !sessionStorage.getItem(flag)) { sessionStorage.setItem(flag, '1'); location.reload(); }
  else if (!changedHere) sessionStorage.removeItem(flag);
}

// ---------- words ----------
const T = {
  he: { acct: 'החשבון שלי', signIn: 'התחברות', gateLink: 'כבר נכנסתם במכשיר אחר? התחברו', homeLink: 'הצטרפתם כבר במכשיר אחר? התחברו כדי להביא את המסעות שלכם',
        title: 'שומרים את המסע בכל מכשיר', lede: 'הקלידו את המייל ונשלח לכם קישור כניסה. בלי סיסמה. אחרי ההתחברות, המסעות שפתחתם, הרשימות וההתקדמות שלכם יחכו לכם בכל דפדפן ובכל טלפון.',
        email: 'כתובת מייל', send: 'שלחו לי קישור', sending: 'שולחים…', sent: e => `שלחנו קישור אל ${e}. פתחו אותו בטלפון או במחשב הזה.`, bad: 'זו לא נראית כתובת מייל תקינה.',
        fail: 'לא הצלחנו לשלוח כרגע. נסו שוב בעוד כמה דקות.', offline: 'צריך חיבור לאינטרנט כדי להתחבר.', as: e => `מחוברים בתור ${e}`, out: 'התנתקות',
        st: { syncing: 'מסנכרנים…', synced: 'הכל שמור בחשבון', error: 'לא הצלחנו לשמור כרגע. ננסה שוב.' }, close: 'סגירה', unlocked: 'פתוח' },
  en: { acct: 'My account', signIn: 'Sign in', gateLink: 'Opened it on another device? Sign in', homeLink: 'Joined before on another device? Sign in to bring your expeditions here',
        title: 'Your expeditions on every device', lede: 'Type your email and we’ll send you a sign-in link. No password. Once signed in, the expeditions you opened, your lists and your progress are waiting in any browser and on any phone.',
        email: 'Email address', send: 'Email me a link', sending: 'Sending…', sent: e => `We sent a link to ${e}. Open it on this phone or computer.`, bad: 'That doesn’t look like an email address.',
        fail: 'We couldn’t send it right now. Please try again in a few minutes.', offline: 'You need an internet connection to sign in.', as: e => `Signed in as ${e}`, out: 'Sign out',
        st: { syncing: 'Syncing…', synced: 'Everything is saved to your account', error: 'Couldn’t save just now. We’ll try again.' }, close: 'Close', unlocked: 'Unlocked' },
};
const W = () => T[(document.documentElement.lang || 'he').startsWith('en') ? 'en' : 'he'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- a small sheet: sign in, or who you are ----------
const css = `
.mwa-btn{width:36px;height:36px;flex:none;padding:0;border-radius:50%;border:1px solid rgba(254,251,241,.14);background:rgba(10,9,8,.35);color:#FEFBF1;display:grid;place-items:center;cursor:pointer;position:relative}
.mwa-btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.mwa-btn.on::after{content:"";position:absolute;top:1px;inset-inline-end:1px;width:8px;height:8px;border-radius:50%;background:#A9C48C;box-shadow:0 0 0 2px #0A0908}
@media (max-width:430px){.top .chip{display:none}}
.mwa-link{margin:2px 0 0;padding:0;border:0;background:none;font:inherit;font-size:14px;color:#E4AA7C;text-decoration:underline;text-decoration-color:rgba(228,170,124,.4);text-underline-offset:4px;cursor:pointer}
.mwa-who{margin:6px 0 0;font-size:13.5px;color:rgba(244,244,244,.56)}
.mwa-who button{margin-inline-start:6px}
.mwa-veil{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:16px;background:rgba(5,5,4,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:mwaIn .3s ease}
@keyframes mwaIn{from{opacity:0}}
.mwa-card{position:relative;width:min(420px,100%);display:grid;gap:14px;padding:26px 22px 22px;border-radius:24px;background:linear-gradient(180deg,#123B35,#0C2925 40%,#0A0908);border:1px solid rgba(254,251,241,.16);box-shadow:0 30px 80px rgba(0,0,0,.6);color:#F4F4F4;font-family:"Google Sans","Helvetica Neue",Arial,sans-serif;text-align:start}
.mwa-card h2{margin:0;padding-inline-end:36px;font-size:22px;line-height:1.25;color:#FEFBF1}
.mwa-card p{margin:0;font-size:15px;line-height:1.55;color:rgba(244,244,244,.78)}
.mwa-card input{width:100%;height:52px;padding-inline:18px;border-radius:64px;border:1px solid rgba(254,251,241,.3);background:rgba(10,9,8,.45);color:#FEFBF1;font:16px "Google Sans",Arial,sans-serif;direction:ltr;text-align:start}
.mwa-card input:focus{outline:none;border-color:#F4AF56}
.mwa-go{min-height:50px;border-radius:64px;border:1px solid #F4AF56;background:radial-gradient(130% 160% at 0 0,rgba(244,175,86,.24),transparent 46%);color:#F4F4F4;font:700 15px "Google Sans",Arial,sans-serif;cursor:pointer}
.mwa-go:disabled{opacity:.55}
.mwa-ghost{min-height:44px;border-radius:64px;border:1px solid rgba(244,244,244,.35);background:none;color:#F4F4F4;font:700 14px "Google Sans",Arial,sans-serif;cursor:pointer}
.mwa-msg{min-height:1.4em;font-size:14px!important}
.mwa-msg.ok{color:#A9C48C!important}.mwa-msg.err{color:#F4AF56!important}
.mwa-x{position:absolute;top:12px;inset-inline-end:12px;width:36px;height:36px;border-radius:50%;border:1px solid rgba(254,251,241,.16);background:rgba(10,9,8,.4);color:#FEFBF1;cursor:pointer;font-size:18px;line-height:1}
.mwa-st{font-size:13.5px!important;color:#A9C48C!important}
`;
// a cloud, so it isn't mistaken for the Leader tab's person icon
const ICON = '<svg viewBox="0 0 24 24"><path d="M7 18.5h10.2a4 4 0 0 0 .5-7.96A5.6 5.6 0 0 0 6.9 9.7 4.4 4.4 0 0 0 7 18.5z"/><path d="m9.6 13.9 1.8 1.8 3.3-3.4"/></svg>';
let status = '';
function setStatus(s) { status = s; const el = document.querySelector('.mwa-st'); if (el) el.textContent = W().st[s] || ''; }

function sheet() {
  const w = W(), v = document.createElement('div');
  v.className = 'mwa-veil'; v.dir = document.documentElement.dir || 'rtl';
  const close = () => v.remove();
  if (user) {
    v.innerHTML = `<div class="mwa-card" role="dialog" aria-modal="true"><button class="mwa-x" aria-label="${esc(w.close)}">×</button>
      <h2>${esc(w.acct)}</h2><p>${esc(w.as(user.email))}</p><p class="mwa-st">${esc(w.st[status] || '')}</p>
      <button class="mwa-ghost" type="button" data-out>${esc(w.out)}</button></div>`;
    v.querySelector('[data-out]').onclick = async () => { await sb.auth.signOut(); user = null; refreshUI(); close(); };
  } else {
    v.innerHTML = `<form class="mwa-card" role="dialog" aria-modal="true" novalidate><button class="mwa-x" type="button" aria-label="${esc(w.close)}">×</button>
      <h2>${esc(w.title)}</h2><p>${esc(w.lede)}</p>
      <input type="email" required autocomplete="email" inputmode="email" placeholder="${esc(w.email)}" aria-label="${esc(w.email)}">
      <button class="mwa-go" type="submit">${esc(w.send)}</button><p class="mwa-msg" role="status"></p></form>`;
    const f = v.querySelector('form'), inp = f.querySelector('input'), btn = f.querySelector('.mwa-go'), msg = f.querySelector('.mwa-msg');
    const say = (t, c) => { msg.textContent = t; msg.className = 'mwa-msg' + (c ? ' ' + c : ''); };
    f.onsubmit = async e => {
      e.preventDefault();
      const email = inp.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say(w.bad, 'err');
      if (!navigator.onLine) return say(w.offline, 'err');
      btn.disabled = true; btn.textContent = w.sending;
      try {
        await ready();
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
        if (error) throw error;
        say(w.sent(email), 'ok'); inp.disabled = true; btn.hidden = true;
      } catch (err) { say(w.fail, 'err'); btn.disabled = false; btn.textContent = w.send; }
    };
    setTimeout(() => inp.focus(), 50);
  }
  v.querySelector('.mwa-x').onclick = close;
  v.addEventListener('pointerdown', e => { if (e.target === v) close(); });
  addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); removeEventListener('keydown', k); } });
  document.body.appendChild(v);
}

function refreshUI() {
  const w = W();
  document.querySelectorAll('.mwa-btn').forEach(b => { b.classList.toggle('on', !!user); b.title = user ? w.as(user.email) : w.signIn; b.setAttribute('aria-label', b.title); });
  document.querySelectorAll('[data-mwa-gate]').forEach(a => { a.hidden = !!user; a.textContent = w.gateLink; });
  const home = document.querySelector('[data-mwa-home]');
  if (home) home.innerHTML = user ? `<p class="mwa-who">${esc(w.as(user.email))}<button class="mwa-link" type="button" data-mwa-open>${esc(w.acct)}</button></p>`
    : `<button class="mwa-link" type="button" data-mwa-open>${esc(w.homeLink)}</button>`;
}

function mountUI() {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  if (isTour) {
    const out = document.getElementById('logout');
    if (out) { const b = document.createElement('button'); b.type = 'button'; b.className = 'mwa-btn'; b.innerHTML = ICON; b.dataset.mwaOpen = ''; out.before(b); }
    const all = document.querySelector('.gate-all');
    if (all) { const a = document.createElement('button'); a.type = 'button'; a.className = 'mwa-link'; a.dataset.mwaOpen = ''; a.dataset.mwaGate = ''; all.after(a); }
  } else {
    const note = document.getElementById('note');
    if (note) { const d = document.createElement('div'); d.dataset.mwaHome = ''; d.style.setProperty('--i', 6); note.after(d); }
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-mwa-open]')) { e.preventDefault(); sheet(); } });
  // the pages switch language by rewriting <html lang>; follow it
  new MutationObserver(refreshUI).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  refreshUI();
}

// ---------- start ----------
let readyP = null;
function ready() {
  if (readyP) return readyP;
  readyP = new Promise((res, rej) => {
    const go = () => {
      try {
        sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'mw-tours-auth' } });
        sb.auth.onAuthStateChange((ev, session) => {
          const was = user && user.id; user = session ? session.user : null; refreshUI();
          if (user && user.id !== was) pull();
        });
        res(sb);
      } catch (e) { rej(e); }
    };
    if (window.supabase && window.supabase.createClient) return go();
    const s = document.createElement('script'); s.src = LIB; s.async = true; s.onload = go; s.onerror = rej; document.head.appendChild(s);
  });
  return readyP;
}

const boot = () => { mountUI(); ready().catch(() => {}); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
addEventListener('online', () => { if (user) pushDirty(); });
})();
