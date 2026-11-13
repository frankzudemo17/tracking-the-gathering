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
  // P8: Gruppen-Einstellung „Zeit je Spieler“ (src/views/groups.js, nur Admins/Superadmin)
  setting: {
    title: 'Spielstart-Intro',
    row: 'Zeit je Spieler',
    value: '{n} s',
    aria: '{n} Sekunden',
    shorter: 'Kürzer',
    longer: 'Länger',
    hint: 'So lange bleibt jede Commander-Karte liegen, nachdem sie gelandet ist. Der Anflug dauert knapp eine Sekunde zusätzlich. Gilt für alle Geräte der Gruppe; an- und ausschalten lässt sich das Intro je Gerät unter Einstellungen › Am Tisch.',
    save: 'Speichern',
    saved: 'Gespeichert',
    notAdmin: 'Nur Admins der Gruppe können das ändern.',
    range: 'Erlaubt sind 2 bis 10 Sekunden.',
  },
};
