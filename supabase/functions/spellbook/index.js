// Supabase Edge Function `spellbook` (Deno) — dünne Hülle. Logik, Grenzen und Kürzung: ./core.js.
// Kein geheimer Schlüssel nötig (Commander Spellbook ist öffentlich). Deploy macht nur der Dirigent.
import { handle } from './core.js';

Deno.serve(handle);
