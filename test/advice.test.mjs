import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, choose, lineupsToSet, BOARD } from '../src/advice.mjs';
import { calibrate } from '../src/model.mjs';
import { bestLineup, evaluate, normalCdf } from '../src/optimize.mjs';
import { nextNight, report, WIDTH } from '../src/cli.mjs';

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
  // Step 3, last try, weak night: wait only if a big night follows.
  assert.deepEqual(advise(2, 1, [0, 0.08]), { small: 1, big: 0 });
  // Step 5 pays no Gems: get through it in one night.
  assert.equal(lineupsToSet(4, 4, [0, 0.01, 0.015, 0.017, 0.018], BOARD.big), 4);
  // A lineup already running that will very likely win makes further tries pointless at Step 3.
  assert.equal(lineupsToSet(2, 2, [0.97, 0.972, 0.973], BOARD.small), 0);
  // Step 4, last try, two lineups running: a third with about 2 % is a close call before a big night, a clear one before a small night.
  const last = [0.098, 0.116];
  assert.ok(choose(3, 1, last, BOARD.big).margin < 0.1 && choose(3, 1, last, BOARD.big).alt === 0);
  assert.ok(choose(3, 1, last, BOARD.small).margin > 0.5 && choose(3, 1, last, BOARD.small).count === 1);
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
});
