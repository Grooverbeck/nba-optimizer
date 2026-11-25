// When to set a lineup and when to keep the try for a later night.
//
// BOARD[next night][step][tries left] is what the board is worth at the start of the next night with games,
// in Gems, measured against the average fresh board (Step 1, 4 tries). "big" = BIG_NIGHT games or more.
// The values come from a nightly decision model over 12 nights (15.–26.11.2026) with the corrected chances
// and lineups set late. Shards and the dollar prizes of Steps 5 and 6 count as 0, so these steps are only
// worth getting through quickly. Four failed tries put the board back to Step 1.
export const BIG_NIGHT = 7;
export const GEMS = [0, 0, 10, 30, 0, 0];
export const BOARD = {
  small: [[0, -0.53, -0.4, -0.36, -0.35], [0, 0.1, 0.47, 0.66, 0.84], [0, 0.23, 1.1, 2, 2.69], [0, -0.68, -0.29, 0.1, 0.49],
    [0, -1.58, -1.58, -1.58, -1.58], [0, -1.58, -1.58, -1.58, -1.58]],
  big: [[0, -0.02, 0.17, 0.23, 0.25], [0, 0.67, 1.19, 1.43, 1.57], [0, 1.7, 2.94, 3.67, 4.27], [0, 0.78, 1.67, 2.19, 2.58],
    [0, -1.58, -1.58, -1.58, -1.58], [0, -1.58, -1.58, -1.58, -1.58]],
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
