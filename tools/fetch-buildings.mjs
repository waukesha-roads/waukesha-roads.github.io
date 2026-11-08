// Downloads building footprints around the City of Waukesha from the Waukesha County
// "Structures" layer and saves them to raw/buildings.json.
//   node tools/fetch-buildings.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const URL = "https://gis.waukeshacounty.gov/host/rest/services/Structures/MapServer/0/query";
const BBOX = "-88.306,42.950,-88.173,43.060"; // city limits + a little margin
const HEAD = { "User-Agent": "WaukeshaStreetTrainer/1.0", "Content-Type": "application/x-www-form-urlencoded" };
mkdirSync("raw", { recursive: true });

async function query(params) {
  const res = await fetch(URL, { method: "POST", headers: HEAD, body: new URLSearchParams({ f: "json", ...params }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j;
}

const area = { geometry: BBOX, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects" };
const { objectIds } = await query({ ...area, returnIdsOnly: "true" });
console.log(`${objectIds.length} buildings in the area`);

const out = [];
const CHUNK = 500;
for (let i = 0; i < objectIds.length; i += CHUNK) {
  const j = await query({
    objectIds: objectIds.slice(i, i + CHUNK).join(","),
    outFields: "Height", returnGeometry: "true", outSR: "4326",
  });
  for (const f of j.features) if (f.geometry) out.push({ h: f.attributes.Height, rings: f.geometry.rings });
  if ((i / CHUNK) % 10 === 0) console.log(`  ${out.length}...`);
}
writeFileSync("raw/buildings.json", JSON.stringify(out));
console.log(`saved ${out.length} buildings to raw/buildings.json. Now run: node tools/build-data.mjs`);
