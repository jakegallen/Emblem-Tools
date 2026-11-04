# emblem-multilang

Tiny, zero-dependency multi-language (i18n) for browser apps. Add a language switcher, translate your UI, remember the visitor's choice, detect their browser language. No build step, no framework, no `eval`, same-origin only, so it runs under a strict Content-Security-Policy.

"i18n" is the industry word for this; this is the plain-language version.

There are **two engines** in this package. Pick by how your app is built:

| Engine | Use when | How you translate |
|--------|----------|-------------------|
| **`emblem-multilang-auto.js`** (recommended) | You are **adding languages to an existing app** whose UI is already English in the DOM (rendered from templates, `innerHTML`, toasts). | Drop it in, ship catalogs. A `MutationObserver` translates the rendered English automatically. You do **not** wrap strings. |
| `emblem-multilang.js` | A **new app** where you want explicit, key-based control from the start. | Wrap text with `data-i18n` / `EmblemLang.t('key')`. |

Both ship a themed language switcher, `{placeholder}` interpolation, browser-language detect, persisted choice, RTL support, and graceful English fallback (never a blank).

---

## `emblem-multilang-auto.js`  - the drop-in engine (recommended)

The one that powers Vault Standoff's 29 languages. English **is** the source: a catalog maps each English string to its translation, the engine inverts that and translates the rendered English back out of the DOM as the app paints. English is a no-op, so the page is pixel-identical until a visitor picks a language.

### Add it

```html
<span id="langmount"></span>   <!-- where the switcher appears -->

<script>
  window.EMBLEM_MULTILANG_CONFIG = {
    catalogUrl: 'i18n/catalog.{code}.json', // {code} replaced per language
    storageKey: 'app_lang',                 // localStorage key for the choice
    mount: '#langmount'                     // auto-render the switcher here
  };
</script>
<script src="emblem-multilang-auto.js"></script>
```

That is the whole integration for a page that re-renders its own UI.

### Catalogs

`catalog.en.json` is the required base. Each other language mirrors its keys. **The key is the exact English string your app renders; the value is the translation.**

```json
{ "_meta": { "lang": "es" },
  "Buy in": "Entrar",
  "You have {n} new messages": "Tienes {n} mensajes nuevos",
  "Signed in as {name}": "Conectado como {name}" }
```

- `{placeholder}` tokens are preserved and re-filled, so numbers, amounts and names stay dynamic.
- A captured token that is itself a known English UI noun (e.g. a door/route name) is translated inline; the `name` slot is kept verbatim so usernames are never mangled (configurable via `verbatimSlots`).
- Anything with no catalog entry stays English. Never blank.

See `example-auto.html` + `example-catalogs/` for a runnable demo (English, Spanish, Arabic/RTL) that also shows the observer translating a line added **after** load.

### The one integration contract

The observer translates **English to a language**. Once the DOM holds (say) Spanish, switching straight to Arabic needs the English to be re-rendered first. The engine fires an **`emblem-lang-change`** event on every switch for exactly this: have your render loop repaint (most apps already re-render on state changes), or reload. Apps that repaint from English get full switching between any two languages for free.

### Config (all optional)

`catalogUrl` (string with `{code}` or `function(code)`), `storageKey`, `baseLang` (default `en`), `mount`, `languages` (override the built-in 29-language registry), `skipSelectors` (extra subtrees to never translate, on top of inputs / scripts / the switcher / `[data-no-i18n]`), `attrs` (translatable attributes, default `placeholder,title,aria-label`), `verbatimSlots` (template slots kept literal, default `['name']`), `event`, `autoBoot`.

### API (`window.EmblemMultilang`)

`t(key, vars)`, `tr(str)` / `translateText(str)` (translate one rendered string, for toasts/canvas), `translateDocument()`, `setLang(code)`, `getLang()`, `renderLanguageSwitcher(mountEl)`, `ready` (Promise), `fmtNumber`, `fmtCurrency`, `isRtl()`, `languages`, `configure(opts)`, `boot()`.

---

## `emblem-multilang.js`  - the key-based engine

For new apps that want explicit control. Mark text with `data-i18n`, provide one object per language, call `EmblemLang.t('key')` for dynamic strings. See the API table below.

```html
<h1 data-i18n="home.title">Vault Standoff</h1>
<input data-i18n-attr="placeholder:form.amount">
<script src="emblem-multilang.js"></script>
<script>
  EmblemLang.init({ fallback:'en', persistKey:'lang', locales: LOCALES });
  EmblemLang.apply();
  document.getElementById('lang-slot').appendChild(EmblemLang.switcher());
</script>
```

| Call | Does |
|------|------|
| `EmblemLang.init({locales, fallback, persistKey, locale, detect})` | Set up; choose active language. |
| `EmblemLang.apply(root?)` | Translate `[data-i18n]` / `[data-i18n-attr]` under `root`. |
| `EmblemLang.t(key, vars?)` | Translated string with `{var}` interpolation. |
| `EmblemLang.setLocale(code)` | Switch, persist, re-scan, fire `onChange`. |
| `EmblemLang.switcher(names?)` / `onChange(fn)` / `addLocale(code, table)` | Switcher element / change hook / runtime add. |

See `example.html` for the keyed demo.

---

## Notes

- **CSP-safe:** one static same-origin script each, no inline code, no network beyond your own catalogs.
- **Graceful:** a missing key or language shows the base-language string, then the authored text, never a blank.
- **Tests:** `node test.js` (keyed engine), `node test-auto.js` (auto engine core). Both pass.

MIT. Part of [Emblem-Tools](https://github.com/jakegallen/Emblem-Tools).
