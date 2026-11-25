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
node src/sync.mjs                # Rohdaten holen, die der Cloudflare-Worker gesammelt hat
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
- Alle Belohnungen zählen in Gems: 10 und 30 Gems auf Step 3 und 4 direkt. 1.000 Essenzen (Step 1: 2.000,
  Step 2: 5.000) zählen grob 0,25 Gems, so viel ist ein Bronze-Pack für dieses Board etwa wert. Ein Dollar
  (Step 5: 100 $, Step 6: 1.000 $) zählt 6 Gems: Im Shop kostet ein Gem 13 bis 20 Cent, gerechnet ist mit
  15 Cent und 0,90 € je Dollar. Die Kurse stehen als `ESSENCE` und `DOLLAR` in `src/advice.mjs`.
- Folge: Auf Step 5 und 6 wartet das Tool auf große Nächte und setzt dann meist nur ein Lineup. Das Modell
  kennt das Set-Ende nicht und bewertet langes Warten dort etwas zu gut.
- Vier gescheiterte Versuche setzen das Board auf Step 1 zurück.
- Die Folgenacht kennt das Tool aus dem Spielplan der Teams (2 Anfragen je Lauf). Es schätzt, was das beste
  Lineup aus den eigenen Karten dort erreicht, und rechnet mit Brettwerten zwischen kleiner und großer Nacht,
  je nachdem, wo diese Chance liegt. Sorare gibt eine Prognose nur für das nächste Spiel eines Spielers;
  für die Folgenacht steht deshalb die aktuelle Prognose.
- Rohdaten ohne Spielplan (vor dem 25.11.2026): Die Zahl der Spiele ist dann nur eine Untergrenze. Ist sie
  unter 7, nennt das Tool beide Fälle.
- „Knapp“ heißt: Die zweitbeste Wahl ist weniger als 0,1 Gems schlechter.
- Liegt das erste Spiel mehr als 6 Stunden entfernt, rät das Tool, später neu zu rechnen: Bis dahin hat Sorare
  die meisten Ausfälle schon auf Prognose 0 gesetzt.
- Nicht eingerechnet: Lineups über zwei Nächte, zwei Steps in einer Nacht (nur als Tipp auf Step 1), Verletzungsmeldungen.

## Sorare-Abfragen

Pro Lauf etwa 40 anonyme Anfragen bei rund 430 Karten (je 50 Karten eine Seite, je 16 Karten eine Abfrage
für Spiele und Form).
Anonyme Grenzen: Tiefe 7, Komplexität 500. Deshalb 16 Karten pro Anfrage. Ein gesetztes Lineup ist anonym
nur über die reine UUID lesbar (`so5.taskLineup`).

## Automatisch sammeln (Cloudflare)

Damit jede Nacht auswertbar ist, sammelt ein kleiner Cloudflare-Worker die Rohdaten auch dann, wenn der PC aus ist.

- Ordner `worker/`, Worker `nba-optimizer-collect`, R2-Bucket `nba-optimizer-data`.
- Läuft täglich um 21:30 und 09:30 UTC (im Winter 22:30 und 10:30 Berlin): kurz vor den Spielen und nach der Nacht.
- Liest dieselben anonymen Sorare-Daten wie das Tool und legt sie als eine JSON-Datei ab, mit dem Dateinamen wie in `data/`.
- Keine öffentliche Adresse, kein Key, kein Login. Ein gescheiterter Lauf hinterlässt eine Notiz unter `errors/`.
- `node src/sync.mjs` holt neue Dateien nach `data/`. Das braucht `npm install` in `worker/` und eine Wrangler-Anmeldung.
- Deploy: in `worker/` `npm run deploy`. Der Bucket muss vorher bestehen (`wrangler r2 bucket create nba-optimizer-data`).
- Grenze: Im kostenlosen Worker-Tarif sind 50 Anfragen je Lauf erlaubt. Ab etwa 560 Karten reicht das nicht mehr.
