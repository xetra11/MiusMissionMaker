# MiusMissionMaker – Szenario-Generator für Mius-Front

Erzeugt Einzelmissionen (`.mispack`) für **Graviteam Tactics: Mius-Front** aus einer JSON-Datei und installiert sie auf Wunsch direkt ins Spiel.

```
JSON  ──►  node tools/scenario.js build  ──►  output/<id>.mispack  ──►  (--install)  ──►  QUICK BATTLE → Missions
```

Voraussetzungen: **Node.js** (getestet mit v24) und ein installiertes Mius-Front. Keine weiteren Pakete nötig.

---

## 1. Schnellstart

```bash
# 1. Katalog erzeugen: welche Karten (Basen) und Zugtypen es gibt -> docs/KATALOG.md
node tools/scenario.js catalog

# 2. Szenario bauen und prüfen
node tools/scenario.js build examples/company_vs_company.json

# 3. Bauen und direkt ins Spiel installieren (Spiel vorher schließen)
node tools/scenario.js build examples/company_vs_company.json --install
```

Danach im Spiel: **QUICK BATTLE → Missions** (bzw. *Training*, je nach `"menu"`).

Liegt das Spiel nicht unter `C:\Program Files (x86)\Steam\steamapps\common\Graviteam Tactics Mius-Front`, bei jedem Befehl `--game "<Spielordner>"` anhängen.

---

## 2. So funktioniert der Generator

Ein Szenario besteht aus drei Teilen:

1. **Basis** – eine der 7 mitgelieferten Missionen. Von ihr kommen **Kartenausschnitt, Wetter, Datum/Uhrzeit, Vorschaubild und die Spielerseite** (Deutsch oder Sowjetisch). Ihre Truppen werden komplett verworfen.
2. **Truppen** – frei aus allen Zugtypen aller Originalmissionen zusammengestellt (24 Typen, siehe [docs/KATALOG.md](docs/KATALOG.md)). Jeder Zug bekommt neue IDs, einen Rufnamen und eine Position.
3. **Ablauf** – Aufstellung, Befehle an den Gegner, Sieg- und Niederlagebedingungen. Daraus erzeugt der Generator das Missionsskript; wer will, schreibt es selbst (`"script"`).

Nach dem Bauen prüft der Generator die Datei automatisch (IDs, Verweise, Prüfsummen, Skript ↔ Rufnamen). Nur eine fehlerfreie Datei wird installiert.

---

## 3. Die JSON-Datei

### 3.1 Minimalbeispiel

```json
{
  "id": "my01_first_fight",
  "title": "First Fight",
  "base": "tr04",
  "points": {
    "home":  [-401, -716],
    "start": [224, -910]
  },
  "sides": {
    "player": {
      "deploy": { "type": "trench", "at": "home" },
      "platoons": [
        { "callsign": "panther_01", "unit": "wer_mibn_1141_plat" }
      ]
    },
    "enemy": {
      "deploy": { "type": "place", "at": "start" },
      "platoons": [
        { "callsign": "pine_01", "unit": "ra_rbn_1242_plat2" }
      ],
      "orders": [ { "to": "home", "mode": "attack" } ]
    }
  },
  "victory": { "balance": 2.0 },
  "defeat": { "enemy_reaches": "home" }
}
```

Ein deutscher Schützenzug (Spieler) gräbt sich bei `home` ein, ein sowjetischer Schützenzug greift von `start` aus an.

Vollständige Beispiele: [examples/company_vs_company.json](examples/company_vs_company.json) (Kompanie gegen Kompanie, im Spiel getestet) und [examples/panzer_meeting.json](examples/panzer_meeting.json) (gemischte Kräfte aus fünf verschiedenen Missionen).

> JSON erlaubt keine Kommentare. Unbekannte Felder werden ignoriert – Notizen kann man also z. B. als `"_notiz": "..."` ablegen.

### 3.2 Alle Felder auf oberster Ebene

| Feld | Pflicht | Typ | Bedeutung |
|---|---|---|---|
| `id` | ja | Text | Dateiname der Mission (`output/<id>.mispack`) und Mod-Name. Nur `a-z`, `0-9`, `_`, max. 40 Zeichen. |
| `title` | ja | Text | Name im Missionsmenü. |
| `description` | – | Text | Beschreibung im Missionsmenü. |
| `base` | ja | Text | Basis-Mission: `sm01`, `tr01` … `tr06`. Legt Karte und **Spielerseite** fest (Tabelle in [3.3](#33-basis-wählen)). |
| `menu` | – | `"missions"` \| `"training"` | Menübereich unter QUICK BATTLE. Standard: `"missions"`. |
| `points` | ja | Objekt | Benannte Kartenpunkte, siehe [3.4](#34-points--kartenpunkte). |
| `sides` | ja | Objekt | `player` und `enemy`, siehe [3.5](#35-sides--die-beiden-seiten). |
| `victory` | – | Objekt | Siegbedingung, siehe [3.7](#37-victory-und-defeat). Ohne: kein vorzeitiger Sieg. |
| `defeat` | – | Objekt | Niederlagebedingung, siehe [3.7](#37-victory-und-defeat). Ohne: keine vorzeitige Niederlage. |
| `max_minutes` | – | Zahl | Maximale Spielzeit in Minuten. Standard: wie die Basis. |
| `time_scale` | – | Zahl | Zeitraffer beim Gefechtsbeginn (z. B. `2`). |
| `deploy_phase` | – | `true` \| `false` | Aufstellungsphase vor dem Gefecht, in der man Einheiten verschieben kann. Standard: `true`. |
| `camera` | – | Objekt | Startkamera: `{ "at": "<punkt>", "direction": "NE", "zoom": 0.3 }`. Standard: Aufstellungspunkt des Spielers. |
| `texts` | – | Objekt | Hinweistexte im Spiel, siehe [3.8](#38-texts--hinweistexte). |
| `mod` | – | Text | Name, unter dem `--install` die Mission ins Spiel einträgt. Standard: `id`. |
| `script` | – | Liste von Texten | Eigenes Missionsskript statt des generierten, siehe [3.9](#39-script--eigenes-missionsskript-für-fortgeschrittene). |

**Texte** (Titel, Beschreibung, Hinweise) dürfen nur einfache Zeichen enthalten: Das Spiel benutzt die kyrillische Zeichentabelle cp1251, die keine Umlaute kennt. `ä ö ü ß` werden automatisch zu `ae oe ue ss`, andere Sonderzeichen führen zu einer Fehlermeldung. Englische Texte passen am besten zum Rest des Spiels.

### 3.3 Basis wählen

| `base` | Spieler | Gegner | Kartenausschnitt |
|---|---|---|---|
| `sm01` | Sowjetisch | Deutsch | MgG4 |
| `tr01` | Sowjetisch | Deutsch | MgE2 |
| `tr02` | Sowjetisch | Deutsch | MgE2 |
| `tr03` | Deutsch | Sowjetisch | MgI4 |
| `tr04` | Deutsch | Sowjetisch | MgE4 |
| `tr05` | Sowjetisch | Deutsch | MgI2 |
| `tr06` | Deutsch | Sowjetisch | MgF4 |

Alle Züge unter `player` müssen von der Spielerseite der Basis sein, alle unter `enemy` von der Gegnerseite – sonst bricht der Generator mit einer Fehlermeldung ab.

### 3.4 `points` – Kartenpunkte

```json
"points": {
  "defence":     [-401, -716],
  "enemy_start": [224, -910]
}
```

- Name: Kleinbuchstaben, Ziffern, `_`; beginnt mit einem Buchstaben. Nicht erlaubt: `own`, `foe`, `own_main`, `foe_main`, `main`, `deploy`, `process`, `goto`, `battle_victory`, `battle_defeat`.
- Wert: `[x, z]` in Metern innerhalb des Kartenausschnitts der Basis. **x wächst nach Osten** (abgeleitet aus den Originalskripten, in denen der Gegner „aus dem Osten“ bei größerem x angreift).
- **Gute Koordinaten finden:** [docs/KATALOG.md](docs/KATALOG.md) listet für jede Basis die Punkte aus ihrem Originalskript (z. B. `tr04`: `inf (-401, -716)`, `enemy1 (224, -910)`, `hill (26, -816)`, `target (-686, -651)`). Diese Stellen sind erreichbar und für die Aufstellung geeignet. Eigene Punkte am besten in deren Nähe wählen und im Spiel ausprobieren.

### 3.5 `sides` – die beiden Seiten

```json
"sides": {
  "player": { "deploy": { ... }, "platoons": [ ... ], "orders": [ ... ], "ai": true },
  "enemy":  { "deploy": { ... }, "platoons": [ ... ], "orders": [ ... ], "ai": true }
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `platoons` | ja | Liste der Züge dieser Seite (mind. 1), siehe [3.6](#36-platoons--die-züge). |
| `deploy` | siehe unten | Wo und wie die Seite zu Beginn aufgestellt wird. |
| `orders` | – | Befehle, die das Skript dieser Seite gibt (meist nur für `enemy`). |
| `ai` | – | `false` sperrt die eigenständige KI dieser Seite, sodass sie nur Skriptbefehle ausführt. Hat `enemy` `orders`, wird die Gegner-KI automatisch gesperrt (wie in den Originalmissionen). |

**`deploy`** – Aufstellung:

| Feld | Pflicht | Werte | Bedeutung |
|---|---|---|---|
| `at` | ja | Punktname | Wo aufgestellt wird. |
| `type` | – | `"trench"` \| `"place"` | `trench` = eingegraben in Stellungen, `place` = offen aufgestellt. Standard: `place`. |
| `formation` | – | `"line2"`, `"line"`, `"columnlr"`, `"battery"` | Formation. Standard: `line2` bei `trench`, `columnlr` bei `place`. Die Werte stammen aus den Originalskripten. |
| `facing` | – | `"N"`, `"NE"`, `"E"`, `"SE"`, `"S"`, `"SW"`, `"W"`, `"NW"` | Blickrichtung. Standard: zur anderen Seite hin. |

Jede Seite braucht entweder ein `deploy`, oder jeder ihrer Züge braucht ein eigenes `deploy` bzw. eine `position`.

**`orders`** – Befehle, der Reihe nach ausgeführt:

```json
"orders": [
  { "to": "hill",   "mode": "assault" },
  { "to": "target", "mode": "attack" },
  { "to": "target", "mode": "siege", "wait_s": 900 }
]
```

| Feld | Pflicht | Werte | Bedeutung |
|---|---|---|---|
| `to` | ja | Punktname | Ziel. |
| `mode` | – | `"assault"`, `"attack"`, `"march"`, `"defence"`, `"siege"` | Art der Bewegung. Standard: `attack`. |
| `wait_s` | – | Sekunden | Erst so lange nach dem vorigen Befehl warten. Ohne `wait_s` wird der Befehl direkt angehängt (der Zug führt ihn aus, wenn der vorige erledigt ist). |

Die Befehle gelten für **alle** Züge der Seite gemeinsam und starten, wenn der Spieler nach der Aufstellung die Pause aufhebt.

### 3.6 `platoons` – die Züge

```json
{ "callsign": "panther_02", "unit": "wer_mibn_1141_plat", "position": [-768, 256], "plan": "defend",
  "deploy": { "type": "trench", "at": "hill" } }
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `callsign` | ja | Rufname des Zugs, z. B. `panther_01`. Muss im ganzen Szenario eindeutig sein. Siehe Hinweis unten. |
| `unit` | ja | Zugtyp aus [docs/KATALOG.md](docs/KATALOG.md), z. B. `wer_mibn_1141_plat`. Ohne Zusatz wird die stärkste Variante genommen; eine bestimmte Variante mit `@mission`, z. B. `wer_mibn_1141_comcoy@tr04`. |
| `position` | – | `[x, z]` – Lage des Zugs auf der Gefechtskarte vor der Aufstellung (Zugsymbol, Aufstellungsbereich). Standard: sein Aufstellungspunkt. |
| `deploy` | – | Eigene Aufstellung nur für diesen Zug, gleiche Felder wie bei der Seite. Überschreibt das `deploy` der Seite. |
| `plan` | – | `"attack"`, `"defend"`, `"hold"` – Grundhaltung der KI für diesen Zug. Standard: wie in der Basis üblich. |

**Rufnamen:** Das Spiel kennt eine feste Liste von Rufnamen (u. a. Pine, Linden, Birch, Asp, Beech, Oak, Fir, Cedar, Poplar, Tiger, Jaguar, Leopard, Panther, Lion, Wolf, Fox, Bear, Lynx, Hawk, Eagle, Falcon). Die Originalmissionen benutzen `birch`, `pine`, `panther`, `tiger`, `asp` mit Nummer, z. B. `pine_03`. Am sichersten: einen dieser Namen in Kleinbuchstaben plus `_` und zweistellige Nummer verwenden.

**Größe:** höchstens 60 Züge pro Szenario und höchstens 15 Züge desselben Pools (z. B. desselben Bataillons).

### 3.7 `victory` und `defeat`

```json
"victory": { "balance": 2.0 },
"defeat":  { "enemy_reaches": "target", "radius": 200, "share": 0.5 }
```

| Feld | Bedeutung |
|---|---|
| `victory.balance` | Sieg, sobald das Kräfteverhältnis eigene : gegnerische Kräfte diesen Wert erreicht (`2.0` = doppelt so stark). |
| `victory.after_s` | Bedingung frühestens nach so vielen Sekunden prüfen. |
| `defeat.enemy_reaches` | Niederlage, wenn der Gegner diesen Punkt erreicht … |
| `defeat.radius` | … im Umkreis von so vielen Metern (Standard `200`) … |
| `defeat.share` | … mit diesem Anteil seiner Kräfte (Standard `0.5` = die Hälfte). |

Ohne Bedingung endet das Gefecht erst mit `max_minutes` oder wenn der Spieler es beendet.

### 3.8 `texts` – Hinweistexte

Der Generator zeigt während der Mission diese Texte; alle haben englische Standardtexte und lassen sich überschreiben:

| Schlüssel | Wann |
|---|---|
| `brief_own` | Beim Start, Kamera auf der eigenen Aufstellung |
| `brief_foe` | Beim Start, Kamera auf der gegnerischen Aufstellung |
| `info_end_deploy` | Aufforderung, die Aufstellung mit Pause zu beenden (nur mit `deploy_phase`) |
| `info_1st_orders` | Aufforderung, erste Befehle zu geben und das Gefecht zu starten |
| `info_attack` | Beim ersten Gegnerbefehl, am Ziel dieses Befehls |

Eigene Schlüssel (z. B. für ein eigenes `script`) kann man ergänzen. `[%do_pause]` wird im Spiel durch die belegte Taste ersetzt.

### 3.9 `script` – eigenes Missionsskript (für Fortgeschrittene)

Statt des generierten Ablaufs kann man das Skript vollständig selbst schreiben, eine Zeile pro Listeneintrag:

```json
"script": [
  "main()",
  "{",
  "\tdef home -401.0, 0.0, -716.0;",
  "\tgroup own panther_01 panther_02;",
  "\ttrench own home line2 E;",
  "\tskip endgame;",
  "}"
]
```

Dann gelten `points`, `orders`, `victory`, `defeat`, `camera` nicht – alles steht im Skript. Rufnamen müssen zu den `platoons` passen (das prüft der Generator). Die bekannten Befehle sind in [docs/TECHNIK.md, Abschnitt 5](docs/TECHNIK.md#5-missionsskript) beschrieben. Tipp: einmal ohne `script` bauen und das generierte Skript als Vorlage nehmen – es steht lesbar in der Mission und lässt sich mit `node tools/azp3.js output/<id>.mispack tmp` als `tmp/script__config__loc_def.bin` herausziehen.

---

## 4. Was das generierte Skript tut

1. Punkte definieren, Gruppen `own` (alle Spielerzüge) und `foe` (alle Gegnerzüge) bilden.
2. Gegner-KI sperren, wenn der Gegner `orders` hat.
3. Beide Seiten nach `deploy` aufstellen, Kamera setzen.
4. Kurze Einweisung: Kamera auf eigene und gegnerische Aufstellung (`brief_own`, `brief_foe`).
5. Aufstellungsphase (falls `deploy_phase`), dann warten, bis der Spieler die Pause aufhebt.
6. Befehle ausführen, Hinweis `info_attack` am ersten Gegnerziel, Zeitraffer, Sieg-/Niederlagebedingungen überwachen.

---

## 5. Installieren und entfernen

`--install` beim Bauen trägt die Mission als Mod ins Spiel ein (wie es der Updater des Spiels tut). Erneutes Installieren mit gleichem `id`/`mod` ersetzt die alte Version.

```bash
# installierte Missions-Mods anzeigen
node tools/install_mission.js list "C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front"

# eine Mission wieder entfernen (Name = id bzw. mod)
node tools/install_mission.js uninstall "C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front" kp01_company_vs_company
```

Das Spiel muss dabei geschlossen sein. Vor der ersten Änderung wird `data\common\shared\config\paths.cfgpack.bak` angelegt.

---

## 6. Häufige Fehlermeldungen

| Meldung | Lösung |
|---|---|
| `Zugtyp "…" unbekannt` | Schreibweise mit [docs/KATALOG.md](docs/KATALOG.md) vergleichen. |
| `"…" ist GER, diese Seite ist aber USSR` | Zug auf die andere Seite verschieben oder eine Basis mit passender Spielerseite wählen. |
| `Punkt "…" ist nicht unter "points" definiert` | Punkt unter `points` anlegen oder Tippfehler beheben. |
| `nur einfache Zeichen erlaubt` | Sonderzeichen aus Titel/Texten entfernen. |
| `Mius-Front laeuft noch` | Spiel beenden, dann erneut mit `--install`. |
| `PRUEFUNG FEHLGESCHLAGEN` | Interner Fehler des Generators – die Liste darunter zeigt, was nicht stimmt. Bitte melden. |

---

## 7. Grenzen

- Karte, Wetter, Datum und Uhrzeit kommen immer aus der Basis; es gibt nur die 7 Kartenausschnitte der Originalmissionen.
- Nur Zugtypen, die in den Originalmissionen vorkommen (24 Stück). Einzelne Gruppen lassen sich nicht frei zusammenstellen.
- Befehle gelten für eine ganze Seite, nicht für einzelne Züge (außer bei eigenem `script`).
- Im Spiel getestet (30.10.2026): „Company vs Company“ und „Panzer Meeting“ (Züge aus fünf verschiedenen Missionen, teils mit getauschter Seite).

---

## 8. Projektstruktur

```
MiusMissionMaker/
├── README.md                    diese Anleitung
├── examples/                    Beispiel-Szenarien (JSON)
├── output/                      erzeugte Missionen (.mispack)
├── docs/
│   ├── KATALOG.md               Basen, Kartenpunkte und Zugtypen (generiert)
│   └── TECHNIK.md               Dateiformate, Reverse Engineering, Interna
└── tools/
    ├── scenario.js              Generator: build / catalog
    ├── install_mission.js       Missionen installieren / auflisten / entfernen
    ├── validate_mission.js      Konsistenzprüfung einer .mispack
    ├── azp3.js, azcf.js         Lesen/Schreiben der Spielformate
    └── templates/desc.addpack   Vorlage für das Mod-Manifest
```
