// Escaping ist der XSS-Schutz der App: esc, html, raw, initials aus src/lib/dom.js.
// ($ und mount brauchen ein DOM und werden hier nicht aufgerufen.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, html, raw, initials } from '../../src/lib/dom.js';

test('esc ersetzt & < > " \'', () => {
  assert.equal(esc(`<b a="x">&'`), '&lt;b a=&quot;x&quot;&gt;&amp;&#39;');
});

test('html escaped Werte, raw bleibt unverändert', () => {
  assert.equal(String(html`<p>${'<i>'}${raw('<b>')}</p>`), '<p>&lt;i&gt;<b></p>');
});

test('html: Arrays werden verbunden, false/null fallen weg', () => {
  assert.equal(String(html`${[1, '<']}${false}${null}`), '1&lt;');
});

test('initials: zwei Wörter, ein Wort, leer', () => {
  assert.equal(initials('Franco Test'), 'FT');
  assert.equal(initials('tim'), 'TI');
  assert.equal(initials(''), '?');
});
