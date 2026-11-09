// Gate-Stufe „test“: node --test über tests/unit/**/*.test.mjs und tests/db/**/*.test.mjs.
// Die Dateisuche läuft hier im Skript (nicht über Shell-Globs, die unter cmd.exe nicht
// expandieren); neue Testdateien werden ohne Änderung an package.json erfasst.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, walk, rel } from './util.mjs';

const files = ['unit', 'db'].flatMap((d) => walk(path.join(ROOT, 'tests', d), ['.test.mjs']));
if (files.length === 0) {
  console.error('test: 0 Testdateien gefunden — falscher Pfad? (rot)');
  process.exit(1);
}
console.log(`test: ${files.length} Dateien · ${files.map(rel).join(', ')}`);
const t0 = Date.now();
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: ROOT, stdio: 'inherit' });
console.log(`test: Laufzeit ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(r.status ?? 1);
