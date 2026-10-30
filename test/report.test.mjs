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
