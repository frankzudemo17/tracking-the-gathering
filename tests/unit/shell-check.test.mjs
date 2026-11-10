// Spec P11 Tempo, Kriterium 17: Gate B4 (tools/gate/shell.mjs) — je Regel 1–6 ein Rotfall und der Grünfall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkShell, cssUrls, normalize } from '../../tools/gate/shell.mjs';

const FILES = [
  'index.html', 'manifest.webmanifest', 'sw.js',
  'src/main.js', 'src/views/login.js', 'src/decks/parse.js', 'src/styles/fonts.css',
  'assets/fonts/a.woff2', 'assets/fonts/ko/x/b.woff2', 'assets/icons/apple-touch-icon.png', 'assets/fonts/OFL.txt',
];
const INDEX = ['manifest.webmanifest', 'assets/icons/apple-touch-icon.png', 'src/styles/fonts.css', 'src/main.js', 'https://example.org/x.js', '#top'];
const CSS = [
  { from: 'src/styles/fonts.css', url: '../../assets/fonts/a.woff2' },
  { from: 'src/styles/fonts.css', url: '../../assets/fonts/ko/x/b.woff2' },
  { from: 'src/styles/fonts.css', url: 'data:image/png;base64,AAAA' },
  { from: 'src/styles/fonts.css', url: 'https://cards.scryfall.io/x.jpg?1' },
];
const GOOD = [
  './', './index.html', './manifest.webmanifest', './src/main.js', './src/views/login.js', './src/decks/parse.js',
  './src/styles/fonts.css', './assets/fonts/a.woff2', './assets/fonts/ko/x/b.woff2', './assets/icons/apple-touch-icon.png',
];
const run = (shell, more = {}) => checkShell({
  entries: shell.map((value, i) => ({ value, line: i + 1 })), files: FILES, indexRefs: INDEX, cssRefs: CSS, ...more,
});
const rules = (r) => r.findings.map((f) => f.rule);

test('Grünfall: vollständige SHELL ⇒ 0 Befunde, Zählung je Regel', () => {
  const r = run(GOOD);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.counts, { entries: GOOD.length, src: 4, index: 4, css: 2 });
});

test('Regel 1: Eintrag existiert nicht (genaue Schreibweise)', () => {
  const r = run([...GOOD, './src/views/Login.js']);
  assert.deepEqual(rules(r), [1]);
  assert.match(r.findings[0].msg, /Login\.js/);
  assert.equal(r.findings[0].line, GOOD.length + 1);
});

test('Regel 2: Eintrag doppelt nach Normalisierung (./x = x)', () => {
  const r = run([...GOOD, 'src/main.js']);
  assert.deepEqual(rules(r), [2]);
  assert.equal(normalize('./src/main.js'), normalize('src/main.js'));
});

test('Regel 3: jede Datei unter src/** — eine View und eine Datei aus src/decks/ fehlen', () => {
  const r = run(GOOD.filter((e) => !/views\/login|decks\/parse/.test(e)));
  assert.deepEqual(rules(r), [3, 3]);
  assert.match(r.findings.map((f) => f.msg).join('\n'), /src\/decks\/parse\.js[\s\S]*src\/views\/login\.js/);
});

test('Regel 4: lokaler Verweis aus index.html fehlt (apple-touch-icon); fremde und #-Verweise zählen nicht', () => {
  const r = run(GOOD.filter((e) => !e.includes('apple-touch-icon')));
  assert.deepEqual(rules(r), [4]);
  assert.match(r.findings[0].msg, /assets\/icons\/apple-touch-icon\.png/);
});

test('Regel 5: url() aus CSS relativ zur CSS-Datei (K.O.-Schrift); data: und https: zählen nicht', () => {
  const r = run(GOOD.filter((e) => !e.includes('ko/x/b.woff2')));
  assert.deepEqual(rules(r), [5]);
  assert.match(r.findings[0].msg, /assets\/fonts\/ko\/x\/b\.woff2.*src\/styles\/fonts\.css/);
  assert.deepEqual(cssUrls(`a{b:url("../x.png")} /* url(../kommentar.png) */ c{d:url( '../y.woff2' )} e{f:url(z.svg)}`), ['../x.png', '../y.woff2', 'z.svg']);
});

test('Regel 6: verboten — sw.js selbst, fremde Adresse, Pfad außerhalb der Wurzel', () => {
  const r = run([...GOOD, './sw.js', 'https://esm.sh/x.js', '../draussen.js']);
  assert.deepEqual(rules(r), [6, 6, 6]);
});

test('Nicht Pflicht: *.txt unter assets/ und Dateien außerhalb src/ ohne Verweis', () => {
  const r = run(GOOD);
  assert.ok(!r.findings.some((f) => /OFL\.txt/.test(f.msg)));
});
