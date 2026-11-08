// Sets the category + secondary_for columns of data/streets.csv from tools/curated-list.txt.
//
//   node tools/apply-curated-list.mjs   then   node tools/build-data.mjs
//
// - streets under [Primary] become Primary
// - streets under [Secondary] become Secondary in every station they run through (secondary_for
//   left blank); a name with no N/S/E/W there also covers its directional parts
// - streets under [Station N] become Secondary, with "Station N" in secondary_for
//   (a street on several station lists gets them all, e.g. "Station 1|Station 5")
// - every other street becomes Tertiary; build-data.mjs then turns courts, circles and
//   dead-end streets into "Dead end" on its own
// Names on the list may use any abbreviation ("E. St. Paul Ave" = "East Saint Paul Avenue").
import { readFileSync, writeFileSync } from "node:fs";

const CSV_PATH = "data/streets.csv";
const LIST_PATH = "tools/curated-list.txt";

// List names that differ from the map's name for the same road.
const ALIAS = {
  "highway 59 arcadian avenue": "arcadian avenue", // Arcadian Ave is WI 59
  "garfield avenue": "east garfield avenue", // the whole road is East Garfield on the map
  "pebble valley road": "north pebble valley road",
};
// Streets the list names that need a row of their own in the CSV.
const EXTRA_ROWS = ["Pendleton Place"];

const ABBR = {
  n: "north", s: "south", e: "east", w: "west", nw: "northwest", ne: "northeast", sw: "southwest", se: "southeast",
  st: "street", ave: "avenue", av: "avenue", rd: "road", dr: "drive", ct: "court", ln: "lane", blvd: "boulevard",
  pkwy: "parkway", cir: "circle", pl: "place", ter: "terrace", terr: "terrace", hwy: "highway", trl: "trail",
};
const norm = (s) => {
  const t = s.toLowerCase().replace(/['’]/g, "").replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  const n = t.map((w, i) => (w === "st" && i < t.length - 1 ? "saint" : ABBR[w] ?? w)).join(" ");
  return ALIAS[n] ?? n;
};

// ---- read the list
const primary = new Set();
const secondaryFor = new Map(); // norm name -> Set of stations
const anySecondary = new Set(); // secondary in whatever stations the road runs through
const listed = new Map(); // norm name -> original text (to report misses)
const noDir = (k) => k.replace(/^(north|south|east|west|northwest|northeast|southwest|southeast) /, "");
let section = null;
for (const raw of readFileSync(LIST_PATH, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const head = line.match(/^\[(.+)\]$/);
  if (head) { section = head[1]; continue; }
  const k = norm(line);
  listed.set(k, line);
  if (section === "Primary") primary.add(k);
  else if (section === "Secondary") anySecondary.add(k);
  else if (section) (secondaryFor.get(k) ?? secondaryFor.set(k, new Set()).get(k)).add(section);
}

// ---- read the CSV (simple: no quoted commas in this file except notes)
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  const head = rows.shift().map((h) => h.trim().toLowerCase().replace(/^﻿/, ""));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
const cell = (v = "") => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const rows = parseCSV(readFileSync(CSV_PATH, "utf8"));
for (const name of EXTRA_ROWS) if (!rows.some((r) => r.name === name)) rows.push({ name });

const found = new Set();
const counts = { Primary: 0, Secondary: 0, Tertiary: 0 };
for (const r of rows) {
  const k = norm(r.name);
  if (primary.has(k)) { r.category = "Primary"; r.secondary_for = ""; found.add(k); }
  else if (secondaryFor.has(k)) { r.category = "Secondary"; r.secondary_for = [...secondaryFor.get(k)].sort().join("|"); found.add(k); }
  else if (anySecondary.has(k) || anySecondary.has(noDir(k))) {
    r.category = "Secondary"; r.secondary_for = ""; // blank = every station it runs through
    found.add(anySecondary.has(k) ? k : noDir(k));
  }
  else { r.category = "Tertiary"; r.secondary_for = ""; }
  counts[r.category]++;
}
rows.sort((a, b) => a.name.localeCompare(b.name));
const COLS = ["name", "category", "secondary_for", "district", "blocks", "map_name", "notes"];
writeFileSync(CSV_PATH, [COLS.join(","), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n");
console.log(`streets.csv: ${rows.length} rows`, counts);
const miss = [...listed].filter(([k]) => !found.has(k));
if (miss.length) console.log("NOT FOUND in streets.csv (add an ALIAS):\n  " + miss.map(([, t]) => t).join("\n  "));
