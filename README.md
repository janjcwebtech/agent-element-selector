# Agent Element Selector

Chrome extension. **Hold ⌥ Option, hover, click** — a short inline reference to that element lands on
your clipboard, ready to drop mid-sentence into a prompt. **Add ⇧ Shift** for the full Markdown
context an AI agent needs to identify and locate it.

It copies identity and location. **Not inner HTML, not computed CSS** — the agent reads the real
styles from your source or via Playwright, and a computed-style dump only contradicts them.

## Install

`chrome://extensions` → **Developer mode** on → **Load unpacked** → pick this folder → reload open tabs.

## Use

| Action | Result |
| --- | --- |
| Hold **⌥ Option** | Blue outline + `tag.class · W×H · hold ⇧ for full context` badge follows the cursor |
| **⌥-click** | Copies the minimal inline reference; toast says *Copied minimal context* |
| **⌥⇧-click** | Badge turns purple; copies the full context; toast says *Copied full context* |
| **Esc** or release | Cancels |

The page never sees the click. Toolbar icon → enable/disable, swap the modifier (⌥ ⌃ ⌘ ⇧), toggle the
full context's ancestors and text sections, set text and ancestor-depth limits. With ⇧ as the
modifier, ⌥ becomes the full-context key.

## Minimal context (⌥-click)

The fewest characters that still single the element out — tag, id, up to 3 classes, and an XPath
unless the id is unique on the page:

```text
[h1.hero__title.text-4xl · //body/div[2]/main/section/div/div[1]/h1]
[button#send-btn.btn.btn--primary]
```

Refer to several elements in one prompt: *make [h1.hero__title · //main/section/h1] match the size of
[p.lead · //main/section/p]*.

## Full context (⌥⇧-click)

~1–2 KB per element:

````markdown
# Element context — `#title`

- **URL:** http://localhost:4321/about
- **Page title:** About
- **Captured:** 2026-09-03T00:59:11Z (dev server)
- **Browser / OS:** Google Chrome 154.0.8037.57 · macOS 26.6.2

## Source
- **Astro source (this element):** `src/components/Hero.astro:12:4`
- **Astro island:** `Counter` from `/src/components/Counter.tsx`
  - client directive: `visible`, server-rendered
- **Marker:** data-testid="hero-heading"

## How to find this element
- **CSS selector:** `#title`
- **XPath:** `//*[@id="title"]`
- **ARIA role:** `heading` — accessible name: "Build faster with context"
- **Playwright:**
  ```js
  page.getByRole('heading', { name: 'Build faster with context' })
  page.getByTestId('hero-heading')
  page.locator('#title')
  ```

## Element
```html
<h1 class="hero__title text-4xl" id="title" data-testid="hero-heading">
```

**Classes (3):** `hero__title` `text-4xl` `md:text-6xl`

## Text content
> Build faster with context

## Position & size
- **Box:** 640 × 35.2 px
- **Viewport position:** x 65, y 65 (right 705, bottom 100.2)
- **Document position:** x 65, y 65
- **Viewport:** 1200 × 1882 @ 1x — scrolled to 0, 0
- **Visible in viewport:** yes
- **Sibling:** 1 of 3 · 0 child element(s)

## Ancestors (nearest first)
1. `section.hero` (role region) — 690×197 — `src/components/Hero.astro`
2. `main` (role main) — 1120×231 — `src/pages/index.astro`
````

Source metadata covers **Astrogeus** (`data-atx-file` + `data-atx-loc` on every element, so the exact
file:line:col of whatever you clicked), **Astro** (`data-astro-source-file` + line, islands with their `client:*`
directive, slots), **Svelte** (`__svelte_meta` file:line), **React/Vue** (component name, plus
file:line in dev builds), and `data-testid` / `data-cy` / `data-component` markers on the element or
an ancestor. Minified production names like `j` are suppressed rather than reported.

Astro's source attributes only exist under `astro dev` — production builds have none, and the output
says so when it detects Astro but finds no attributes.

## Notes

- Browser / OS comes from UA Client Hints, so macOS and Windows versions are the real ones, not the
  frozen `10_15_7` / `NT 10.0` from the user-agent string.
- Works in iframes; the copy is flagged when the element is inside one.
- The overlay is a shadow root with `all: initial`. Nothing is inserted into the page DOM.
- Falls back from `navigator.clipboard` to a hidden textarea on non-secure origins. If the document
  isn't focused, the toast turns red and says to click the page once.
- Nothing is sent anywhere: no background worker, no network, no host permissions.
- No icons yet, so Chrome shows the default puzzle piece.

## Testing

See [CLAUDE.md](CLAUDE.md) for the inject-and-dispatch recipe. Quick manual check:

```bash
python3 -m http.server 8899   # then open http://localhost:8899/test/fixture.html
```
