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

function spread(scores) {
  if (scores.length < 2) return null;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1));
}

// Sorare's projectedScore is the mean. The spread comes from the last 15 games;
// with little history it falls back to a third of the projection, never below 6 points.
export function buildCandidates(snapshot, now = new Date()) {
  const step = snapshot.steps.find(s => s.id === snapshot.stepId);
  const bonuses = editionBonuses(step.engineConfiguration);
  const byCard = new Map(snapshot.eligibility.map(e => [e.slug, e]));
  const lineupOf = new Map((snapshot.lineups ?? []).flatMap(l => l.cards.map(slug => [slug, l.id])));
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
    const c = {
      card: card.slug, player: player.slug, name: player.displayName, team: player.activeClub?.slug ?? '?',
      stars: player.gameplayTierStars ?? 0, tier: player.gameplayTier, positions: card.anyPositions,
      edition: card.cardEditionName, bonus, projection,
      game: g ? { id: g.id, date: g.date, status: g.statusTyped, home: g.homeTeam?.slug, away: g.awayTeam?.slug } : null,
      mean: projection * (1 + bonus),
      sd: Math.max(spread(played) ?? projection / 3, 6) * (1 + bonus),
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
