// i18n namespace "intro" (en) · P3 of wave ttg-features: game start intro (src/views/intro.js) and the
// pieces of the automatic line (src/views/intro-ui.js, decision 9). Included in en.js under `intro`.
// Keep keys equal to de-intro.js (lint L5). Placeholders in curly braces.
export default {
  label: 'Game start',
  skip: 'Skip',
  first: 'Goes first',
  live: 'Player {i} of {n}: {name}, {deck}',
  liveNoDeck: 'Player {i} of {n}: {name}',
  record: { first: 'First game', won: 'Won {w} of {g}' },
  salt: 'Salt',
  bracket: 'Bracket {n}',
  motto: '“{text}”',
  auto: {
    colorless: 'Colorless',
    mono: { W: 'Mono-white', U: 'Mono-blue', B: 'Mono-black', R: 'Mono-red', G: 'Mono-green' },
    multi: { 2: 'Two-color', 3: 'Three-color', 4: 'Four-color', 5: 'Five-color' },
    infinite1: '1 infinite combo',
    infiniteN: '{n} infinite combos',
    gc1: '1 Game Changer',
    gcN: '{n} Game Changers',
    // English keeps the Scryfall type (no table)
    tribeKnown: '{type} creatures',
    tribe: '{type} creatures',
    heavy: 'creature-heavy',
    few: 'few creatures',
    curve: { low: 'low curve', mid: 'mid curve', high: 'high curve' },
  },
  // P8: group setting "time per player" (src/views/groups.js, admins/superadmin only)
  setting: {
    title: 'Game start intro',
    row: 'Time per player',
    value: '{n} s',
    aria: '{n} seconds',
    shorter: 'Shorter',
    longer: 'Longer',
    hint: 'How long each commander card stays on the table after it lands. The fly-in adds just under a second. Applies to every device in this group; each device can switch the intro on or off under Settings › At the table.',
    save: 'Save',
    saved: 'Saved',
    notAdmin: 'Only group admins can change this.',
    range: 'Allowed: 2 to 10 seconds.',
  },
};
