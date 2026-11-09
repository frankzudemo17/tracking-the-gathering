import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.startsWith('__');

export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // PKCE: Links aus Mails kommen als ?code=… zurück, nicht im #-Teil (der gehört dem Router)
        flowType: 'pkce',
        storageKey: 'ttg-auth',
      },
    })
  : null;

/** Ergebnis prüfen und Fehler werfen (mit Original-Meldung für die Übersetzung). */
export function must({ data, error }) {
  if (error) throw error;
  return data;
}

/** Basis-URL der App (für Mail-Links und Einladungslinks), funktioniert auch unter /tracking-the-gathering/ */
export function appUrl(hash = '') {
  const u = new URL(location.href);
  u.search = ''; u.hash = hash;
  return u.toString();
}

// ---------------- Profilbilder (privater Bucket → signierte URLs, gecacht) ----------------
const urlCache = new Map(); // path -> { url, until }
const TTL = 55 * 60 * 1000;

export async function avatarUrls(paths) {
  const want = [...new Set(paths.filter(Boolean))];
  const now = Date.now();
  const missing = want.filter((p) => !(urlCache.get(p)?.until > now));
  if (missing.length && sb) {
    const { data } = await sb.storage.from('avatars').createSignedUrls(missing, 3600);
    for (const row of data || []) if (row.signedUrl && !row.error) urlCache.set(row.path, { url: row.signedUrl, until: now + TTL });
  }
  const out = {};
  for (const p of want) out[p] = urlCache.get(p)?.url || null;
  return out;
}
export const forgetAvatar = (path) => urlCache.delete(path);
