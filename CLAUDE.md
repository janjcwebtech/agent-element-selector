# CLAUDE.md — Agent Element Selector

Personal Chrome MV3 extension. Hold ⌥, hover, click → an inline reference like
`[h1.hero__title · //body/main/section/h1]` lands on the clipboard, for dropping mid-sentence into a
prompt. Add ⇧ (⌥⇧-click) for full Markdown context: source, locators, box, ancestors.

## Ground rules

**Never copy inner HTML, and never copy computed CSS.** Both were tried and both were removed on
purpose. Inner HTML is bulk with no signal. Computed CSS was actively harmful: on a Tailwind site,
~80% of the properties that "differ from the browser default" come from preflight (`* { box-sizing:
border-box; border: 0 solid; margin: 0 }`) or from inheritance off `:root` — so the dump contradicts
what's actually written in the stylesheet, and the agent has the real source anyway. If a future
task asks for styling, push back and point at this paragraph first.

**Nothing goes into the page DOM.** The overlay is a single shadow host with `all: initial`. Don't
add probe elements, reference nodes or hidden iframes — an earlier version inserted a bare element
to compute a style baseline, and it's gone along with the CSS feature.

**No build step, no dependencies, no bundler.** Plain ES2020 in three files. Keep it that way; the
whole point is that `chrome://extensions` → *Load unpacked* works on the raw folder.

## Layout

| File | Role |
| --- | --- |
| `manifest.json` | MV3. `storage` + `clipboardWrite` only. No background worker, no host permissions. |
| `content.js` | Everything. One IIFE, guarded by `window.__agentElementSelectorLoaded`. |
| `popup.html` / `popup.js` | Settings UI, backed by `chrome.storage.sync`. |
| `test/fixture.html` | Local page with Astro-style source attrs, a flex hero, a grid list. |

`content.js` reads top-to-bottom in labelled sections: **settings → environment → utils → framework/source
metadata → element-specific bits → locators → collection → formatting → overlay → clipboard →
arm/disarm → events**. `collect(el)` / `collectMinimal(el)` build plain data objects; `toMarkdown(d)` /
`toInline(d)` are the only places that decide what the user sees. Add a new field in `collect`, render it in `toMarkdown` — don't
format inside the collectors.

## Things that will bite you

- **Settings keys live in three places** and must match exactly: `DEFAULTS` in `content.js`,
  `DEFAULTS` in `popup.js`, and the element `id`s in `popup.html` (the id *is* the storage key).
- **The inline reference is minimal on purpose** — tag#id + ≤3 selector-safe classes, plus an XPath
  only when the id isn't unique. Anything more belongs in the ⇧ full context, not the prompt.
- **The full-context key is ⇧, or ⌥ when the modifier setting is Shift** — `fullKey()` in `content.js`
  and `showKeys()` in `popup.js` must agree.
- **Every `chrome.*` access is wrapped in try/catch.** That's not defensive noise — it lets
  `content.js` be injected as a plain `<script>` for testing, where `chrome` is undefined.
- **All listeners are capture-phase.** While armed, `mousedown`/`mouseup`/`click`/`dblclick`/
  `auxclick`/`dragstart`/`contextmenu` are swallowed so the page never sees the click.
- **The copy fires on `mousedown`, not `click`.** It still counts as a user gesture for the
  clipboard, and it beats macOS's ⌥-click-downloads-the-link behaviour.
- **`REAL_NAME` (`/^[A-Z][A-Za-z0-9]{2,}$/`) guards React and Vue component names.** Without it a
  production bundle reports `React component: j`. A name is only emitted if it passes that test or
  comes with a `_debugSource` file:line.
- **Astrogeus `data-atx-file` / `data-atx-loc` beat Astro's own source attrs** — they're on every
  element, not just component roots. The other `data-atx-*` attrs are stripped from `openTag` as noise.
- **Browser / OS comes from UA Client Hints**, fetched async at load; the UA string (frozen at macOS
  10.15.7 / Windows NT 10.0) is only the fallback.
- **Astro source attributes only exist under `astro dev`.** `toMarkdown` says so explicitly when it
  detects Astro but finds no `data-astro-source-file`. Don't "fix" that message.
- `cssPath` returns as soon as the path is unique, so it's usually 1–3 segments, not a full chain.
  It deliberately skips framework-generated and Tailwind-variant classes (`GENERATED_CLASS`,
  `AWKWARD_CLASS`) — those make selectors that don't survive a rebuild.

## Verifying a change

`node --check content.js && node --check popup.js` catches syntax. For behaviour, inject the script
into a real page and drive it synthetically — much faster than reloading the unpacked extension:

```bash
python3 -m http.server 8899          # serve the repo; add CORS headers to test a remote page
```

```js
// in the page console (or a browser-MCP evaluate)
window.__copied = null;
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true });
const src = await fetch('http://127.0.0.1:8899/content.js').then(r => r.text());
document.head.appendChild(Object.assign(document.createElement('script'), { textContent: src }));

const el = document.querySelector('YOUR_SELECTOR');
const r = el.getBoundingClientRect();
const o = { altKey: true, bubbles: true, button: 0,
            clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
window.dispatchEvent(new MouseEvent('mousemove', o));
window.dispatchEvent(new MouseEvent('mousedown', o));
setTimeout(() => console.log(window.__copied), 300);
```

Check on a real Tailwind/React site, not just the fixture — every bug found so far (the leaked
`cursor: crosshair`, the `currentColor` noise, the minified `j`) only showed up on a production page.

Sanity checks worth repeating: the emitted CSS selector and `getByText` locator each resolve back to
exactly one element, and it's the target; payload stays in the 1–2 KB range.
