const DEFAULTS = {
  enabled: true,
  modifier: 'Alt',
  includeUrl: true,
  includeAncestors: true,
  ancestorDepth: 5,
};

const KEY_LABEL = { Alt: '⌥ Option', Control: '⌃ Control', Meta: '⌘ Command', Shift: '⇧ Shift' };
const $ = (id) => document.getElementById(id);
const FIELDS = Object.keys(DEFAULTS);

function read(id) {
  const el = $(id);
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return Number(el.value);
  return el.value;
}

function write(id, value) {
  const el = $(id);
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value;
}

// Mirrors fullKey() in content.js: Shift opens the menu, unless Shift is the modifier.
function showKeys(modifier) {
  $('keyName').textContent = KEY_LABEL[modifier] || modifier;
  $('fullKeyName').textContent = KEY_LABEL[modifier === 'Shift' ? 'Alt' : 'Shift'];
}

let statusTimer = null;
function flash(text) {
  $('status').textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('status').textContent = ''; }, 1200);
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  const s = { ...DEFAULTS, ...stored };
  FIELDS.forEach((f) => write(f, s[f]));
  showKeys(s.modifier);
});

FIELDS.forEach((f) => {
  $(f).addEventListener('change', () => {
    const value = read(f);
    chrome.storage.sync.set({ [f]: value }, () => flash('Saved'));
    if (f === 'modifier') showKeys(value);
  });
});

/* ---- tabs */

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => {
    x.classList.toggle('on', x === b);
    $(x.dataset.tab).hidden = x !== b;
  });
}));

/* ---- history: rounds copied from the page's edit mode, in chrome.storage.local `history` */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (cls, text, onClick) => {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const when = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const shortUrl = (u) => { try { const x = new URL(u); return x.protocol === 'file:' ? x.pathname.split('/').slice(-2).join('/') : x.host + x.pathname + x.search; } catch (_) { return u; } };
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

let hTimer = null;
function hflash(text) {
  $('hstatus').textContent = text;
  clearTimeout(hTimer);
  hTimer = setTimeout(() => { $('hstatus').textContent = ''; }, 2500);
}

const openIds = new Set();   // keeps expanded rounds expanded across re-renders

function renderHistory(list) {
  const box = $('history');
  box.replaceChildren();
  $('clearHistory').hidden = !list.length;
  if (!list.length) {
    box.append(el('div', 'empty', 'Nothing yet. Hold ⌥ on a page, click Edit page, change some text or add comments, then Copy prompt.'));
    return;
  }
  for (const round of list) {
    const edits = round.items.filter((i) => i.kind === 'edit').length;
    const done = round.items.filter((i) => i.done).length;
    const card = el('div', 'round');
    const head = el('div', 'r-head');
    head.append(el('span', 'r-when', when(round.created)),
      el('span', 'r-prog' + (done === round.items.length ? ' all' : ''), `${done} / ${round.items.length} done`));
    const sum = [edits && plural(edits, 'text edit'), round.items.length - edits && plural(round.items.length - edits, 'comment')].filter(Boolean).join(', ');
    const actions = el('div', 'r-actions');
    actions.append(
      btn('b', 'Copy prompt', () => navigator.clipboard.writeText(round.prompt).then(() => hflash('Prompt copied'), () => hflash('Copy failed'))),
      btn('b', 'Show on page', () => showOnPage(round)),
      el('span', 'grow'),
      btn('link', 'Delete', () => updateHistory((h) => h.filter((r) => r.id !== round.id))));
    const details = el('details');
    details.open = openIds.has(round.id);
    details.addEventListener('toggle', () => { if (details.open) openIds.add(round.id); else openIds.delete(round.id); });
    details.append(el('summary', null, 'Items'));
    round.items.forEach((it, i) => {
      const row = el('label', 'item' + (it.done ? ' done' : ''));
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!it.done;
      cb.addEventListener('change', () => updateHistory((h) => {
        const r = h.find((x) => x.id === round.id);
        if (r && r.items[i]) r.items[i].done = cb.checked;
        return h;
      }));
      const what = el('span', 'what');
      what.append(el('span', 'ref', `${i + 1} · ${it.kind === 'edit' ? 'Text' : 'Comment'} · ${it.label}`),
        el('span', 'txt', it.kind === 'edit' ? `“${clip(it.before, 80)}” → “${clip(it.after, 80)}”` : clip(it.text, 200)));
      row.append(cb, what);
      details.append(row);
    });
    card.append(head, el('div', 'r-url', shortUrl(round.url)), el('div', 'r-sum', sum), actions, details);
    box.append(card);
  }
}

function loadHistory() {
  chrome.storage.local.get({ history: [] }, (got) => renderHistory(got.history || []));
}

function updateHistory(fn) {
  chrome.storage.local.get({ history: [] }, (got) => chrome.storage.local.set({ history: fn(got.history || []) }));
}

// The page's content script checks the URL; another page (or a tab without the script) gets a new
// tab, and the round waits in `pendingReplay` for that page to load.
async function showOnPage(round) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const openNew = () => chrome.storage.local.set({ pendingReplay: { id: round.id, url: round.url, at: Date.now() } },
    () => chrome.tabs.create({ url: round.url }, () => window.close()));
  if (!tab) { openNew(); return; }
  chrome.tabs.sendMessage(tab.id, { type: 'aes:replay', round }, { frameId: 0 }, (res) => {
    if (chrome.runtime.lastError || !res) { openNew(); return; }
    if (res.ok) window.close();
    else if (res.reason === 'busy') hflash('That page has unsaved changes. Copy or discard them first.');
    else openNew();
  });
}

$('clearHistory').addEventListener('click', () => {
  if (confirm('Delete every round in the history?')) chrome.storage.local.set({ history: [] });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) renderHistory(changes.history.newValue || []);
});

loadHistory();
