/* Agent Element Selector — content script.
   Hold the modifier key, hover to outline, click to copy agent-ready context. */
(() => {
  if (window.__agentElementSelectorLoaded) return;
  window.__agentElementSelectorLoaded = true;

  /* ---------------------------------------------------------------- settings */

  const DEFAULTS = {
    enabled: true,
    modifier: 'Alt',      // Alt | Control | Meta | Shift
    includeAncestors: true,
    includeText: true,
    textLimit: 500,
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
      if (!settings.enabled) disarm();
    });
  } catch (_) { /* storage unavailable in some contexts */ }

  const MODIFIER_FLAG = { Alt: 'altKey', Control: 'ctrlKey', Meta: 'metaKey', Shift: 'shiftKey' };
  const heldNow = (e) => !!e[MODIFIER_FLAG[settings.modifier] || 'altKey'];

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

  function openTag(el) {
    const attrs = Array.from(el.attributes).map((a) => `${a.name}="${esc(trunc(a.value, 140))}"`);
    const oneLine = `<${el.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    if (oneLine.length <= 110) return oneLine;
    return `<${el.tagName.toLowerCase()}\n  ${attrs.join('\n  ')}\n>`;
  }

  function shortLabel(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = classList(el).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }

  /* ---------------------------------------------- framework / source metadata */

  const DEV_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local|.*\.localhost|.*\.test)$/i;
  const isDevServer = () => DEV_HOSTS.test(location.hostname) || !!location.port;

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
    if (document.querySelector('astro-dev-toolbar, astro-island, [data-astro-cid], [data-astro-source-file]')) out.detected = true;
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

  function specifics(el) {
    const tag = el.tagName.toLowerCase();
    const rows = [];
    const add = (k, v) => { if (v != null && v !== '') rows.push([k, String(v)]); };

    if (tag === 'a') { add('href', el.getAttribute('href')); add('resolved href', el.href); add('target', el.target); }
    if (tag === 'img') {
      add('src', trunc(el.getAttribute('src') || '', 160));
      add('currentSrc', trunc(el.currentSrc || '', 160));
      add('alt', el.alt);
      add('natural size', el.naturalWidth ? `${el.naturalWidth}×${el.naturalHeight}` : null);
      add('loading', el.getAttribute('loading'));
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      add('type', el.type); add('name', el.name); add('placeholder', el.placeholder);
      add('value', trunc(el.value || '', 120)); add('required', el.required || null); add('disabled', el.disabled || null);
    }
    if (tag === 'button') add('type', el.type);
    if (tag === 'svg' || tag === 'use' || tag === 'path') add('svg', 'yes');

    add('role', el.getAttribute('role') || (el.ariaRoleDescription || null));
    add('aria-label', el.getAttribute('aria-label'));
    add('aria-labelledby', el.getAttribute('aria-labelledby'));
    add('aria-hidden', el.getAttribute('aria-hidden'));
    add('title', el.getAttribute('title'));
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

  // Close enough to the accname algorithm for locator purposes.
  function accessibleName(el) {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby.split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || '')
        .join(' ');
      if (squash(text)) return squash(text);
    }
    const label = el.getAttribute('aria-label');
    if (label && squash(label)) return squash(label);
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return squash(el.getAttribute('alt') || '');
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.labels && el.labels.length) return squash(el.labels[0].innerText || '');
      return squash(el.getAttribute('placeholder') || el.getAttribute('title') || '');
    }
    return squash(el.innerText || el.textContent || '');
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

  function locators(el) {
    const role = roleOf(el);
    const name = trunc(accessibleName(el), 80);
    const out = { css: cssPath(el), xpath: xPath(el), role, name: name || null, playwright: [] };
    const q = (s) => `'${String(s).replace(/'/g, "\\'")}'`;

    if (role && name) out.playwright.push(`page.getByRole(${q(role)}, { name: ${q(name)} })`);
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
    if (testid) out.playwright.push(`page.getByTestId(${q(testid)})`);
    if (!role && name) {
      out.playwright.push(name.length <= 60
        ? `page.getByText(${q(name)}, { exact: true })`
        : `page.getByText(${q(trunc(name, 60).replace(/…$/, ''))})`);
    }
    out.playwright.push(`page.locator(${q(out.css)})`);
    return out;
  }

  /* --------------------------------------------------------------- collection */

  function collect(el) {
    const rect = el.getBoundingClientRect();
    const cls = classList(el);
    const data = {
      url: location.href,
      title: document.title,
      when: new Date().toISOString(),
      dev: isDevServer(),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: cls,
      selector: cssPath(el),
      openTag: openTag(el),
      text: settings.includeText ? trunc(squash(el.innerText || el.textContent || ''), settings.textLimit) : '',
      childCount: el.children.length,
      siblingIndex: el.parentElement ? Array.from(el.parentElement.children).indexOf(el) + 1 : null,
      siblingTotal: el.parentElement ? el.parentElement.children.length : null,
      rect,
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      inFrame: window.top !== window.self,
      specifics: specifics(el),
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
          astro: node.getAttribute('data-astro-source-file') || null,
        });
        node = node.parentElement;
        n++;
      }
    }

    return data;
  }

  /* --------------------------------------------------------------- formatting */

  function toMarkdown(d) {
    const L = [];
    const r = d.rect;
    const round = (n) => Math.round(n * 10) / 10;

    L.push(`# Element context — \`${d.selector || d.tag}\``);
    L.push('');
    L.push(`- **URL:** ${d.url}`);
    L.push(`- **Page title:** ${d.title}`);
    L.push(`- **Captured:** ${d.when}${d.dev ? ' (dev server)' : ''}`);
    if (d.inFrame) L.push(`- **Note:** element lives inside an iframe`);
    L.push('');

    const fw = d.framework;
    if (fw) {
      L.push('## Source');
      if (fw.astro) {
        const a = fw.astro;
        if (a.ownFile) L.push(`- **Astro source (this element):** \`${a.ownFile}${a.ownLoc ? ':' + a.ownLoc : ''}\``);
        if (a.nearestFile) L.push(`- **Astro source (nearest ancestor \`${a.nearestEl}\`):** \`${a.nearestFile}${a.nearestLoc ? ':' + a.nearestLoc : ''}\``);
        if (!a.ownFile && !a.nearestFile && a.detected) {
          L.push('- **Astro detected**, but no `data-astro-source-file` on this subtree (build output, or dev toolbar disabled).');
        }
        if (a.island) {
          const i = a.island;
          L.push(`- **Astro island:** \`${i.component}\` from \`${i.url}\``);
          L.push(`  - client directive: \`${i.client || 'n/a'}\`${i.ssr ? ', server-rendered' : ''}`);
          if (i.renderer) L.push(`  - renderer: \`${i.renderer}\``);
          if (i.props && i.props !== '{}') L.push(`  - props: \`${i.props}\``);
        }
        if (a.slot) L.push(`- **Inside Astro slot:** \`${a.slot}\``);
      }
      if (fw.react) L.push(`- **React component:** \`${fw.react.component}\`${fw.react.file ? ` — \`${fw.react.file}\`` : ''}`);
      if (fw.svelte) L.push(`- **Svelte source:** \`${fw.svelte.file}\` (on ${fw.svelte.at})`);
      if (fw.vue) L.push(`- **Vue component:** \`${fw.vue.component || '?'}\`${fw.vue.file ? ` — \`${fw.vue.file}\`` : ''}`);
      if (fw.hints) for (const h of fw.hints) L.push(`- **Marker:** ${h}`);
      L.push('');
    }

    L.push('## How to find this element');
    const loc = d.locators;
    L.push(`- **CSS selector:** \`${loc.css || '(none derivable)'}\``);
    L.push(`- **XPath:** \`${loc.xpath}\``);
    if (loc.role) L.push(`- **ARIA role:** \`${loc.role}\`${loc.name ? ` — accessible name: "${loc.name}"` : ''}`);
    if (loc.playwright.length) {
      L.push('- **Playwright:**');
      L.push('  ```js');
      for (const p of loc.playwright) L.push('  ' + p);
      L.push('  ```');
    }
    L.push('');

    L.push('## Element');
    L.push('```html');
    L.push(d.openTag);
    L.push('```');
    if (d.classes.length) {
      L.push('');
      L.push(`**Classes (${d.classes.length}):** ${d.classes.map((c) => '`' + c + '`').join(' ')}`);
    }
    if (d.specifics.length) {
      L.push('');
      for (const [k, v] of d.specifics) L.push(`- **${k}:** ${v}`);
    }
    L.push('');

    if (d.text) {
      L.push('## Text content');
      L.push('> ' + d.text.replace(/\n/g, '\n> '));
      L.push('');
    }

    L.push('## Position & size');
    L.push(`- **Box:** ${round(r.width)} × ${round(r.height)} px`);
    L.push(`- **Viewport position:** x ${round(r.left)}, y ${round(r.top)} (right ${round(r.right)}, bottom ${round(r.bottom)})`);
    L.push(`- **Document position:** x ${round(r.left + d.scroll.x)}, y ${round(r.top + d.scroll.y)}`);
    L.push(`- **Viewport:** ${d.viewport.w} × ${d.viewport.h} @ ${d.viewport.dpr}x — scrolled to ${d.scroll.x}, ${d.scroll.y}`);
    L.push(`- **Visible in viewport:** ${r.bottom > 0 && r.top < d.viewport.h && r.right > 0 && r.left < d.viewport.w ? 'yes' : 'no'}`);
    if (d.siblingIndex) L.push(`- **Sibling:** ${d.siblingIndex} of ${d.siblingTotal} · ${d.childCount} child element(s)`);
    L.push('');

    if (d.ancestors.length) {
      L.push('## Ancestors (nearest first)');
      d.ancestors.forEach((a, i) => {
        L.push(`${i + 1}. \`${a.label}\`${a.role ? ` (role ${a.role})` : ''} — ${a.size}${a.astro ? ` — \`${a.astro}\`` : ''}`);
      });
      L.push('');
    }

    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* ------------------------------------------------------------------ overlay */

  let host = null, shadow = null, box = null, badge = null, toast = null, cursorStyle = null;

  function ensureOverlay() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-agent-element-selector', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .box {
          position: fixed; box-sizing: border-box; pointer-events: none;
          border: 2px solid #4f8cff; background: rgba(79,140,255,.14);
          border-radius: 2px; transition: all .04s linear; display: none;
        }
        .badge {
          position: fixed; pointer-events: none; display: none;
          font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
          background: #4f8cff; color: #fff; padding: 2px 6px; border-radius: 3px;
          white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
          box-shadow: 0 1px 4px rgba(0,0,0,.3);
        }
        .toast {
          position: fixed; right: 16px; bottom: 16px; pointer-events: none;
          font: 500 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: #12241a; color: #d6ffe6; border: 1px solid #2f7d53;
          padding: 10px 14px; border-radius: 8px; max-width: 380px;
          box-shadow: 0 6px 20px rgba(0,0,0,.35); opacity: 0;
          transform: translateY(6px); transition: opacity .15s ease, transform .15s ease;
        }
        .toast.show { opacity: 1; transform: translateY(0); }
        .toast.err { background: #2a1414; color: #ffd9d9; border-color: #8a3b3b; }
        .toast small { display: block; opacity: .75; font-weight: 400;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 3px; }
      </style>
      <div class="box"></div><div class="badge"></div><div class="toast"></div>`;
    box = shadow.querySelector('.box');
    badge = shadow.querySelector('.badge');
    toast = shadow.querySelector('.toast');
    (document.body || document.documentElement).appendChild(host);
  }

  function highlight(el) {
    ensureOverlay();
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    badge.style.display = 'block';
    badge.textContent = `${shortLabel(el)} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    const above = r.top > 22;
    badge.style.left = Math.max(2, r.left) + 'px';
    badge.style.top = (above ? r.top - 20 : Math.min(r.bottom + 4, window.innerHeight - 22)) + 'px';
  }

  function hideHighlight() {
    if (box) { box.style.display = 'none'; badge.style.display = 'none'; }
  }

  let toastTimer = null;
  function showToast(msg, sub, isError) {
    ensureOverlay();
    toast.className = 'toast show' + (isError ? ' err' : '');
    toast.innerHTML = '';
    toast.append(msg);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      toast.append(s);
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2200);
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
    const el = elementAt(lastPoint.x, lastPoint.y);
    if (el) { current = el; highlight(el); }
  }

  function disarm() {
    if (!armed) return;
    armed = false;
    current = null;
    hideHighlight();
    if (cursorStyle) { cursorStyle.remove(); cursorStyle = null; }
  }

  function elementAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === host || el === document.documentElement) return null;
    if (el.closest && el.closest('[data-agent-element-selector]')) return null;
    return el;
  }

  /* ------------------------------------------------------------------- events */

  async function doCopy(el) {
    let data, md;
    try {
      data = collect(el);
      md = toMarkdown(data);
    } catch (err) {
      showToast('Could not read that element', String(err && err.message || err), true);
      return;
    }
    const ok = await copyText(md);
    if (ok) {
      const kb = (new Blob([md]).size / 1024).toFixed(1);
      const src = data.framework?.astro?.ownFile || data.framework?.astro?.nearestFile;
      showToast('Copied element context', `${shortLabel(el)} · ${kb} KB${src ? ' · ' + src.split('/').slice(-2).join('/') : ''}`);
    } else {
      showToast('Copy failed — click the page once, then retry', 'The document needs focus for clipboard access', true);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (!settings.enabled) return;
    if (e.key === 'Escape' && armed) { disarm(); return; }
    if (e.key === settings.modifier || heldNow(e)) arm();
  }, true);

  window.addEventListener('keyup', (e) => {
    if (e.key === settings.modifier || !heldNow(e)) disarm();
  }, true);

  window.addEventListener('blur', disarm, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) disarm(); });

  window.addEventListener('mousemove', (e) => {
    lastPoint = { x: e.clientX, y: e.clientY };
    if (!settings.enabled) return;
    if (heldNow(e)) {
      if (!armed) arm();
      const el = elementAt(e.clientX, e.clientY);
      if (el && el !== current) { current = el; highlight(el); }
      else if (el) highlight(el);
    } else if (armed) disarm();
  }, true);

  window.addEventListener('scroll', () => { if (armed && current) highlight(current); }, true);
  window.addEventListener('resize', () => { if (armed && current) highlight(current); }, true);

  function swallow(e) {
    if (!armed) return false;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    return true;
  }

  window.addEventListener('mousedown', (e) => {
    if (!armed || e.button !== 0) return;
    const el = elementAt(e.clientX, e.clientY);
    if (!swallow(e)) return;
    if (el) doCopy(el);
  }, true);

  for (const type of ['mouseup', 'click', 'dblclick', 'auxclick', 'dragstart', 'contextmenu']) {
    window.addEventListener(type, swallow, true);
  }

  window.addEventListener('pagehide', disarm);
})();
