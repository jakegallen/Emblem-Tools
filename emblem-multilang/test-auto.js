// Node test for emblem-multilang-auto core logic (reverse-index translation:
// exact, {template}, nested-noun, verbatim name). DOM/observer parts are
// browser-tested. Run: node test-auto.js
const path = require('path');

const CATALOGS = {
  en: { "Buy in": "Buy in", "{n} caught": "{n} caught", "{door} was packed": "{door} was packed",
        "Service Shaft": "Service Shaft", "Winner: {name}": "Winner: {name}" },
  es: { "Buy in": "Entrar", "{n} caught": "{n} atrapados", "{door} was packed": "{door} estaba llena",
        "Service Shaft": "Pozo de Servicio", "Winner: {name}": "Ganador: {name}" }
};

// stubs BEFORE require
global.window = global;
global.EMBLEM_MULTILANG_CONFIG = { autoBoot: false, storageKey: 'test_lang' };
global.fetch = (url) => {
  const m = String(url).match(/catalog\.([\w-]+)\.json|\.([\w-]+)\.json|\{code\}/);
  const code = url.includes('en') ? 'en' : url.includes('es') ? 'es' : 'en';
  return Promise.resolve({ ok: !!CATALOGS[code], json: () => Promise.resolve(CATALOGS[code] || {}) });
};
global.navigator = { languages: ['en-US'] };
global.localStorage = (() => { let s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); } }; })();
global.CustomEvent = function (t, o) { this.type = t; this.detail = o && o.detail; };
global.dispatchEvent = () => {};
global.document = {
  documentElement: { setAttribute() {} },
  body: { nodeType: 1 },
  createTreeWalker: () => ({ nextNode: () => null }),
  getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  querySelector: () => null, head: { appendChild() {} },
  addEventListener: () => {}
};

const I = require(path.join(__dirname, 'emblem-multilang-auto.js'));
let fails = 0;
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fails++; };

// override catalogUrl so our fetch stub resolves per code
I.configure({ catalogUrl: (c) => 'catalog.' + c + '.json' });

// prime the base (en) catalog first, as boot() does in real use, then switch to es
I.setLang('en').then(() => I.setLang('es')).then(() => {
  ok('exact string translates (Buy in -> Entrar)', I.translateText('Buy in') === 'Entrar');
  ok('template translates and keeps the number (5 caught -> 5 atrapados)', I.translateText('5 caught') === '5 atrapados');
  ok('nested noun inside a template is localized (Service Shaft)', I.translateText('Service Shaft was packed') === 'Pozo de Servicio estaba llena');
  ok('verbatim {name} slot stays untranslated', I.translateText('Winner: alice.eth') === 'Ganador: alice.eth');
  ok('unknown/dynamic string passes through unchanged', I.translateText('0xABCD 42 points') === '0xABCD 42 points');
  ok('getLang reflects the switch', I.getLang() === 'es');
  ok('isRtl false for es', I.isRtl() === false);
  ok('languages registry present (>=10)', I.languages.length >= 10);

  return I.setLang('en');
}).then(() => {
  ok('base locale is identity (Buy in stays English)', I.translateText('Buy in') === 'Buy in');
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
}).catch(e => { console.log('FAIL threw ' + e.message); process.exit(1); });
