// Turns a snapshot into scored candidates: one card, its next eligible game, mean and spread of its points.

export function editionBonuses(engineConfiguration) {
  const map = new Map();
  for (const e of engineConfiguration?.specialEditionCards?.editions ?? []) {
    for (const name of e.edition_names) map.set(name, e.bonus);
  }
  return map;
}

export function stepRules(step) {
  const rules = Object.fromEntries(step.displayedTypedRules.map(r => [r.key, r]));
  return {
    slots: rules.Appearances?.appearances?.length ?? 5,
    maxStars: rules.AverageScores?.averageType === 'STARS' ? rules.AverageScores.max : Infinity,
    rarities: rules.Scarcity?.rarities ?? ['common'],
    captain: step.engineConfiguration?.captain ?? null,
  };
}

// A failed, cancelled or expired lineup is over: it used up one try, but its cards are free again.
const ENDED = ['FAILED', 'CANCELLED', 'EXPIRED', 'SUCCESSFUL'];

export function activeLineups(snapshot) {
  return (snapshot.lineups ?? []).filter(l => !ENDED.includes(l.aasmState));
}

export function failedLineups(snapshot) {
  return (snapshot.lineups ?? []).filter(l => l.aasmState === 'FAILED');
}

export function cancelledLineups(snapshot) {
  return (snapshot.lineups ?? []).filter(l => ['CANCELLED', 'EXPIRED'].includes(l.aasmState));
}

function spread(scores) {
  if (scores.length < 2) return null;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1));
}

// Correction from real results: 2,384 player games in the snapshots of 30.10.–25.11.2026, each read
// up to 30 hours before the game (node src/calibrate.mjs prints these figures from data/).
// Per projection band: `out` = share that did not play, read up to 6 hours | longer before the game starts;
// `shift` = how far the scores of those who played sat off the projection, in spreads.
// `spread` = how much wider the real scores scattered than the spread of the last 15 games.
export const CALIBRATION = {
  lateHours: 6,
  spread: 1.18,
  bands: [
    { below: 8, out: [0.39, 0.41], shift: 0.57 },
    { below: 12, out: [0.12, 0.16], shift: 0.13 },
    { below: 25, out: [0.032, 0.082], shift: 0 },
    { below: Infinity, out: [0.013, 0.058], shift: -0.13 },
  ],
};

export function calibrate(projection, sd, leadHours, cal = CALIBRATION) {
  const band = cal.bands.find(b => projection < b.below);
  return { mean: Math.max(0, projection + band.shift * sd), sd: sd * cal.spread, out: band.out[leadHours <= cal.lateHours ? 0 : 1] };
}

// `points` is what Sorare shows: projectedScore × edition bonus. The chance uses the corrected `mean`, `sd` and `out`.
// The spread comes from the last 15 games; with little history it falls back to a third of the projection, never below 6 points.
export function buildCandidates(snapshot, now = new Date()) {
  const read = snapshot.fetchedAt ? Date.parse(snapshot.fetchedAt) : now.getTime();
  const step = snapshot.steps.find(s => s.id === snapshot.stepId);
  const bonuses = editionBonuses(step.engineConfiguration);
  const byCard = new Map(snapshot.eligibility.map(e => [e.slug, e]));
  const lineupOf = new Map(activeLineups(snapshot).flatMap(l => l.cards.map(slug => [slug, l.id])));
  const candidates = [], excluded = [], inLineups = [];
  for (const card of snapshot.cards) {
    const player = card.basketballPlayer;
    const elig = byCard.get(card.slug);
    const game = elig?.eligiblePlayerGameScores?.[0];
    const raw = elig?.basketballPlayer?.rawPlayerGameScores ?? [];
    const played = raw.filter(x => x != null);
    const bonus = bonuses.get(card.cardEditionName) ?? 0;
    const projection = game?.projectedScore ?? 0;
    const g = game?.anyGame;
    const base = Math.max(spread(played) ?? projection / 3, 6);
    const cal = calibrate(projection, base, g ? (Date.parse(g.date) - read) / 3600e3 : Infinity);
    const c = {
      card: card.slug, player: player.slug, name: player.displayName, team: player.activeClub?.slug ?? '?',
      stars: player.gameplayTierStars ?? 0, tier: player.gameplayTier, positions: card.anyPositions,
      edition: card.cardEditionName, bonus, projection,
      game: g ? { id: g.id, date: g.date, status: g.statusTyped, home: g.homeTeam?.slug, away: g.awayTeam?.slug } : null,
      points: projection * (1 + bonus),
      mean: cal.mean * (1 + bonus), sd: cal.sd * (1 + bonus), out: cal.out, spread: base,
      recent: played.length ? played.reduce((a, b) => a + b, 0) / played.length : null,
      playedShare: raw.length ? played.length / raw.length : null,
    };
    if (lineupOf.has(card.slug)) inLineups.push({ ...c, lineup: lineupOf.get(card.slug) });
    else if (!g) excluded.push({ ...c, reason: 'kein Spiel in diesem Step' });
    else if (g.statusTyped && g.statusTyped !== 'scheduled' || Date.parse(g.date) <= now.getTime()) excluded.push({ ...c, reason: 'Spiel läuft schon oder ist vorbei' });
    else if (!(projection > 0)) excluded.push({ ...c, reason: 'Sorare-Prognose 0 (spielt wohl nicht)' });
    else candidates.push(c);
  }
  return { step, rules: stepRules(step), candidates, excluded, inLineups };
}
