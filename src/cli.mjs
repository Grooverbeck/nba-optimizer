#!/usr/bin/env node
// Usage: node src/cli.mjs [--manager luckyphil] [--step 1] [--lineups 3] [--offline data/<file>.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { buildCandidates } from './model.mjs';
import { evaluate, planLineups } from './optimize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function args(argv) {
  const out = { manager: 'luckyphil' };
  for (let i = 0; i < argv.length; i += 2) {
    const [key, value] = [argv[i].replace(/^--/, ''), argv[i + 1]];
    if (!['manager', 'step', 'lineups', 'offline'].includes(key) || value == null) throw new Error(`Unbekannte Option: ${argv[i]}`);
    out[key] = ['step', 'lineups'].includes(key) ? Number(value) : value;
  }
  return out;
}

const berlin = iso => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const pct = x => `${Math.round(x * 100)} %`;
const num = x => x.toFixed(1).replace('.', ',');
const opponent = c => c.game ? (c.game.home === c.team ? `vs ${c.game.away}` : `@ ${c.game.home}`) : '';

function table(cards) {
  const rows = [['Spieler', 'Sterne', 'Team', 'Spiel', 'Anwurf (Berlin)', 'Prognose', 'Bonus', 'Erwartet']];
  for (const c of cards) rows.push([c.name, String(c.stars).replace('.', ','), c.team, opponent(c), c.game ? berlin(c.game.date) : '-',
    num(c.projection), c.bonus ? `+${Math.round(c.bonus * 100)} %` : '-', num(c.mean)]);
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  return rows.map(r => '  ' + r.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd());
}

function lineupBlock(title, lineup, rules) {
  return [`${title}: erwartet ${num(lineup.mean)} Punkte, Chance aufs Ziel ${pct(lineup.chance)}, Sterne ${String(lineup.stars).replace('.', ',')}/${rules.maxStars}`,
    ...table(lineup.cards), ''];
}

export function report(snapshot, options = {}) {
  const { step, rules, candidates, excluded, inLineups } = buildCandidates(snapshot, options.now);
  const count = options.lineups ?? step.remainingLineupsCount;
  const plan = planLineups(candidates, rules, step.target, count);
  const lines = [
    `NBA Career · Set ${snapshot.set.name} · Step ${step.level + 1} (${step.state}) · Ziel ${step.target} · ${snapshot.manager}`,
    `Regeln: ${rules.slots} Spieler, max. ${rules.maxStars} Sterne, ${rules.rarities.join('/')}, ${rules.captain ? `Kapitän +${rules.captain * 100} %` : 'kein Kapitän'}, Editionsbonus.`,
    `Daten von Sorare: ${berlin(snapshot.fetchedAt)} · ${snapshot.cards.length} Karten, ${candidates.length} spielbar.`,
    '',
  ];
  (snapshot.lineups ?? []).forEach((l, i) => {
    const cards = inLineups.filter(c => c.lineup === l.id);
    lines.push(...lineupBlock(`Schon gesetzt ${i + 1} (${l.aasmState})`, { cards, ...evaluate(cards, step.target) }, rules));
  });
  lines.push(`Vorschlag: ${plan.lineups.length} ${inLineups.length ? 'weitere ' : ''}Lineup(s) (noch frei: ${step.remainingLineupsCount}).`, '');
  plan.lineups.forEach((l, i) => lines.push(...lineupBlock(`Lineup ${i + 1}`, l, rules)));
  if (plan.lineups.length > 1) lines.push(`Chance, dass mindestens eins davon das Ziel schafft: ${pct(plan.atLeastOne)}`, '');
  const notPlaying = excluded.filter(c => c.reason.startsWith('Sorare-Prognose 0')).map(c => c.name);
  if (notPlaying.length) lines.push(`Ohne Prognose (spielen wohl nicht): ${notPlaying.join(', ')}`);
  const started = excluded.filter(c => c.reason.startsWith('Spiel läuft')).length;
  if (started) lines.push(`${started} Karten weggelassen, weil ihr Spiel schon läuft.`);
  lines.push('', 'Erwartet = Sorare-Prognose × Editionsbonus. Chance = Normalverteilung mit Streuung der letzten 15 Spiele.');
  return { text: lines.join('\n'), plan, step };
}

async function main() {
  const opts = args(process.argv.slice(2));
  let snapshot;
  if (opts.offline) snapshot = JSON.parse(readFileSync(opts.offline, 'utf8'));
  else {
    snapshot = await collect({ manager: opts.manager, stepLevel: opts.step, log: m => console.error(m) });
    mkdirSync(join(ROOT, 'data'), { recursive: true });
    const file = join(ROOT, 'data', `${snapshot.fetchedAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(snapshot, null, 1));
    console.error(`Rohdaten: ${file}`);
  }
  const stored = snapshot.steps.find(s => s.id === snapshot.stepId);
  if (opts.offline && opts.step && stored.level !== opts.step - 1) throw new Error(`Die Rohdaten gehören zu Step ${stored.level + 1}.`);
  const { text, step } = report(snapshot, { lineups: opts.lineups });
  console.log(text);
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  const out = join(ROOT, 'out', `step${step.level + 1}-${snapshot.fetchedAt.replace(/[:.]/g, '-')}.txt`);
  writeFileSync(out, text + '\n');
  console.error(`Gespeichert: ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e.message); process.exit(1); });
