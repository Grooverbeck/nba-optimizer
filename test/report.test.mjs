import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report, WIDTH } from '../src/cli.mjs';

test('report stays within the narrow width', () => {
  const step = { id: 's1', level: 0, target: 150, state: 'LINEUP_SET', remainingLineupsCount: 2,
    engineConfiguration: { captain: null, specialEditionCards: { editions: [{ bonus: 0.15, edition_names: ['divination_shiny_variant_1'] }] } },
    displayedTypedRules: [{ key: 'Scarcity', rarities: ['common'] }, { key: 'AverageScores', averageType: 'STARS', max: 16 },
      { key: 'Appearances', appearances: [1, 2, 3, 4, 5] }] };
  const names = ['Isaiah Hartenstein', 'Alperen Şengün', "Jae'Sean Tate", 'Shai Gilgeous-Alexander', 'Kyshawn George',
    'Payton Pritchard', 'Ausar Thompson', 'Toumani Camara', 'Draymond Green', 'Christian Braun', 'Moussa Diabaté', 'Ben Simmons'];
  const cards = names.map((name, i) => ({ slug: `c${i}`, cardEditionName: i === 0 ? 'divination_shiny_variant_1' : 'divination_standard_base',
    anyPositions: [], basketballPlayer: { slug: `p${i}`, displayName: name, gameplayTierStars: 2.5, activeClub: { slug: 'portland-trail-blazers' } } }));
  const eligibility = cards.map((c, i) => ({ slug: c.slug, basketballPlayer: { rawPlayerGameScores: [20, 30, 25] },
    eligiblePlayerGameScores: [{ projectedScore: i === 11 ? 0 : 30 + i, anyGame: { id: `g${i}`, date: '2026-11-01T00:30:00Z', statusTyped: 'scheduled',
      homeTeam: { slug: 'minnesota-timberwolves' }, awayTeam: { slug: 'portland-trail-blazers' } } }] }));
  const snapshot = { fetchedAt: '2026-10-30T16:25:00Z', manager: 'luckyphil', set: { name: 'Divination' }, stepId: 's1', steps: [step],
    lineups: [{ id: 'l1', aasmState: 'READY', cards: ['c5', 'c6', 'c7', 'c8', 'c9'] }], cards, eligibility };
  const { text, plan } = report(snapshot, { now: new Date('2026-10-30T17:00:00Z') });
  const wide = text.split('\n').filter(l => l.length > WIDTH);
  assert.deepEqual(wide, []);
  assert.equal(plan.lineups.length, 1);
  assert.match(text, /== Schon gesetzt 1 ==/);
  assert.match(text, /@ Timberwolves/);
  assert.match(text, /Spielen wohl nicht \(1\): Ben Simmons/);
});

test('a failed lineup frees its cards and is listed with its score', () => {
  const step = { id: 's1', level: 3, target: 240, state: 'LINEUP_SET', remainingLineupsCount: 3,
    engineConfiguration: { captain: null, specialEditionCards: { editions: [] } },
    displayedTypedRules: [{ key: 'Scarcity', rarities: ['common'] }, { key: 'AverageScores', averageType: 'STARS', max: 16 },
      { key: 'Appearances', appearances: [1, 2, 3, 4, 5] }] };
  const cards = [0, 1, 2, 3, 4, 5].map(i => ({ slug: `c${i}`, cardEditionName: 'divination_standard_base', anyPositions: [],
    basketballPlayer: { slug: `p${i}`, displayName: `Spieler ${i}`, gameplayTierStars: 3, activeClub: { slug: 'utah-jazz' } } }));
  const eligibility = cards.map((c, i) => ({ slug: c.slug, basketballPlayer: { rawPlayerGameScores: [30, 40] },
    eligiblePlayerGameScores: [{ projectedScore: 40 + i, anyGame: { id: `g${i}`, date: '2026-11-08T01:00:00Z', statusTyped: 'scheduled',
      homeTeam: { slug: 'utah-jazz' }, awayTeam: { slug: 'boston-celtics' } } }] }));
  const snapshot = { fetchedAt: '2026-11-07T12:00:00Z', manager: 'luckyphil', set: { name: 'Divination' }, stepId: 's1', steps: [step],
    lineups: [{ id: 'l1', aasmState: 'FAILED', score: 147.8, cards: ['c1', 'c2', 'c3', 'c4', 'c5'] }], cards, eligibility };
  const { text, plan } = report(snapshot, { now: new Date('2026-11-07T12:00:00Z'), lineups: 1 });
  assert.match(text, /Nicht geschafft: 147,8 Pkt/);
  assert.doesNotMatch(text, /Schon gesetzt/);
  assert.deepEqual(plan.lineups[0].cards.map(c => c.card).sort(), ['c1', 'c2', 'c3', 'c4', 'c5']);
});

test('a running lineup shows its points so far and only open games count as open', async () => {
  const { runningLineup } = await import('../src/cli.mjs');
  const step = { id: 's1', level: 3, target: 240, state: 'LINEUP_SET', remainingLineupsCount: 2,
    engineConfiguration: { captain: null, specialEditionCards: { editions: [] } },
    displayedTypedRules: [{ key: 'Scarcity', rarities: ['common'] }, { key: 'AverageScores', averageType: 'STARS', max: 16 },
      { key: 'Appearances', appearances: [1, 2, 3, 4, 5] }] };
  const cards = [0, 1, 2, 3, 4].map(i => ({ slug: `c${i}`, cardEditionName: 'divination_standard_base', anyPositions: [],
    basketballPlayer: { slug: `p${i}`, displayName: `Spieler ${i}`, gameplayTierStars: 3, activeClub: { slug: 'utah-jazz' } } }));
  const eligibility = cards.map((c, i) => ({ slug: c.slug, basketballPlayer: { rawPlayerGameScores: [30, 40] },
    eligiblePlayerGameScores: [{ projectedScore: 40, anyGame: { id: `g${i}`, date: '2026-11-09T00:00:00Z', statusTyped: 'scheduled',
      homeTeam: { slug: 'utah-jazz' }, awayTeam: { slug: 'boston-celtics' } } }] }));
  const played = (card, score) => ({ card, score, game: { id: 'x', date: '2026-11-08T01:00:00Z', status: 'played' } });
  const lineup = { id: 'l1', aasmState: 'READY', score: 85.1, cards: ['c0', 'c1', 'c2', 'c3', 'c4'],
    appearances: [played('c0', 29.7), played('c1', 39.9), played('c2', 15.5), played('c3', 0),
      { card: 'c4', score: 0, game: { id: 'g4', date: '2026-11-09T00:00:00Z', status: 'scheduled' } }] };
  const snapshot = { fetchedAt: '2026-11-08T08:00:00Z', manager: 'luckyphil', set: { name: 'Divination' }, stepId: 's1', steps: [step],
    lineups: [lineup], cards, eligibility };
  const { text } = report(snapshot, { now: new Date('2026-11-08T08:00:00Z'), lineups: 0 });
  assert.match(text, /== Läuft 1 ==/);
  assert.match(text, /85,1 Pkt bisher · noch 1 offen/);
  assert.match(text, /Chance 0 %/);
  assert.equal((text.match(/  gespielt/g) ?? []).length, 4);
  assert.deepEqual(text.split('\n').filter(l => l.length > WIDTH), []);
  const { buildCandidates } = await import('../src/model.mjs');
  const r = runningLineup(lineup, buildCandidates(snapshot, new Date('2026-11-08T08:00:00Z')).inLineups, 125);
  assert.ok(Math.abs(r.mean - 125.1) < 1e-9 && r.chance > 0.5);
});

test('nightCutoff ends tonight at 12:00 Berlin, also in summer time and during the night', async () => {
  const { nightCutoff } = await import('../src/cli.mjs');
  const iso = (n, now) => nightCutoff(n, new Date(now)).toISOString();
  assert.equal(iso(1, '2026-11-04T16:25:00Z'), '2026-11-05T11:00:00.000Z'); // Wed 17:25 -> Thu 12:00
  assert.equal(iso(1, '2026-11-04T23:30:00Z'), '2026-11-05T11:00:00.000Z'); // Thu 00:30, night running
  assert.equal(iso(1, '2026-11-05T09:00:00Z'), '2026-11-06T11:00:00.000Z'); // Thu 10:00 -> Fri 12:00
  assert.equal(iso(2, '2026-11-04T16:25:00Z'), '2026-11-06T11:00:00.000Z');
  assert.equal(iso(1, '2026-04-01T16:00:00Z'), '2026-04-02T10:00:00.000Z'); // CEST
});
