# Changelog

All notable changes to MiusMissionMaker. The release workflow publishes the section of a version as its release notes, so add a section `## <version> – <date>` before pushing the tag `v<version>`.

## Unreleased

## 0.4.0 – 2026-11-10

### Added

- Click a platoon card, then click on the map to put the platoon there.
- Drag a box on the map to select several platoons (Shift+click adds or removes one) and move them together, or arrange them as line, column or carré facing the other side, at a chosen distance.
- The map zooms with the mouse wheel and the **+**, **−** and **Fit** buttons, and pans with the right mouse button.
- Platoons on the map are counters: a dark plate with the side's colour and the tactical symbol, readable over zones and order lines. Zoomed in, they show their callsign and name where there is room.
- **Facing & formation** at the bottom right of the map shows a wedge for the facing and a tag with the formation (brown: dug in) on every counter.
- The map shows the game's map texture with fields, forest, roads, water and contour lines; **Terrain** at the bottom right of the map turns it off. `node tools/scenario.js reference` writes it to `docs/maps`.
- **Put them on the map** places the platoons of older scenarios that set up at a point.

### Changed

- A click on the map no longer adds a point; use **Add point** in the left panel, then click on the map or on a village or grey dot.
- Platoons are always placed on the map: a new platoon appears in its side's start area, and the "Set up" choice is gone. The side's **Set-up defaults** set type, formation and facing; a platoon's details can override them.
- `deploy` of a side or group may leave out `at`; it then only sets type, formation and facing for platoons with a `position`.

### Fixed

- Villages outside a base's centre map tile were mirrored north–south; they are now where the game has them.

## 0.3.0 – 2026-11-06

### Added

- The editor shows its version next to the title and in the window title; builds that are not releases show `dev` and the commit.
- Platoons and vehicles have their English names from the game, e.g. "Tank platoon · Panther tank coy, 5× Pz V ausf.D" instead of `wer_pant_coy_43_plat`. `docs/UNITS.md` and `scenario.schema.json` list the names too.
- German tactical symbols after H.Dv. 272 (1941, weapon symbols as changed in 1943) for every platoon in the unit list, on the platoon cards and on the map, with staff pennants by level, thick sides for companies and marks for motorised, half-tracked and self-propelled units. Soviet platoons get Soviet symbols after TM 30-430 (1946), with the tank weight class in the diamonds.
- A filter by type in the unit list (tanks, assault guns, anti-tank guns, howitzers, mortars, ...).

### Changed

- Platoon cards are one line with symbol, name, strength and set-up; a click shows the details.
- On the map, numbers only appear where they do not overlap; a click picks the nearest platoon.

## 0.2.1 – 2026-11-05

### Added

- `CHANGELOG.md`, also in the ZIP. Its section of a version is the text of that version's release.

## 0.2.0 – 2026-11-05

### Added

- **Groups:** platoons of a side can be grouped, each group with its own set-up point and orders. This allows attacks on several axes or in waves, for example a second wave that starts 5 minutes later, without a custom script. Platoons without orders, such as mortars or anti-tank guns, hold their positions.
- **Placing platoons on the map:** under **Set up** a platoon can stand with its side or group, at a point of its own, or on the map. Platoons on the map can be dragged, and clicking one shows its card. The full callsign appears on hover.
- The map shows the route of every group, with its name and delay.
- New example `examples/panzer_vorhut.json`: a German Kampfgruppe against Soviet tanks attacking on two axes, the second 5 minutes later.
- Scenario fields `sides.<side>.groups` and `platoons[].group`, in `scenario.schema.json` and the README reference.

### Changed

- A platoon with a `position` now sets up exactly there. Its `deploy` may leave out `at` and only set type, formation or facing.
- Order delays are entered in minutes in the editor. The scenario file still stores seconds in `wait_s`.
- The deployment trigger of each platoon sits at the centre of the 512 m square holding its position, as in the shipped missions.

## 0.1.1 – 2026-10-30

### Added

- Release workflow that publishes `MiusMissionMaker-windows.zip` for every version tag.
- Download links in the README.

## 0.1.0 – 2026-10-30

First version.

- Generator `tools/scenario.js`: builds a `.mispack` mission for Graviteam Tactics: Mius-Front from a JSON scenario, installs it and starts the battle.
- All 266 platoon types of the game, taken from shipped missions or built from the game's unit database; reference in `docs/UNITS.md`.
- Desktop editor `MiusMissionMaker.exe` with map, points, forces, orders and a **Start battle** button.
- JSON schema `scenario.schema.json` and examples.
