// i18n-Namensraum „intro“ (de) · P3 der Welle ttg-features: Spielstart-Intro (src/views/intro.js) und
// Bausteine der automatischen Zeile (src/views/intro-ui.js, Entscheid 9). Eingebunden in de.js unter `intro`.
// Schlüssel in de/en gleich (lint L5). Platzhalter in geschweiften Klammern.
export default {
  label: 'Spielstart',
  skip: 'Überspringen',
  first: 'Beginnt',
  live: 'Spieler {i} von {n}: {name}, {deck}',
  liveNoDeck: 'Spieler {i} von {n}: {name}',
  record: { first: 'Erstes Spiel', won: '{w} von {g} gewonnen' },
  salt: 'Salz',
  bracket: 'Bracket {n}',
  motto: '„{text}“',
  auto: {
    colorless: 'Farblos',
    mono: { W: 'Mono-Weiß', U: 'Mono-Blau', B: 'Mono-Schwarz', R: 'Mono-Rot', G: 'Mono-Grün' },
    multi: { 2: 'Zweifarbig', 3: 'Dreifarbig', 4: 'Vierfarbig', 5: 'Fünffarbig' },
    infinite1: '1 Endlos-Kombo',
    infiniteN: '{n} Endlos-Kombos',
    gc1: '1 Game Changer',
    gcN: '{n} Game Changer',
    // Nachtrag 1: bekannter Typ ⇒ deutscher Plural aus der Tabelle in intro-ui.js ({name}); unbekannt ⇒ Rückfall ({type} englisch)
    tribeKnown: '{name}',
    tribe: 'viele {type}-Kreaturen',
    heavy: 'kreaturenlastig',
    few: 'kaum Kreaturen',
    curve: { low: 'niedrige Manakurve', mid: 'mittlere Manakurve', high: 'hohe Manakurve' },
  },
};
