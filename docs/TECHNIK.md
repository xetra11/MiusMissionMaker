# Technik: Dateiformate und Vorgehen

Hintergrund zum Generator: wie die Missionsdateien von **Graviteam Tactics: Mius-Front** aufgebaut sind und wie das herausgefunden wurde. Für das Erstellen von Szenarien reicht die [README](../README.md).

Die Format-Erkenntnisse stammen aus Reverse Engineering der mitgelieferten Missionen; es gibt keine offizielle Dokumentation.

Nützliche Kommandos zum Untersuchen von Dateien:

```bash
# Container-Inhalt auflisten und Einträge als .bin extrahieren
node tools/azp3.js <datei.mispack> <zielordner>

# Eine AZCF-Konfiguration lesbar ausgeben (optional: max. Zeilen pro Tabelle)
node tools/azcf.js dump <extrahierte_datei.bin> [maxRows]

# Prüfen, ob Lesen+Schreiben byte-identisch ist
node tools/azcf.js roundtrip <extrahierte_datei.bin>
```

---

## 2. Vorgehen – wie die Mission entstanden ist

### 2.1 Bestandsaufnahme

Im Spielordner liegen die Missionen unter `data\oprum\shared\missions\` (`sm01_repulse`, `tr01`–`tr06`). Kampagnen (`*.campack2`) und Schnellgefecht-Daten (`*.qbdesc`) liegen unter `data\oprum\shared\camps\`.

In den Spielbibliotheken (`bin\rel\x64\adv_opgame.codelib`) finden sich Strings wie `mod_new_mispck`, `mod_build`, `mod_install`, `battle as mission`, `qick battle as mission`. Das bestätigt: Missionen entstehen im Spiel, indem ein Gefecht als `.mispack` gespeichert wird, und werden über das Mod-Tool verteilt. Einen freien Editor gibt es nicht – deshalb der Weg über das Dateiformat.

### 2.2 Container entschlüsseln (AZP3)

Hex-Dump einer `.mispack` zeigte den Header `AZP3 … GRAVITECH3 pack system v3.0` und ab `0x140` ein Verzeichnis mit 0x80-Byte-Einträgen. Die Nutzdaten sind **unkomprimiert** (das Missionsskript lag als Klartext im Dump). Das unbekannte Feld je Eintrag ließ sich als **einfache Bytesumme** der Nutzdaten identifizieren (für alle Einträge aller Missionen bestätigt).

### 2.3 Konfigurationsformat entschlüsseln (AZCF)

Die eigentlichen Daten sind AZCF-Blöcke: ein Baum aus Knoten, die entweder **Parameterlisten** oder **Tabellen** sind, mit einem Typ-String pro Knoten (z. B. `sassaasasvs`) und einem gemeinsamen String-Pool. Details in [Abschnitt 3.2](#32-azcf-konfigurationsblock).

Vorgehen: Feldbedeutungen aus Offsets und Größen abgeleitet (z. B. `35 Parameter × 0x40 = Startoffset des nächsten Knotens`), dann einen Parser **und** Serializer geschrieben und so lange korrigiert, bis **alle Konfigurationen aller 7 Missionen byte-identisch** wieder herauskamen. Die großen `tacgame_image`-Blöcke kommen semantisch identisch heraus (Abweichung nur durch einen verwaisten String `"dummy"`, den der Spiel-eigene Writer im Pool zurücklässt).

Ein Punkt blieb offen: Namens-Lookups nutzen eine Hashtabelle mit unbekannter Hashfunktion (gängige Funktionen getestet, keine passte). Das ist unkritisch, solange **keine Parameter- oder Knotennamen** geändert werden – die Hashtabellen werden dann einfach unverändert übernommen. Tabellenzeilen (Einheiten usw.) haben keine Hashtabelle und lassen sich frei hinzufügen/entfernen.

### 2.4 Missionsinhalt verstehen

Eine Mission ist ein **eingefrorener Gefechtszustand**: Der Block `tacgame_image` enthält jede Division, jeden Zug, jede Gruppe und jeden einzelnen Soldaten/jedes Fahrzeug. Die Zuordnung läuft über ein hierarchisches ID-Schema (Abschnitt 4). Das Missionsskript liegt dreifach vor (Klartext-Eintrag, Zeilentabelle in `desc`, kodiert als `SCR1` im `tacgame_image`) – alle drei ließen sich exakt nachbauen.

### 2.5 Vorlage wählen

Ein Vergleich aller Missionen ergab `tr04_defence` als ideale Basis, weil sie bereits enthält:

| Seite | Inhalt in tr04 |
|---|---|
| Deutsch | Kompanietrupp (`wer_mibn_1141_comcoy`), 1 Schützenzug (`wer_mibn_1141_plat`), le.IG-Zug |
| Sowjetisch | Kompanietrupp (`ra_rbn_1242_comcoy`), 2 Schützenzüge (`ra_rbn_1242_plat2`), T-70-Zug |

### 2.6 Erster Umbau (von Hand, inzwischen durch `scenario.js` ersetzt)

1. **Entfernt:** le.IG-Zug (`tiger_01`) und T-70-Zug (`asp`) samt Gruppen, Soldaten, Kartenmarkern, Auslösern und deren Pools.
2. **Ordinalzahlen** der verbleibenden Züge neu durchnummeriert (1..n).
3. **Geklont:** 2× deutscher Schützenzug (`panther_03`, `panther_04`), 1× sowjetischer Schützenzug (`pine_04`) – jeweils mit allen Gruppen und Soldaten, neuen IDs, neuen Namen der Gruppenführer, eigener Position, eigenem Kartenmarker und Auslöser.
4. **Schnellgefecht-Konfiguration** (`qbattle`) angepasst, damit sie zur Truppenliste passt.
5. **Missionsbeschreibung** (`desc`): Zugzahlen auf 4/4, `chap_id = 2` (Menübereich *Missions* statt *Training*), neuer Text, neues Skript.
6. **Skript und Briefing** neu geschrieben und in alle drei Ablageorte übernommen.
7. Pack neu geschrieben: Offsets auf 0x1000 ausgerichtet, Datei auf 0x10000, Prüfsummen neu berechnet.

Ergebnis:

| Seite | Zug | Gruppen | Mann |
|---|---|---|---|
| Deutsch (Spieler) | `panther_01` Kompanietrupp | 4 | 23 |
| | `panther_02`–`04` Schützenzüge (je 4 Gruppen + 5-cm-Granatwerfer + Zugtrupp) | 6 | je 50 |
| Sowjetisch (KI) | `pine_01` Kompanietrupp | 2 | 5 |
| | `pine_02`–`04` Schützenzüge | 5 | je 39 |

---

## 3. Dateiformate

Alle Zahlen Little Endian.

### 3.1 AZP3-Container (`.mispack`, `.campack2`, `.qbdesc`)

| Offset | Inhalt |
|---|---|
| `0x00` | `AZP3`, u32 Anzahl Einträge, u32 `0x20`, …, u32 `0x440` (Ende des Verzeichnisses) |
| `0x20` | `GRAVITECH3 pack system v3.0` |
| `0xB0`–`0x13F` | Hashtabelle der Eintragsnamen (unverändert übernehmen) |
| `0x140` | Verzeichnis, 0x80 Byte pro Eintrag |

Verzeichniseintrag (0x80 Byte):

| Offset | Typ | Bedeutung |
|---|---|---|
| `+0x00` | u32 | immer `9` |
| `+0x04` | u32 | **Prüfsumme = Summe aller Bytes** der Nutzdaten (mod 2³²) |
| `+0x08` | u32 | Offset der Nutzdaten (0x1000-aligned, erster bei `0x10000`) |
| `+0x10` | u32 | Größe der Nutzdaten |
| `+0x20` | 3 × char[32] | Namen, z. B. `tacgame_image` / `tacimage` / `loc_def` |

Die Datei wird auf ein Vielfaches von `0x10000` aufgefüllt.

Einträge einer Mission:

| Eintrag | Format | Inhalt |
|---|---|---|
| `tacgame_image / tacimage` | AZCF | kompletter Gefechtszustand (Truppen, Zonen, Skript) |
| `qbattle / config` | AZCF | Schnellgefecht-Einstellungen, aus denen die Mission entstand |
| `desc / config` | AZCF | Missionsbeschreibung für das Menü (Seiten, Zugzahlen, Text, Skript) |
| `script / config` | Text (cp1251, CRLF) | Missionsskript |
| `desc / text` | Text (cp1251, CRLF) | Titel, Beschreibung, Briefing-Texte |
| `image / image` | Bild | Vorschaubild |

### 3.2 AZCF-Konfigurationsblock

```
0x00  Header (0x20): 'AZCF', Knotenzahl, 0x40, Root-Hashgröße, Root-Hashoffset, 0…
0x20  Knoten-Records, je 0x80 Byte
      Datenbereich (Parameter / Tabellenzellen)
      Hashtabellen (8 Byte pro Slot)
      Kindlisten (u32-Indizes)
      String-Pool
```

**Knoten-Record (0x80 Byte):** `slotA[0x20]` (Name beim Root), `slotB[0x20]` (Name bei Kindknoten, z. B. `i_divisions:divisions`), danach 16 × u32:

| Index | Bedeutung |
|---|---|
| 0 | Typ: `0` = reiner Container, `1` = Parameterliste, `2` = Tabelle |
| 1 | Spalten (Tabelle) bzw. 1 |
| 2 | Zeilen (Tabelle) bzw. Anzahl Parameter |
| 3 | Offset des Typ-Strings (ein Zeichen pro Parameter/Spalte) |
| 4 | Offset der Daten |
| 5 | Offset der Kindliste (bei Blättern: Beginn des Kindlisten-Bereichs) |
| 6 | Anzahl Kinder |
| 7, 8 | Hashtabelle der Parameternamen (Slots, Offset) |
| 9, 10 | Hashtabelle der Kindnamen (Slots, Offset) |

**Parameter (0x40 Byte):** Wert[16], u32 Typ, Padding[12], Name[32].
**Tabellenzelle (0x20 Byte):** Wert[16], u32 Typ, Padding[12].

Werttypen:

| Typ | Zeichen im Typ-String | Bedeutung |
|---|---|---|
| 0 | `f` | float |
| 1 | `v` | Vektor (3–4 float) |
| 2 | `s` | String: u32 Länge, u32 **absoluter Offset** im Block |
| 4 | `u` | u32 (auch 4-Zeichen-Codes wie `GER`, `USSR`, `USER`, `ENEM`) |
| 5 | `b` | bool |
| 6 | `a` | 16 Byte Rohdaten |

**String-Pool:** pro Knoten zuerst sein Typ-String, dann die von ihm referenzierten Werte-Strings. Werte-Strings werden dedupliziert, Typ-Strings nicht. Normale Strings sind NUL-terminiert; Binär-Blobs (z. B. `SCR1`) haben keinen Terminator.

**Hashtabellen:** Slot = `(bucket | 0x80000000, index)`, offene Adressierung mit linearem Sondieren. Hashfunktion unbekannt → Namen nicht ändern, Tabellen 1:1 übernehmen.

### 3.3 `SCR1` / `LOC1` (Skript und Texte im `tacgame_image`)

```
'SCR1' bzw. 'LOC1', u8 0, u32 Zeilenzahl, u32 Textgröße, u32[Zeilenzahl] Zeilen-Offsets, Zeilen (je NUL-terminiert)
```

Das ist einfach das zeilenweise zerlegte Skript bzw. der Text. Der Encoder in `scenario.js` (`lineBlock`) reproduziert die Originale byte-genau.

---

## 4. Truppenstruktur im `tacgame_image`

Knoten `i_divisions:divisions` mit den Tabellen:

| Tabelle | Inhalt | Wichtige Spalten |
|---|---|---|
| `pools` | Truppenpools (Bataillon/Regiment) | 0 Pool-Name, 1 Pool-ID + Seite, 2 Vorlage, 3/4 Namenslisten |
| `plats` | Züge | 0 Vorlage, 1 Zug-ID + Seite, 2 Icon-Typ (`plu_rifles` …), 5 Plan (`DEF`/`ATAK`), 6/8 Familienname des Zugführers, 7 Ordinalzahl (Byte 12), 9 Position (x,0,z), 10 **Rufname** |
| `squads` | Gruppen | 0 `sq_<id hex>`, 1 Gruppen-ID, 3 Gruppentyp (`wer_squad_inf_41l` …), 8 `USER`/`ENEM`, 11/16 Familienname, 20 Vorname |
| `units` | Soldaten/Fahrzeuge | 0 `i_human:hum_<id>` bzw. `i_techn:tec_<id+1>`, 1 Datenbank, 2 Typ (`ger_inf_soldier` …), 3 ID, 5 zugehöriges Fahrzeug |

Weitere Tabellen, die auf Züge verweisen:

| Tabelle | Verweis |
|---|---|
| `brief` | Kartenmarker pro Zug: Zug-ID in Spalte 0 (Byte 4), Position in Spalte 1 |
| `triggers` | Auslöser pro Zug: **Ordinalzahl** in Spalte 0 (Byte 8), Position in Spalte 1 |

### ID-Schema

```
Zug-ID     = (Pool-ID | 0x80000) + Laufnummer << 13 + Index_im_Verband << 9
Gruppen-ID = Zug-ID + 0x20 * k        (k = 1, 2, …)
Soldat-ID  = Gruppen-ID + j           (j = 0, 1, …)
Fahrzeug   : ID = Gruppen-ID, Name = Gruppen-ID + 1
```

Beispiel: Pool `p_wer_mibn1141` = `0x10800000` → Zug `0x10886400` (Laufnummer 3, Index 2) → Gruppe `0x10886440` → Soldat `0x10886443`.

Die Laufnummer muss über alle Züge eindeutig sein. Die Ordinalzahlen (Spalte 7, Byte 12) laufen 1..n und werden von `triggers` referenziert.

---

## 5. Missionsskript

Die Sprache ist nicht dokumentiert; alle Befehle unten stammen aus den mitgelieferten Missionen.

| Befehl | Bedeutung (abgeleitet) |
|---|---|
| `def name x, y, z;` | benannter Punkt (y = 0) |
| `group name rufname* …;` | Gruppe aus Zügen (Wildcard `*`, `rufname:n` = n-te Gruppe des Zugs) |
| `block_ai gruppe;` | KI-Eigeninitiative für die Gruppe sperren |
| `trench gruppe punkt line2 E;` | eingegraben aufstellen, Formation, Blickrichtung |
| `place gruppe punkt columnlr W;` | aufstellen ohne Stellung |
| `camera punkt NE 0.3;` | Kamera setzen |
| `track gruppe punkt;` | Gruppe an Punkt binden (Aufstellungsbereich) |
| `skip endgame;` / `skip deploy endgame;` | Phasen überspringen |
| `run f;` / `go f;` | Funktion aufrufen / parallel starten |
| `delay s;` | warten |
| `mark`, `unmark`, `chmark`, `blink`, `event` | Briefing-Marker und Hinweise (Texte aus `desc/text`, `#schlüssel`) |
| `wait_order 1st_orders;` | auf Ende der Aufstellung warten |
| `move gruppe punkt assault\|attack\|march\|defence\|siege;` | Bewegungsbefehl, `+move` = anhängen |
| `time 2;` | Zeitbeschleunigung |
| `wait_bal 2.0;` | warten bis Kräfteverhältnis erreicht |
| `wait_in gruppe punkt radius anteil;` | warten bis Gruppe im Gebiet |
| `endgame victory\|defeat;` | Mission beenden |
| `@`, `@1` | Parameter in Hilfsfunktionen (z. B. `goto()`) |

Der Generator erzeugt das Skript in `scenario.js` (`makeScript`); per `"script"` im JSON kann man es komplett selbst vorgeben.

**Texte:** Erste Zeile Titel, zweite Beschreibung, danach `#schlüssel Text`. Optional ein Abschnitt `*loc_rus` mit Übersetzungen. Kodierung ist cp1251 – **keine Umlaute** (ä/ö/ü existieren dort nicht), daher sind die Texte englisch.

---

## 6. Wie der Generator Truppen zusammensetzt

`scenario.js` nimmt aus der Basis-Mission alles außer den Truppen (Kartenausschnitt, Wetter, Zonen, Spielerseite) und baut die Tabellen `pools`, `plats`, `squads`, `units`, `brief`, `triggers` sowie die Zugliste des Schnellgefecht-Editors neu auf.

- **Katalog:** jeder Zug aller 7 Originalmissionen, Schlüssel = Zugvorlage (`plats` Spalte 0). Trainingsmissionen enthalten ausgedünnte Züge; ohne `@mission` wird die stärkste Variante genommen, bei Gleichstand die der Basis.
- **Pools** werden mitkopiert. Kollidiert eine Pool-ID auf derselben Seite, wird das Bit-Feld 20–23 neu vergeben (Typ-Byte bleibt).
- **IDs:** Zug = `(Pool | 0x80000) + Laufnummer<<13 + Index<<9`; Gruppen und Soldaten behalten ihre Abstände innerhalb des Zugs.
- **Spieler/Gegner:** Folgende Felder hängen davon ab, auf welcher Seite ein Zug steht, und werden beim Übertragen gesetzt:
  - eindeutig je Seite: Zugfarbe und Flag (`plats` Spalte 7, Bytes 0–7), `USER`/`ENEM` (`squads` Spalte 8), Markerfarbe (`brief` Spalte 0, Bytes 8–11)
  - je Mission und Seite verschieden (KI-Plan und Zustand): `plats` Spalten 4 und 5, `squads` Spalte 15, `triggers` Spalte 2 – übernommen wird jeweils der häufigste Wert dieser Seite in der Basis
- **Spaltenzahl:** `sm01` hat ein älteres Format (11 statt 12 Spalten in `plats`, keine `triggers`); Zeilen werden beim Übertragen angepasst.
- **Namen** der Gruppenführer werden zufällig (aber reproduzierbar pro `id`) aus den Namenslisten gewählt.

Gegenprobe: Das Beispiel `examples/company_vs_company.json` ergibt in allen Truppentabellen dieselben Zeilen wie die zuvor von Hand gebaute und im Spiel getestete Mission (abgesehen von IDs, Namen, Positionen und Reihenfolge).

---

## 7. Validierung

`validate_mission.js` prüft:

- Prüfsummen aller Einträge
- eindeutige Zug-, Gruppen- und Soldaten-IDs sowie Rufnamen
- jede Gruppe gehört zu einem Zug, jeder Soldat zu einer Gruppe, jeder Zug zu einem Pool
- Fahrzeug-Verweise zeigen auf existierende Fahrzeuge
- Kartenmarker und Auslöser passen zu den Zügen, Ordinalzahlen laufen 1..n
- Skript identisch in `script`, `desc` und `SCR1`; Text identisch in `desc` und `LOC1`
- alle Rufnamen im Skript existieren

Ergebnis für die Beispiele: **alle Prüfungen bestanden**. Prüft zusätzlich, dass das `USER`/`ENEM`-Flag jeder Gruppe zur Seite passt. Bei zwei Originalmissionen melden einzelne Prüfungen Abweichungen (`sm01`: Skript-Eintrag weicht leicht von `desc` ab; `tr05`: weniger Marker als Züge) – die Prüfungen sind dort strenger als das Spiel.

---

## 8. Installation im Spiel

### Empfohlen: direkt mit `install_mission.js` (ohne Spiel, ohne Updater)

Das Tool macht genau das, was der Updater des Spiels tut (aus `out\i_updater.log` abgeleitet): Mission nach `data\common\<GUID>\shared\missions\` kopieren, Manifest `desc.addpack` schreiben, GUID in `data\common\shared\config\paths.cfgpack` eintragen. Das Spiel muss dafür geschlossen sein. Vor der ersten Änderung wird `paths.cfgpack.bak` angelegt.

```bash
node tools/install_mission.js install "C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front" "Company vs Company" output/kp01_company_vs_company.mispack
node tools/install_mission.js list "C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front"
node tools/install_mission.js uninstall "C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front" "Company vs Company"
```

Die GUID wird aus dem Mod-Namen abgeleitet: erneutes `install` mit gleichem Namen ersetzt den Mod (Version +1) statt ihn zu verdoppeln. Vorlage für das Manifest: `tools/templates/desc.addpack` (vom Spiel erzeugt).

### Über das Spiel – Erfahrungen

- **Build** packt alle `.mispack` des gewählten Ordners in eine ZIP-Datei `<modname>.gt3ext` (Inhalt: `core/desc.addpack` + `core/shared/missions/<name>.mispack`) und legt einen Arbeitsordner `core\` an – beides im Mod-Ordner selbst. Deshalb pro Mod einen eigenen Ordner verwenden.
- **Install** startet den Updater. Protokoll: `<Spielordner>\out\i_updater.log`, Build-Protokoll: `out\common_engine.log` („Try build mod …“).
- Erfolgreich installierte Addons stehen in `data\common\shared\config\paths.cfgpack`; Mod-Einstellungen in `users\profiles\cloud\mods.engcfg`.
- Installierte Missionen erscheinen laut Handbuch im Menü **QUICK BATTLE** (dort, wo auch die Trainingsmissionen gelistet sind).
- Der **Install-Knopf** im Spiel startete den Updater unzuverlässig (einmal mit `ERROR 0x500`, einmal gar nicht).
- Zuverlässig ist der Ordner **`new_updates\`** im Spielordner: `.gt3ext` dort ablegen, Spiel starten → Updater installiert (`success!`). Danach die Dateien **wieder entfernen**, sonst erscheint bei jedem Start der Update-Dialog.
- Ein Kontrolltest mit einer unveränderten Originalmission und die generierte Mission ließen sich so beide installieren – `0x500` lag also nicht an der generierten Datei.
- Der Menübereich hängt von `chap_id` im `desc` ab: **2** = Missions, **3** = Training.

## 9. Offene Punkte und Risiken

- Im Spiel bestätigt (Stand 29.10.2026): die mit dem ersten Umbau erzeugte „Company vs Company“ erscheint unter QUICK BATTLE → Missions.
- Im Spiel bestätigt (Stand 30.10.2026): Züge aus anderen Missionen inkl. Seitenwechsel funktionieren (`examples/panzer_meeting.json`).
- Bedeutung einzelner Rohfelder (z. B. Bytes 4–9 in `plats` Spalte 1) ist nur teilweise bekannt; sie werden von der Quellzeile übernommen.
- Hashfunktion der Namenstabellen unbekannt → keine neuen Parameter- oder Knotennamen möglich.
- Wetter, Datum und Uhrzeit kommen aus der Basis; das Vorschaubild ebenso.
