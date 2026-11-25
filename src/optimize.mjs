// Lineup search: maximize the chance that the lineup total reaches the step target.
// Player points are treated as independent normals, so chance = Phi((sum mean - target) / sqrt(sum var)),
// weighted over who plays and who sits out.

export function normalCdf(z) {
  // Abramowitz-Stegun 7.1.26, error < 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

const reach = (mean, variance, target) => variance > 0 ? normalCdf((mean - target) / Math.sqrt(variance)) : Number(mean >= target);

// A card may not play at all (chance `out`, then 0 points). Every combination of absences counts with its probability.
// `points` is the shown total (Sorare projection), `mean` the corrected one the chance is built on.
export function evaluate(cards, target) {
  const sum = f => cards.reduce((a, c) => a + f(c), 0);
  let chance = 0;
  const walk = (i, p, mean, variance) => {
    if (i === cards.length) { chance += p * reach(mean, variance, target); return; }
    const c = cards[i], out = c.out ?? 0;
    walk(i + 1, p * (1 - out), mean + c.mean, variance + c.sd ** 2);
    if (out > 0) walk(i + 1, p * out, mean, variance);
  };
  walk(0, 1, 0, 0);
  return { points: sum(c => c.points ?? c.mean), mean: sum(c => c.mean), sd: Math.sqrt(sum(c => c.sd ** 2)), stars: sum(c => c.stars), chance };
}

// "b beats a": b has no more stars and at least as many points. For the chance search the spread matters too:
// below the target more spread helps (a lucky night is needed), above the target less spread helps.
// A card that sits out more often never beats one that plays more reliably.
export const beatsOnPoints = (b, a) => b.stars <= a.stars && b.mean >= a.mean && (b.stars < a.stars || b.mean > a.mean);
const beatsWithSpread = above => (b, a) => b.stars <= a.stars && b.mean >= a.mean && (above ? b.sd <= a.sd : b.sd >= a.sd)
  && (b.out ?? 0) <= (a.out ?? 0) && (b.stars < a.stars || b.mean > a.mean || b.sd !== a.sd || (b.out ?? 0) < (a.out ?? 0));

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
  const walk = (start, mean, variance, stars, playing) => {
    if (pick.length === slots) {
      const v = value(mean, variance, playing);
      if (v > bestValue) { bestValue = v; best = [...pick]; }
      return;
    }
    const left = slots - pick.length;
    for (let i = start; i <= cards.length - left; i++) {
      const c = cards[i];
      if (players.has(c.player) || stars + c.stars + (left - 1) * minStars > maxStars) continue;
      pick.push(c); players.add(c.player);
      walk(i + 1, mean + c.mean, variance + c.sd ** 2, stars + c.stars, playing * (1 - (c.out ?? 0)));
      pick.pop(); players.delete(c.player);
    }
  };
  walk(0, 0, 0, 0, 1);
  return best;
}

// Highest chance to reach the target. First the most points possible decide whether the target is within reach;
// that tells which way the spread counts, so the pruning stays exact.
// The search counts a lineup only when all its players play; the reported chance also counts the nights with an absence.
export function bestLineup(candidates, rules, target) {
  const top = search(undominated(candidates, rules.slots), rules, mean => mean);
  if (!top) return null;
  const above = evaluate(top, target).mean > target;
  const best = search(undominated(candidates, rules.slots, beatsWithSpread(above)), rules,
    (mean, variance, playing) => playing * reach(mean, variance, target));
  return best && { cards: best, ...evaluate(best, target) };
}

// Chance that at least one of the first m lineups reaches the target, for m = 1, 2, ...
// Lineups without a common player are independent. Two cards of the same player in two lineups fail together,
// so that case is counted by drawing every player's night once (fixed random numbers: same result on every run).
export function atLeastOne(lineups, target, draws = 40000) {
  const players = lineups.flatMap(l => l.cards.map(c => c.player));
  let miss = 1;
  if (new Set(players).size === players.length) return lineups.map(l => 1 - (miss *= 1 - l.chance));
  let seed = 20261125;
  const random = () => { // mulberry32
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const hits = lineups.map(() => 0);
  for (let n = 0; n < draws; n++) {
    const night = new Map(); // player -> standard score of the night, null when not playing
    let reached = false;
    lineups.forEach((l, i) => {
      let total = 0;
      for (const c of l.cards) {
        if (!night.has(c.player)) night.set(c.player, random() < (c.out ?? 0) ? null : Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()));
        const z = night.get(c.player);
        if (z != null) total += c.mean + c.sd * z;
      }
      reached ||= total >= target;
      if (reached) hits[i]++;
    });
  }
  // The first lineup keeps its exact chance; further lineups can only add to it.
  return hits.reduce((out, h, i) => [...out, i ? Math.max(out[i - 1], h / draws) : lineups[0].chance], []);
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
  const cumulative = atLeastOne(lineups, target);
  return { lineups, cumulative, atLeastOne: cumulative.at(-1) ?? 0 };
}
