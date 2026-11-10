// i18n namespace "live" (en) · belongs to P6 of the wave ttg-live-feinschliff-decks (Live-UI).
// Seam from P3: imported in en.js as `live`; only that package writes here. Keep keys equal in de/en (lint L5).
export default {
  // Connection in game menu → Tools → Live status (below the save status)
  conn: {
    live: 'Live connected', liveSub: 'Changes from other phones show up instantly',
    connecting: 'Connecting', connectingSub: 'Your input still counts',
    offline: 'No live connection', offlineSub: 'Other phones see your input once you are back online',
  },
  join: {
    title: 'Add a phone',
    text: 'Players from the group open the game on their phone from the home screen.',
    share: 'Share link',
    shareText: 'Our running game in Tracking the Gathering',
  },
  ended: {
    title: 'Game has ended',
    finished: 'The game was scored on another phone.',
    aborted: 'The game was discarded on another phone.',
    toStart: 'To home',
  },
  missing: {
    title: 'Game not found',
    text: 'This game no longer exists or belongs to another group.',
    toStart: 'Back to home',
  },
  undoes: 'Takes back: {what}',
  // Home screen "Join game"
  none: 'No game is running in this group right now.',
  pick: { title: 'Choose a running game', meta: 'Round {r} · {min} min' },
};
