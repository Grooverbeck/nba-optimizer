# NBA-Optimizer (Sorare NBA Career)

Schlägt für LuckyPhil die besten Lineups im aktuellen Step des NBA-Career-Boards vor (Set Divination).
Lokal, ohne Abhängigkeiten, nur anonyme Lesezugriffe auf die Sorare-API (kein Key, kein Login).

## Starten

```bash
npm start                        # aktueller Step, so viele Lineups wie noch frei sind
node src/cli.mjs --step 2        # bestimmter Step
node src/cli.mjs --lineups 2     # Anzahl Vorschläge
node src/cli.mjs --tage 1        # nur Spiele bis morgen 12:00 (heute Nacht), --tage 2 = zwei Nächte
node src/cli.mjs --offline data/<datei>.json   # ohne Sorare, mit gespeicherten Rohdaten
node src/calibrate.mjs           # Korrekturwerte aus den gespeicherten Rohdaten neu ausrechnen
npm test
```

Ausgabe in der Konsole und in `out/`. Rohdaten landen in `data/`.

## Regeln (Stand 30.10.2026, live von Sorare gelesen)

- 6 Steps, Ziele 150 / 180 / 210 / 240 / 280 / 300 Punkte, bis 4 Lineups je Step.
- 5 Spieler, beliebige Position, nur Common, zusammen max. 16 Sterne.
- Kein Kapitän. Editionsbonus: shiny +5 %, holo +10 %, shiny variant +15 %, holo variant +20 %, full art +30 %.
- Jede Karte zählt mit ihrem nächsten Spiel im Step.

## Rechnung

- Angezeigte Punkte = Sorare-Prognose für das Spiel × Editionsbonus.
- Streuung = Standardabweichung der letzten 15 Spiele (mindestens 6 Punkte).
- Die Chance ist mit echten Ergebnissen korrigiert (2.384 Spieler-Einsätze, 30.10.–25.11.2026, Werte in
  `CALIBRATION` in `src/model.mjs`):
  - Ausfälle: Ein Spieler mit Prognose ab 25 spielte in 1,3 % der Fälle nicht, wenn die Prognose höchstens
    6 Stunden vor dem Spiel gelesen wurde, sonst in 5,8 %. Bei Prognose 12–25 sind es 3,2 % und 8,2 %,
    darunter deutlich mehr. Ein Ausfall zählt 0 Punkte.
  - Prognose: Spieler mit Prognose ab 25 holen im Schnitt etwas weniger als vorhergesagt.
  - Streuung: Die echten Punkte streuen 1,18-mal so weit.
- Gesucht wird das Lineup mit der höchsten Chance, das Ziel zu erreichen (alle Kombinationen, Sterne-Limit).
  Vorher fallen Karten weg, die von Karten 5 anderer Spieler geschlagen werden (mehr Punkte, nicht mehr Sterne,
  und bei der Streuung nicht schlechter: unter dem Ziel zählt mehr Streuung, über dem Ziel weniger).
- Mehrere Lineups: das beste zuerst, dann das beste aus den übrigen Karten, usw. Steht derselbe Spieler
  mit zwei Karten in zwei Lineups, scheitern sie öfter gemeinsam. Das ist in „Mindestens eins“ eingerechnet.
- Karten in schon gesetzten Lineups werden nicht vorgeschlagen; das gesetzte Lineup wird mitbewertet.
  Läuft es schon, zählen gespielte Spiele mit ihren echten Punkten, nur offene Spiele mit der Prognose.
  Ein Spiel, das gerade läuft, zählt mit den Live-Punkten plus dem Teil der Prognose, der nach der Zeit
  noch fehlt (ein Spiel dauert etwa 2,5 Stunden ab Anwurf).
- Aktueller Step ist der erste, der weder abgeholt noch gesperrt ist, auch wenn alle Versuche schon laufen.
  Ein gescheitertes oder abgebrochenes Lineup kostet einen Versuch, seine Karten sind danach wieder frei.
- Karten mit Prognose 0 (verletzt, spielt nicht) und Spiele, die schon laufen, fallen raus.

## Setzen oder warten

Mit `--tage 1` steht unter den Vorschlägen eine Empfehlung, wie viele Lineups sich heute lohnen.

- Grundlage: ein Entscheidungsmodell über 12 Nächte (15.–26.11.2026). Es kennt den Wert des Boards je Step
  und Zahl der freien Versuche, getrennt nach kleiner und großer Folgenacht (groß = ab 7 Spiele).
  Die Werte stehen in `src/advice.mjs`.
- Gezählt werden nur Gems (10 auf Step 3, 30 auf Step 4). Shards und die Dollar-Preise zählen 0.
- Vier gescheiterte Versuche setzen das Board auf Step 1 zurück.
- Die Folgenacht liest das Tool aus den Karten. Jede Karte zeigt nur ihr nächstes Spiel, deshalb ist die
  Zahl der Spiele eine Untergrenze. Ist sie unter 7, nennt das Tool beide Fälle.
- „Knapp“ heißt: Die zweitbeste Wahl ist weniger als 0,1 Gems schlechter.
- Liegt das erste Spiel mehr als 6 Stunden entfernt, rät das Tool, später neu zu rechnen: Bis dahin hat Sorare
  die meisten Ausfälle schon auf Prognose 0 gesetzt.
- Nicht eingerechnet: Lineups über zwei Nächte, zwei Steps in einer Nacht (nur als Tipp auf Step 1), Verletzungsmeldungen.

## Sorare-Abfragen

Pro Lauf etwa 9 anonyme Anfragen.
Anonyme Grenzen: Tiefe 7, Komplexität 500. Deshalb 16 Karten pro Anfrage. Ein gesetztes Lineup ist anonym
nur über die reine UUID lesbar (`so5.taskLineup`).
