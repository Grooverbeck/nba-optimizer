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
  so5 { taskLineup(id: $id) { id score aasmState taskAppearances { index anyCard { slug } } } }
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

export function pickStep(steps, level) {
  if (level != null) {
    const step = steps.find(s => s.level === level - 1);
    if (!step) throw new Error(`Step ${level} nicht gefunden.`);
    return step;
  }
  return steps.find(s => ['PLAYABLE', 'LINEUP_SET'].includes(s.state)) ?? steps.find(s => s.state === 'LOCKED') ?? steps[0];
}

export async function collect({ manager, stepLevel, log = () => {} }) {
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
    lineups.push({ id: l.id, aasmState: l.aasmState, score: l.score, cards: l.taskAppearances.map(a => a.anyCard.slug) });
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
  return { fetchedAt: new Date().toISOString(), manager, set, steps, stepId: step.id, lineups, cards, eligibility };
}
