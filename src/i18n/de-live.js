// i18n-Namensraum „live“ (de) · gehört P6 der Welle ttg-live-feinschliff-decks (Live-UI).
// Naht aus P3: eingebunden in de.js unter `live`; nur dieses Paket schreibt hier. Schlüssel in de/en gleich halten (lint L5).
export default {
  // Verbindung im Spielmenü → Werkzeuge → Live-Status (unter dem Speicherstatus)
  conn: {
    live: 'Live verbunden', liveSub: 'Änderungen anderer Handys erscheinen sofort',
    connecting: 'Verbindung wird aufgebaut', connectingSub: 'Deine Eingaben zählen trotzdem',
    offline: 'Keine Live-Verbindung', offlineSub: 'Andere Handys sehen deine Eingaben, sobald du wieder online bist',
  },
  join: {
    title: 'Handy dazuholen',
    text: 'Mitspieler aus der Gruppe öffnen das Spiel auf ihrem Handy über die Startseite.',
    share: 'Link teilen',
    shareText: 'Unser laufendes Spiel in Tracking the Gathering',
  },
  ended: {
    title: 'Spiel wurde beendet',
    finished: 'Das Spiel wurde auf einem anderen Handy gewertet.',
    aborted: 'Das Spiel wurde auf einem anderen Handy verworfen.',
    toStart: 'Zur Startseite',
  },
  missing: {
    title: 'Spiel nicht gefunden',
    text: 'Dieses Spiel gibt es nicht mehr oder es gehört zu einer anderen Gruppe.',
    toStart: 'Zur Startseite',
  },
  undoes: 'Nimmt zurück: {what}',
  // Startseite „Spiel beitreten“
  none: 'Gerade läuft kein Spiel in dieser Gruppe.',
  pick: { title: 'Laufendes Spiel wählen', meta: 'Runde {r} · {min} min' },
};
