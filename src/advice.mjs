// When to set a lineup and when to keep the try for a later night.
//
// Every reward counts in Gems:
// - Step 1 and 2 pay 2,000 and 5,000 common essence. 1,000 essence buy one Bronze pack; for this board
//   such a pack is worth roughly 0.25 Gems (a rough figure, rescaled from an older estimate).
// - Step 3 and 4 pay 10 and 30 Gems.
// - Step 5 and 6 pay 100 and 1,000 dollars. In the shop a Gem costs 13 to 20 cents (25.11.2026);
//   with 15 cents and 0.90 euros per dollar, a dollar buys 6 Gems.
export const ESSENCE = 0.25; // Gems per 1,000 essence
export const DOLLAR = 6; // Gems per dollar
export const GEMS = [2 * ESSENCE, 5 * ESSENCE, 10, 30, 100 * DOLLAR, 1000 * DOLLAR];

// BOARD[next night][step][tries left] is what the board is worth at the start of the next night with games,
// in Gems, measured against the average fresh board (Step 1, 4 tries). "big" = BIG_NIGHT games or more.
// The values come from a nightly decision model over 12 nights (15.–26.11.2026) with the corrected chances,
// lineups set late and the rewards above; they have to be recomputed when ESSENCE or DOLLAR change.
// Four failed tries put the board back to Step 1. The model does not know when the set ends,
// so it rates long waiting at Steps 5 and 6 a little too well.
export const BIG_NIGHT = 7;
export const BOARD = {
  small: [[0, -0.86, -0.66, -0.6, -0.58], [0, -0.11, 0.42, 0.66, 0.86], [0, -0.19, 0.78, 1.78, 2.58], [0, -0.35, 0.87, 2.32, 3.66],
    [0, 6.16, 14.35, 22.38, 30.27], [0, 29.49, 60.86, 92.02, 122.98]],
  big: [[0, -0.02, 0.29, 0.38, 0.41], [0, 0.74, 1.48, 1.84, 2.03], [0, 1.86, 3.47, 4.39, 5.08], [0, 2.65, 4.81, 6.18, 7.41],
    [0, 10.57, 18.76, 26.8, 34.68], [0, 33.9, 65.27, 96.43, 127.39]],
};

// A choice is close when the next best one is worth less than this many Gems less.
export const CLOSE = 0.1;

// chances[m] = chance that the step is won tonight with m new lineups (chances[0]: lineups already running, else 0).
// `count` = how many new lineups are worth setting tonight (on a tie the larger number),
// `alt` = the next best number, `margin` = how many Gems it is worse.
export function choose(level, tries, chances, board) {
  const reset = board[0][4];
  const won = GEMS[level] + (level >= 5 ? reset : board[level + 1][4]);
  const lost = left => left > 0 ? board[level][left] : reset;
  const values = chances.slice(0, tries + 1).map((c, m) => c * won + (1 - c) * lost(tries - m));
  const order = values.map((_, m) => m).sort((a, b) => values[b] - values[a] > 1e-9 ? 1 : values[a] - values[b] > 1e-9 ? -1 : b - a);
  return { count: order[0], alt: order[1] ?? null, margin: order.length > 1 ? values[order[0]] - values[order[1]] : Infinity };
}

export const lineupsToSet = (level, tries, chances, board) => choose(level, tries, chances, board).count;

export function advise(level, tries, chances) {
  return { small: lineupsToSet(level, tries, chances, BOARD.small), big: lineupsToSet(level, tries, chances, BOARD.big) };
}
