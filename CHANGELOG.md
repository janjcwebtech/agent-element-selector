# Changelog

- Newest first. Versions follow `manifest.json`.
- A release candidate keeps a numeric `version` and carries its label in `version_name`.

## 2.0.0-rc.1 — 2026-11-11 (release candidate, branch `v2-rc`)

Not released. Being tested and adjusted before it ships as 2.x.

### Added

- **On-page toolbar**, shown and hidden with the extension icon, laid out like the Claude artifact view.
  - Page title on the left opens **History**.
  - One segmented control for the mode: **Use the page · Select element (S) · Edit text (V) · Comment (C)**.
  - **Design** and **Settings** buttons, then × to close.
- **Select element** mode: hover and click to copy a reference, ⇧ for the menu, no key to hold.
- **Design** panel (experimental): lists the page's `:root` CSS variables, previews a new value live
  and adds it to the round as a `Design token` item with before / after.
- **Settings** dialog, centered on the page. New setting: toolbar **Position** (top / bottom).
- **History** dropdown under the page title: copy a prompt again, **Show on page**, **Open page** for
  a round made elsewhere, delete, clear.
- `background.js`: a service worker that only forwards the icon click to the page.
- `CHANGELOG.md`.

### Changed

- The toolbar popup is gone; History and Settings live on the page.
- **Edit page** (the pill shown while holding ⌥) is replaced by the toolbar. The menu's **Edit text**
  row opens the toolbar in Edit text.
- A round lasts as long as the toolbar, not the edit mode: pins stay visible and clickable in every mode.
- After **Copy prompt** the toolbar stays open and returns to *Use the page*.
- Esc steps back to *Use the page*; S / V / C only act outside it, so the page keeps its own shortcuts.
- **Extension Enabled** is now **Hold the modifier to select** and only gates the ⌥ shortcut. The
  toolbar works with it off.
- One neutral, dark token set for the whole overlay; the brand purple is gone.
  - Rings, match boxes and pins are dark with a light halo, so they read on light and on dark pages.
  - The menu, panels, composer, toast and badge share the toolbar's surface, border, radius and spacing.
  - Toasts are dark with a green or red dot instead of a filled green or red box.
- The text being edited gets the overlay's own ring; the browser's focus outline is hidden while typing.
- Settings keys are defined in one place (`DEFAULTS` in `content.js`).

### Removed

- `popup.html`, `popup.js`.
- Per-item checkboxes in the History list; items are ticked in the on-page checklist (**Show on page**).

### Known limits

- Tabs open before an install or a reload of the extension need a refresh before the icon responds.
- The toolbar covers 48px of the page; move it to the bottom when it hides what you need.
- Design reads only stylesheets from the page's own origin and only variables declared on `:root` / `html`.
- The real icon click has been exercised only through the injected test stub, not a loaded extension.

## 1.4.3 — 2026-11-08

- **Edit text** row in the menu: starts edit mode with the caret in that element's text.

## 1.4.2 — 2026-11-08

- Opt-in outline on changed text.
- Settings tab with an on/off switch and grouped options.

## 1.4.1 — 2026-11-08

- Filter the replay checklist by text edits or comments.

## 1.4.0 — 2026-11-08

- Edit mode: retype text in place, pin comments, copy everything as one `<page-edits>` prompt.
- Round history and replay with a checklist.

## 1.3.0 — 2026-11-05

- Page URL in every reference.
- ⇧ menu for class and component references.
- Full context wrapped in `<element-context>` tags, marked as page data.
- Open-source preparation: MIT license, toolbar icon, placeholder paths.

## 1.1.0 — 2026-09-26

- The copy is split into a minimal inline reference and full context.

## 1.0.0 — 2026-09-03

- Initial version.
