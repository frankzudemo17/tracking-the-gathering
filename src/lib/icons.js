// Linien-Icons aus Main.dc.html → icons()
import { raw } from './dom.js';

export const I = {
  home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  play: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3M12 7l4.5 8h-9L12 7',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M10 17h4v4h-4z',
  user: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8M4 21a8 8 0 0 1 16 0',
  back: 'M15 5l-7 7 7 7', chevDown: 'M6 9l6 6 6-6', chevRight: 'M9 6l6 6-6 6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5a1 1 0 1 0 0 .01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  camera: 'M4 7h3l2-3h6l2 3h3v12H4V7M12 17a4 4 0 1 0 0-8a4 4 0 1 0 0 8',
  copy: 'M9 9h11v11H9V9M5 15H4V4h11v1',
  live: 'M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v.01M12 16v4',
  plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5 9-10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  key: 'M15 7a4 4 0 1 0 0 .01M12.2 9.8L4 18v3h3v-2h2v-2h2l1.8-1.8',
  edit: 'M4 20h4L19 9l-4-4L4 16v4M14 6l4 4',
  users: 'M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 7',
};

export function icon(name, size = 20, sw = 2, extra = '') {
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}><path d="${I[name]}"></path></svg>`);
}
