// Die eine geteilte Daten-Instanz für Historie/Statistik (Cache über Ansichten hinweg). Naht P13.
// Views lesen nur hierüber (WELLE ttg-ende-statistik, UI-Regel 6). Nicht in Node testbar (importiert supabase.js).
import { sb } from '../supabase.js';
import { createHistoryData } from './history-data.js';

export const groupData = createHistoryData(sb);
