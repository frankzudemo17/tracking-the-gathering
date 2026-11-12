// i18n-Namensraum „stats“ (de) · Besitzer: P18 (Profil- + Deck-Statistik).
// Naht aus P13: eingebunden in de.js unter `stats`; nur dieses Paket schreibt hier. Schlüssel in de/en gleich halten (lint L5).
export default {
  winRate: 'Siegquote',
  loadError: 'Statistik konnte gerade nicht geladen werden.',
  games1: '1 Spiel', gamesN: '{n} Spiele',
  deckLine: '{games} · {rate} Siege',
  winRateLine: '{v} Siegquote',
  ofFive: '{v} von 5',
  // Profil
  mood: 'Stimmung', avgSalt: 'Ø Salz', avgFun: 'Ø Spaß', avgDeck: 'Ø Deck-Bewertung',
  saltTrend: 'Salz-Verlauf', saltTrendHint: 'Eigenes Salz, letzte {n} bewertete Spiele · 1 = entspannt, 5 = sehr salzig',
  saltTrendLabel: 'Salz-Werte, älteste zuerst: {list}',
  pointsTrend: 'Punkte-Verlauf', pointsHint: 'Punkte gesamt nach {n} Spielen', pointsLabel: 'Punkte-Verlauf über {n} Spiele, zuletzt {v} Punkte',
  tempo: 'Tempo', tempoLine: 'Ø Zug {time} · Platz {rank} von {of}',
  slowest: 'Langsamster am Tisch', fastest: 'Schnellster am Tisch',
  highlights: 'Highlights',
  nemesis: 'Nemesis', nemesisMe: '{name} hat dich {n}× rausgenommen', nemesisOther: '{name} hat {who} {n}× rausgenommen',
  favDeck: 'Lieblingsdeck', bestDeck: 'Bestes Deck', favBestDeck: 'Lieblings- und bestes Deck',
  streak: 'Längste Siegesserie', streak1: '1 Sieg in Folge', streakN: '{n} Siege in Folge',
  fastestWin: 'Schnellster Sieg', inRounds: 'in {n} Runden',
  // Deck
  rating: 'Bewertung', ownRating: 'Eigene Deck-Bewertung', fun: 'Spaß am Tisch', salt: 'Salz bei Gegnern',
  saltLine1: 'Ø {v} aus 1 Bewertung', saltLineN: 'Ø {v} aus {n} Bewertungen', noSalt: 'Noch keine Salz-Bewertung',
  recent: 'Letzte Spiele', win: 'Sieg', place: 'Platz {n}', rounds: '{n} Runden',
  // Profil „Erweitert“: Zugzeiten und Spieldauer (Spec P1 Zug-Uhr)
  more: {
    title: 'Erweitert', hint: 'Zugzeiten und Spieldauer',
    compare: 'Ø Zugdauer im Vergleich', compareHint: 'Alle Spieler der Gruppe, langsamster zuerst',
    compareFew: 'Für einen Vergleich braucht es Zugzeiten von mindestens zwei Spielern.',
    compareNone: 'Von {name} gibt es noch keine Zugzeiten.',
    longest: 'Längster Zug', longestGroup: 'Längster Zug der Gruppe', longestMe: 'Dein längster Zug', longestOther: 'Längster Zug von {name}',
    noTurns: 'Noch keine Zugzeiten erfasst.',
    duration: 'Ø Spieldauer', durationAll: 'Alle Partien', durationPlayers: '{n} Spieler',
    colMe: 'Du', colGroup: 'Gruppe',
    durationNone: 'Noch keine Spieldauer erfasst.',
  },
};
