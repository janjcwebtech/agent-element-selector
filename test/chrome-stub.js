// Fake chrome.* for injecting content.js as a plain script; storage.local persists in sessionStorage.
(() => {
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true });
  const load = () => JSON.parse(sessionStorage.getItem('__local') || '{}');
  const save = (o) => sessionStorage.setItem('__local', JSON.stringify(o));
  const listeners = [];
  const local = {
    get(keys, cb) {
      const all = load(); let out = {};
      if (keys == null) out = all;
      else if (typeof keys === 'string') { if (keys in all) out[keys] = all[keys]; }
      else if (Array.isArray(keys)) keys.forEach((k) => { if (k in all) out[k] = all[k]; });
      else for (const [k, d] of Object.entries(keys)) out[k] = k in all ? all[k] : d;
      setTimeout(() => cb(JSON.parse(JSON.stringify(out))), 0);
    },
    set(obj, cb) {
      const all = load(); const changes = {};
      for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: all[k], newValue: v }; all[k] = v; }
      save(all); setTimeout(() => { listeners.forEach((l) => l(changes, 'local')); cb && cb(); }, 0);
    },
    remove(keys, cb) {
      const all = load(); [].concat(keys).forEach((k) => delete all[k]); save(all); setTimeout(() => cb && cb(), 0);
    },
  };
  window.chrome = { runtime: { lastError: null, onMessage: { addListener(f) { window.__onMessage = f; } } },
    storage: { local, sync: { get: (d, cb) => cb({ ...d }) }, onChanged: { addListener: (f) => listeners.push(f) } } };
})();
