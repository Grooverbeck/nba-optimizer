#!/usr/bin/env node
// Usage: node src/cli.mjs [--manager luckyphil] [--step 1] [--lineups 3] [--tage 1] [--offline data/<file>.json]
// --tage N: only games before 12:00 Berlin N days from today (--tage 1 = tonight).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { advise, BIG_NIGHT, BOARD, boardFor, choose, CLOSE } from './advice.mjs';
import { activeLineups, buildCandidates, calibrate, CALIBRATION, cancelledLineups, failedLineups } from './model.mjs';
import { bestLineup, evaluate, planLineups } from './optimize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function args(argv) {
  const out = { manager: 'luckyphil' };
  for (let i = 0; i < argv.length; i += 2) {
    const [key, value] = [argv[i].replace(/^--/, ''), argv[i + 1]];
    if (!['manager', 'step', 'lineups', 'tage', 'offline'].includes(key) || value == null) throw new Error(`Unbekannte Option: ${argv[i]}`);
    out[key] = ['step', 'lineups', 'tage'].includes(key) ? Number(value) : value;
  }
  return out;
}

// End of the Nth NBA night: 12:00 Berlin after it (DST-safe). Before 06:00 the running night still counts as tonight.
export function nightCutoff(days, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now.getTime() - 6 * 3600e3));
  const noonUtc = new Date(`${day}T12:00:00Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() + days);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(noonUtc));
  return new Date(noonUtc.getTime() - (hour - 12) * 3600e3);
}

// Narrow output (max. 40 characters per line) so it fits a phone or a small terminal pane.
export const WIDTH = 40;

const berlin = iso => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.weekday.replace('.', '')} ${p.hour}:${p.minute}`;
};
// Whole percent; one decimal below 10 %, where the far steps are decided.
const pct = x => x >= 0.0995 || x < 0.0005 ? `${Math.round(x * 100)} %` : `${(x * 100).toFixed(1).replace('.', ',')} %`;
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
    `${c.name.padEnd(w)} ${stars(c.stars).padStart(5)} ${num(c.points).padStart(5)}`,
    `  ${c.game ? `${berlin(c.game.date)} ${opponent(c)}` : 'kein Spiel'}${c.bonus ? ` · +${Math.round(c.bonus * 100)} %` : ''}`,
  ]);
}

// An NBA game lasts about 2.5 hours from its listed start.
export const GAME_HOURS = 2.5;

// A set lineup: finished games count with their real points, open games with the projection.
// A running game counts with its live points plus the part of the projection still to come (by elapsed time).
export function runningLineup(lineup, inLineups, target, at = new Date()) {
  const cards = lineup.cards.map(slug => inLineups.find(c => c.card === slug)).filter(Boolean);
  const byCard = new Map((lineup.appearances ?? []).map(a => [a.card, a]));
  const withStatus = status => cards.filter(c => byCard.get(c.card)?.game?.status === status);
  const done = new Map(withStatus('played').map(c => [c.card, byCard.get(c.card).score ?? 0]));
  const live = new Map(withStatus('playing').map(c => {
    const a = byCard.get(c.card), elapsed = (at.getTime() - Date.parse(a.game.date)) / (GAME_HOURS * 3600e3);
    const left = Math.min(1, Math.max(0, 1 - elapsed));
    return [c.card, { score: a.score ?? 0, left, rest: { ...c, points: c.points * left, mean: c.mean * left, sd: c.sd * Math.sqrt(left), out: 0 } }];
  }));
  const open = cards.filter(c => !done.has(c.card) && !live.has(c.card));
  const fixed = [...done.values(), ...[...live.values()].map(l => l.score)].reduce((a, b) => a + b, 0);
  const rest = evaluate([...open, ...[...live.values()].map(l => l.rest)], target - fixed);
  return { cards, done, live, open, fixed, points: fixed + rest.points, chance: rest.chance, stars: cards.reduce((a, c) => a + c.stars, 0) };
}

function runningBlock(title, r, rules) {
  const w = Math.max(...r.cards.map(c => c.name.length));
  const scored = (c, points, note) => [`${c.name.padEnd(w)} ${stars(c.stars).padStart(5)} ${num(points).padStart(5)}`, `  ${note}`];
  const rows = r.cards.flatMap(c => r.done.has(c.card) ? scored(c, r.done.get(c.card), 'gespielt')
    : r.live.has(c.card) ? scored(c, r.live.get(c.card).score,
      r.live.get(c.card).left > 0 ? `läuft · Rest ca. ${num(r.live.get(c.card).rest.points)}` : 'läuft · gleich vorbei')
    : players([c]).map(line => line.replace(c.name, c.name.padEnd(w))));
  return [`== ${title} ==`,
    r.live.size ? `${num(r.fixed)} Pkt bisher · ${r.live.size} läuft · ${r.open.length} offen` : `${num(r.fixed)} Pkt bisher · noch ${r.open.length} offen`,
    `Erwartet ${num(r.points)} · Chance ${pct(r.chance)} · ${String(r.stars).replace('.', ',')}/${rules.maxStars}★`,
    ...rows, ''];
}

function lineupBlock(title, lineup, rules) {
  const last = lineup.cards.map(c => c.game?.date).filter(Boolean).sort().at(-1);
  return [`== ${title} ==`,
    `${num(lineup.points)} Pkt · Chance ${pct(lineup.chance)} · ${String(lineup.stars).replace('.', ',')}/${rules.maxStars}★`,
    ...(last ? [`Letztes Spiel: ${berlin(last)}`] : []),
    ...players(lineup.cards), ''];
}

// The next night with games, as far as the snapshot shows it: a card only lists its next game,
// so a game between two teams that both play tonight is missing. The count is a lower bound.
export function nextNight(cards, now) {
  for (let n = 2; n <= 8; n++) {
    const from = nightCutoff(n - 1, now).getTime(), to = nightCutoff(n, now).getTime();
    const games = new Map(cards.filter(c => c.game && Date.parse(c.game.date) >= from && Date.parse(c.game.date) < to).map(c => [c.game.id, c.game.date]));
    if (games.size) return { games: games.size, first: [...games.values()].sort()[0] };
  }
  return null;
}

// With the clubs' schedules the next night is known exactly: its games, which of the own cards play in it,
// and roughly what the best lineup reaches there. Sorare projects only a player's next game, so the current
// projection stands in for that night; cards with projection 0 are left out.
export function nextNightFromSchedule(schedule, cards, rules, target, now) {
  for (let n = 2; n <= 8; n++) {
    const from = nightCutoff(n - 1, now).getTime(), to = nightCutoff(n, now).getTime();
    const games = new Map(), clubs = new Set();
    for (const s of schedule) for (const g of s.games) {
      const start = Date.parse(g.date);
      if (start >= from && start < to) { games.set(g.id, g.date); clubs.add(s.club); }
    }
    if (!games.size) continue;
    const pool = cards.filter(c => clubs.has(c.team) && c.projection > 0).map(c => ({ ...c, out: calibrate(c.projection, 1, 0).out }));
    return { games: games.size, first: [...games.values()].sort()[0], cards: pool.length, chance: bestLineup(pool, rules, target)?.chance ?? 0 };
  }
  return null;
}

// How many of the planned lineups to set tonight, and when. `won` = chance that a lineup already running wins.
function adviceBlock(step, plan, won, next, read, candidates) {
  const tries = Math.min(step.remainingLineupsCount, plan.lineups.length);
  const chances = [won, ...plan.cumulative.slice(0, tries).map(c => 1 - (1 - won) * (1 - c))];
  const pick = board => choose(step.level, step.remainingLineupsCount, chances, board);
  const say = m => m === 0 ? 'heute nicht setzen' : m === tries ? (m === 1 ? 'das Lineup setzen' : `alle ${m} Lineups setzen`)
    : m === 1 ? 'nur Lineup 1 setzen' : `Lineup 1 bis ${m} setzen`;
  const up = text => text[0].toUpperCase() + text.slice(1);
  const night = next ? `Nacht auf ${berlin(next.first).split(' ')[0]}` : 'nächste Nacht';
  const lines = ['== Empfehlung =='];
  let count, picks, most;
  if (next?.chance != null) {
    // The next night is known from the schedule and rated by the own cards that play in it: one answer.
    const one = pick(boardFor(step.level, next.chance));
    count = { small: one.count, big: one.count }; picks = [one]; most = one.count;
    lines.push(...wrap(`${up(say(one.count))}.`),
      ...wrap(`${up(night)}: ${next.games} ${next.games === 1 ? 'Spiel' : 'Spiele'}, ${next.cards} deiner Karten, bestes Lineup etwa ${pct(next.chance)}.`));
  } else {
    // Older raw data without the schedule: only a lower bound of the next night's games is visible.
    count = advise(step.level, step.remainingLineupsCount, chances);
    const big = next && next.games >= BIG_NIGHT;
    if (count.small === count.big) lines.push(...wrap(`${up(say(count.big))}.`));
    else if (big) lines.push(...wrap(`${up(say(count.big))}, den Rest aufheben: Die ${night} hat mind. ${next.games} Spiele.`));
    else lines.push(...wrap(`Hat die ${night} ${BIG_NIGHT} Spiele oder mehr: ${say(count.big)}. Sonst: ${say(count.small)}.`),
      ...(next ? wrap(`Sichtbar sind bisher ${next.games} Spiele.`) : []));
    picks = (big ? ['big'] : count.small === count.big ? ['big', 'small'] : []).map(size => pick(BOARD[size]));
    most = big ? count.big : Math.max(count.small, count.big);
  }
  // Where the next best choice is nearly as good, say so: the board values are rough.
  const close = picks.find(c => c.margin < CLOSE);
  if (close) lines.push(...wrap(`Knapp: ${up(say(close.alt))} ist fast gleich gut.`));
  const first = plan.lineups.slice(0, most).flatMap(l => l.cards.map(c => Date.parse(c.game.date))).sort((a, b) => a - b)[0];
  const late = first - CALIBRATION.lateHours * 3600e3;
  if (most && late > read) lines.push(...wrap(`Erst ab ${berlin(new Date(late).toISOString())} setzen und vorher neu rechnen: Dann fallen weniger Spieler aus.`));
  const tips = [...new Set(candidates.map(c => Date.parse(c.game.date)))].sort((a, b) => a - b);
  const second = tips.find(t => t >= tips[0] + GAME_HOURS * 3600e3);
  if (step.level === 0 && most && second) lines.push(...wrap(`Tipp: Step 1 nur mit den frühen Spielen setzen, nach Spielende einlösen und Step 2 mit den Spielen ab ${berlin(new Date(second).toISOString())} setzen.`));
  return { lines: [...lines, ''], count };
}

export function report(snapshot, options = {}) {
  const now = options.now ?? new Date();
  const { step, rules, candidates: all, excluded, inLineups } = buildCandidates(snapshot, now);
  const cutoff = options.days ? nightCutoff(options.days, now) : null;
  const candidates = cutoff ? all.filter(c => Date.parse(c.game.date) < cutoff.getTime()) : all;
  const count = options.lineups ?? step.remainingLineupsCount;
  const plan = planLineups(candidates, rules, step.target, count);
  const lines = [
    `NBA Step ${step.level + 1} · Ziel ${step.target} · ${snapshot.manager}`,
    `Set ${snapshot.set.name} · Stand ${berlin(snapshot.fetchedAt)}`,
    `${snapshot.cards.length} Karten, ${candidates.length} spielbar`,
    ...(cutoff ? [`Nur Spiele bis ${berlin(cutoff.toISOString())}`, `(${all.length - candidates.length} Karten spielen später)`] : []),
    ...wrap(`Regeln: ${rules.slots} Spieler, max. ${rules.maxStars}★, ${rules.rarities.join('/')}, ${rules.captain ? `Kapitän +${rules.captain * 100} %` : 'kein Kapitän'}, Editionsbonus`),
    '',
  ];
  const scores = list => list.map(l => l.score != null ? `${num(l.score)} Pkt` : '?').join(', ');
  const failed = failedLineups(snapshot), cancelled = cancelledLineups(snapshot);
  if (failed.length) lines.push(...wrap(`Nicht geschafft: ${scores(failed)}${cancelled.length ? '' : ' (Karten wieder frei)'}`));
  if (cancelled.length) lines.push(...wrap(`Abgebrochen: ${scores(cancelled)} (Karten wieder frei)`));
  if (failed.length || cancelled.length) lines.push('');
  let lost = 1;
  activeLineups(snapshot).forEach((l, i) => {
    const r = runningLineup(l, inLineups, step.target, new Date(snapshot.fetchedAt));
    lost *= 1 - r.chance;
    lines.push(...(r.done.size || r.live.size ? runningBlock(`Läuft ${i + 1}`, r, rules)
      : lineupBlock(`Schon gesetzt ${i + 1}`, { cards: r.cards, ...evaluate(r.cards, step.target) }, rules)));
  });
  lines.push(`Vorschlag: ${plan.lineups.length} ${inLineups.length ? 'weitere ' : ''}Lineup(s)`, `(noch frei: ${step.remainingLineupsCount})`, '');
  plan.lineups.forEach((l, i) => lines.push(...lineupBlock(`Lineup ${i + 1}`, l, rules)));
  if (plan.lineups.length > 1) lines.push(...wrap(`Mindestens eins schafft das Ziel: ${pct(plan.atLeastOne)}`), '');
  const owned = [...all, ...excluded, ...inLineups];
  const advice = options.days === 1 && plan.lineups.length
    ? adviceBlock(step, plan, 1 - lost, snapshot.schedule ? nextNightFromSchedule(snapshot.schedule, owned, rules, step.target, now) : nextNight(owned, now),
      Date.parse(snapshot.fetchedAt), candidates) : null;
  if (advice) lines.push(...advice.lines);
  const notPlaying = excluded.filter(c => c.reason.startsWith('Sorare-Prognose 0')).map(c => c.name);
  if (notPlaying.length) lines.push(...wrap(`Spielen wohl nicht (${notPlaying.length}): ${notPlaying.join(', ')}`), '');
  const started = excluded.filter(c => c.reason.startsWith('Spiel läuft')).length;
  if (started) lines.push(...wrap(`${started} Karten weggelassen, ihr Spiel läuft schon.`), '');
  lines.push(...wrap('Pkt = Sorare-Prognose × Editionsbonus. Chance: mit echten Ergebnissen korrigiert (Ausfälle, Prognose, Streuung).'));
  return { text: lines.join('\n'), plan, step, advice: advice?.count ?? null };
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
  const { text, step } = report(snapshot, { lineups: opts.lineups, days: opts.tage });
  console.log(text);
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  const out = join(ROOT, 'out', `step${step.level + 1}-${snapshot.fetchedAt.replace(/[:.]/g, '-')}${opts.tage ? `-tage${opts.tage}` : ''}.txt`);
  writeFileSync(out, text + '\n');
  console.error(`Gespeichert: ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e.message); process.exit(1); });
