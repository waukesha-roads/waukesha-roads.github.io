# Waukesha Street Trainer

A street name is shown and the player clicks that street on a map with no street names.
After each guess the street is highlighted, names appear, and the app shows how far off the
click was, which street was actually clicked, and the street's block ranges.

**Practice aid only. Not for navigation or dispatch.** Map data may be out of date or wrong.
always rely on official maps and CAD. Provided as is, with no warranty.

## Running it
Live at https://waukesha-roads.github.io/. Locally: double-click `index.html`, or serve the folder
with `python -m http.server 8765` and open http://localhost:8765. Everything except the optional
Satellite view works offline (Leaflet is bundled in `vendor/`).

## Data sources and licenses
| Data | Source | License |
|---|---|---|
| Roads, street names, city limits, water, parks, rail | [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Building footprints | Microsoft US Building Footprints, via the Waukesha County "Structures" layer | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Station areas, address points | Waukesha County GIS public map services | Public data, no warranty |
| Satellite imagery (optional view) | USGS The National Map (USDA NAIP) | Public domain |
| Map library | [Leaflet](https://leafletjs.com) | BSD 2-Clause (notice kept in `vendor/leaflet`) |

The generated files in `data/` that are built from OpenStreetMap and the building footprints are a
derived database and are made available under the **ODbL 1.0**. Street-name labels after a guess
are drawn by the app from the OpenStreetMap names, not from third-party map tiles.

## Files
| File | What it is |
|---|---|
| `data/streets.csv` | **The street list. Edit this** (Excel works). One row per street. |
| `data/districts.js` | Station areas (Waukesha County GIS district boundaries). |
| `data/streets.js`, `data/network.js`, `data/boundary.js` | Generated. Don't edit by hand. |
| `tools/fetch-osm.mjs` | Re-downloads city limits + road geometry from OpenStreetMap. |
| `tools/build-data.mjs` | Rebuilds the generated files from `streets.csv`. |

## Updating the street list
`data/streets.csv` columns:

| Column | Example | Notes |
|---|---|---|
| `name` | `W Main St` | Shown in the game. Abbreviations are fine. They're matched to the map automatically. |
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
It lists any street it couldn't find on the map. Fill in `map_name` for those.

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
Building footprints come from the Waukesha County "Structures" layer (21,650 inside the city),
which the county sources from Microsoft's (Bing Maps) building footprints.
They appear on the Street map once zoomed in (zoom 15+). In address mode, a click anywhere on the
address's own building is always correct, however big the building is. 94% of addresses are linked
to a building. Refresh them with:
```
node tools/fetch-buildings.mjs
node tools/build-data.mjs
```

## Reporting a wrong answer
If the map or an answer looks wrong, take a screenshot of the answer card and send it in.
