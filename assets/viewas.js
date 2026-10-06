// Admin "view as a traveler": tours/<tour>/?as=<member id>, opened from /admin.
// Runs before the page so the traveler's lists live in this tab only and never touch this browser's own.
(() => {
  const as = new URLSearchParams(location.search).get('as');
  if (!as || !/^[0-9a-f-]{36}$/i.test(as)) return;
  window.MW_AS = as;
  const box = 'mw-as-' + as, P = Storage.prototype, get = P.getItem, set = P.setItem, rm = P.removeItem;
  let mem = {}; try { mem = JSON.parse(get.call(sessionStorage, box) || '{}'); } catch (e) {}
  const mine = (st, k) => st === localStorage && typeof k === 'string' && k.startsWith('mw-tour-') && k !== 'mw-tour-lang';
  const keep = () => { try { set.call(sessionStorage, box, JSON.stringify(mem)); } catch (e) {} };
  P.getItem = function (k) { return mine(this, k) ? (k in mem ? mem[k] : null) : get.call(this, k); };
  P.setItem = function (k, v) { if (mine(this, k)) { mem[k] = String(v); keep(); } else set.call(this, k, v); };
  P.removeItem = function (k) { if (mine(this, k)) { delete mem[k]; keep(); } else rm.call(this, k); };
  // the service worker would serve the page without the query: not needed for a quick look
})();
