/* Agent Element Selector — content script.
   Hold the modifier key, hover to outline, click to copy a reference + page URL.
   Press the second key (⇧) while holding to open the menu: one class, its component, or full context. */
(() => {
  if (window.__agentElementSelectorLoaded) return;
  window.__agentElementSelectorLoaded = true;

  /* ---------------------------------------------------------------- settings */

  const DEFAULTS = {
    enabled: true,
    modifier: 'Alt',      // Alt | Control | Meta | Shift
    includeUrl: true,
    includeAncestors: true,
    ancestorDepth: 5,
  };
  let settings = { ...DEFAULTS };

  try {
    chrome.storage?.sync.get(DEFAULTS, (stored) => {
      if (!chrome.runtime.lastError && stored) settings = { ...DEFAULTS, ...stored };
    });
    chrome.storage?.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
      if (!settings.enabled) { closeMenu(); disarm(); }
    });
  } catch (_) { /* storage unavailable in some contexts */ }

  const MODIFIER_FLAG = { Alt: 'altKey', Control: 'ctrlKey', Meta: 'metaKey', Shift: 'shiftKey' };
  const heldNow = (e) => !!e[MODIFIER_FLAG[settings.modifier] || 'altKey'];
  // Pressing this key while the modifier is held opens the menu (classes, component, full context).
  const fullKey = () => (settings.modifier === 'Shift' ? 'Alt' : 'Shift');
  const fullNow = (e) => !!e[MODIFIER_FLAG[fullKey()]];
  const KEY_GLYPH = { Alt: '⌥', Control: '⌃', Meta: '⌘', Shift: '⇧' };

  /* ------------------------------------------------------------- environment */

  // The UA string freezes macOS at 10_15_7 and Windows at NT 10.0, so it's only the fallback;
  // UA Client Hints give the real versions but resolve async — fetch once up front.
  function envFromUA(ua) {
    const b = ua.match(/(Edg|OPR|Firefox|Chrome)\/([\d.]+)/);
    const safari = !b && ua.match(/Version\/([\d.]+).*Safari/);
    const browser = b ? `${{ Edg: 'Microsoft Edge', OPR: 'Opera' }[b[1]] || b[1]} ${b[2]}` : safari ? `Safari ${safari[1]}` : null;
    const o = ua.match(/(Mac OS X|Windows NT|Android|CrOS|iPhone OS|Linux)[ _]?([\d._]*)/);
    const os = o ? `${{ 'Mac OS X': 'macOS', 'Windows NT': 'Windows', CrOS: 'ChromeOS', 'iPhone OS': 'iOS' }[o[1]] || o[1]} ${o[2].replace(/_/g, '.')}`.trim() : null;
    return { browser, os };
  }

  function envFromClientHints(h) {
    const brands = (h.fullVersionList || h.brands || []).filter((x) => !/^not.a.brand$/i.test(x.brand));
    const b = brands.find((x) => x.brand !== 'Chromium') || brands[0];
    let ver = h.platformVersion || '';
    if (h.platform === 'Windows') ver = parseInt(ver, 10) >= 13 ? '11' : parseInt(ver, 10) > 0 ? '10' : '';
    return { browser: b ? `${b.brand} ${b.version}` : null, os: h.platform ? `${h.platform} ${ver}`.trim() : null };
  }

  let env = envFromUA(navigator.userAgent);
  try {
    navigator.userAgentData?.getHighEntropyValues(['platformVersion', 'fullVersionList'])
      .then((h) => { const hinted = envFromClientHints(h); env = { browser: hinted.browser || env.browser, os: hinted.os || env.os }; })
      .catch(() => {});
  } catch (_) { /* client hints unavailable */ }

  /* ------------------------------------------------------------------- utils */

  const trunc = (s, n) => (s == null ? '' : (s.length > n ? s.slice(0, n) + '…' : s));
  const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s).replace(/"/g, '&quot;');

  const GENERATED_CLASS = /^(svelte-[a-z0-9]{4,}|jsx-\d+|css-[a-z0-9]{5,}|sc-[A-Za-z0-9]{5,}|[a-zA-Z]+_[a-zA-Z0-9]+__[a-zA-Z0-9]{4,})$/;
  const AWKWARD_CLASS = /[:[\]()/!#%]/;   // tailwind variants etc — legal but noisy in a selector

  function classList(el) {
    return (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  }
  function selectorClasses(el) {
    return classList(el).filter((c) => !GENERATED_CLASS.test(c) && !AWKWARD_CLASS.test(c) && c.length <= 40);
  }

  // Tailwind-style utilities. The menu folds these so the named classes stay on top.
  const UTILITY_CLASS = /^-?(flex|inline-flex|inline-block|inline-grid|grid|block|inline|hidden|contents|sticky|relative|absolute|fixed|static|group|peer|container|truncate|uppercase|lowercase|capitalize|italic|underline|transition|transform|shadow|rounded|border|ring|outline|isolate|antialiased|sr-only|[mp][trblxyse]?-|gap-|space-[xy]-|items-|justify-|content-|self-|place-|text-|bg-|font-|leading-|tracking-|w-|h-|min-[wh]-|max-[wh]-|size-|top-|left-|right-|bottom-|inset-|z-|order-|col-|row-|basis-|grow|shrink|flex-|aspect-|object-|overflow-|opacity-|duration-|ease-|delay-|ring-|shadow-|rounded-|border-|outline-|cursor-|select-|backdrop-|blur|translate-|scale-|rotate-|fill-|stroke-|line-clamp-|whitespace-|break-|from-|via-|to-|divide-|underline-|decoration-)/;
  const classKind = (c) => (GENERATED_CLASS.test(c) ? 'generated' : AWKWARD_CLASS.test(c) || UTILITY_CLASS.test(c) ? 'utility' : 'named');

  // The query string is kept (it often decides what's on the page); tracking params are dropped,
  // and the hash only survives when it's a client-side route (#/… or #!…).
  const TRACKING_PARAM = /^(utm_[a-z_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|ref_src|_ga|_gl)$/i;
  function cleanUrl(href) {
    let u;
    try { u = new URL(href); } catch (_) { return href; }
    for (const k of new Set(u.searchParams.keys())) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    if (!/^#[!/]/.test(u.hash)) u.hash = '';
    return u.href;
  }
  const pageUrl = () => (settings.includeUrl ? cleanUrl(location.href) : '');

  // "sitewide" buttons swap the page URL for the origin. file: / about:srcdoc have none.
  const siteScopeOk = () => settings.includeUrl && location.origin && location.origin !== 'null';

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    let guard = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && guard++ < 12) {
      const parent = node.parentElement;
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      let seg = node.tagName.toLowerCase();
      const cls = selectorClasses(node).slice(0, 3);
      if (cls.length) seg += '.' + cls.map((c) => CSS.escape(c)).join('.');
      if (parent) {
        let twins = [];
        try { twins = Array.from(parent.children).filter((c) => c.matches(seg)); } catch (_) { twins = [node]; }
        if (twins.length > 1) {
          const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
      }
      parts.unshift(seg);
      const candidate = parts.join(' > ');
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (_) { /* ignore */ }
      node = parent;
    }
    return parts.join(' > ');
  }

  // One line, values capped at 80 chars: it's the attributes as written, not a content dump.
  function openTag(el) {
    const attrs = Array.from(el.attributes).filter((a) => !a.name.startsWith('data-atx-')).map((a) => `${a.name}="${esc(trunc(squash(a.value), 80))}"`);
    return `<${el.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  }

  function shortLabel(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = classList(el).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }

  /* ---------------------------------------------- framework / source metadata */


  function astroInfo(el) {
    const out = {};
    if (el.hasAttribute('data-astro-source-file')) {
      out.ownFile = el.getAttribute('data-astro-source-file');
      out.ownLoc = el.getAttribute('data-astro-source-loc');
    }
    const near = el.closest('[data-astro-source-file]');
    if (near && near !== el) {
      out.nearestFile = near.getAttribute('data-astro-source-file');
      out.nearestLoc = near.getAttribute('data-astro-source-loc');
      out.nearestEl = shortLabel(near);
    }
    // Astrogeus stamps every rendered element with its own file + line:col, not just component roots.
    const atx = el.closest('[data-atx-file]');
    if (atx) {
      out.atx = { file: atx.getAttribute('data-atx-file'), loc: atx.getAttribute('data-atx-loc'), on: atx === el ? null : shortLabel(atx) };
    }
    const island = el.closest('astro-island');
    if (island) {
      out.island = {
        component: island.getAttribute('component-export') || '(default)',
        url: island.getAttribute('component-url'),
        renderer: island.getAttribute('renderer-url'),
        client: island.getAttribute('client'),
        ssr: island.hasAttribute('ssr'),
        uid: island.getAttribute('uid'),
        props: trunc(island.getAttribute('props') || '', 300),
      };
    }
    const slot = el.closest('astro-slot, astro-static-slot');
    if (slot) out.slot = slot.tagName.toLowerCase() + (slot.getAttribute('name') ? ` name="${slot.getAttribute('name')}"` : '');
    if (document.querySelector('astro-dev-toolbar, astro-island, [data-astro-cid], [data-astro-source-file], [data-atx-file]')) out.detected = true;
    return Object.keys(out).length ? out : null;
  }

  const REAL_NAME = /^[A-Z][A-Za-z0-9]{2,}$/;

  function reactInfo(el) {
    let node = el;
    let hops = 0;
    while (node && hops++ < 6) {
      const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (key) {
        let fiber = node[key];
        let depth = 0;
        while (fiber && depth++ < 12) {
          const t = fiber.elementType || fiber.type;
          const name = typeof t === 'function' ? (t.displayName || t.name) : (t && t.displayName);
          if (name) {
            const src = fiber._debugSource;
            const file = src ? `${src.fileName}:${src.lineNumber}${src.columnNumber ? ':' + src.columnNumber : ''}` : null;
            // minified production bundles yield names like `j` or `Ml` — noise, not context
            if (file || REAL_NAME.test(name)) return { component: name, file };
            return null;
          }
          fiber = fiber.return;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function svelteInfo(el) {
    let node = el;
    let hops = 0;
    while (node && hops++ < 6) {
      const meta = node.__svelte_meta;
      if (meta && meta.loc) {
        return { file: `${meta.loc.file}:${meta.loc.line}${meta.loc.column != null ? ':' + meta.loc.column : ''}`, at: shortLabel(node) };
      }
      node = node.parentElement;
    }
    return null;
  }

  function vueInfo(el) {
    let node = el;
    let hops = 0;
    while (node && hops++ < 6) {
      const c = node.__vueParentComponent || node.__vue__;
      const type = c && (c.type || c.$options);
      if (type) {
        const name = type.__name || type.name || type._componentTag;
        const file = type.__file;
        if (file || (name && REAL_NAME.test(name))) return { component: name || null, file: file || null };
      }
      node = node.parentElement;
    }
    return null;
  }

  function frameworkInfo(el) {
    const out = {};
    const astro = astroInfo(el);
    if (astro) out.astro = astro;
    const react = reactInfo(el);
    if (react) out.react = react;
    const svelte = svelteInfo(el);
    if (svelte) out.svelte = svelte;
    const vue = vueInfo(el);
    if (vue) out.vue = vue;

    const hints = [];
    for (const attr of ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-component', 'data-qa']) {
      const holder = el.closest(`[${attr}]`);
      if (holder) hints.push(`${attr}="${holder.getAttribute(attr)}"${holder === el ? '' : ` (on ${shortLabel(holder)})`}`);
    }
    if (hints.length) out.hints = hints;
    return Object.keys(out).length ? out : null;
  }

  /* ---------------------------------------------------- element-specific bits */

  // Only what the opening tag doesn't already show. No form values: they're what someone typed.
  function computedExtras(el) {
    const tag = el.tagName.toLowerCase();
    const rows = [];
    if (tag === 'a' && el.href && el.href !== el.getAttribute('href')) rows.push(['resolved href', trunc(el.href, 200)]);
    if (tag === 'img') {
      if (el.currentSrc && el.currentSrc !== el.getAttribute('src')) rows.push(['current src', trunc(el.currentSrc, 160)]);
      if (el.naturalWidth) rows.push(['natural size', `${el.naturalWidth}×${el.naturalHeight}`]);
    }
    return rows;
  }

  /* ------------------------------------------------------------------ locators */

  const IMPLICIT_ROLE = {
    a: 'link', button: 'button', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
    h5: 'heading', h6: 'heading', img: 'img', nav: 'navigation', main: 'main', header: 'banner',
    footer: 'contentinfo', aside: 'complementary', form: 'form', table: 'table', ul: 'list',
    ol: 'list', li: 'listitem', section: 'region', article: 'article', dialog: 'dialog',
    select: 'combobox', textarea: 'textbox', summary: 'button', progress: 'progressbar',
  };

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      return { button: 'button', submit: 'button', reset: 'button', checkbox: 'checkbox',
        radio: 'radio', range: 'slider', search: 'searchbox', email: 'textbox',
        tel: 'textbox', url: 'textbox', text: 'textbox', number: 'spinbutton' }[t] || null;
    }
    return IMPLICIT_ROLE[tag] || null;
  }

  function xPath(el) {
    const parts = [];
    let node = el;
    let guard = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && guard++ < 15) {
      if (node.id) { parts.unshift(`*[@id="${node.id}"]`); break; }
      const tag = node.tagName.toLowerCase();
      const twins = node.parentElement
        ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName)
        : [node];
      parts.unshift(twins.length > 1 ? `${tag}[${twins.indexOf(node) + 1}]` : tag);
      node = node.parentElement;
    }
    return '//' + parts.join('/');
  }

  // No accessible name / getByRole name / getByText: those repeat the page's text, which reads as a
  // contradiction next to a request to change that text. CSS + XPath + test id are enough to find it.
  function locators(el) {
    const out = { css: cssPath(el), xpath: xPath(el), role: roleOf(el), playwright: [] };
    const q = (s) => `'${String(s).replace(/'/g, "\\'")}'`;
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
    if (testid) out.playwright.push(`page.getByTestId(${q(testid)})`);
    if (out.css) out.playwright.push(`page.locator(${q(out.css)})`);
    return out;
  }

  /* --------------------------------------------------------------- collection */

  // tag#id + ≤3 selector-safe classes: the label of every reference, the badge and the menu header.
  function minimalLabel(el) {
    let label = el.tagName.toLowerCase();
    if (el.id) label += '#' + el.id;
    const cls = selectorClasses(el).slice(0, 3);
    if (cls.length) label += '.' + cls.join('.');
    return label;
  }

  function collect(el) {
    const rect = el.getBoundingClientRect();
    const data = {
      url: pageUrl(),
      env,
      label: minimalLabel(el),
      openTag: openTag(el),
      rect,
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      inFrame: window.top !== window.self,
      extras: computedExtras(el),
      framework: frameworkInfo(el),
      ancestors: [],
      locators: locators(el),
    };

    if (settings.includeAncestors) {
      let node = el.parentElement;
      let n = 0;
      while (node && n < settings.ancestorDepth && node !== document.documentElement) {
        const r = node.getBoundingClientRect();
        data.ancestors.push({
          label: shortLabel(node),
          size: `${Math.round(r.width)}×${Math.round(r.height)}`,
          role: node.getAttribute('role') || IMPLICIT_ROLE[node.tagName.toLowerCase()] || null,
          astro: node.getAttribute('data-astro-source-file')
            || (node.hasAttribute('data-atx-file') ? `${node.getAttribute('data-atx-file')}:${node.getAttribute('data-atx-loc')}` : null),
        });
        node = node.parentElement;
        n++;
      }
    }

    return data;
  }

  // Just enough to single the element out: tag#id.classes, plus an XPath unless the id is unique.
  function collectMinimal(el) {
    let uniqueId = false;
    try { uniqueId = !!el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1; } catch (_) { /* odd id */ }
    return { label: minimalLabel(el), xpath: uniqueId ? null : xPath(el) };
  }

  // The menu's rows: this element, each class with its match count, the component, full context.
  // `list()` re-queries so hovering a row always outlines what's on the page now.
  function collectGroups(el) {
    const items = [{ kind: 'element' }];
    for (const c of classList(el)) {
      const sel = '.' + CSS.escape(c);
      const list = () => { try { return Array.from(document.querySelectorAll(sel)); } catch (_) { return []; } };
      items.push({ kind: 'class', group: classKind(c), cls: c, text: '.' + c, list, n: list().length });
    }
    const comp = componentGroup(el);
    if (comp) items.push(comp);
    items.push({ kind: 'full' });
    return items;
  }

  // Same template line = same source attrs. Astrogeus stamps every element, Astro (dev) component
  // roots; either way "all N from File.astro:line" is every rendered copy of what you pointed at.
  function componentGroup(el) {
    const holder = el.closest('[data-atx-file]') || el.closest('[data-astro-source-file]');
    if (!holder) return null;
    const atx = holder.hasAttribute('data-atx-file');
    const fileAttr = atx ? 'data-atx-file' : 'data-astro-source-file';
    const locAttr = atx ? 'data-atx-loc' : 'data-astro-source-loc';
    const file = holder.getAttribute(fileAttr), loc = holder.getAttribute(locAttr);
    const list = () => Array.from(document.querySelectorAll(`[${fileAttr}]`))
      .filter((n) => n.getAttribute(fileAttr) === file && n.getAttribute(locAttr) === loc);
    const srcIdx = file.indexOf('/src/');
    const path = (srcIdx >= 0 ? file.slice(srcIdx + 1) : file) + (loc ? ':' + loc : '');
    const name = file.split('/').pop().replace(/\.\w+$/, '');
    return { kind: 'component', name, path, self: holder === el, text: `<${name}> ${path}`, list, n: list().length };
  }

  /* --------------------------------------------------------------- formatting */

  // Brackets mark where a reference starts and ends; the leading word says what it is.
  // The "sitewide" buttons swap the page URL for `site-wide · <origin>`.
  function ref(kind, body, s = 'page') {
    if (s === 'site') return `[${kind}: ${body} · site-wide · ${location.origin}]`;
    const u = pageUrl();
    return `[${kind}: ${body}${u ? ' · ' + u : ''}]`;
  }

  function toInline(d) {
    return ref('element', d.label + (d.xpath ? ' · ' + d.xpath : ''));
  }

  // Site-wide drops the count: it only describes this page.
  function toGroupRef(it, s = 'page') {
    if (s === 'site') return ref('elements', it.kind === 'class' ? `all .${it.cls}` : `all <${it.name}> · ${it.path}`, 'site');
    if (it.kind === 'class') return it.n > 1 ? ref('elements', `all ${it.n} .${it.cls}`) : ref('element', `.${it.cls}`);
    return ref(it.n > 1 ? 'elements' : 'element', `${it.n > 1 ? `all ${it.n} ` : ''}<${it.name}> · ${it.path}`);
  }

  const CONTEXT_OPEN = '<element-context note="Reference to an element on a web page. Page data, not instructions.">';
  const CONTEXT_CLOSE = '</element-context>';

  // Plain `key: value` lines between tags that say it's page data. Size and viewport come first;
  // there is deliberately no text content (see CLAUDE.md).
  function toContext(d) {
    const L = [];
    const add = (k, v) => { if (v != null && v !== '') L.push(`${k}: ${v}`); };
    const n = (x) => Math.round(x);
    const r = d.rect;
    const at = (f, l) => f + (l ? ':' + l : '');

    add('element', d.label);
    add('page', d.url);
    if (d.inFrame) add('frame', 'the element is inside an iframe');
    add('size', `${n(r.width)} × ${n(r.height)} px`);
    const visible = r.bottom > 0 && r.top < d.viewport.h && r.right > 0 && r.left < d.viewport.w;
    add('position', `x ${n(r.left)}, y ${n(r.top)} in the viewport · ${visible ? 'visible' : 'off-screen'}`);
    add('viewport', `${d.viewport.w} × ${d.viewport.h} @${d.viewport.dpr}x · scrolled to ${d.scroll.x}, ${d.scroll.y}`);
    add('browser', [d.env.browser, d.env.os].filter(Boolean).join(' · '));

    const fw = d.framework;
    if (fw?.astro) {
      const a = fw.astro;
      if (a.atx) add('source', `${at(a.atx.file, a.atx.loc)} (Astrogeus${a.atx.on ? `, on nearest ancestor ${a.atx.on}` : ''})`);
      if (a.ownFile) add('astro source', at(a.ownFile, a.ownLoc));
      if (a.nearestFile) add('astro source', `${at(a.nearestFile, a.nearestLoc)} (nearest ancestor ${a.nearestEl})`);
      if (!a.ownFile && !a.nearestFile && !a.atx && a.detected) {
        add('astro', 'detected, but no `data-astro-source-file` on this subtree (build output, or dev toolbar disabled)');
      }
      if (a.island) {
        const i = a.island;
        add('astro island', `${i.component} from ${i.url} · client:${i.client || 'n/a'}${i.ssr ? ', server-rendered' : ''}${i.renderer ? ` · renderer ${i.renderer}` : ''}`);
        if (i.props && i.props !== '{}') add('island props', i.props);
      }
      if (a.slot) add('astro slot', a.slot);
    }
    if (fw?.react) add('react component', `${fw.react.component}${fw.react.file ? ` · ${fw.react.file}` : ''}`);
    if (fw?.svelte) add('svelte source', `${fw.svelte.file} (on ${fw.svelte.at})`);
    if (fw?.vue) add('vue component', `${fw.vue.component || '?'}${fw.vue.file ? ` · ${fw.vue.file}` : ''}`);
    if (fw?.hints) for (const h of fw.hints) add('marker', h);

    const loc = d.locators;
    add('css', loc.css || '(none derivable)');
    add('xpath', loc.xpath);
    add('role', loc.role);
    if (loc.playwright.length === 1) add('playwright', loc.playwright[0]);
    else if (loc.playwright.length) { L.push('playwright:'); for (const p of loc.playwright) L.push('  ' + p); }
    add('tag', d.openTag);
    for (const [k, v] of d.extras) add(k, v);

    if (d.ancestors.length) {
      L.push('ancestors (nearest first):');
      d.ancestors.forEach((a, i) => L.push(`  ${i + 1}. ${a.label}${a.role ? ` (role ${a.role})` : ''} · ${a.size}${a.astro ? ` · ${a.astro}` : ''}`));
    }

    // Page data can't close the block early.
    const body = L.join('\n').replace(/<\/element-context/gi, '<\\/element-context');
    return `${CONTEXT_OPEN}\n${body}\n${CONTEXT_CLOSE}\n`;
  }

  /* ------------------------------------------------------------------ overlay */

  // Styled with the atx-inspector tokens (01-atx-inspector/src/client/ui.ts): near-black glass,
  // brand purple only where it points at the page, hover = surface shift.
  const OVERLAY_CSS = `
    :host {
      all: initial;
      --atx-card: #171717; --atx-accent: #404040;
      --atx-border: rgb(255 255 255 / 0.10); --atx-input: rgb(255 255 255 / 0.15);
      --atx-input-bg: rgb(255 255 255 / 0.075); --atx-control-bg: rgb(255 255 255 / 0.045); --atx-ring: #737373;
      --atx-foreground: #fafafa; --atx-muted-fg: #a1a1a1; --atx-faint-fg: #949494;
      --atx-brand: #6144d7; --atx-brand-text: #aaa7f4;
      --atx-success: #0a7e3a; --atx-destructive: #ff6467; --atx-primary: #e5e5e5; --atx-primary-fg: #171717; --atx-warning: #e3ae28;
      --atx-radius-sm: 6px; --atx-radius-md: 8px; --atx-radius-lg: 10px; --atx-radius-full: 999px;
      --atx-font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      --atx-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    [hidden] { display: none !important; }
    .box { position: fixed; box-sizing: border-box; pointer-events: none; border: 2px solid var(--atx-brand);
      border-radius: var(--atx-radius-sm); box-shadow: 0 0 0 2px #6144d744, 0 0 12px #6144d766; }
    .box.tiny { box-shadow: 0 0 0 3px #6144d766, 0 0 12px #6144d799; }
    .mbox { position: fixed; box-sizing: border-box; pointer-events: none; border: 1px dashed var(--atx-brand);
      background: rgb(97 68 215 / 0.16); border-radius: var(--atx-radius-sm); }
    .badge { position: fixed; pointer-events: none; display: flex; align-items: baseline; gap: 7px; white-space: nowrap;
      padding: 5px 9px; max-width: calc(100vw - 8px); overflow: hidden; box-sizing: border-box;
      background: var(--atx-card); color: var(--atx-foreground); border: 1px solid var(--atx-border);
      border-radius: var(--atx-radius-md); font: 12px/1.3 var(--atx-font-ui); box-shadow: 0 8px 24px rgba(0,0,0,.36); }
    .badge.full { border-color: var(--atx-brand); }
    .b-label { font: 500 11.5px/1.3 var(--atx-font-mono); color: var(--atx-brand-text); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .b-size { font: 11px/1.3 var(--atx-font-mono); color: var(--atx-faint-fg); flex: none; }
    .b-hint { color: var(--atx-muted-fg); flex: none; }
    .edge { position: fixed; left: 50%; transform: translateX(-50%); pointer-events: none;
      font: 600 11.5px/1 var(--atx-font-ui); color: var(--atx-brand-text); background: var(--atx-card);
      border: 1px solid var(--atx-border); padding: 6px 11px; border-radius: var(--atx-radius-full); box-shadow: 0 4px 14px rgba(0,0,0,.3); }
    .edge.up { top: 8px; } .edge.down { bottom: 8px; }
    .toast { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); pointer-events: none;
      max-width: min(560px, calc(100vw - 24px)); box-sizing: border-box;
      font: 500 14px/1.4 var(--atx-font-ui); background: var(--atx-success); color: var(--atx-foreground);
      padding: 10px 18px; border-radius: var(--atx-radius-lg); box-shadow: 0 4px 16px rgba(0,0,0,.32);
      opacity: 0; transition: opacity 120ms; }
    .toast.show { opacity: 1; }
    .toast.err { background: var(--atx-destructive); color: var(--atx-primary-fg); }
    .toast small { display: block; opacity: .85; font: 400 11.5px/1.45 var(--atx-font-mono); margin-top: 3px; word-break: break-all; }

    .menu { position: fixed; pointer-events: auto; width: 360px; max-width: calc(100vw - 16px); box-sizing: border-box;
      display: flex; flex-direction: column; padding: 6px; text-align: left;
      background: rgb(29 29 35 / 0.97); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      color: var(--atx-foreground); border: 1px solid var(--atx-border); border-radius: var(--atx-radius-lg);
      box-shadow: 0 8px 28px rgba(0,0,0,.42); font: 500 13px/1.35 var(--atx-font-ui); outline: none; color-scheme: dark; cursor: auto; }
    .m-head { display: flex; align-items: center; gap: 8px; padding: 2px 2px 8px 10px; margin-bottom: 4px; border-bottom: 1px solid var(--atx-border); }
    .m-label { font: 500 12px/1.3 var(--atx-font-mono); color: var(--atx-brand-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
    .m-size { font: 11px/1 var(--atx-font-mono); color: var(--atx-faint-fg); font-variant-numeric: tabular-nums; flex: none; }
    .m-close { flex: none; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: var(--atx-radius-md);
      background: transparent; color: var(--atx-muted-fg); font: 17px/1 var(--atx-font-ui); cursor: pointer; }
    .m-close:hover { background: var(--atx-accent); color: var(--atx-foreground); }
    .m-close:focus-visible { outline: none; box-shadow: 0 0 0 2px rgb(115 115 115 / .7); }
    .m-btn { flex: none; height: 24px; padding: 0 9px; box-sizing: border-box; border: 1px solid var(--atx-input);
      border-radius: var(--atx-radius-md); background: var(--atx-control-bg); color: var(--atx-foreground);
      font: 500 12px/1 var(--atx-font-ui); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer;
      transition: background 120ms, border-color 120ms, color 120ms; }
    .m-row.on .m-btn { border-color: rgb(255 255 255 / 0.22); }
    /* Hover inverts to the atx emphatic fill (near-white, dark ink): the one click that copies.
       After .m-row.on .m-btn and as specific, so it wins the border too. */
    .m-row .m-btn:hover { background: var(--atx-primary); border-color: var(--atx-primary); color: var(--atx-primary-fg); }
    .m-btn:active { transform: translateY(1px); }
    .m-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgb(115 115 115 / .7); }
    .m-filter { margin: 2px 0 6px; min-height: 32px; padding: 4px 10px; box-sizing: border-box; width: 100%;
      border: 1px solid transparent; border-radius: var(--atx-radius-lg); background: var(--atx-input-bg); color: var(--atx-foreground);
      font: 400 13px/1.45 var(--atx-font-mono); outline: none; color-scheme: dark; transition: border-color 200ms, box-shadow 200ms; }
    .m-filter::placeholder { color: var(--atx-faint-fg); }
    .m-filter:focus { border-color: var(--atx-ring); box-shadow: 0 0 0 3px rgb(115 115 115 / .5); }
    .m-body { position: relative; overflow-y: auto; min-height: 0; flex: 1 1 auto; overscroll-behavior: contain; }
    .m-sec { font: 600 10.5px/1 var(--atx-font-ui); letter-spacing: .07em; text-transform: uppercase; color: var(--atx-faint-fg); padding: 10px 12px 5px; }
    .m-sec.warn { color: var(--atx-warning); }
    .m-note { font: 400 12.5px/1.45 var(--atx-font-ui); color: var(--atx-muted-fg); padding: 6px 12px; }
    .m-sep { height: 1px; background: var(--atx-border); margin: 6px 0; }
    .m-row { display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 4px 6px 4px 12px; box-sizing: border-box;
      border-radius: var(--atx-radius-md); cursor: default; color: var(--atx-foreground); }
    .m-row.clickable { cursor: pointer; }
    .m-row.on { background: var(--atx-accent); }
    .m-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .k-class .m-name, .k-component .m-name { font: 500 12.5px/1.3 var(--atx-font-mono); }
    .m-sub { display: block; font: 400 11.5px/1.35 var(--atx-font-ui); color: var(--atx-muted-fg); overflow: hidden; text-overflow: ellipsis; }
    .k-full .m-name, .k-full .m-sub { white-space: normal; }
    .k-disclose .m-name { color: var(--atx-muted-fg); }
    .k-disclose .m-name::before { content: "▸ "; color: var(--atx-faint-fg); }
    .m-status { margin: 6px 4px 0; padding: 8px 6px 2px; border-top: 1px solid var(--atx-border);
      font: 500 11.5px/1.35 var(--atx-font-ui); color: var(--atx-muted-fg); }
  `;

  let host = null, shadow = null, box = null, badge = null, toast = null, edgeUp = null, edgeDown = null, matchLayer = null, cursorStyle = null;

  function ensureOverlay() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-agent-element-selector', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    shadow.append(style);
    matchLayer = make('div');
    box = make('div', 'box');
    badge = make('div', 'badge');
    edgeUp = make('div', 'edge up');
    edgeDown = make('div', 'edge down');
    toast = make('div', 'toast');
    for (const n of [box, badge, edgeUp, edgeDown]) n.hidden = true;
    shadow.append(matchLayer, box, badge, edgeUp, edgeDown, toast);
    // Events from the menu are composed, so they'd bubble out to the page's document listeners
    // (click-outside handlers, analytics, smooth-scroll libraries eating `wheel`). Stop them here,
    // after the menu's own handlers and our window capture listeners have run.
    for (const type of ['click', 'dblclick', 'auxclick', 'contextmenu', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
      'keydown', 'keyup', 'keypress', 'input', 'wheel', 'touchstart', 'touchmove']) {
      shadow.addEventListener(type, (e) => e.stopPropagation());
    }
    menuEl = null;
    (document.body || document.documentElement).appendChild(host);
  }

  // Shadow-root element helper; every page-derived string goes in through textContent.
  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Visible viewport, without the scrollbar. documentElement.clientHeight is the document in quirks mode.
  function view() {
    const de = document.documentElement;
    const quirks = document.compatMode !== 'CSS1Compat';
    return { w: (!quirks && de.clientWidth) || window.innerWidth, h: (!quirks && de.clientHeight) || window.innerHeight };
  }

  const placeRect = (node, r) => Object.assign(node.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });

  let fullMode = false;

  function drawBox(target) {
    ensureOverlay();
    const r = target.getBoundingClientRect();
    placeRect(box, r);
    box.hidden = false;
    box.classList.toggle('tiny', r.width < 20 || r.height < 20);
    return r;
  }

  function highlight(target) {
    const r = drawBox(target);
    const glyph = KEY_GLYPH[fullKey()];
    badge.hidden = false;
    badge.classList.toggle('full', fullMode);
    badge.replaceChildren(
      make('span', 'b-label', minimalLabel(target)),
      make('span', 'b-size', `${Math.round(r.width)}×${Math.round(r.height)}`),
      make('span', 'b-hint', fullMode ? `click or press ${glyph} again for the menu` : `click copies · press ${glyph} for the menu`));
    const { w, h } = view();
    badge.style.left = Math.max(4, Math.min(r.left, w - badge.offsetWidth - 4)) + 'px';
    badge.style.top = (r.top > 30 ? r.top - 30 : Math.min(r.bottom + 6, h - 30)) + 'px';
  }

  function hideHighlight() {
    if (!box) return;
    box.hidden = true;
    badge.hidden = true;
  }

  // Dashed boxes on every match in view; matches outside it become ↑ / ↓ counters at the edge.
  const MAX_MATCH_BOXES = 400;
  function drawMatches(list, skip) {
    const { w, h } = view();
    let above = 0, below = 0, inView = 0, hidden = 0, i = 0;
    const pool = matchLayer.children;
    for (const m of list) {
      const r = m.getBoundingClientRect();
      if (!r.width && !r.height) { hidden++; continue; }   // display:none, or a breakpoint hides it
      if (r.bottom <= 0) { above++; continue; }
      if (r.top >= h) { below++; continue; }
      if (r.right <= 0 || r.left >= w) { hidden++; continue; }
      inView++;
      if (m === skip || i >= MAX_MATCH_BOXES) continue;
      const b = pool[i] || matchLayer.appendChild(make('div', 'mbox'));
      b.hidden = false;
      placeRect(b, r);
      i++;
    }
    for (; i < pool.length; i++) pool[i].hidden = true;
    edgeUp.hidden = !above;
    edgeUp.textContent = `↑ ${above} above`;
    edgeDown.hidden = !below;
    edgeDown.textContent = `↓ ${below} below`;
    return { inView, above, below, hidden };
  }
  const clearMatches = () => { if (matchLayer) drawMatches([], null); };

  let toastTimer = null;
  function showToast(msg, sub, isError) {
    ensureOverlay();
    toast.className = 'toast show' + (isError ? ' err' : '');
    toast.replaceChildren(msg);
    if (sub) toast.append(make('small', null, sub));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2400);
  }

  /* --------------------------------------------------------------------- menu */

  let menu = null;      // open menu state: { el, point, items, rows, active, expanded, filter, … }
  let menuEl = null;

  function openMenu(target, point) {
    closeMenu();
    ensureOverlay();
    hideHighlight();
    const items = collectGroups(target);
    const classCount = items.filter((i) => i.kind === 'class').length;
    const r = target.getBoundingClientRect();
    menu = { el: target, point, items, classCount, rows: [], active: 0, expanded: false, filter: '', input: null,
      prevFocus: document.activeElement };

    menuEl = make('div', 'menu');
    menuEl.tabIndex = -1;
    menuEl.setAttribute('role', 'dialog');
    menuEl.setAttribute('aria-label', 'Choose what to copy');
    const head = make('div', 'm-head');
    const close = make('button', 'm-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => closeMenu());
    head.append(make('span', 'm-label', minimalLabel(target)), make('span', 'm-size', `${Math.round(r.width)}×${Math.round(r.height)}`), close);
    menuEl.append(head);
    if (classCount > 8) {
      const input = make('input', 'm-filter');
      input.type = 'text';
      input.placeholder = `Filter ${classCount} classes`;
      input.setAttribute('aria-label', 'Filter classes');
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.addEventListener('input', () => { menu.filter = input.value; menu.active = 0; renderMenu(); });
      menuEl.append(input);
      menu.input = input;
    }
    menu.body = make('div', 'm-body');
    menu.status = make('div', 'm-status');
    menuEl.append(menu.body, menu.status);
    shadow.append(menuEl);

    drawBox(target);
    renderMenu();
    (menu.input || menuEl).focus({ preventScroll: true });
  }

  function closeMenu() {
    if (!menu) return;
    const prev = menu.prevFocus;
    menu = null;
    menuEl?.remove();
    menuEl = null;
    clearMatches();
    hideHighlight();
    try { if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true }); } catch (_) { /* not focusable */ }
    if (armed && current) highlight(current);
  }

  function renderMenu() {
    const m = menu;
    const f = m.filter.trim().toLowerCase();
    m.body.replaceChildren();
    m.rows = [];
    const ok = (it) => !f || it.text.toLowerCase().includes(f);
    const sec = (t, cls) => m.body.append(make('div', 'm-sec' + (cls ? ' ' + cls : ''), t));
    const note = (t) => m.body.append(make('div', 'm-note', t));
    const classes = m.items.filter((i) => i.kind === 'class');
    const pick = (g) => classes.filter((i) => i.group === g && ok(i));
    const named = pick('named'), util = pick('utility'), gen = pick('generated');

    if (!f) { sec('Element'); addRow(m.items[0]); }
    if (!classes.length) note('No classes on this element.');
    if (named.length) { sec(classes.length > named.length ? 'Named classes' : 'Classes'); named.forEach(addRow); }
    if (util.length) {
      // Fold only when there are named classes to keep on top; on a pure-Tailwind element the utilities are the list.
      if (!f && !m.expanded && util.length > 4 && named.length) addRow({ kind: 'disclose', text: `${util.length} utility classes` });
      else { sec('Utility classes'); util.forEach(addRow); }
    }
    if (gen.length) { sec('Generated · renamed on rebuild', 'warn'); gen.forEach(addRow); }
    if (f && !named.length && !util.length && !gen.length) note(`No class contains “${m.filter.trim()}”.`);
    const comp = m.items.find((i) => i.kind === 'component');
    if (comp && ok(comp)) { sec('Component'); addRow(comp); }
    if (!f) { m.body.append(make('div', 'm-sep')); addRow(m.items.find((i) => i.kind === 'full')); }

    m.active = Math.max(0, Math.min(m.active, m.rows.length - 1));
    placeMenu();
    setActive(m.active);
  }

  // A row-end button that copies on one click. Hovering it says exactly what it copies.
  function copyButton(text, title, onCopy, statusText, rowIdx) {
    const b = make('button', 'm-btn', text);
    b.type = 'button';
    b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault());   // keeps focus in the filter box
    b.addEventListener('click', (e) => { e.stopPropagation(); onCopy(); });
    b.addEventListener('mouseenter', () => { if (menu) menu.status.textContent = statusText; });
    b.addEventListener('mouseleave', () => { if (menu) setActive(rowIdx); });
    return b;
  }

  // Element / class / component rows act only through their buttons; Full context and the
  // utility disclosure are whole-row actions.
  function addRow(it) {
    const m = menu, idx = m.rows.length;
    const row = make('div', 'm-row k-' + it.kind);
    const name = make('span', 'm-name');
    const site = siteScopeOk();
    const domain = site ? location.host : '';
    if (it.kind === 'element') {
      name.textContent = 'This element';
      row.append(name, copyButton('Copy context', pageUrl() || 'This element', () => act(it, 'page'),
        settings.includeUrl ? 'Copies this element plus the page URL.' : 'Copies this element.', idx));
    } else if (it.kind === 'class' || it.kind === 'component') {
      const what = it.kind === 'class' ? `.${it.cls}` : `<${it.name}>`;
      if (it.kind === 'component') {
        name.textContent = what;
        name.append(make('span', 'm-sub', it.self ? it.path : `${it.path} · contains this`));
      } else name.textContent = it.text;
      const pageLabel = it.n === 1 ? 'only this' : `${it.n} on this page`;
      const pageStatus = it.n === 1 ? `Copies ${what}; only this element has it here.` : `Copies all ${it.n} ${what} on this page.`;
      row.append(name, copyButton(pageLabel, pageUrl() || 'This page', () => act(it, 'page'), pageStatus, idx));
      if (site) row.append(copyButton('sitewide', location.origin, () => act(it, 'site'), `Copies every ${what} across ${domain}.`, idx));
    } else if (it.kind === 'full') {
      name.textContent = 'Full context';
      name.append(make('span', 'm-sub', 'Size, position, viewport, browser, source, locators, ancestors…'));
      row.append(name);
      row.classList.add('clickable');
      row.addEventListener('click', () => act(it, 'page'));
    } else {
      name.textContent = it.text;
      row.append(name);
      row.classList.add('clickable');
      row.addEventListener('click', () => act(it, 'page'));
    }
    row.addEventListener('mouseenter', () => setActive(idx));
    row.addEventListener('mousedown', (e) => e.preventDefault());   // keeps focus in the filter box
    m.body.append(row);
    m.rows.push({ it, row });
  }

  // Hover state: highlights the row, outlines its matches on the page, and fills the status line.
  function setActive(i) {
    const m = menu;
    if (!m.rows.length) { clearMatches(); m.status.textContent = 'Nothing matches the filter.'; return; }
    m.active = i;
    m.rows.forEach((r, j) => r.row.classList.toggle('on', j === i));
    const { it } = m.rows[i];
    if (it.kind === 'class' || it.kind === 'component') {
      const list = it.list();
      const st = drawMatches(list, m.el);
      const bits = [`${list.length} on this page`, `${st.inView} in view`];
      if (st.above) bits.push(`${st.above} above`);
      if (st.below) bits.push(`${st.below} below`);
      if (st.hidden) bits.push(`${st.hidden} hidden`);
      m.status.textContent = list.length === 1 ? 'Only this element has it on this page.' : bits.join(' · ');
    } else {
      clearMatches();
      m.status.textContent = {
        element: settings.includeUrl ? 'This element, plus the page URL.' : 'This element only.',
        full: 'Copied between start and end tags, marked as page data.',
        disclose: 'Tailwind-style utilities, folded so the named classes stay on top.',
      }[it.kind];
    }
  }

  function act(it, s) {
    const m = menu;
    if (it.kind === 'disclose') { m.expanded = true; renderMenu(); return; }
    const target = m.el;
    closeMenu();
    if (it.kind === 'element') doCopy(target);
    else if (it.kind === 'full') copyFull(target);
    else {
      const text = toGroupRef(it, s);
      const what = it.kind === 'class' ? `.${it.cls}` : `<${it.name}>`;
      const msg = s === 'site' ? `Copied ${what} site-wide`
        : it.n > 1 ? `Copied all ${it.n} ${it.kind === 'class' ? `elements with ${what}` : what}` : `Copied ${what}`;
      copyText(text).then((ok) => (ok ? showToast(msg, text) : copyFailed()));
    }
  }

  // Left of the element by default, then right, below, above; at the pointer when the element
  // covers most of the view. Always clamped; a long list scrolls inside the menu.
  function placeMenu() {
    const m = menu, { w: vw, h: vh } = view(), pad = 8, gap = 10;
    menuEl.style.maxHeight = (vh - 2 * pad) + 'px';
    menuEl.style.left = '0px';
    menuEl.style.top = '0px';
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    const r = m.el.getBoundingClientRect();
    const big = (r.width > vw * 0.55 && r.height > vh * 0.35) || r.height > vh * 0.7;
    const clampX = (x) => Math.max(pad, Math.min(x, vw - mw - pad));
    const clampY = (y) => Math.max(pad, Math.min(y, vh - mh - pad));
    let x, y;
    if (!big && r.left - gap - pad >= mw) { x = r.left - gap - mw; y = clampY(r.top); }
    else if (!big && vw - r.right - gap - pad >= mw) { x = r.right + gap; y = clampY(r.top); }
    else if (!big && vh - r.bottom - gap - pad >= mh) { x = clampX(r.left); y = r.bottom + gap; }
    else if (!big && r.top - gap - pad >= mh) { x = clampX(r.left); y = r.top - gap - mh; }
    else {
      const p = m.point || { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      x = p.x - gap - mw >= pad ? p.x - gap - mw : clampX(p.x + gap);
      y = clampY(p.y - 24);
    }
    menuEl.style.left = Math.round(x) + 'px';
    menuEl.style.top = Math.round(y) + 'px';
  }

  function refreshMenu() {
    if (!menu) return;
    if (!menu.el.isConnected) { closeMenu(); return; }
    drawBox(menu.el);
    placeMenu();
    setActive(menu.active, false);
  }

  // Esc closes the menu; other keys typed into the filter stay away from page shortcuts.
  function menuKey(e) {
    if (e.key === 'Escape') { stopAll(e); closeMenu(); return true; }
    if (fromOverlay(e)) e.stopImmediatePropagation();
    return false;
  }

  /* ------------------------------------------------------------------ clipboard */

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }

  const copyFailed = () => showToast('Copy failed — click the page once, then retry', 'The document needs focus for clipboard access', true);

  /* --------------------------------------------------------------- arm/disarm */

  let armed = false;
  let current = null;
  let lastPoint = { x: 0, y: 0 };

  function arm() {
    if (armed || !settings.enabled) return;
    armed = true;
    ensureOverlay();
    cursorStyle = document.createElement('style');
    cursorStyle.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
    (document.head || document.documentElement).appendChild(cursorStyle);
    const target = elementAt(lastPoint.x, lastPoint.y);
    if (target) { current = target; if (!menu) highlight(target); }
  }

  // The menu outlives the keys: letting go of ⌥ / ⇧ leaves it open.
  function disarm() {
    if (!armed) return;
    armed = false;
    current = null;
    if (!menu) hideHighlight();
    if (cursorStyle) { cursorStyle.remove(); cursorStyle = null; }
  }

  function elementAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === host || hit === document.documentElement) return null;
    if (hit.closest && hit.closest('[data-agent-element-selector]')) return null;
    return hit;
  }

  const fromOverlay = (e) => !!host && e.composedPath().includes(host);

  /* ------------------------------------------------------------------- events */

  async function doCopy(target) {
    let text;
    try {
      text = toInline(collectMinimal(target));
    } catch (err) {
      showToast('Could not read that element', String(err && err.message || err), true);
      return;
    }
    if (await copyText(text)) showToast(settings.includeUrl ? 'Copied element + URL' : 'Copied element', text);
    else copyFailed();
  }

  async function copyFull(target) {
    let data, text;
    try {
      data = collect(target);
      text = toContext(data);
    } catch (err) {
      showToast('Could not read that element', String(err && err.message || err), true);
      return;
    }
    if (!(await copyText(text))) { copyFailed(); return; }
    const kb = (new Blob([text]).size / 1024).toFixed(1);
    const a = data.framework?.astro;
    const src = a?.atx?.file || a?.ownFile || a?.nearestFile;
    showToast('Copied full context', `${data.label} · ${kb} KB${src ? ' · ' + src.split('/').slice(-2).join('/') : ''}`);
  }

  function setFullMode(on) {
    if (on === fullMode) return;
    fullMode = on;
    if (armed && current && !menu) highlight(current);
  }

  window.addEventListener('keydown', (e) => {
    if (menu && menuKey(e)) return;
    if (!settings.enabled) return;
    if (e.key === 'Escape' && armed) { disarm(); return; }
    const wasBoth = armed && fullMode;
    if (e.key === settings.modifier || heldNow(e)) arm();
    setFullMode(fullNow(e));
    // The key press that completes modifier + ⇧ over an element opens the menu there, no click.
    // Pressing it again over a different element moves the menu.
    const completes = !e.repeat && !wasBoth && armed && fullMode && (e.key === settings.modifier || e.key === fullKey());
    if (completes && current && (!menu || current !== menu.el)) openMenu(current, { ...lastPoint });
  }, true);

  window.addEventListener('keyup', (e) => {
    if (e.key === settings.modifier || !heldNow(e)) disarm();
    setFullMode(fullNow(e));
    if (menu && fromOverlay(e)) e.stopImmediatePropagation();
  }, true);
  window.addEventListener('keypress', (e) => { if (menu && fromOverlay(e)) e.stopImmediatePropagation(); }, true);

  window.addEventListener('blur', disarm, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { closeMenu(); disarm(); } });

  window.addEventListener('mousemove', (e) => {
    lastPoint = { x: e.clientX, y: e.clientY };
    if (!settings.enabled) return;
    if (fromOverlay(e)) { if (menu) current = null; return; }   // travelling over the menu: no new target
    fullMode = fullNow(e);
    if (heldNow(e)) {
      if (!armed) arm();
      const target = elementAt(e.clientX, e.clientY);
      if (target) current = target;
      if (target && !menu) highlight(target);
    } else if (armed) disarm();
  }, true);

  window.addEventListener('scroll', () => { if (menu) refreshMenu(); else if (armed && current) highlight(current); }, true);
  window.addEventListener('resize', () => { if (menu) refreshMenu(); else if (armed && current) highlight(current); }, true);

  function stopAll(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function swallow(e) {
    if (!armed) return false;
    stopAll(e);
    return true;
  }

  // A click outside the open menu closes it, and that click never reaches the page.
  let swallowClick = false;
  let swallowTimer = null;

  window.addEventListener('mousedown', (e) => {
    if (fromOverlay(e)) return;   // the menu handles its own clicks
    if (menu) {
      stopAll(e);
      closeMenu();
      swallowClick = true;
      clearTimeout(swallowTimer);
      swallowTimer = setTimeout(() => { swallowClick = false; }, 600);
      return;
    }
    if (!armed || e.button !== 0) return;
    const target = elementAt(e.clientX, e.clientY);
    if (!swallow(e)) return;
    if (!target) return;
    if (fullNow(e)) openMenu(target, { x: e.clientX, y: e.clientY });
    else doCopy(target);
  }, true);

  for (const type of ['mouseup', 'click', 'dblclick', 'auxclick', 'dragstart', 'contextmenu']) {
    window.addEventListener(type, (e) => {
      if (fromOverlay(e)) return;
      if (swallowClick) {
        stopAll(e);
        if (type === 'click' || type === 'auxclick' || type === 'contextmenu') swallowClick = false;
        return;
      }
      swallow(e);
    }, true);
  }

  window.addEventListener('pagehide', () => { closeMenu(); disarm(); });
})();
