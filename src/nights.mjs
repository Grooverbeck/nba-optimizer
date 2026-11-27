// NBA nights in Berlin time, and the next night with games from the clubs' schedules.

// End of the Nth NBA night: 12:00 Berlin after it (DST-safe). Before 06:00 the running night still counts as tonight.
export function nightCutoff(days, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now.getTime() - 6 * 3600e3));
  const noonUtc = new Date(`${day}T12:00:00Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() + days);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(noonUtc));
  return new Date(noonUtc.getTime() - (hour - 12) * 3600e3);
}

// The first night after tonight that has games: its games (id -> start), the clubs that play,
// and `end` (12:00 Berlin after it, which names the night: "Nacht auf So").
// `schedule` = [{ club, games: [{ id, date }] }], as far ahead as it was read.
export function nextScheduledNight(schedule, now = new Date()) {
  for (let n = 2; n <= 8; n++) {
    const from = nightCutoff(n - 1, now).getTime(), to = nightCutoff(n, now).getTime();
    const games = new Map(), clubs = new Set();
    for (const s of schedule) for (const g of s.games) {
      const start = Date.parse(g.date);
      if (start >= from && start < to) { games.set(g.id, g.date); clubs.add(s.club); }
    }
    if (games.size) return { games, clubs, end: new Date(to) };
  }
  return null;
}
