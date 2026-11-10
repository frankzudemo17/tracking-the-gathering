// i18n-Namensraum „stats“ (en) · Besitzer: P18 (Profil- + Deck-Statistik).
// Naht aus P13: eingebunden in en.js unter `stats`; nur dieses Paket schreibt hier. Schlüssel in de/en gleich halten (lint L5).
export default {
  winRate: 'Win rate',
  loadError: 'Stats could not be loaded right now.',
  games1: '1 game', gamesN: '{n} games',
  deckLine: '{games} · {rate} wins',
  winRateLine: '{v} win rate',
  ofFive: '{v} of 5',
  // Profile
  mood: 'Mood', avgSalt: 'Avg salt', avgFun: 'Avg fun', avgDeck: 'Avg deck rating',
  saltTrend: 'Salt trend', saltTrendHint: 'Own salt, last {n} rated games · 1 = relaxed, 5 = very salty',
  saltTrendLabel: 'Salt values, oldest first: {list}',
  pointsTrend: 'Points trend', pointsHint: 'Total points after {n} games', pointsLabel: 'Points over {n} games, latest {v} points',
  tempo: 'Pace', tempoLine: 'Avg turn {time} · rank {rank} of {of}',
  slowest: 'Slowest at the table', fastest: 'Fastest at the table',
  highlights: 'Highlights',
  nemesis: 'Nemesis', nemesisMe: '{name} knocked you out {n}×', nemesisOther: '{name} knocked {who} out {n}×',
  favDeck: 'Favourite deck', bestDeck: 'Best deck', favBestDeck: 'Favourite and best deck',
  streak: 'Longest win streak', streak1: '1 win in a row', streakN: '{n} wins in a row',
  fastestWin: 'Fastest win', inRounds: 'in {n} rounds',
  // Deck
  rating: 'Rating', ownRating: 'Own deck rating', fun: 'Fun at the table', salt: 'Salt from opponents',
  saltLine1: 'Avg {v} from 1 rating', saltLineN: 'Avg {v} from {n} ratings', noSalt: 'No salt rating yet',
  recent: 'Recent games', win: 'Win', place: 'Place {n}', rounds: '{n} rounds',
};
