#!/usr/bin/env node
// Usage: node src/calibrate.mjs
// Compares what the saved snapshots in data/ predicted with what the players then scored,
// and prints the figures for CALIBRATION in model.mjs. Needs snapshots from before and after each night.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALIBRATION } from './model.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const spread = a => a.length < 2 ? null : Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// One entry per player and snapshot: the projection for the next game and the latest scores (null = did not play).
const snapshots = readdirSync(DATA).filter(f => f.endsWith('.json')).sort().flatMap(f => {
  try {
    const s = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
    if (!s.eligibility || !s.fetchedAt) return [];
    const players = new Map();
    for (const e of s.eligibility) {
      const game = e.eligiblePlayerGameScores?.[0];
      if (e.basketballPlayer?.slug && !players.has(e.basketballPlayer.slug)) players.set(e.basketballPlayer.slug,
        { scores: e.basketballPlayer.rawPlayerGameScores ?? [], projection: game?.projectedScore ?? 0, game: game?.anyGame });
    }
    return [{ at: Date.parse(s.fetchedAt), players }];
  } catch { return []; }
});

// The last prediction before each game, then the first later snapshot whose score list has moved on by that game.
const predictions = new Map();
snapshots.forEach((s, i) => { for (const [player, v] of s.players) {
  const start = v.game ? Date.parse(v.game.date) : 0;
  if (v.projection > 0 && start > s.at) predictions.set(`${player}|${v.game.id}`, { player, i, start, ...v, lead: (start - s.at) / 3600e3 });
} });
const rows = [];
for (const p of predictions.values()) {
  for (let j = p.i + 1; j < snapshots.length; j++) {
    const now = snapshots[j].players.get(p.player)?.scores;
    if (snapshots[j].at < p.start + 4 * 3600e3 || !now?.length || same(now, p.scores)) continue;
    const shift = [1, 2, 3, 4, 5, 6].find(n => now.length - n >= 5 && same(now.slice(n), p.scores.slice(0, now.length - n)));
    if (shift) rows.push({ ...p, actual: now[shift - 1], sd: Math.max(spread(p.scores.filter(x => x != null)) ?? p.projection / 3, 6) });
    break;
  }
}

const used = rows.filter(r => r.lead <= 30), played = used.filter(r => r.actual != null);
const z = list => list.map(r => (r.actual - r.projection) / r.sd);
const share = list => list.length ? (list.filter(r => r.actual == null).length / list.length).toFixed(3) : '-';
console.log(`${snapshots.length} Snapshots, ${used.length} Einsätze, ${played.length} gespielt`);
console.log(`spread: ${spread(z(played)).toFixed(2)}`);
let from = 0;
for (const band of CALIBRATION.bands) {
  const inBand = used.filter(r => r.projection >= from && r.projection < band.below);
  const late = inBand.filter(r => r.lead <= CALIBRATION.lateHours), early = inBand.filter(r => r.lead > CALIBRATION.lateHours);
  console.log(`Prognose ${from}–${band.below}: out [${share(late)}, ${share(early)}] (${late.length} | ${early.length} Einsätze), shift ${mean(z(inBand.filter(r => r.actual != null))).toFixed(2)}`);
  from = band.below;
}
