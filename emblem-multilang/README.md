# emblem-multilang

A tiny (about 150 lines, zero dependencies) multi-language helper for browser apps. It adds a language switcher, looks up translated strings, scans the DOM, remembers the visitor's choice, and detects their browser language. No build step, no framework, no `eval`, same-origin only, so it runs under a strict Content-Security-Policy (`script-src 'self'`).

"i18n" is the industry word for this (internationalization); this is just the plain-language version of it.

## Why

Most i18n libraries are large, need a bundler, or pull strings over the network. This is one file you drop in. It is deliberately forgiving: any string you have not translated yet falls back to your base language, and then to the text already on the page, so a half-finished translation never leaves a blank button.

## Use it

```html
<script src="emblem-multilang.js"></script>
<script src="locales.js"></script>   <!-- your string tables, see below -->
<script>
  EmblemLang.init({
    fallback: "en",
    persistKey: "lang",     // remembers the choice in localStorage
    locales: LOCALES        // { en: {...}, es: {...}, "pt-br": {...}, ... }
  });
  EmblemLang.apply();       // translate everything on the page now

  // drop a language switcher wherever you want it
  document.getElementById("lang-slot").appendChild(
    EmblemLang.switcher({ en: "English", es: "Espanol", "pt-br": "Portugues", ja: "日本語" })
  );
</script>
```

Mark up static text with `data-i18n` (and `data-i18n-attr` for attributes):

```html
<h1 data-i18n="home.title">Vault Standoff</h1>
<button data-i18n="buy.cta">Buy in</button>
<input data-i18n-attr="placeholder:form.amount,title:form.amount_hint">
<span data-i18n="pot" data-i18n-vars='{"n":"0"}'>The pot is 0</span>
```

Translate dynamic strings (toasts, status lines) in code:

```js
toast(EmblemLang.t("errors.claim_failed"));
status.textContent = EmblemLang.t("pot", { n: potValue });   // "El bote es 1200"
```

## Your string tables

Flat keys or nested objects both work. Keep one object per language, English first as the base:

```js
window.LOCALES = {
  en: {
    "home.title": "Vault Standoff",
    "buy.cta": "Buy in",
    "pot": "The pot is {n}",
    "errors.claim_failed": "Claim failed, try again"
  },
  es: {
    "home.title": "Duelo de Boveda",
    "buy.cta": "Entrar",
    "pot": "El bote es {n}",
    "errors.claim_failed": "Fallo el reclamo, intentalo de nuevo"
  }
};
```

## API

| Call | What it does |
|------|--------------|
| `EmblemLang.init({locales, fallback, persistKey, locale, detect})` | Set up. Chooses the active language from (in order) an explicit `locale`, the saved choice, the browser, then `fallback`. |
| `EmblemLang.apply(root?)` | Translate every `[data-i18n]` / `[data-i18n-attr]` under `root` (default `document`). Call after you inject new DOM. |
| `EmblemLang.t(key, vars?)` | Return the translated string, interpolating `{vars}`. Falls back to base, then to the key. |
| `EmblemLang.setLocale(code)` | Switch language, persist it, re-scan the DOM, fire `onChange`. |
| `EmblemLang.getLocale()` / `available()` | Current code / list of loaded codes. |
| `EmblemLang.switcher(names?)` | Build a `<select>` language switcher you can append anywhere. |
| `EmblemLang.onChange(fn)` | Register a callback for when the language changes (re-render dynamic bits). |
| `EmblemLang.addLocale(code, table)` | Add a language table at runtime (e.g. lazy-loaded). |
| `EmblemLang.detect()` | The browser-language match, or `null`. |

## Notes

- **Graceful by design:** a missing key shows the base-language string, or the authored page text, never a blank.
- **CSP-safe:** one static same-origin script, no inline code, no network calls. Add its `<script src>` and you are done.
- **Open as you go:** ship English plus one language, add more tables later with `addLocale`; nothing else changes.

MIT. Part of [Emblem-Tools](https://github.com/jakegallen/Emblem-Tools).
