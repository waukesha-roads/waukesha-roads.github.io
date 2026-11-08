# Waukesha Street Trainer

A street name is shown; the player clicks that street on a map with no street names.
After each guess the street is highlighted, names appear, and the app shows how far off the
click was, which street was actually clicked, and the street's block ranges.

## Running it
Double-click `index.html` (it works straight from disk), or serve the folder:
`python -m http.server 8765` and open http://localhost:8765. It needs internet for the
background map tiles and the Leaflet map library.

## Files
| File | What it is |
|---|---|
| `data/streets.csv` | **The street list. Edit this** (Excel works). One row per street. |
| `data/districts.js` | Station areas (Waukesha County GIS district boundaries). |
| `data/streets.js`, `data/network.js`, `data/boundary.js` | Generated - don't edit by hand. |
| `tools/fetch-osm.mjs` | Re-downloads city limits + road geometry from OpenStreetMap. |
| `tools/build-data.mjs` | Rebuilds the generated files from `streets.csv`. |

## Updating the street list
`data/streets.csv` columns:

| Column | Example | Notes |
|---|---|---|
| `name` | `W Main St` | Shown in the game. Abbreviations are fine - they're matched to the map automatically. |
| `category` | `Primary` | `Primary`, `Secondary`, `Tertiary` or `Dead end`. Tertiary courts, circles and one-way-in streets become `Dead end` automatically. |
| `secondary_for` | `Station 1\|Station 5` | Secondary streets only: the stations whose list has it. In another station it counts as Tertiary. |
| `district` | `Station 1` or `Station 1\|Station 2` | Optional. Blank = worked out from the map. |
| `blocks` | `100-1900` or `100-900 N; 100-1500 S` | 100-block ranges, `;` between ranges. |
| `map_name` | `East Main Street\|West Main Street` | Optional. Use when the name doesn't match the map, or to combine pieces. |
| `notes` | `Divided hwy north of Moreland` | Optional, shown after the guess. |

Then run:
```
node tools/build-data.mjs
```
It lists any street it couldn't find on the map - fill in `map_name` for those.

The Primary list and per-station Secondary lists are in `tools/curated-list.txt`.
To re-apply them after editing that file (it rewrites `category` and `secondary_for` for every row):
```
node tools/apply-curated-list.mjs
node tools/build-data.mjs
```

## Address mode
The "Up the stakes" checkbox asks for exact addresses (e.g. *2000 S West Ave*) instead of streets.
Addresses are the county's NG911 Site Address points for the City of Waukesha (unit/suite records
skipped). A guess counts if it is within the chosen distance of the address point, **or** on the
right street within that distance of the spot directly in front of the address (big lots like
Walmart sit far back from the road). Distances: Easy 250 m (default), Normal 125 m, Strict 75 m.
Street questions (address mode off) always accept clicks within 50 m of the road.

Block ranges for streets with no `blocks` value in the CSV are filled in automatically from these
addresses (shown as "from county addresses"). A value typed into the CSV always wins.

Refresh the address data:
```
node tools/fetch-addresses.mjs
node tools/build-data.mjs
```

## Buildings
Building footprints come from the Waukesha County "Structures" layer (21,650 inside the city).
They appear on the Street map once zoomed in (zoom 15+). In address mode, a click anywhere on the
address's own building is always correct, however big the building is; 94% of addresses are linked
to a building. Refresh them with:
```
node tools/fetch-buildings.mjs
node tools/build-data.mjs
```

## "I was right" log
After a wrong (or skipped) answer, players can press **I was right** and add an optional note.
Entries are saved in that computer's browser (there is no server). On the home screen, under
Start: **Download log** saves a CSV (opens in Excel) with the question, where they clicked, the
answer location, distance, accuracy setting, the note, and Google Maps links for both spots.
**Clear** deletes the log on that computer (download it first). Each laptop/browser keeps its own log.
