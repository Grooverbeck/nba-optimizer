import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, boardFor, choose, lineupsToSet, BOARD } from '../src/advice.mjs';
import { calibrate } from '../src/model.mjs';
import { bestLineup, evaluate, normalCdf } from '../src/optimize.mjs';
import { nextNight, nextNightFromSchedule, report, WIDTH } from '../src/cli.mjs';

test('the correction depends on the projection band and on how long before the game it is read', () => {
  const late = calibrate(30, 10, 3), early = calibrate(30, 10, 9);
  assert.ok(late.out < early.out);
  assert.ok(late.mean < 30 && late.sd > 10);
  assert.ok(calibrate(10, 6, 3).out > calibrate(20, 6, 3).out);
});

test('a card that may sit out lowers the chance, and the search avoids it', () => {
  const card = (id, out) => ({ card: id, player: id, stars: 3, mean: 32, sd: 5, out });
  assert.ok(Math.abs(evaluate([card('a', 0.1)], 22).chance - 0.9 * normalCdf(2)) < 1e-9);
  const pool = ['a', 'b', 'c', 'd', 'e'].map(id => card(id, 0)).concat(card('shaky', 0.3));
  const best = bestLineup(pool, { slots: 5, maxStars: 16 }, 150);
  assert.ok(!best.cards.some(c => c.card === 'shaky'));
  // With one of five out, the other four have to carry it.
  const four = evaluate(['a', 'b', 'c', 'd'].map(id => card(id, 0)), 150).chance;
  const withShaky = evaluate([...['a', 'b', 'c', 'd'].map(id => card(id, 0)), card('shaky', 0.3)], 150);
  assert.ok(Math.abs(withShaky.chance - (0.7 * evaluate(pool.slice(0, 5), 150).chance + 0.3 * four)) < 1e-9);
});

test('how many lineups to set depends on the step and on the next night', () => {
  // Step 1: a failed board starts at Step 1 again anyway, so every try goes out.
  assert.deepEqual(advise(0, 4, [0, 0.85, 0.95, 0.98, 0.99]), { small: 4, big: 4 });
  // Step 4, 3 tries: before a big night the weak third lineup stays home, before a small one it goes out.
  assert.deepEqual(advise(3, 3, [0, 0.065, 0.10, 0.105]), { small: 3, big: 2 });
  // Step 3, last try, weak night: wait only if a big night follows, and that is a close call.
  assert.deepEqual(advise(2, 1, [0, 0.08]), { small: 1, big: 0 });
  const close = choose(2, 1, [0, 0.08], BOARD.big);
  assert.ok(close.margin < 0.1 && close.alt === 1);
  // Step 4, last try, two lineups running: before a big night the try clearly stays, before a small one it clearly goes.
  assert.ok(choose(3, 1, [0.098, 0.116], BOARD.big).count === 0 && choose(3, 1, [0.098, 0.116], BOARD.big).margin > 0.5);
  assert.ok(choose(3, 1, [0.098, 0.116], BOARD.small).count === 1 && choose(3, 1, [0.098, 0.116], BOARD.small).margin > 0.5);
  // Step 5 pays 100 dollars: on a weak night wait, on a strong night one lineup at a time.
  assert.deepEqual(advise(4, 4, [0, 0.0036, 0.004, 0.0041, 0.0042]), { small: 0, big: 0 });
  assert.deepEqual(advise(4, 4, [0, 0.0174, 0.021, 0.023, 0.0239]), { small: 1, big: 1 });
  // A lineup already running that will very likely win: a try that adds next to nothing stays for the big night.
  assert.equal(lineupsToSet(3, 2, [0.9, 0.901, 0.902], BOARD.big), 0);
});

test('the report recommends how many lineups to set and when', () => {
  const step = { id: 's2', level: 1, target: 180, state: 'PLAYABLE', remainingLineupsCount: 3,
    engineConfiguration: { captain: null, specialEditionCards: { editions: [] } },
    displayedTypedRules: [{ key: 'Scarcity', rarities: ['common'] }, { key: 'AverageScores', averageType: 'STARS', max: 16 },
      { key: 'Appearances', appearances: [1, 2, 3, 4, 5] }] };
  const cards = Array.from({ length: 13 }, (_, i) => ({ slug: `c${i}`, cardEditionName: 'divination_standard_base', anyPositions: [],
    basketballPlayer: { slug: `p${i}`, displayName: `Spieler ${i}`, gameplayTierStars: 3, activeClub: { slug: 'utah-jazz' } } }));
  // Six cards play tonight, the other seven in seven different games of the night after.
  const eligibility = cards.map((c, i) => ({ slug: c.slug, basketballPlayer: { rawPlayerGameScores: [30, 40] },
    eligiblePlayerGameScores: [{ projectedScore: 40, anyGame: { id: i < 6 ? 'tonight' : `next${i}`, date: i < 6 ? '2026-11-08T01:00:00Z' : '2026-11-09T01:00:00Z',
      statusTyped: 'scheduled', homeTeam: { slug: 'utah-jazz' }, awayTeam: { slug: 'boston-celtics' } } }] }));
  const snapshot = { fetchedAt: '2026-11-07T12:00:00Z', manager: 'luckyphil', set: { name: 'Divination' }, stepId: 's2', steps: [step],
    lineups: [], cards, eligibility };
  const now = new Date('2026-11-07T12:00:00Z');
  const { text, advice, plan } = report(snapshot, { now, days: 1 });
  assert.equal(plan.lineups.length, 1);
  assert.deepEqual(advice, { small: 1, big: 1 });
  assert.match(text, /== Empfehlung ==\nDas Lineup setzen\.\nErst ab Sa 20:00 setzen/);
  assert.deepEqual(text.split('\n').filter(l => l.length > WIDTH), []);
  assert.equal(report(snapshot, { now }).advice, null);
  const games = eligibility.map(e => ({ game: e.eligiblePlayerGameScores[0].anyGame }));
  assert.deepEqual(nextNight(games, now), { games: 7, first: '2026-11-09T01:00:00Z' });
  // Read three hours before the game, fewer players sit out, so the same lineup has a better chance.
  const late = report({ ...snapshot, fetchedAt: '2026-11-07T22:00:00Z' }, { now: new Date('2026-11-07T22:00:00Z'), days: 1 });
  assert.ok(late.plan.lineups[0].chance > plan.lineups[0].chance);
  assert.doesNotMatch(late.text, /Erst ab/);

  // With the clubs' schedules in the raw data the next night is exact and rated by the own cards that play in it.
  const game = (id, date) => ({ id, date });
  const schedule = [
    { club: 'utah-jazz', games: [game('tonight', '2026-11-08T01:00:00Z'), game('n1', '2026-11-10T01:00:00Z')] },
    { club: 'boston-celtics', games: [game('tonight', '2026-11-08T01:00:00Z'), game('n2', '2026-11-10T02:00:00Z')] },
  ];
  const known = report({ ...snapshot, schedule }, { now, days: 1 });
  assert.match(known.text, /== Empfehlung ==\nDas Lineup setzen\.\nNacht auf Di: 2 Spiele, 13 deiner\nKarten, bestes Lineup etwa \d+ %\./);
  assert.deepEqual(known.text.split('\n').filter(l => l.length > WIDTH), []);
  const owned = cards.map((c, i) => ({ card: c.slug, player: `p${i}`, team: i < 7 ? 'utah-jazz' : 'boston-celtics', stars: 3, projection: i === 0 ? 0 : 40, mean: 40, sd: 8 }));
  const next = nextNightFromSchedule(schedule, owned, { slots: 5, maxStars: 16 }, 180, now);
  // The night after tonight has no game; the one after has two. The card with projection 0 does not count.
  assert.deepEqual({ games: next.games, first: next.first, cards: next.cards }, { games: 2, first: '2026-11-10T01:00:00Z', cards: 12 });
  assert.ok(next.chance > 0.8);
});

test('the board for a known next night lies between the small-night and the big-night values', () => {
  assert.deepEqual(boardFor(3, 0.01), BOARD.small);
  assert.deepEqual(boardFor(3, 0.2), BOARD.big);
  const mid = boardFor(3, (0.028 + 0.083) / 2);
  assert.ok(Math.abs(mid[3][2] - (BOARD.small[3][2] + BOARD.big[3][2]) / 2) < 1e-9);
});
