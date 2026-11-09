**Konvention:** Unit-Tests nur für Module, die `src/supabase.js` nicht (auch nicht indirekt) importieren —
dessen https-Import von esm.sh ist in Node nicht ladbar. Reine Logik (`src/lib/dom.js`, später `src/game/*`) ist testbar.
Neue Dateien `tests/unit/<thema>.test.mjs` bzw. `tests/db/<thema>.test.mjs` erfasst `npm run test` automatisch.
DB-Tests nutzen `tests/db/harness.mjs` (`freshDb()` + `tools(db)`), eine PGlite-Instanz je Datei, kein Netz.

# Tests

| Ordner | Inhalt |
|---|---|
| `tests/unit/` | `node:test`-Fälle für reine Module (ohne DOM, ohne Netz) |
| `tests/db/` | Migrationen gegen PGlite mit Supabase-Attrappe: Schema, RLS, RPCs, Storage |

Lauf: `npm run test` (alle) oder `node --test tests/unit/dom.test.mjs` (eine Datei).
