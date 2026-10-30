import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestLineup, evaluate, normalCdf, planLineups } from '../src/optimize.mjs';
import { buildCandidates, editionBonuses } from '../src/model.mjs';

const rules = { slots: 5, maxStars: 16 };
const card = (id, stars, mean, sd = 8, player = id) => ({ card: id, player, name: id, stars, mean, sd });

test('normalCdf matches known values', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1) - 0.1587) < 1e-3);
});

test('star cap is respected even when stronger players exist', () => {
  const pool = [card('a', 5, 50), card('b', 5, 48), card('c', 5, 47), card('d', 2, 25), card('e', 2, 24),
    card('f', 1, 20), card('g', 1, 19), card('h', 3, 30)];
  const best = bestLineup(pool, rules, 150);
  assert.equal(best.cards.length, 5);
  assert.ok(best.stars <= 16);
});

test('a player is used once per lineup, and lineups share no card', () => {
  const pool = [card('x1', 3, 40, 8, 'x'), card('x2', 3, 40, 8, 'x'), ...'abcdefghij'.split('').map((id, i) => card(id, 3, 30 - i))];
  const { lineups } = planLineups(pool, rules, 150, 2);
  for (const l of lineups) assert.equal(new Set(l.cards.map(c => c.player)).size, 5);
  const all = lineups.flatMap(l => l.cards.map(c => c.card));
  assert.equal(new Set(all).size, all.length);
  assert.ok(lineups.every(l => l.cards.some(c => c.player === 'x')));
});

test('chance prefers reaching the target over raw points', () => {
  // Same mean, lower spread wins when the mean is above target.
  const safe = evaluate([card('s', 3, 160, 5)], 150).chance;
  const risky = evaluate([card('r', 3, 160, 40)], 150).chance;
  assert.ok(safe > risky);
});

test('edition bonus and exclusions in the model', () => {
  const step = { id: 's1', level: 0, target: 150, state: 'PLAYABLE', remainingLineupsCount: 4,
    engineConfiguration: { captain: null, specialEditionCards: { editions: [{ bonus: 0.05, edition_names: ['divination_shiny_base'] }] } },
    displayedTypedRules: [{ key: 'AverageScores', averageType: 'STARS', max: 16 }, { key: 'Appearances', appearances: [1, 2, 3, 4, 5] }] };
  const player = slug => ({ slug, displayName: slug, gameplayTierStars: 2, activeClub: { slug: 't' } });
  const game = (date, projectedScore) => [{ projectedScore, anyGame: { id: 'g', date, statusTyped: 'scheduled', homeTeam: { slug: 't' }, awayTeam: { slug: 'u' } } }];
  const snapshot = { stepId: 's1', steps: [step], lineups: [{ id: 'l1', cards: ['used'] }],
    cards: [
      { slug: 'shiny', cardEditionName: 'divination_shiny_base', anyPositions: [], basketballPlayer: player('p1') },
      { slug: 'zero', cardEditionName: 'divination_standard_base', anyPositions: [], basketballPlayer: player('p2') },
      { slug: 'used', cardEditionName: 'divination_standard_base', anyPositions: [], basketballPlayer: player('p3') },
      { slug: 'past', cardEditionName: 'divination_standard_base', anyPositions: [], basketballPlayer: player('p4') },
    ],
    eligibility: [
      { slug: 'shiny', eligiblePlayerGameScores: game('2026-11-01T00:00:00Z', 20), basketballPlayer: { rawPlayerGameScores: [10, 30, null] } },
      { slug: 'zero', eligiblePlayerGameScores: game('2026-11-01T00:00:00Z', 0) },
      { slug: 'used', eligiblePlayerGameScores: game('2026-11-01T00:00:00Z', 25) },
      { slug: 'past', eligiblePlayerGameScores: game('2026-10-29T00:00:00Z', 25) },
    ] };
  const { candidates, excluded, inLineups } = buildCandidates(snapshot, new Date('2026-10-30T12:00:00Z'));
  assert.deepEqual(candidates.map(c => c.card), ['shiny']);
  assert.ok(Math.abs(candidates[0].mean - 21) < 1e-9);
  assert.equal(candidates[0].playedShare, 2 / 3);
  assert.deepEqual(inLineups.map(c => c.card), ['used']);
  assert.deepEqual(excluded.map(c => c.card).sort(), ['past', 'zero']);
  assert.equal(editionBonuses(step.engineConfiguration).get('divination_shiny_base'), 0.05);
});
