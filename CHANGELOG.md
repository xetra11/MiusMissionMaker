# Changelog

All notable changes to MiusMissionMaker. The release workflow publishes the section of a version as its release notes, so add a section `## <version> – <date>` before pushing the tag `v<version>`.

## Unreleased

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
