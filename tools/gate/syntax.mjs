// Gate-Stufe „typecheck“: node --check über jede .js/.mjs in src/, tools/, tests/ plus sw.js.
// Kein Build-Schritt, kein TypeScript (CLAUDE.md) — Syntaxprüfung ist der Typecheck dieses Repos.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, walk, rel } from './util.mjs';

const files = [
  ...['src', 'tools', 'tests'].flatMap((d) => walk(path.join(ROOT, d), ['.js', '.mjs'])),
  path.join(ROOT, 'sw.js'),
].filter((f) => fs.existsSync(f));

if (files.length === 0) {
  console.error('typecheck: 0 Dateien gefunden — falscher Pfad? (rot)');
  process.exit(1);
}

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error(`✗ ${rel(f)}\n${(r.stderr || '').trim()}\n`);
  }
}

console.log(`typecheck: ${files.length} Dateien geprüft, ${bad} mit Fehler`);
process.exit(bad ? 1 : 0);
