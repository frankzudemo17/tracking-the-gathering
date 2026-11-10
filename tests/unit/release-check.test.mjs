// Spec P11 Tempo, Kriterium 18: release-check — geänderte ausgelieferte Datei ohne neue VERSION ⇒ Befund.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseFindings, versionOf, shipped } from '../../tools/release-check.mjs';

const SW = (v) => `// Kopf\nconst VERSION = '${v}';\nconst URGENT = false;\n`;

test('geänderte src/…-Datei + gleiche VERSION ⇒ Befund', () => {
  const f = releaseFindings({ changed: ['src/views/start.js', 'tests/unit/x.test.mjs'], baseSw: SW('ttg-v27'), headSw: SW('ttg-v27') });
  assert.equal(f.length, 1);
  assert.match(f[0], /src\/views\/start\.js/);
  assert.match(f[0], /ttg-v27/);
});

test('geänderte src/…-Datei + andere VERSION ⇒ kein Befund', () => {
  assert.deepEqual(releaseFindings({ changed: ['src/views/start.js', 'sw.js', 'src/version.js'], baseSw: SW('ttg-v27'), headSw: SW('ttg-v28') }), []);
});

test('nur tests/… oder tools/… geändert ⇒ kein Befund', () => {
  assert.deepEqual(releaseFindings({ changed: ['tests/unit/a.test.mjs', 'tools/gate/shell.mjs', 'package.json', 'HANDOFF.md'], baseSw: SW('ttg-v27'), headSw: SW('ttg-v27') }), []);
});

test('jede ausgelieferte Datei zählt: index.html, manifest, sw.js, src/**, assets/**', () => {
  for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'src/a/b.css', 'assets/icons/x.png']) assert.equal(shipped(p), true, p);
  for (const p of ['tests/sw/run.mjs', 'tools/serve.mjs', 'supabase/migrations/x.sql', 'README.md', 'srcx/a.js']) assert.equal(shipped(p), false, p);
  const f = releaseFindings({ changed: ['index.html', 'assets/icons/x.png'], baseSw: SW('ttg-v27'), headSw: SW('ttg-v27') });
  assert.equal(f.length, 1);
  assert.match(f[0], /index\.html.*assets\/icons\/x\.png/s);
});

test('VERSION fehlt in sw.js ⇒ Befund statt stiller Freigabe', () => {
  assert.equal(versionOf('const X = 1;'), null);
  assert.equal(releaseFindings({ changed: ['src/a.js'], baseSw: SW('ttg-v27'), headSw: 'kaputt' }).length, 1);
});
