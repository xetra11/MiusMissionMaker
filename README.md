# MiusMissionMaker – scenario generator for Graviteam Tactics: Mius-Front

Builds single-player missions (`.mispack`) for **Graviteam Tactics: Mius-Front** from a JSON file and optionally installs them into the game.

```
scenario JSON ──► node tools/scenario.js build ──► output/<id>.mispack ──(--install)──► in game: QUICK BATTLE → Missions
```

**No game analysis needed.** Everything needed to write a valid scenario is listed in this README (bases, maps, villages, keywords, script commands) and in [`docs/UNITS.md`](docs/UNITS.md) (every platoon type the game knows). Both are generated from the game data, so nobody has to search the game files again. You do not need access to the game to author a scenario; only building/installing it requires the game. A machine-readable version of all rules is in [`scenario.schema.json`](scenario.schema.json) (JSON Schema draft-07).

Requirements for building: **Node.js** (tested with v24) and an installed copy of Mius-Front. No npm packages.

---

## 1. Quick start

```bash
# build and validate a scenario
node tools/scenario.js build examples/company_vs_company.json

# build and install it into the game (close the game first)
node tools/scenario.js build examples/company_vs_company.json --install
```

In the game the mission appears under **QUICK BATTLE → Missions** (or *Training*, see `"menu"`).

If the game is not installed at `C:\Program Files (x86)\Steam\steamapps\common\Graviteam Tactics Mius-Front`, add `--game "<game folder>"` to every command.

---

## 2. How it works

A scenario has three parts:

1. **Base** – one of the 7 missions shipped with the game. It provides the **map section, weather, date/time, preview image and which nation the player commands** (German or Soviet). Its own troops are discarded.
2. **Forces** – any combination of the 266 platoon types of the game ([docs/UNITS.md](docs/UNITS.md)). Each platoon gets new IDs, a callsign and a position. Platoons are taken from a shipped mission where one contains them, otherwise built from the game's unit database.
3. **Course of battle** – deployment, orders for the enemy, victory and defeat conditions, hint texts. The generator turns this into the mission script; experts may supply their own script.

After building, the generator validates the file (IDs, references, checksums, script ↔ callsigns). Only a valid file is installed.

Status: `company_vs_company` and `panzer_meeting` were played successfully in the game (the latter with forces from five different missions, some switching sides). `liberate_village` is new and untested in the game: it is the first scenario with database-built units and with forces starting outside their start areas. Every one of the 266 platoon types builds and passes validation, but database-built platoons (marked in `docs/UNITS.md`) are not yet confirmed in the game.

---

## 3. Writing a scenario (checklist)

Follow these steps; every value you need is in section 6.

1. **Pick a base** (6.1). It decides the map and who the player is: German player → `tr03`, `tr04`, `tr06`; Soviet player → `sm01`, `tr01`, `tr02`, `tr05`.
2. **Define points** in that base's coordinate system. Put the player's deployment point inside the **player start area** and the enemy's inside the **enemy start area** of the base. Reusing or staying close to the *known points* of the base is safest – they are tested positions. To fight over a village, use the **settlements** listed for the base; they give the real location of the buildings.
3. **Choose platoons** from [docs/UNITS.md](docs/UNITS.md): player platoons must be of the player's nation, enemy platoons of the enemy nation. Its vehicle index at the end shows which platoons contain a given vehicle. A realistic company = 1 HQ + 2–3 rifle platoons, optionally support (machine guns, mortars, anti-tank guns, tanks).
4. **Give every platoon a unique callsign** of the form `<name>_<two digits>`, e.g. `panther_01`, with a name from the callsign list (6.3). Typically one name per side.
5. **Set deployment** for each side (`deploy`), **orders** for the attacker, a **victory** and a **defeat** condition.
6. Keep all texts plain ASCII; English fits the rest of the game.

Typical distances: deployment points 600–1500 m apart; the attacker's order target is the defender's position.

---

## 4. Scenario JSON format

### 4.1 Minimal example

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

A German rifle platoon (player) digs in at `home`; a Soviet rifle platoon attacks from `start`.

Complete examples:
- [examples/company_vs_company.json](examples/company_vs_company.json) – German infantry company defends against a Soviet rifle company (base `tr04`).
- [examples/panzer_meeting.json](examples/panzer_meeting.json) – Pz III platoon, rifle platoon and Pak against T-34s, riflemen, SMG troops and a Maxim (base `tr06`, units from five missions).
- [examples/liberate_village.json](examples/liberate_village.json) – infantry company and two StuG III attack a village held by a Soviet rifle company (base `tr06`, enemy deployed per platoon, victory by taking the village).

JSON has no comments. Unknown top-level fields starting with `_` are ignored, e.g. `"_note": "..."`. To get editor validation and auto-completion add `"$schema": "../scenario.schema.json"` (path relative to the JSON file).

### 4.2 Top-level fields

| Field | Required | Type | Meaning |
|---|---|---|---|
| `id` | yes | string | Output file name (`output/<id>.mispack`) and mod name. `a-z`, `0-9`, `_`, max. 40 characters. |
| `title` | yes | string | Name in the mission menu. Plain ASCII. |
| `description` | – | string | Description in the mission menu. Plain ASCII. |
| `base` | yes | string | Base mission, see 6.1. Determines map and player nation. |
| `menu` | – | `"missions"` \| `"training"` | Menu section under QUICK BATTLE. Default `"missions"`. |
| `points` | yes | object | Named map points, see 4.3. |
| `sides` | yes | object | `player` and `enemy`, see 4.4. |
| `victory` | – | object | Victory condition, see 4.6. Without it there is no early victory. |
| `defeat` | – | object | Defeat condition, see 4.6. Without it there is no early defeat. |
| `max_minutes` | – | number | Maximum battle time in minutes. Default: as in the base (60 or 120). |
| `time_scale` | – | number | Time acceleration when the battle starts, e.g. `2`. |
| `deploy_phase` | – | boolean | Deployment phase before the battle in which the player can move units. Default `true`. |
| `camera` | – | object | Start camera `{ "at": "<point>", "direction": "NE", "zoom": 0.3 }`. Default: player's deployment point. |
| `texts` | – | object | In-game hint texts, see 4.7. |
| `mod` | – | string | Mod name used by `--install`. Default: `id`. |
| `script` | – | array of strings | Your own mission script instead of the generated one, see 4.8. |

### 4.3 `points` – map points

```json
"points": {
  "defence":     [-401, -716],
  "enemy_start": [224, -910]
}
```

- **Name:** lowercase letters, digits, `_`, starting with a letter, max. 31 characters, not a reserved name (6.3).
- **Value:** `[x, z]` in metres in the coordinate system of the base. **x grows to the east** (derived from the original scripts, where the enemy "from the east" stands at larger x). Points must lie inside the base's map extent (6.1), otherwise the build fails.
- Each base lists its **player start area**, **enemy start area** and **known points** (6.1). The generator warns if a side deploys outside its own start area.

### 4.4 `sides` – player and enemy

```json
"sides": {
  "player": { "deploy": { ... }, "platoons": [ ... ], "orders": [ ... ], "ai": true },
  "enemy":  { "deploy": { ... }, "platoons": [ ... ], "orders": [ ... ], "ai": true }
}
```

| Field | Required | Meaning |
|---|---|---|
| `platoons` | yes | List of platoons of this side (at least 1), see 4.5. |
| `deploy` | see below | Where and how this side is set up at the start. |
| `orders` | – | Orders the script gives to this side (usually only for `enemy`). |
| `ai` | – | `false` blocks this side's own AI so it only follows script orders. If `enemy` has `orders`, its AI is blocked automatically (as in the original missions). |

**`deploy`** – initial set-up:

| Field | Required | Values | Meaning |
|---|---|---|---|
| `at` | yes | point name | Where to set up. |
| `type` | – | `"trench"` \| `"place"` | `trench` = dug in at prepared positions, `place` = in the open. Default `place`. |
| `formation` | – | see 6.3 | Formation. Default `line2` for `trench`, `columnlr` for `place`. |
| `facing` | – | `"N"`, `"NE"`, `"E"`, `"SE"`, `"S"`, `"SW"`, `"W"`, `"NW"` | Facing. Default: towards the other side. |

Each side needs a `deploy`, unless every one of its platoons has its own `deploy` or a `position`.

**`orders`** – executed in sequence, for **all** platoons of the side together, starting when the player unpauses after deployment:

```json
"orders": [
  { "to": "hill",   "mode": "assault" },
  { "to": "target", "mode": "attack" },
  { "to": "target", "mode": "siege", "wait_s": 900 }
]
```

| Field | Required | Values | Meaning |
|---|---|---|---|
| `to` | yes | point name | Destination. |
| `mode` | – | see 6.3 | Kind of movement. Default `attack`. |
| `wait_s` | – | seconds | Wait this long after the previous order. Without `wait_s` the order is queued and executed once the previous one is done. |

### 4.5 `platoons`

```json
{ "callsign": "panther_02", "unit": "wer_mibn_1141_plat", "position": [-768, 256], "plan": "defend",
  "deploy": { "type": "trench", "at": "hill" } }
```

| Field | Required | Meaning |
|---|---|---|
| `callsign` | yes | Unique callsign, recommended `<name>_<nn>` with a name from 6.3, e.g. `pine_03`. Other names work but trigger a warning and may display oddly in the game. |
| `unit` | yes | Platoon type from [docs/UNITS.md](docs/UNITS.md), e.g. `wer_mibn_1141_plat`. Without suffix the strongest variant is used (on a tie the base's own variant). A specific variant: `<unit>@<base>`, e.g. `wer_mibn_1141_comcoy@tr04`. Must match the side's nation. |
| `size` | – | Number of squads (1–15), for tanks effectively the number of vehicles. Repeats the platoon's last squad type, e.g. `wer_spg_bn_43_bat_pl` with `"size": 3` gives 3 StuG III instead of 2. |
| `position` | – | `[x, z]` – platoon symbol / deployment area on the battle map before set-up. Default: its deployment point. |
| `deploy` | – | Own set-up for this platoon only (same fields as the side's `deploy`); overrides the side's `deploy`. |
| `plan` | – | `"attack"`, `"defend"`, `"hold"` – basic AI attitude of this platoon. Default: as usual in the base. |

Limits: at most 60 platoons per scenario, at most 15 platoons of the same pool (same battalion type).

### 4.6 `victory` and `defeat`

```json
"victory": { "balance": 2.0 },
"defeat":  { "enemy_reaches": "target", "radius": 200, "share": 0.5 }
```

To win by taking an objective, combine both checks; they are evaluated in order, first `own_reaches`, then `balance`:

```json
"victory": { "own_reaches": "village", "radius": 250, "share": 0.5, "balance": 2.0 }
```

| Field | Meaning |
|---|---|
| `victory.balance` | Victory as soon as the ratio of own to enemy strength reaches this value (`2.0` = twice as strong). |
| `victory.after_s` | Start checking only after this many seconds. |
| `victory.own_reaches` | Victory requires your forces to reach this point … |
| `victory.radius` | … within this radius in metres (default `200`) … |
| `victory.share` | … with this share of your forces (default `0.5`). |
| `defeat.enemy_reaches` | Defeat when the enemy reaches this point … |
| `defeat.radius` | … within this radius in metres (default `200`) … |
| `defeat.share` | … with this share of its forces (default `0.5`). |

Without conditions the battle ends at `max_minutes` or when the player ends it.

### 4.7 `texts` – hint texts

The generated script shows these texts; all have English defaults and can be overridden:

| Key | Shown |
|---|---|
| `brief_own` | at start, camera on the player's deployment |
| `brief_foe` | at start, camera on the enemy's deployment |
| `info_end_deploy` | asking to finish deployment with pause (only with `deploy_phase`) |
| `info_1st_orders` | asking to give first orders and start the battle |
| `info_attack` | at the target of the enemy's first order |

You may add further keys (e.g. for your own `script`). `[%do_pause]` is replaced in the game by the assigned key. All texts must be plain ASCII (the game uses code page 1251, which has no umlauts; `ä ö ü ß` are converted to `ae oe ue ss` automatically, other non-ASCII characters are an error).

### 4.8 `script` – own mission script (advanced)

Instead of the generated course of battle you can write the whole script, one line per array entry:

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

Then `points`, `orders`, `victory`, `defeat` and `camera` have no effect – everything is in the script. Callsigns used in `group` lines must exist (checked). All commands are listed in section 6.4. Tip: build once without `script` and use the generated script as a template: `node tools/azp3.js output/<id>.mispack tmp` writes it to `tmp/script__config__loc_def.bin`.

---

## 5. What the generated script does

1. Defines the points; groups `own` (all player platoons) and `foe` (all enemy platoons).
2. Blocks the enemy AI if the enemy has `orders`.
3. Sets up both sides according to `deploy`, positions the camera.
4. Short briefing: camera on own and enemy deployment (`brief_own`, `brief_foe`).
5. Deployment phase (if `deploy_phase`), then waits until the player unpauses.
6. Issues the orders, shows `info_attack` at the enemy's first target, applies `time_scale`, watches victory/defeat conditions.

---

## 6. Reference: all allowed values

<!-- REFERENCE:BEGIN (generated by `node tools/scenario.js reference`, do not edit by hand) -->

### 6.1 Bases

A base supplies the map section, weather, date/time and which nation the player commands. Its own troops are discarded.

| `base` | Player | Enemy | Original mission | Map extent (x / z, metres) |
|---|---|---|---|---|
| `sm01` | Soviet (USSR) | German (GER) | Active defence | x -1024..4096 / z -2048..3072 |
| `tr01` | Soviet (USSR) | German (GER) | Basic training | x -2048..3072 / z -1024..4096 |
| `tr02` | Soviet (USSR) | German (GER) | Attack | x -2048..3072 / z -1024..4096 |
| `tr03` | German (GER) | Soviet (USSR) | Recon | x -1024..4096 / z -2048..2048 |
| `tr04` | German (GER) | Soviet (USSR) | Defence | x -2048..2048 / z -2048..2048 |
| `tr05` | Soviet (USSR) | German (GER) | Ambush | x -2048..3072 / z 0..4096 |
| `tr06` | German (GER) | Soviet (USSR) | Meeting engagement | x -2048..3072 / z -2048..2048 |

#### Base `sm01` – Active defence

- Player: **Soviet** (`USSR`), enemy: **German** (`GER`)
- Original mission: Establish defense of the village. Repel the enemy attack. At your disposal: sabre platoon, ATR platoon, mortar platoon.
- Map extent: x -1024..4096, z -2048..3072; grid of 1024 m cells
- Player start area: x 0..1024 / z 0..1024; x 1024..2048 / z 1024..2048
- Enemy start area: x 2048..3072 / z 0..1024; x 2048..3072 / z 1024..2048
- Settlements: 111 houses around [2900, -416], 1812 x 1063 m (neutral area); 33 houses around [2425, -430], 702 x 317 m (neutral area); 17 houses around [1352, -127], 316 x 248 m (neutral area); 8 houses around [1640, -230], 322 x 127 m (neutral area); 8 houses around [3506, -476], 66 x 251 m (neutral area); 5 houses around [1268, 300], 104 x 202 m (neutral area); 4 houses around [98, 98], 55 x 114 m (player area); 4 houses around [3342, -89], 75 x 98 m (neutral area); 3 houses around [404, 35], 152 x 22 m (player area)
- Known points from the original mission script (tested positions; good anchors for your own points):

| name | x | z | lies in |
|---|---|---|---|
| alied | 717 | 575 | player area |
| mortars | 1136 | 1532 | player area |
| spotter | 1213 | 1053 | player area |
| enemy | 2163 | 533 | enemy area |
| target | 1214 | 565 | neutral area |
| defence | 1328 | 622 | neutral area |
| village | 1279 | 362 | neutral area |

#### Base `tr01` – Basic training

- Player: **Soviet** (`USSR`), enemy: **German** (`GER`)
- Original mission: Training Mission, which will introduce you to the basic principles of the game and units control.
- Map extent: x -2048..3072, z -1024..4096; grid of 1024 m cells
- Player start area: x 1024..2048 / z 2048..3072
- Enemy start area: x 0..1024 / z 1024..2048
- Settlements: 10 houses around [2893, 2117], 220 x 164 m (neutral area); 9 houses around [2478, 2789], 49 x 148 m (neutral area)
- Known points from the original mission script (tested positions; good anchors for your own points):

| name | x | z | lies in |
|---|---|---|---|
| user | 1680 | 2463 | player area |
| base1 | 1927 | 2511 | player area |
| base2 | 1864 | 2507 | player area |
| base3 | 1792 | 2493 | player area |
| move1 | 1658 | 2128 | player area |
| enemy | 329 | 1577 | enemy area |
| hunt1 | 1652 | 1765 | neutral area |
| hunt2 | 700 | 1841 | enemy area |

#### Base `tr02` – Attack

- Player: **Soviet** (`USSR`), enemy: **German** (`GER`)
- Original mission: This mission introduces basic principles of attack and troop movement.
- Map extent: x -2048..3072, z -1024..4096; grid of 1024 m cells
- Player start area: x -1024..0 / z 1024..2048; x -1024..0 / z 2048..3072
- Enemy start area: x 0..1024 / z 1024..2048; x 1024..2048 / z 1024..2048
- Settlements: 10 houses around [2893, 2117], 220 x 164 m (neutral area); 9 houses around [2478, 2789], 49 x 148 m (neutral area)
- Known points from the original mission script (tested positions; good anchors for your own points):

| name | x | z | lies in |
|---|---|---|---|
| ridge | 475 | 2030 | enemy area |
| user | -268 | 2190 | player area |
| edefence | 1384 | 1720 | enemy area |
| at_guns | 1233 | 1226 | enemy area |

#### Base `tr03` – Recon

- Player: **German** (`GER`), enemy: **Soviet** (`USSR`)
- Original mission: This mission introduces principles of recon.
- Map extent: x -1024..4096, z -2048..2048; grid of 1024 m cells
- Player start area: x 0..1024 / z -1024..0
- Enemy start area: x 2048..3072 / z -1024..0; x 2048..3072 / z 0..1024
- Settlements: 83 houses around [1583, 1757], 1180 x 586 m (neutral area); 42 houses around [1721, 1388], 527 x 524 m (neutral area); 27 houses around [346, 1386], 713 x 410 m (neutral area); 10 houses around [1434, -1909], 256 x 159 m (neutral area); 8 houses around [-590, -476], 66 x 251 m (neutral area); 6 houses around [2072, -2014], 180 x 44 m (neutral area); 4 houses around [-754, -89], 75 x 98 m (neutral area); 4 houses around [803, -1537], 59 x 117 m (neutral area)
- Known points from the original mission script (tested positions; good anchors for your own points):

| name | x | z | lies in |
|---|---|---|---|
| user | 488 | -877 | player area |
| user1 | 488 | -877 | player area |
| ambush | 590 | -192 | player area |
| recon | 2573 | -47 | enemy area |
| enemy1 | 2735 | -664 | enemy area |
| enemy2 | 2995 | 324 | enemy area |
| enemy3 | 2350 | -150 | enemy area |
| hill | 1841 | -177 | neutral area |
| target | 554 | -659 | player area |
| return | 740 | -114 | player area |
| attack | 1305 | -381 | neutral area |

#### Base `tr04` – Defence

- Player: **German** (`GER`), enemy: **Soviet** (`USSR`)
- Original mission: This mission will show you how to organize defense.
- Map extent: x -2048..2048, z -2048..2048; grid of 1024 m cells
- Player start area: x -1024..0 / z -1024..0; x -1024..0 / z 0..1024
- Enemy start area: x 0..1024 / z -1024..0; x 0..1024 / z 0..1024
- Settlements: none
- Known points from the original mission script (tested positions; good anchors for your own points):

| name | x | z | lies in |
|---|---|---|---|
| plc | -883 | -690 | player area |
| plc_red | -848 | -818 | player area |
| hidden_red | -882 | -750 | player area |
| hidden_orange | -912 | -750 | player area |
| hidden_yellow | -335 | -302 | player area |
| hidden_green | -145 | -238 | player area |
| notr | -654 | -398 | player area |
| notec | -848 | -884 | player area |
| bad | -910 | -406 | player area |
| en_plc | 143 | -112 | enemy area |
| enemy1 | 224 | -910 | enemy area |
| target | -686 | -651 | player area |
| attack | 0 | -845 | player area |
| hill | 26 | -816 | enemy area |
| guns | -594 | -655 | player area |
| gun1 | -594 | -655 | player area |
| inf | -401 | -716 | player area |
| pl_inf | -401 | -716 | player area |
| pl_sup | -531 | -722 | player area |

#### Base `tr05` – Ambush

- Player: **Soviet** (`USSR`), enemy: **German** (`GER`)
- Original mission: This mission tells how to make an ambush.
- Map extent: x -2048..3072, z 0..4096; grid of 1024 m cells
- Player start area: x 0..1024 / z 2048..3072
- Enemy start area: x 0..1024 / z 1024..2048; x 1024..2048 / z 1024..2048
- Settlements: 149 houses around [-1868, 262], 1803 x 598 m (neutral area); 111 houses around [-1196, 3680], 1812 x 1063 m (neutral area); 33 houses around [-1671, 3666], 702 x 317 m (neutral area); 10 houses around [1434, 2187], 256 x 159 m (neutral area); 8 houses around [-590, 3620], 66 x 251 m (neutral area); 6 houses around [2072, 2082], 180 x 44 m (neutral area); 4 houses around [-754, 4007], 75 x 98 m (neutral area); 4 houses around [803, 2559], 59 x 117 m (player area)
- Known points from the original mission script (tested positions; good anchors for your own points):

| name | x | z | lies in |
|---|---|---|---|
| user | 465 | 2415 | player area |
| arty | 208 | 2383 | player area |
| mg | 234 | 2447 | player area |
| enemy | 910 | 1293 | enemy area |
| ambush | 382 | 2446 | player area |
| point0 | 334 | 2530 | player area |
| point1 | 508 | 2215 | player area |
| point2 | 582 | 2089 | player area |
| target | 32 | 3068 | player area |

#### Base `tr06` – Meeting engagement

- Player: **German** (`GER`), enemy: **Soviet** (`USSR`)
- Original mission: This mission will tell about armor penetration diagrams and after battle statistics
- Map extent: x -2048..3072, z -2048..2048; grid of 1024 m cells
- Player start area: x -1024..0 / z -1024..0
- Enemy start area: x 1024..2048 / z -1024..0
- Settlements: 20 houses around [274, 1756], 430 x 307 m (neutral area); 10 houses around [845, -1979], 220 x 164 m (neutral area); 9 houses around [430, -1307], 49 x 148 m (neutral area); 8 houses around [686, 1599], 298 x 393 m (neutral area); 5 houses around [657, 1985], 215 x 102 m (neutral area); 4 houses around [1023, 1947], 112 x 64 m (neutral area); 4 houses around [2146, 98], 55 x 114 m (neutral area); 3 houses around [2452, 35], 152 x 22 m (neutral area)
- Known points from the original mission script (tested positions; good anchors for your own points):

| name | x | z | lies in |
|---|---|---|---|
| user | -113 | -558 | player area |
| cmd | -113 | -558 | player area |
| enemy | 1264 | -785 | enemy area |

### 6.2 Unit types

The complete list of all allowed `unit` values is in **[docs/UNITS.md](docs/UNITS.md)**: every platoon type of the game, grouped by parent unit, with composition, strength and service period, plus an index of all vehicles and heavy weapons.

- German (`GER`): 132 platoon types (5 reconnaissance, 36 company HQ, 23 armour, 11 mobile support, 39 support weapons, 9 battalion HQ, 7 infantry, 2 recovery/repair)
- Soviet (`USSR`): 134 platoon types (10 reconnaissance, 15 battalion HQ, 24 support weapons, 36 company HQ, 5 infantry, 40 armour, 4 mobile support)

### 6.3 Enumerations

| Field | Allowed values |
|---|---|
| `base` | `sm01`, `tr01`, `tr02`, `tr03`, `tr04`, `tr05`, `tr06` |
| `menu` | `missions` (default), `training` |
| `deploy.type` | `trench` (dug in at prepared positions), `place` (placed in the open) |
| `deploy.formation` (complete list from the game's script parser) | `columnlr` (column, tested; default for place), `line2` (two lines, tested; default for trench), `line` (single line, tested), `line1` (single line, tested with anti-tank guns), `battery` (gun/mortar battery, tested), `line3` (three lines), `column` (column), `col` (column), `columnl` (column left), `columnr` (column right), `coll` (column left), `colr` (column right), `collr` (column) |
| `deploy.facing`, `camera.direction` | `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW` |
| `orders[].mode` (complete list; meanings inferred) | `assault` (aggressive advance, fighting through to the point), `attack` (attack the point), `march` (move in march order: fast, not ready to fight), `fast_move` (fast move), `defence` (move to the point and take up defence there), `siege` (surround and besiege the point), `recon` (reconnaissance move), `hidden` (concealed move), `scan` (observe the area), `enter` (mount vehicles), `leave` (dismount from vehicles) |
| `platoons[].plan` | `attack`, `defend`, `hold` |
| callsign names | `pine`, `linden`, `birch`, `asp`, `beech`, `chestnut`, `willow`, `oak`, `fir`, `broom`, `guelder`, `cedar`, `reed`, `poplar`, `cherry`, `tiger`, `jaguar`, `leopard`, `panther`, `elefant`, `lion`, `beaver`, `viper`, `wolf`, `fox`, `bear`, `lynx`, `hawk`, `eagle`, `crocodile`, `falcon` – use as `<name>_<two digits>`, e.g. `pine_01` |
| reserved point/callsign names | `own`, `foe`, `own_main`, `foe_main`, `main`, `deploy`, `process`, `goto`, `battle_victory`, `battle_defeat`, `foe_later`, `own_later` |
| default `texts` keys | `brief_own`, `brief_foe`, `info_end_deploy`, `info_1st_orders`, `info_attack` |

### 6.4 Script commands

All commands the game's script parser knows, for use in `"script"`, with the first usage found in the shipped missions.

| Command | Example |
|---|---|
| `def` | `def alied 717, 0, 575;` |
| `group` | `group panther panther_02 panther_03;` |
| `place` | `place panther enemy columnlr W;` |
| `trench` | `trench jaguar_01 edefence line north-west;` |
| `ambush` | `ambush()` |
| `detach` | `detach;` |
| `formation` | not used in the shipped missions |
| `move` | `move panther target assault;` |
| `+move` | `+move panther village defence;` |
| `defence` | not used in the shipped missions |
| `block_ai` | `block_ai panther;` |
| `track` | `track panther enemy;` |
| `camera` | `camera alied SE 0.5;` |
| `map` | not used in the shipped missions |
| `skip` | `skip deploy endgame;` |
| `run` | `run fst_orders;` |
| `go` | `go process;` |
| `ret` | `ret;` |
| `delay` | `delay 5.0;` |
| `time` | `time 2;` |
| `mark` | `mark defence brief1a;` |
| `unmark` | `unmark brief1;` |
| `chmark` | `chmark brief1c brief1d;` |
| `event` | `event @ @1;` |
| `blink` | `blink common pause info_1st_orders;` |
| `unblink` | not used in the shipped missions |
| `blink_tab` | `blink_tab support 0 1 brief6;` |
| `unblink_tab` | `unblink_tab support;` |
| `wait_sel` | `wait_sel pine;` |
| `wait_sel1` | `wait_sel1 tiger_recon;` |
| `wait_order` | `wait_order move;` |
| `wait_orders` | not used in the shipped missions |
| `wait_in` | `wait_in enemy village 200.0 0.5;` |
| `wait_bal` | `wait_bal 2.0;` |
| `wait_lost` | not used in the shipped missions |
| `wait_capt` | `wait_capt edefence 200.0 2.0;` |
| `endgame` | `endgame victory;` |
| `setac` | `setac arty point0;` |
| `check` | not used in the shipped missions |
| `press` | not used in the shipped missions |
| `achiv` | `achiv AC_TRAIN_END;` |
| `clear_mem` | not used in the shipped missions |

<!-- REFERENCE:END -->

---

## 7. Installing and removing

`--install` registers the mission in the game as a mod, the same way the game's own updater does. Installing again with the same `id`/`mod` replaces the previous version.

```bash
# list installed mission mods
node tools/install_mission.js list "C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front"

# remove a mission (name = id or mod)
node tools/install_mission.js uninstall "C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front" kp01_company_vs_company
```

The game must be closed. Before the first change `data\common\shared\config\paths.cfgpack.bak` is created.

---

## 8. Common errors

| Message | Fix |
|---|---|
| `unit "…" unknown` | Compare with the `unit` column in [docs/UNITS.md](docs/UNITS.md). |
| `"…" is GER, but this side is USSR` | Move the platoon to the other side or pick a base with the matching player nation (6.1). |
| `point "…" is not defined in "points"` | Add the point or fix the typo. |
| `point "…" is outside the map of base …` | Use coordinates within the base's map extent (6.1). |
| `only plain ASCII characters are allowed` | Remove special characters from title/texts. |
| `note: … deploys at "…", which lies in the … area` | Warning only: move the deployment point into the side's start area unless intended. |
| `note: … is in service … outside` | Warning only: the unit did not exist on the mission date (all bases are 1 July 1943). |
| `Mius-Front is still running` | Close the game, then run again with `--install`. |
| `VALIDATION FAILED` | Internal generator error – the list below it shows what is wrong. |

---

## 9. Limits

- Map, weather, date and time always come from the base; only the 7 map sections of the shipped missions are available.
- Only the platoon types of [docs/UNITS.md](docs/UNITS.md); individual squads cannot be combined freely (`size` only repeats the last squad type).
- Orders apply to a whole side, not to single platoons (except with your own `script`).

---

## 10. Project layout

```
MiusMissionMaker/
├── README.md                    this guide (section 6 is generated)
├── scenario.schema.json         JSON Schema for scenario files (generated)
├── docs/UNITS.md                every platoon type of the game (generated)
├── examples/                    example scenarios
├── output/                      built missions (.mispack)
├── docs/TECHNIK.md              file formats, reverse engineering, internals (German)
└── tools/
    ├── scenario.js              generator: build / reference
    ├── unitdb.js                the game's unit database and platoon templates
    ├── mapdata.js               buildings and settlements from the map tiles
    ├── install_mission.js       install / list / remove missions
    ├── validate_mission.js      consistency check of a .mispack
    ├── azp3.js, azcf.js         reading/writing the game formats
    └── templates/desc.addpack   template for the mod manifest
```

After a game update, regenerate section 6, `docs/UNITS.md` and the schema with `node tools/scenario.js reference`.
