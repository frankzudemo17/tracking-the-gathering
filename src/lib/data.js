// Die eine geteilte Daten-Instanz für Historie/Statistik (Cache über Ansichten hinweg). Naht P13.
// Views lesen nur hierüber (WELLE ttg-ende-statistik, UI-Regel 6). Nicht in Node testbar (importiert supabase.js).
import { sb } from '../supabase.js';
import { createHistoryData } from './history-data.js';
import { pageCache, cacheKey } from './cache.js';
import { state } from '../state.js';

// P12: Gruppen-Daten liegen im einen Speicher der App, je Konto + Gruppe (Entscheid 2/3).
export const groupData = createHistoryData(sb, { cache: pageCache, key: (g) => cacheKey(state.session?.user?.id, g, 'group') });
