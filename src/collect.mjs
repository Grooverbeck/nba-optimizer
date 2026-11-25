import { nextScheduledNight } from './nights.mjs';
import { query } from './sorare.mjs';

// Anonymous queries are limited to depth 7, so the board, cards and eligibility are separate requests.
const BOARD_QUERY = `query NbaBoard($slug: String!) {
  cardSet { currentSet(sport: NBA) { id slug name startDate } }
  user(slug: $slug) { slug setBoard(sport: NBA, mode: CAREER) { steps { ... on CareerStep {
    id state level target title maxLineupsCount pendingLineupsCount lockedLineupsCount remainingLineupsCount
    engineConfiguration { captain collection grade xpMultiplier specialEditionCards }
    displayedTypedRules { __typename key
      ... on So5ScarcityRule { rarities }
      ... on So5AverageScoresRule { max averageType }
      ... on So5AppearancesRule { appearances { name positions } } }
    myTask { ... on ThresholdPickerTask { taskLineups { id aasmState } } }
  } } } }
}`;

// Anonymous reads find a task lineup only by its bare UUID, not by the "Tasks::TaskLineup:" id.
const LINEUP_QUERY = `query NbaLineup($id: ID!) {
  so5 { taskLineup(id: $id) { id score aasmState taskAppearances { index anyCard { slug } score
    game { id date ... on GameOfBasketball { statusTyped } } } } }
}`;

const CARDS_QUERY = `query NbaCards($slug: String!, $set: String!, $page: Int!) {
  user(slug: $slug) { searchCards(cardSetSlug: $set, rarity: common, sport: NBA, page: $page, pageSize: 50) {
    nbHits nbPages page
    hits { slug ... on NBACard { cardEditionName anyPositions
      basketballPlayer { slug displayName gameplayTier gameplayTierStars activeClub { slug } } } }
  } }
}`;

const ELIGIBILITY_QUERY = `query NbaEligibility($step: String!, $cards: [String!]!) {
  anyCards(slugs: $cards) { slug
    eligiblePlayerGameScores(stepId: $step) { scoringVersion projectedScore
      anyGame { id date ... on GameOfBasketball { statusTyped homeTeam { slug } awayTeam { slug } } } }
    ... on NBACard { basketballPlayer { slug rawPlayerGameScores(last: 15) } } }
}`;

// 24 cards cost 649 complexity points; anonymous limit is 500.
const BATCH = 16;

// Every club's next games, read through one of its players. 30 players cost 721 complexity points, 15 fit.
// Three games per club cover the next two nights with games for every club.
const SCHEDULE_QUERY = `query NbaSchedule($slugs: [String!]!) {
  players(slugs: $slugs) { slug activeClub { slug upcomingGames(first: 3) { id date } } }
}`;
const SCHEDULE_BATCH = 15;

// Sorare's projections for every player of one game, also for games several days ahead. One game per request.
const GAME_QUERY = `query NbaGame($id: ID!) {
  anyGame(id: $id) { id date playerGameScores { projectedScore anyPlayer { slug } } }
}`;

export function pickStep(steps, level) {
  if (level != null) {
    const step = steps.find(s => s.level === level - 1);
    if (!step) throw new Error(`Step ${level} nicht gefunden.`);
    return step;
  }
  // The current step is the first one neither claimed nor locked: PLAYABLE, LINEUP_SET, or LIVE once all tries are set.
  return steps.find(s => !['CLAIMED', 'LOCKED'].includes(s.state)) ?? steps.find(s => s.state === 'LOCKED') ?? steps[0];
}

// `ahead: false` skips the projections for the next night (one request per game of that night).
export async function collect({ manager, stepLevel, ahead = true, log = () => {} }) {
  log('Board und Regeln …');
  const board = await query('NbaBoard', BOARD_QUERY, { slug: manager });
  const set = board.cardSet.currentSet;
  if (!set) throw new Error('Kein aktuelles NBA-Set bei Sorare.');
  const steps = board.user?.setBoard?.steps;
  if (!steps?.length) throw new Error(`Kein NBA-Career-Board für ${manager} (Set noch nicht geöffnet?).`);
  const step = pickStep(steps, stepLevel);

  const lineups = [];
  for (const { id } of step.myTask?.taskLineups ?? []) {
    log('Gesetzte Lineups …');
    const data = await query('NbaLineup', LINEUP_QUERY, { id: id.replace(/^.*:/, '') });
    const l = data.so5.taskLineup;
    lineups.push({ id: l.id, aasmState: l.aasmState, score: l.score, cards: l.taskAppearances.map(a => a.anyCard.slug),
      appearances: l.taskAppearances.map(a => ({ card: a.anyCard.slug, score: a.score,
        game: a.game && { id: a.game.id, date: a.game.date, status: a.game.statusTyped } })) });
  }

  log('Karten …');
  const cards = [];
  for (let page = 1; ; page++) {
    const data = await query('NbaCards', CARDS_QUERY, { slug: manager, set: set.slug, page });
    const result = data.user.searchCards;
    cards.push(...result.hits);
    if (page >= result.nbPages) break;
  }

  log(`Spiele und Form für ${cards.length} Karten …`);
  const eligibility = [];
  for (let i = 0; i < cards.length; i += BATCH) {
    const slugs = cards.slice(i, i + BATCH).map(c => c.slug);
    const data = await query('NbaEligibility', ELIGIBILITY_QUERY, { step: step.id, cards: slugs });
    eligibility.push(...data.anyCards);
  }
  log('Spielplan …');
  const playerOfClub = new Map();
  for (const c of cards) {
    const club = c.basketballPlayer?.activeClub?.slug;
    if (club && !playerOfClub.has(club)) playerOfClub.set(club, c.basketballPlayer.slug);
  }
  const schedule = [], slugs = [...playerOfClub.values()];
  for (let i = 0; i < slugs.length; i += SCHEDULE_BATCH) {
    const data = await query('NbaSchedule', SCHEDULE_QUERY, { slugs: slugs.slice(i, i + SCHEDULE_BATCH) });
    for (const p of data.players) if (p.activeClub) schedule.push({ club: p.activeClub.slug, games: p.activeClub.upcomingGames ?? [] });
  }
  const snapshot = { fetchedAt: new Date().toISOString(), manager, set, steps, stepId: step.id, lineups, cards, eligibility, schedule };
  const night = ahead ? nextScheduledNight(schedule) : null;
  if (!night) return snapshot;
  log(`Prognosen für die nächste Nacht (${night.games.size} Spiele) …`);
  snapshot.ahead = [];
  for (const id of night.games.keys()) {
    const game = (await query('NbaGame', GAME_QUERY, { id })).anyGame;
    snapshot.ahead.push({ id: game.id, date: game.date,
      scores: (game.playerGameScores ?? []).map(s => ({ player: s.anyPlayer?.slug, projectedScore: s.projectedScore })) });
  }
  return snapshot;
}
