# Agent Element Selector

Chrome extension. **Hold ⌥ Option, hover, click** — and everything an AI agent needs to *identify*
that element is on your clipboard as Markdown.

It copies identity and location. **Not inner HTML, not computed CSS** — the agent reads the real
styles from your source or via Playwright, and a computed-style dump only contradicts them.

## Install

`chrome://extensions` → **Developer mode** on → **Load unpacked** → pick this folder → reload open tabs.

## Use

| Action | Result |
| --- | --- |
| Hold **⌥ Option** | Blue outline + `tag.class · W×H` badge follows the cursor |
| **Click** while holding | Copies, shows a toast; the page never sees the click |
| **Esc** or release | Cancels |

Toolbar icon → enable/disable, swap the modifier (⌥ ⌃ ⌘ ⇧), toggle the ancestors and text sections,
set text and ancestor-depth limits.

## What you get

~1–2 KB per element:

````markdown
# Element context — `#title`

- **URL:** http://localhost:4321/about
- **Page title:** About
- **Captured:** 2026-09-03T00:59:11Z (dev server)

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

Source metadata covers **Astro** (`data-astro-source-file` + line, islands with their `client:*`
directive, slots), **Svelte** (`__svelte_meta` file:line), **React/Vue** (component name, plus
file:line in dev builds), and `data-testid` / `data-cy` / `data-component` markers on the element or
an ancestor. Minified production names like `j` are suppressed rather than reported.

Astro's source attributes only exist under `astro dev` — production builds have none, and the output
says so when it detects Astro but finds no attributes.

## Notes

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
