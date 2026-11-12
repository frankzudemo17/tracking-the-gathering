// i18n namespace "table" (en) · P7 of the wave ttg-live-feinschliff-decks: table settings, game defaults,
// bracket hint in setup, plain K.O. sheet. Imported in en.js as `table`. Keep keys equal in de/en (lint L5).
export default {
  tableTitle: 'At the table',
  gameTitle: 'Game defaults',
  na: 'Not available on this device',
  saveFailed: 'Setting not saved',
  wake: { title: 'Keep screen on', sub: 'The display stays on during a game' },
  vibration: { title: 'Vibration', sub: 'When rolling dice and on K.O.' },
  motion: {
    title: 'Reduce motion',
    modes: { system: 'System', on: 'On', off: 'Off' },
    subs: { system: 'Follows the device setting', on: 'Dice and K.O. screens without animation', off: 'Always animated' },
  },
  ko: {
    title: 'K.O. screens',
    modes: { all: 'All', some: 'Some', off: 'Off' },
    subs: { all: 'One of the three variants at random', some: 'Only the selected variants', off: 'Just a short prompt, no screen' },
    variants: { A: 'Anime', B: 'Realm of Shadows', C: 'Arcade' },
    last: 'At least one variant stays on',
  },
  life: { title: 'Starting life', sub: 'Preselected for new games' },
  layout: { title: 'Table layout' },
  pins: { title: 'Default pins', sub: 'Pinned counters for newly added decks', tax2: 'Partner tax' },
  turn: { title: 'Show turn time', sub: '“Your turn” clock in the life counter' },
  hint: {
    spread: 'Brackets {min} and {max} at the table — is that okay?',
    check: '{deck} checks as bracket {n}',
  },
  koQuiet: { title: 'Is {name} out?' },
  intro: { title: 'Intro at game start', sub: 'Briefly introduces every deck before the first turn' }, // P3 wave ttg-features
};
