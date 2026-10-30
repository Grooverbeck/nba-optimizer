# NBA-Optimizer (Sorare NBA Career)

Schlägt für LuckyPhil die besten Lineups im aktuellen Step des NBA-Career-Boards vor (Set Divination).
Lokal, ohne Abhängigkeiten, nur anonyme Lesezugriffe auf die Sorare-API (kein Key, kein Login).

## Starten

```bash
npm start                        # aktueller Step, so viele Lineups wie noch frei sind
node src/cli.mjs --step 2        # bestimmter Step
node src/cli.mjs --lineups 2     # Anzahl Vorschläge
node src/cli.mjs --offline data/<datei>.json   # ohne Sorare, mit gespeicherten Rohdaten
npm test
```

Ausgabe in der Konsole und in `out/`. Rohdaten landen in `data/`.

## Regeln (Stand 30.10.2026, live von Sorare gelesen)

- 6 Steps, Ziele 150 / 180 / 210 / 240 / 280 / 300 Punkte, bis 4 Lineups je Step.
- 5 Spieler, beliebige Position, nur Common, zusammen max. 16 Sterne.
- Kein Kapitän. Editionsbonus: shiny +5 %, holo +10 %, shiny variant +15 %, holo variant +20 %, full art +30 %.
- Jede Karte zählt mit ihrem nächsten Spiel im Step.

## Rechnung

- Erwartete Punkte = Sorare-Prognose für das Spiel × Editionsbonus.
- Streuung = Standardabweichung der letzten 15 Spiele (mindestens 6 Punkte).
- Gesucht wird das Lineup mit der höchsten Chance, das Ziel zu erreichen (alle Kombinationen, Sterne-Limit).
- Mehrere Lineups: das beste zuerst, dann das beste aus den übrigen Karten, usw.
- Karten in schon gesetzten Lineups werden nicht vorgeschlagen; das gesetzte Lineup wird mitbewertet.
- Karten mit Prognose 0 (verletzt, spielt nicht) und Spiele, die schon laufen, fallen raus.

## Sorare-Abfragen

Pro Lauf etwa 9 anonyme Anfragen.
Anonyme Grenzen: Tiefe 7, Komplexität 500. Deshalb 16 Karten pro Anfrage. Ein gesetztes Lineup ist anonym
nur über die reine UUID lesbar (`so5.taskLineup`).
