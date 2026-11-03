// Node test for the pure logic of emblem-i18n (lookup, fallback, interpolation,
// detect). DOM parts (apply/switcher) are browser-tested in the host app.
// Run: node test.js
const path = require("path");

// minimal browser globals the module touches at load / in detect()
global.window = global;
Object.defineProperty(global, "navigator", { value: { languages: ["pt-BR", "en-US"] }, configurable: true, writable: true });
global.document = { documentElement: { setAttribute() {} }, querySelectorAll: () => [] };
global.localStorage = (() => { let s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); } }; })();

const I18n = require(path.join(__dirname, "emblem-multilang.js"));
let fails = 0;
const ok = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); if (!cond) fails++; };

const locales = {
  en: { hi: "Hello", pot: "The pot is {n}", nested: { deep: "Deep EN" }, only_en: "only en" },
  es: { hi: "Hola", pot: "El bote es {n}", nested: { deep: "Profundo ES" } },
  "pt-br": { hi: "Ola" }
};

I18n.init({ locales, fallback: "en", persistKey: "lang", detect: true });
ok("detect picks pt-br from navigator.languages (exact match)", I18n.getLocale() === "pt-br");

I18n.setLocale("es");
ok("setLocale switches current locale", I18n.getLocale() === "es");
ok("t() returns the current-locale string", I18n.t("hi") === "Hola");
ok("t() interpolates {vars}", I18n.t("pot", { n: 7 }) === "El bote es 7");
ok("t() falls back to base locale when key missing in current", I18n.t("only_en") === "only en");
ok("t() supports dotted nested keys", I18n.t("nested.deep") === "Profundo ES");
ok("t() returns the key itself when missing everywhere (never blank)", I18n.t("no.such.key") === "no.such.key");

I18n.setLocale("en");
ok("base locale lookup works", I18n.t("hi") === "Hello");
ok("persistence wrote to localStorage", global.localStorage.getItem("lang") === "en");

ok("available() lists all locales", JSON.stringify(I18n.available().sort()) === JSON.stringify(["en", "es", "pt-br"]));
ok("setLocale rejects an unknown locale", I18n.setLocale("zz") === false && I18n.getLocale() === "en");

// detect base-language fallback (fr-CA -> no fr, falls through to null here)
Object.defineProperty(global, "navigator", { value: { languages: ["de-DE", "es-ES"] }, configurable: true, writable: true });
ok("detect falls back to base language (es from es-ES)", I18n.detect() === "es");

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
