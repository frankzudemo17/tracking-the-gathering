// Namen-Probe (P15): 6er-Tisch im Vorschau-Werkzeug, lange Namen und Commander, mehrere Handygrößen, Layouts und Züge.
// Prüft je Feld: Name/Commander (.who) überdeckt weder die Lebenszahl (.lc-big) noch den Mittelknopf (Kreis).
// Kein Konto, keine DB — Spiel, Spieler und Decks werden wie in preview.mjs vorgespielt.
//   node tools/preview/namen-probe.mjs [--root <worktree>] [--bilder <ordner>]   ⇒ Exit 0 (alles frei) / 1 (Treffer)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(opt('--root', path.resolve(HERE, '..', '..')));
const shots = opt('--bilder', null);
const { openPage } = await import(pathToFileURL(path.join(root, 'tools', 'preview', 'preview.mjs')).href);
const { chromium } = await import('playwright');

const GROUP = '22222222-2222-4222-8222-222222222222';
const GAME = '99999999-9999-4999-8999-999999999999';
// Sitz 2 und 5 liegen bei „seiten“ neben dem Mittelknopf (Feld mit dem Knopf oben in der Mitte)
const NAMES = ['Abc', 'Erika Musterfrau', 'Maximilian Muster', 'Jo', 'Wiebke', 'Konstantin Beispiel'];
const CMDS = ['Kotis', 'Rocco, Street Chef', 'Yargle and Multani', 'Atraxa', 'Nashi', 'Zul Ashur, Lich Lord'];
const SIZES = [[393, 852], [375, 667], [360, 640], [412, 915]];
const LAYOUTS = ['seiten', 'rundum', 'unten'];
const TURNS = [0, 2, 5];

const tables = (layout, turn) => ({
  games: [{ id: GAME, playgroup_id: GROUP, session_id: null, status: 'live', layout, starting_life: 40, first_seat: turn, current_turn: turn, round: 1,
    started_at: new Date().toISOString(), ended_at: null, created_by: null }],
  game_players: NAMES.map((_, i) => ({ member_id: `mp-${i}`, deck_id: `dp-${i}`, seat: i, place: null, eliminated_round: null, eliminated_by: null, final_life: null })),
  members: NAMES.map((n, i) => ({ id: `mp-${i}`, display_name: n, avatar_path: null, profile_id: null, playgroup_id: GROUP, role: 'member', created_at: '2026-01-01' })),
  decks: CMDS.map((c, i) => ({ id: `dp-${i}`, short_name: null, commander_name: c, partner_name: null, image_url: null, partner_image_url: null,
    color_identity: ['G'], field_color: null, field_mode: 'art', counter_pins: null })),
  game_events: [],
});

const browser = await chromium.launch(process.env.TTG_CHROMIUM ? { executablePath: process.env.TTG_CHROMIUM } : {});
let bad = 0; let runs = 0;
try {
  for (const layout of LAYOUTS) for (const [w, h] of SIZES) for (const turn of TURNS) {
    const { page, errors, close } = await openPage({ root, look: 'nacht', route: '#/start', browser });
    try {
      await page.setViewportSize({ width: w, height: h });
      const rows = tables(layout, turn);
      await page.route('**/*.supabase.co/rest/v1/**', async (r) => {
        const t = new URL(r.request().url()).pathname.slice('/rest/v1/'.length);
        if (!(t in rows)) return r.fallback();
        const single = (r.request().headers().accept || '').includes('vnd.pgrst.object');
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? rows[t][0] : rows[t]) });
      });
      await page.evaluate((g) => { location.hash = '#/spiel/' + g; }, GAME);
      await page.waitForSelector('.lc-field .lc-big', { timeout: 15000 });
      await page.waitForTimeout(300);
      await page.evaluate(() => document.querySelectorAll('.lc-hub-tip').forEach((n) => n.remove()));
      const found = await page.evaluate(() => {
        const hub = document.querySelector('.lc-hub').getBoundingClientRect();
        const cx = hub.left + hub.width / 2; const cy = hub.top + hub.height / 2; const r = hub.width / 2;
        const out = [];
        for (const f of document.querySelectorAll('.lc-field')) {
          const who = f.querySelector('.who'); const big = f.querySelector('.lc-big');
          const name = who.querySelector('b').textContent;
          for (const line of who.children) {
            const a = line.getBoundingClientRect();
            if (!a.width) continue;
            // Zahl als Ziffernfläche: der Zeilenkasten (line-height .9) ist höher als die Ziffern (Versalhöhe ≈ .72em) —
            // je .09em oben und unten abziehen, in Feldrichtung (bei ±90° gedrehten Feldern ist „oben“ links/rechts).
            const b = big.getBoundingClientRect();
            const m = new DOMMatrix(getComputedStyle(f.querySelector('.lc-inner')).transform);
            const side = Math.abs(m.b) > 0.5;
            const k = 0.09 * parseFloat(getComputedStyle(big).fontSize);
            const g = side ? { l: b.left + k, r: b.right - k, t: b.top, b: b.bottom } : { l: b.left, r: b.right, t: b.top + k, b: b.bottom - k };
            if (a.left < g.r && a.right > g.l && a.top < g.b && a.bottom > g.t) out.push(`${name}: „${line.textContent}“ über der Zahl`);
            const d = Math.hypot(Math.max(a.left, Math.min(cx, a.right)) - cx, Math.max(a.top, Math.min(cy, a.bottom)) - cy);
            if (d < r) out.push(`${name}: „${line.textContent}“ unter dem Mittelknopf`);
          }
        }
        return out;
      });
      runs++;
      const tag = `${layout} ${w}×${h} Zug ${turn}`;
      if (found.length || errors.length) { bad++; console.log(`✗ ${tag}: ${[...found, ...errors].join(' · ')}`); } else console.log(`✓ ${tag}`);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${layout}-${w}x${h}-zug${turn}.png`) }); }
    } finally { await close(); }
  }
} finally { await browser.close(); }
console.log(`namen-probe: ${runs} Tische, ${bad} mit Treffer`);
process.exit(bad ? 1 : 0);
