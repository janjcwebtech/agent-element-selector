const DEFAULTS = {
  enabled: true,
  modifier: 'Alt',
  includeAncestors: true,
  includeText: true,
  textLimit: 500,
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

// Mirrors fullKey() in content.js: Shift upgrades to full context, unless Shift is the modifier.
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
