/*! emblem-multilang-auto - drop-in, zero-dependency multi-language (i18n) for existing apps.
 *  MIT. Part of Emblem-Tools (https://github.com/jakegallen/Emblem-Tools).
 *
 *  WHY THIS ONE: most of your UI is already English in the DOM (rendered from
 *  templates, innerHTML, toasts, canvas). Instead of hand-wrapping every string,
 *  this engine keeps a catalog that maps each English string to its translation,
 *  then a MutationObserver translates the rendered English back out of the DOM as
 *  the app paints. You drop it in, ship catalogs, add a switcher: done. English is
 *  a no-op (identity), so the page is pixel-identical until a visitor picks a
 *  language. It handles {placeholder} templates, nested noun translation, RTL,
 *  Intl number/currency, browser-language detect, and a persisted choice.
 *
 *  This is the "retrofit an existing app" engine. For a brand-new app where you
 *  want explicit key-based control, see emblem-multilang.js in this same folder.
 *
 *  QUICK START (configure BEFORE this script loads, or call EmblemMultilang.configure):
 *    <script>
 *      window.EMBLEM_MULTILANG_CONFIG = {
 *        catalogUrl: 'i18n/catalog.{code}.json', // {code} is replaced per language
 *        storageKey: 'app_lang',                 // localStorage key for the choice
 *        mount: '#langmount'                     // where to auto-render the switcher
 *      };
 *    </script>
 *    <script src="emblem-multilang-auto.js"></script>
 *
 *  Catalog format (catalog.en.json is the required base; others mirror its keys):
 *    { "_meta": {"lang":"es"},
 *      "Buy in": "Entrar",
 *      "The pot is {n}": "El bote es {n}",
 *      "{n} caught": "{n} atrapados" }
 *  The KEY is the exact English string your app renders; the VALUE is the
 *  translation. Anything with no catalog entry stays English (never blank).
 *
 *  Global surface (window.EmblemMultilang): t, tr/translateText, translateDocument,
 *  setLang, getLang, renderLanguageSwitcher, ready (Promise), fmtNumber, fmtCurrency,
 *  isRtl, languages, configure, boot.
 */
(function (global) {
  'use strict';

  var CFG = global.EMBLEM_MULTILANG_CONFIG || {};

  // --- registry of selectable languages. Ship a catalog.<code>.json for each one
  //     you want lit up in the switcher. English is the base/fallback. Override the
  //     whole list via config.languages. ---------------------------------------
  var LANGUAGES = CFG.languages || [
    { code: 'en',    name: 'English',    flag: '🇬🇧' },
    { code: 'es',    name: 'Español',    flag: '🇪🇸' },
    { code: 'fr',    name: 'Français',   flag: '🇫🇷' },
    { code: 'de',    name: 'Deutsch',    flag: '🇩🇪' },
    { code: 'it',    name: 'Italiano',   flag: '🇮🇹' },
    { code: 'nl',    name: 'Nederlands', flag: '🇳🇱' },
    { code: 'pl',    name: 'Polski',     flag: '🇵🇱' },
    { code: 'pt-BR', name: 'Português',  flag: '🇧🇷' },
    { code: 'ru',    name: 'Русский',    flag: '🇷🇺' },
    { code: 'uk',    name: 'Українська', flag: '🇺🇦' },
    { code: 'tr',    name: 'Türkçe',     flag: '🇹🇷' },
    { code: 'ar',    name: 'العربية',    flag: '🇸🇦', rtl: true },
    { code: 'fa',    name: 'فارسی',      flag: '🇮🇷', rtl: true },
    { code: 'ur',    name: 'اردو',       flag: '🇵🇰', rtl: true },
    { code: 'hi',    name: 'हिन्दी',       flag: '🇮🇳' },
    { code: 'bn',    name: 'বাংলা',       flag: '🇧🇩' },
    { code: 'ne',    name: 'नेपाली',       flag: '🇳🇵' },
    { code: 'ta',    name: 'தமிழ்',       flag: '🇮🇳' },
    { code: 'th',    name: 'ไทย',        flag: '🇹🇭' },
    { code: 'km',    name: 'ខ្មែរ',        flag: '🇰🇭' },
    { code: 'my',    name: 'မြန်မာ',      flag: '🇲🇲' },
    { code: 'vi',    name: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'id',    name: 'Indonesia',  flag: '🇮🇩' },
    { code: 'ms',    name: 'Melayu',     flag: '🇲🇾' },
    { code: 'tl',    name: 'Tagalog',    flag: '🇵🇭' },
    { code: 'zh-CN', name: '简体中文',    flag: '🇨🇳' },
    { code: 'zh-TW', name: '繁體中文',    flag: '🇹🇼' },
    { code: 'ja',    name: '日本語',      flag: '🇯🇵' },
    { code: 'ko',    name: '한국어',      flag: '🇰🇷' }
  ];
  var RTL_CODES = { ar: 1, he: 1, fa: 1, ur: 1, ps: 1, sd: 1, yi: 1 };

  var LS_KEY = CFG.storageKey || 'emblem_lang';
  var BASE = CFG.baseLang || 'en';
  var EVENT = CFG.event || 'emblem-lang-change';
  // catalogUrl: a function(code)->url, or a string pattern containing {code}.
  var urlPattern = CFG.catalogUrl || 'i18n/catalog.{code}.json';
  function catalogUrl(code) {
    return (typeof urlPattern === 'function') ? urlPattern(code) : String(urlPattern).replace('{code}', code);
  }

  var catalogs = {};
  var current = BASE;
  var _readyResolve;
  var ready = new Promise(function (res) { _readyResolve = res; });

  function isSupported(code) {
    for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i].code === code) return true;
    return false;
  }

  // Resolve a browser BCP-47 tag (e.g. "pt-BR", "zh-Hant-TW", "en-US") to a
  // supported catalog code: full tag, then region-aware variants, then primary.
  function resolveTag(tag) {
    var raw = String(tag || '').trim();
    if (!raw) return null;
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i].code.toLowerCase() === raw.toLowerCase()) return LANGUAGES[i].code;
    }
    var parts = raw.toLowerCase().split('-');
    var primary = parts[0];
    var region = parts[parts.length - 1];
    var script = parts.length > 1 ? parts[1] : '';
    if (primary === 'pt' && isSupported('pt-BR')) return 'pt-BR';
    if (primary === 'zh') {
      if ((script === 'hant' || region === 'tw' || region === 'hk' || region === 'mo') && isSupported('zh-TW')) return 'zh-TW';
      if (isSupported('zh-CN')) return 'zh-CN';
    }
    if (isSupported(primary)) return primary;
    return null;
  }

  function detectLang() {
    try { var saved = localStorage.getItem(LS_KEY); if (saved && isSupported(saved)) return saved; } catch (e) {}
    try {
      var list = navigator.languages && navigator.languages.length
        ? navigator.languages : [navigator.language || navigator.userLanguage || BASE];
      for (var i = 0; i < list.length; i++) { var r = resolveTag(list[i]); if (r) return r; }
    } catch (e) {}
    return BASE;
  }

  function isRtl(code) { return !!RTL_CODES[code]; }

  function loadCatalog(code) {
    if (catalogs[code]) return Promise.resolve(catalogs[code]);
    return fetch(catalogUrl(code))
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (json) { catalogs[code] = json || {}; return catalogs[code]; })
      .catch(function () { catalogs[code] = {}; return catalogs[code]; });
  }

  function interpolate(str, vars) {
    if (!vars || str.indexOf('{') === -1) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      if (vars[k] == null) return m;
      var v = vars[k];
      return (typeof v === 'number') ? fmtNumber(v) : String(v);
    });
  }

  // Key lookup: current catalog -> base catalog -> the raw key (visible, not blank).
  function t(key, vars) {
    var cur = catalogs[current], en = catalogs[BASE];
    var str = (cur && cur[key] != null) ? cur[key] : (en && en[key] != null) ? en[key] : key;
    return interpolate(str, vars);
  }

  function localeTag() {
    var meta = activeMeta();
    return (meta && meta.locale) || current || BASE;
  }
  function fmtNumber(n, opts) {
    try { return new Intl.NumberFormat(localeTag(), opts).format(n); } catch (e) { return String(n); }
  }
  function fmtCurrency(amount, ccy) {
    ccy = ccy || 'USD';
    try {
      return new Intl.NumberFormat(localeTag(), { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(amount);
    } catch (e) { return '$' + amount; }
  }

  /* ==========================================================================
     DOM TRANSLATION LAYER
     English IS the source. catalog.en.json maps each English string to its
     translation. We invert that into an exact map (plain strings) + regex
     templates (interpolated strings, e.g. "{n} caught" -> /^(.+?) caught$/),
     then a MutationObserver translates freshly-rendered text nodes + the
     placeholder/title/aria-label attributes to the active language. en is a
     no-op. Skipped: user content and inputs (configurable), our own switcher,
     and anything marked [data-no-i18n].
     ======================================================================== */
  var _exactMap = null, _templates = null, _revBuiltFor = null, _observer = null, _applyScheduled = false;

  function compileTemplate(enStr) {
    var slots = [], re = '^', rest = enStr, m, tokenRe = /\{(\w+)\}/;
    while ((m = tokenRe.exec(rest)) !== null) {
      re += rest.slice(0, m.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      slots.push(m[1]); re += '([\\s\\S]*?)';
      rest = rest.slice(m.index + m[0].length);
    }
    re += rest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
    return { re: new RegExp(re), slots: slots };
  }

  function buildReverseIndex(code) {
    _exactMap = {}; _templates = [];
    var en = catalogs[BASE] || {}, tgt = catalogs[code] || {};
    for (var key in en) {
      if (key === '_meta' || !en.hasOwnProperty(key)) continue;
      var enStr = en[key];
      if (typeof enStr !== 'string' || !enStr) continue;
      var out = (tgt[key] != null) ? tgt[key] : enStr;
      if (enStr.indexOf('{') === -1) {
        if (_exactMap[enStr] == null) _exactMap[enStr] = out;
      } else {
        var c = compileTemplate(enStr);
        _templates.push({ re: c.re, slots: c.slots, tpl: out, enTpl: enStr, len: enStr.length });
      }
    }
    _templates.sort(function (a, b) { return b.len - a.len; });  // longest (most specific) first
    _revBuiltFor = code;
  }

  // The 'name' slot is excluded from nested-noun translation so usernames stay verbatim.
  // Override which slots are treated as verbatim via config.verbatimSlots.
  var VERBATIM = {}; (CFG.verbatimSlots || ['name']).forEach(function (s) { VERBATIM[s] = 1; });

  function translateText(str) {
    if (current === BASE || typeof str !== 'string') return str;
    if (_revBuiltFor !== current) buildReverseIndex(current);
    if (_exactMap[str] != null) return _exactMap[str];
    var trimmed = str.replace(/^\s+|\s+$/g, '');
    if (trimmed !== str && _exactMap[trimmed] != null) return str.replace(trimmed, _exactMap[trimmed]);
    for (var i = 0; i < _templates.length; i++) {
      var tpl = _templates[i], mm = tpl.re.exec(str);
      if (!mm) continue;
      var vars = {};
      for (var j = 0; j < tpl.slots.length; j++) {
        var slotName = tpl.slots[j], cap = mm[j + 1];
        if (!VERBATIM[slotName] && cap != null && _exactMap[cap] != null) cap = _exactMap[cap];
        vars[slotName] = cap;
      }
      return tpl.tpl.replace(/\{(\w+)\}/g, function (w, k) { return (vars[k] != null) ? vars[k] : w; });
    }
    return str;
  }
  function tr(str) { try { return translateText(str); } catch (e) { return str; } }

  var SKIP_SEL = 'input, textarea, select, script, style, code, .emlang, [data-no-i18n]'
    + (CFG.skipSelectors ? (', ' + CFG.skipSelectors) : '');
  function inSkip(node) {
    var el = (node.nodeType === 3) ? node.parentNode : node;
    if (!el || !el.closest) return false;
    try { return !!el.closest(SKIP_SEL); } catch (e) { return false; }
  }

  var ATTRS = CFG.attrs || ['placeholder', 'title', 'aria-label'];

  function translateTextNode(tn) {
    if (!tn || tn.nodeType !== 3) return;
    var v = tn.nodeValue;
    if (!v || !/\S/.test(v) || inSkip(tn)) return;
    var out = translateText(v);
    if (out !== v) tn.nodeValue = out;
  }
  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || inSkip(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (el.hasAttribute && el.hasAttribute(a)) {
        var v = el.getAttribute(a), out = translateText(v);
        if (out !== v) el.setAttribute(a, out);
      }
    }
  }
  function translateSubtree(root) {
    if (current === BASE || !root) return;
    try {
      if (root.nodeType === 3) { translateTextNode(root); return; }
      if (root.nodeType !== 1 || inSkip(root)) return;
      translateAttrs(root);
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false), n;
      while ((n = walker.nextNode())) { if (n.nodeType === 3) translateTextNode(n); else translateAttrs(n); }
    } catch (e) {}
  }
  function translateDocument() { if (current !== BASE) translateSubtree(document.body); }

  function startObserver() {
    if (_observer || typeof MutationObserver === 'undefined') return;
    _observer = new MutationObserver(function (muts) {
      if (current === BASE) return;
      for (var i = 0; i < muts.length; i++) {
        var mu = muts[i];
        if (mu.type === 'childList' && mu.addedNodes && mu.addedNodes.length) {
          for (var j = 0; j < mu.addedNodes.length; j++) translateSubtree(mu.addedNodes[j]);
        } else if (mu.type === 'characterData') { translateTextNode(mu.target); }
        else if (mu.type === 'attributes') { translateAttrs(mu.target); }
      }
    });
    try { _observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); } catch (e) {}
  }

  function applyToDocument() {
    try {
      document.documentElement.setAttribute('lang', current);
      document.documentElement.setAttribute('dir', isRtl(current) ? 'rtl' : 'ltr');
    } catch (e) {}
    if (current !== BASE && _revBuiltFor !== current) { try { buildReverseIndex(current); } catch (e) {} }
    try { translateDocument(); } catch (e) {}
    try { global.dispatchEvent(new CustomEvent(EVENT, { detail: { lang: current } })); }
    catch (e) { try { var ev = document.createEvent('Event'); ev.initEvent(EVENT, true, true); global.dispatchEvent(ev); } catch (_) {} }
  }

  function setLang(code) {
    if (!isSupported(code)) code = BASE;
    return loadCatalog(code).then(function () {
      current = code;
      try { localStorage.setItem(LS_KEY, code); } catch (e) {}
      applyToDocument();
      try { paintSwitchers(); } catch (e) {}
      return code;
    });
  }
  function getLang() { return current; }

  // --- compact language dropdown. Themed with CSS custom properties (with plain
  //     fallbacks) so it inherits your app's look; a native <select> under a shell
  //     keeps it accessible and mobile-friendly. No external CSS. ---------------
  var _switchers = [];
  function injectSwitcherCss() {
    if (document.getElementById('emlang-css')) return;
    var st = document.createElement('style'); st.id = 'emlang-css';
    st.textContent = ''
      + '.emlang{position:relative;display:inline-flex;align-items:center}'
      + '.emlang .emlang-shell{display:inline-flex;align-items:center;gap:6px;'
      +   'border:2px solid var(--eml-border,var(--ink,#17130d));border-radius:10px;'
      +   'background:var(--eml-bg,var(--card,#fbfaf6));color:var(--eml-fg,var(--ink,#17130d));'
      +   'font-family:var(--eml-font,var(--font-ui,Inter,system-ui,sans-serif));'
      +   'font-size:15px;padding:0 8px;height:40px;cursor:pointer;transition:transform .14s,box-shadow .14s}'
      + '.emlang .emlang-shell:hover{transform:translate(-1px,-1px)}'
      + '.emlang .emlang-flag{font-size:17px;line-height:1}'
      + '.emlang .emlang-code{letter-spacing:.4px;text-transform:uppercase;font-size:14px}'
      + '.emlang .emlang-caret{font-size:10px;opacity:.55}'
      + '.emlang select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;font-size:16px}'
      + '@media(max-width:560px){.emlang .emlang-shell{height:38px;font-size:14px;padding:0 7px}}'
      + '[dir=rtl] .emlang .emlang-shell{flex-direction:row-reverse}';
    document.head.appendChild(st);
  }
  function activeMeta() {
    for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i].code === current) return LANGUAGES[i];
    return LANGUAGES[0];
  }
  function paintSwitchers() {
    var meta = activeMeta();
    _switchers.forEach(function (root) {
      var flag = root.querySelector('.emlang-flag'), code = root.querySelector('.emlang-code'), sel = root.querySelector('select');
      if (flag) flag.textContent = meta.flag || '🌐';
      if (code) code.textContent = (meta.code || BASE).toUpperCase();
      if (sel && sel.value !== current) sel.value = current;
    });
  }
  function renderLanguageSwitcher(mountEl) {
    injectSwitcherCss();
    var host = (typeof mountEl === 'string') ? document.querySelector(mountEl) : mountEl;
    if (!host) return null;
    var root = host.querySelector(':scope > .emlang') || null;
    if (!root) {
      root = document.createElement('div'); root.className = 'emlang';
      var opts = LANGUAGES.map(function (l) { return '<option value="' + l.code + '">' + (l.flag || '') + ' ' + l.name + '</option>'; }).join('');
      root.innerHTML = '<span class="emlang-shell" aria-hidden="true"><span class="emlang-flag">🌐</span>'
        + '<span class="emlang-code">' + BASE.toUpperCase() + '</span><span class="emlang-caret">▾</span></span>'
        + '<select aria-label="Language">' + opts + '</select>';
      host.appendChild(root);
      root.querySelector('select').addEventListener('change', function () { setLang(this.value); });
      _switchers.push(root);
    }
    paintSwitchers();
    return root;
  }

  function boot() {
    var want = detectLang();
    Promise.all([loadCatalog(BASE), want !== BASE ? loadCatalog(want) : Promise.resolve()]).then(function () {
      current = want;
      if (current !== BASE) { try { buildReverseIndex(current); } catch (e) {} }
      var begin = function () {
        try { startObserver(); } catch (e) {}
        applyToDocument();
        if (CFG.mount) { try { renderLanguageSwitcher(CFG.mount); } catch (e) {} }
        _readyResolve(current);
      };
      if (document.body) begin();
      else document.addEventListener('DOMContentLoaded', begin, { once: true });
    });
  }

  function configure(opts) {
    opts = opts || {};
    if (opts.languages) LANGUAGES = opts.languages;
    if (opts.storageKey) LS_KEY = opts.storageKey;
    if (opts.baseLang) BASE = opts.baseLang;
    if (opts.event) EVENT = opts.event;
    if (opts.catalogUrl) urlPattern = opts.catalogUrl;
    if (opts.verbatimSlots) { VERBATIM = {}; opts.verbatimSlots.forEach(function (s) { VERBATIM[s] = 1; }); }
    return API;
  }

  var API = {
    t: t, tr: tr, translateText: translateText, translateDocument: translateDocument,
    setLang: setLang, getLang: getLang, renderLanguageSwitcher: renderLanguageSwitcher,
    ready: ready, fmtNumber: fmtNumber, fmtCurrency: fmtCurrency,
    isRtl: function () { return isRtl(current); }, languages: LANGUAGES.slice(),
    configure: configure, boot: boot
  };
  global.EmblemMultilang = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  // Auto-boot unless told not to (set EMBLEM_MULTILANG_CONFIG.autoBoot = false to
  // configure() first and boot() yourself).
  if (CFG.autoBoot !== false) boot();
})(typeof window !== 'undefined' ? window : this);
