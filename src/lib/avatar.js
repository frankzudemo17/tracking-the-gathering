// Profilbilder: im Client quadratisch mittig zuschneiden, 256×256 JPEG (~0,85), hochladen.
import { sb, must, forgetAvatar } from '../supabase.js';

const SIZE = 256;

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* Fallback unten */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

export async function squareJpeg(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('kein Bild');
  const img = await decode(file);
  const w = img.width, h = img.height, s = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, SIZE, SIZE);
  img.close?.();
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.85));
}

/** target: { kind: 'profile' | 'member', id } */
const pathFor = (target) => `${target.kind === 'profile' ? 'profiles' : 'members'}/${target.id}/avatar.jpg`;
const table = (target) => (target.kind === 'profile' ? 'profiles' : 'members');

export async function setAvatar(target, file) {
  const blob = await squareJpeg(file);
  const path = pathFor(target);
  must(await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' }));
  forgetAvatar(path);
  return sb.from(table(target)).update({ avatar_path: path }).eq('id', target.id).select().single().then(must);
}

export async function removeAvatar(target) {
  const path = pathFor(target);
  await sb.storage.from('avatars').remove([path]);
  forgetAvatar(path);
  return sb.from(table(target)).update({ avatar_path: null }).eq('id', target.id).select().single().then(must);
}
