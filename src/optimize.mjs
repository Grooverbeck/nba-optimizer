// Lineup search: maximize the chance that the lineup total reaches the step target.
// Player points are treated as independent normals, so chance = Phi((sum mean - target) / sqrt(sum var)).

export function normalCdf(z) {
  // Abramowitz-Stegun 7.1.26, error < 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function evaluate(cards, target) {
  const mean = cards.reduce((a, c) => a + c.mean, 0);
  const sd = Math.sqrt(cards.reduce((a, c) => a + c.sd ** 2, 0));
  const stars = cards.reduce((a, c) => a + c.stars, 0);
  return { mean, sd, stars, chance: sd > 0 ? normalCdf((mean - target) / sd) : Number(mean >= target) };
}

// "b beats a": b has no more stars and at least as many points. For the chance search the spread matters too:
// below the target more spread helps (a lucky night is needed), above the target less spread helps.
export const beatsOnPoints = (b, a) => b.stars <= a.stars && b.mean >= a.mean && (b.stars < a.stars || b.mean > a.mean);
const beatsWithSpread = above => (b, a) => b.stars <= a.stars && b.mean >= a.mean && (above ? b.sd <= a.sd : b.sd >= a.sd)
  && (b.stars < a.stars || b.mean > a.mean || b.sd !== a.sd);

// A card beaten by cards of at least `slots` other players is never needed:
// in any lineup one of them is free to take its place. Keeps the search small for big collections.
export function undominated(candidates, slots, beats = beatsOnPoints) {
  return candidates.filter(a => {
    const better = new Set();
    for (const b of candidates) if (b.player !== a.player && beats(b, a)) better.add(b.player);
    return better.size < slots;
  });
}

// Exhaustive search over all lineups (one card per player, star cap), keeping the one with the highest value.
function search(candidates, { slots, maxStars }, value) {
  const cards = [...candidates].sort((a, b) => b.mean - a.mean);
  const minStars = Math.min(...cards.map(c => c.stars));
  let best = null, bestValue = -Infinity;
  const pick = [], players = new Set();
  const walk = (start, mean, variance, stars) => {
    if (pick.length === slots) {
      const v = value(mean, variance);
      if (v > bestValue) { bestValue = v; best = [...pick]; }
      return;
    }
    const left = slots - pick.length;
    for (let i = start; i <= cards.length - left; i++) {
      const c = cards[i];
      if (players.has(c.player) || stars + c.stars + (left - 1) * minStars > maxStars) continue;
      pick.push(c); players.add(c.player);
      walk(i + 1, mean + c.mean, variance + c.sd ** 2, stars + c.stars);
      pick.pop(); players.delete(c.player);
    }
  };
  walk(0, 0, 0, 0);
  return best;
}

// Highest chance to reach the target. First the most points possible decide whether the target is within reach;
// that tells which way the spread counts, so the pruning stays exact.
export function bestLineup(candidates, rules, target) {
  const top = search(undominated(candidates, rules.slots), rules, mean => mean);
  if (!top) return null;
  const above = evaluate(top, target).mean > target;
  const best = search(undominated(candidates, rules.slots, beatsWithSpread(above)), rules,
    (mean, variance) => variance > 0 ? (mean - target) / Math.sqrt(variance) : (mean >= target ? Infinity : -Infinity));
  return best && { cards: best, ...evaluate(best, target) };
}

// Greedy: best lineup first, then the best one from the remaining cards, and so on.
export function planLineups(candidates, rules, target, count) {
  const lineups = [];
  let pool = candidates;
  for (let i = 0; i < count; i++) {
    const lineup = bestLineup(pool, rules, target);
    if (!lineup) break;
    lineups.push(lineup);
    const used = new Set(lineup.cards.map(c => c.card));
    pool = pool.filter(c => !used.has(c.card));
  }
  const atLeastOne = 1 - lineups.reduce((a, l) => a * (1 - l.chance), 1);
  return { lineups, atLeastOne };
}
