// Release-Check (Spec P11 Tempo, E8): Seit der Service Worker eigene Dateien nur aus dem Versions-Cache
// liefert, erreicht eine Änderung installierte Geräte NUR mit neuer VERSION in sw.js.
// Exit 1, wenn sich zwischen Basis und HEAD eine ausgelieferte Datei geändert hat, VERSION aber gleich blieb.
// Nicht Teil von `npm run build` (Paket-Branches zählen VERSION nicht hoch) — der Merge-Zug ruft es vor dem Push.
//   npm run release-check [-- <basis-ref>]     (Standard: origin/main)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Wird die Datei an Geräte ausgeliefert (und damit von sw.js gecacht)? */
export const shipped = (p) => ['index.html', 'manifest.webmanifest', 'sw.js'].includes(p) || p.startsWith('src/') || p.startsWith('assets/');

/** VERSION aus dem Text von sw.js, sonst null. */
export const versionOf = (text) => (text ?? '').match(/\bconst\s+VERSION\s*=\s*'([^']+)'/)?.[1] ?? null;

/** Reine Prüfung: geänderte Pfade + sw.js an Basis und HEAD ⇒ Befunde (leer = in Ordnung). */
export function releaseFindings({ changed, baseSw, headSw }) {
  const files = changed.filter(shipped);
  if (files.length === 0) return [];
  const a = versionOf(baseSw);
  const b = versionOf(headSw);
  if (!b) return [`sw.js: const VERSION = '…' nicht gefunden — ausgelieferte Dateien geändert: ${files.join(', ')}`];
  if (a === b) return [`VERSION '${b}' unverändert, aber ausgelieferte Dateien geändert: ${files.join(', ')} — VERSION in sw.js und src/version.js hochzählen`];
  return [];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = process.argv[2] || 'origin/main';
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  let changed, baseSw, headSw;
  try {
    changed = git('diff', '--name-only', base, 'HEAD').split('\n').map((s) => s.trim()).filter(Boolean);
    baseSw = git('show', `${base}:sw.js`);
    headSw = git('show', 'HEAD:sw.js');
  } catch (e) {
    console.error(`release-check: git-Fehler (${base}): ${e.message.split('\n')[0]}`);
    process.exit(2);
  }
  const findings = releaseFindings({ changed, baseSw, headSw });
  console.log(`release-check: Basis ${base} · ${changed.length} geänderte Dateien, davon ${changed.filter(shipped).length} ausgeliefert · VERSION ${versionOf(baseSw)} → ${versionOf(headSw)}`);
  for (const f of findings) console.error(`✗ ${f}`);
  process.exit(findings.length ? 1 : 0);
}
