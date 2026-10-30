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

// Narrow output (max. 40 characters per line) so it fits a phone or a small terminal pane.
export const WIDTH = 40;

const berlin = iso => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.weekday.replace('.', '')} ${p.hour}:${p.minute}`;
};
const pct = x => `${Math.round(x * 100)} %`;
const num = x => x.toFixed(1).replace('.', ',');
const stars = x => `${String(x).replace('.', ',')}★`;
const teamName = slug => { const w = slug.split('-').pop(); return w[0].toUpperCase() + w.slice(1); };
const opponent = c => c.game.home === c.team ? `vs ${teamName(c.game.away)}` : `@ ${teamName(c.game.home)}`;

function wrap(text) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const last = lines.length - 1;
    if (lines[last] && lines[last].length + 1 + word.length > WIDTH) lines.push(word);
    else lines[last] = lines[last] ? `${lines[last]} ${word}` : word;
  }
  return lines;
}

// One player per line (name, stars, expected points), kickoff and bonus on a short second line.
function players(cards) {
  const w = Math.max(...cards.map(c => c.name.length));
  return cards.flatMap(c => [
    `${c.name.padEnd(w)} ${stars(c.stars).padStart(5)} ${num(c.mean).padStart(5)}`,
    `  ${c.game ? `${berlin(c.game.date)} ${opponent(c)}` : 'kein Spiel'}${c.bonus ? ` · +${Math.round(c.bonus * 100)} %` : ''}`,
  ]);
}

function lineupBlock(title, lineup, rules) {
  return [`== ${title} ==`,
    `${num(lineup.mean)} Pkt · Chance ${pct(lineup.chance)} · ${String(lineup.stars).replace('.', ',')}/${rules.maxStars}★`,
    ...players(lineup.cards), ''];
}

export function report(snapshot, options = {}) {
  const { step, rules, candidates, excluded, inLineups } = buildCandidates(snapshot, options.now);
  const count = options.lineups ?? step.remainingLineupsCount;
  const plan = planLineups(candidates, rules, step.target, count);
  const lines = [
    `NBA Step ${step.level + 1} · Ziel ${step.target} · ${snapshot.manager}`,
    `Set ${snapshot.set.name} · Stand ${berlin(snapshot.fetchedAt)}`,
    `${snapshot.cards.length} Karten, ${candidates.length} spielbar`,
    ...wrap(`Regeln: ${rules.slots} Spieler, max. ${rules.maxStars}★, ${rules.rarities.join('/')}, ${rules.captain ? `Kapitän +${rules.captain * 100} %` : 'kein Kapitän'}, Editionsbonus`),
    '',
  ];
  (snapshot.lineups ?? []).forEach((l, i) => {
    const cards = inLineups.filter(c => c.lineup === l.id);
    lines.push(...lineupBlock(`Schon gesetzt ${i + 1}`, { cards, ...evaluate(cards, step.target) }, rules));
  });
  lines.push(`Vorschlag: ${plan.lineups.length} ${inLineups.length ? 'weitere ' : ''}Lineup(s)`, `(noch frei: ${step.remainingLineupsCount})`, '');
  plan.lineups.forEach((l, i) => lines.push(...lineupBlock(`Lineup ${i + 1}`, l, rules)));
  if (plan.lineups.length > 1) lines.push(...wrap(`Mindestens eins schafft das Ziel: ${pct(plan.atLeastOne)}`), '');
  const notPlaying = excluded.filter(c => c.reason.startsWith('Sorare-Prognose 0')).map(c => c.name);
  if (notPlaying.length) lines.push(...wrap(`Spielen wohl nicht (${notPlaying.length}): ${notPlaying.join(', ')}`), '');
  const started = excluded.filter(c => c.reason.startsWith('Spiel läuft')).length;
  if (started) lines.push(...wrap(`${started} Karten weggelassen, ihr Spiel läuft schon.`), '');
  lines.push(...wrap('Pkt = Sorare-Prognose × Editionsbonus. Chance aus der Streuung der letzten 15 Spiele.'));
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
