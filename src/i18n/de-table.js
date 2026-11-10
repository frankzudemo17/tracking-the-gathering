// i18n-Namensraum „table“ (de) · P7 der Welle ttg-live-feinschliff-decks: Tisch-Einstellungen, Spiel-Standards,
// Bracket-Hinweis im Setup, schlichtes K.O.-Sheet. Eingebunden in de.js unter `table`. Schlüssel in de/en gleich (lint L5).
export default {
  tableTitle: 'Am Tisch',
  gameTitle: 'Spiel-Standards',
  na: 'Auf diesem Gerät nicht verfügbar',
  saveFailed: 'Einstellung nicht gespeichert',
  wake: { title: 'Bildschirm anlassen', sub: 'Während eines Spiels bleibt das Display an' },
  vibration: { title: 'Vibration', sub: 'Beim Würfeln und beim K.O.' },
  motion: {
    title: 'Weniger Bewegung',
    modes: { system: 'System', on: 'An', off: 'Aus' },
    subs: { system: 'Folgt der Einstellung des Geräts', on: 'Würfel und K.O.-Screens ohne Animation', off: 'Immer mit Animation' },
  },
  ko: {
    title: 'K.O.-Screens',
    modes: { all: 'Alle', some: 'Einzelne', off: 'Aus' },
    subs: { all: 'Zufällig eine der drei Varianten', some: 'Nur die ausgewählten Varianten', off: 'Nur eine kurze Abfrage, kein Screen' },
    variants: { A: 'Anime', B: 'Reich der Schatten', C: 'Arcade' },
    last: 'Eine Variante bleibt mindestens an',
  },
  life: { title: 'Startleben', sub: 'Vorauswahl für neue Spiele' },
  layout: { title: 'Tischlayout' },
  pins: { title: 'Standard-Pins', sub: 'Angepinnte Zähler für neu angelegte Decks', tax2: 'Partner-Steuer' },
  turn: { title: 'Zugzeit anzeigen', sub: 'Uhr „Am Zug“ im Lifecounter' },
  hint: {
    spread: 'Brackets {min} und {max} am Tisch — passt das?',
    check: '{deck} prüft als Bracket {n}',
  },
  koQuiet: { title: '{name} scheidet aus?' },
};
