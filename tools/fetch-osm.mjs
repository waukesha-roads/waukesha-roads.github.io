// Downloads the City of Waukesha boundary and all named roads inside it from
// OpenStreetMap (Overpass API) and saves the raw responses to raw/.
// Run:  node tools/fetch-osm.mjs     (only needed when you want fresh map data)
import { writeFileSync, mkdirSync } from "node:fs";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": "WaukeshaStreetTrainer/1.0 (street map trainer)",
  Accept: "application/json",
};

async function overpass(query) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: HEADERS,
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

mkdirSync("raw", { recursive: true });

// City of Waukesha (admin_level 8) - not the Town of Waukesha or the county.
const boundaryQ = `[out:json][timeout:90];
rel["boundary"="administrative"]["admin_level"="8"]["name"="Waukesha"];
out geom;`;

const roadsQ = `[out:json][timeout:180];
rel["boundary"="administrative"]["admin_level"="8"]["name"="Waukesha"];
map_to_area->.city;
way(area.city)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["name"];
out geom tags;`;

console.log("Fetching city boundary...");
const boundary = await overpass(boundaryQ);
writeFileSync("raw/boundary.json", JSON.stringify(boundary));
console.log("  relations:", boundary.elements.map((e) => `${e.id} ${e.tags.name}`).join(", "));

console.log("Fetching roads...");
const roads = await overpass(roadsQ);
writeFileSync("raw/roads.json", JSON.stringify(roads));
console.log("  ways:", roads.elements.length);
// Unlabeled background features: water, parks, railroads (bbox around the city + margin).
const [s, w, n, e] = (() => {
  const b = boundary.elements[0].bounds;
  return [b.minlat - 0.02, b.minlon - 0.03, b.maxlat + 0.02, b.maxlon + 0.03];
})();
const bb = `(${s},${w},${n},${e})`;
const featuresQ = `[out:json][timeout:180];
(
  way["natural"="water"]${bb};
  rel["natural"="water"]${bb};
  way["waterway"~"^(river|stream|canal)$"]${bb};
  way["leisure"~"^(park|golf_course|nature_reserve)$"]${bb};
  rel["leisure"~"^(park|golf_course|nature_reserve)$"]${bb};
  way["landuse"~"^(cemetery|recreation_ground)$"]${bb};
  way["railway"="rail"]["service"!~"."]${bb};
);
out geom tags;`;
// The full drivable road network around the city - named or not, inside the city or not -
// so highways, bypasses and ramps are drawn complete. (Quiz questions still use roadsQ.)
const networkQ = `[out:json][timeout:180];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]${bb};
out geom tags;`;
console.log("Fetching full road network around the city...");
const network = await overpass(networkQ);
writeFileSync("raw/network.json", JSON.stringify(network));
console.log("  ways:", network.elements.length);

console.log("Fetching water / parks / railroads...");
const features = await overpass(featuresQ);
writeFileSync("raw/features.json", JSON.stringify(features));
console.log("  features:", features.elements.length);


// Waukesha City Fire first-due zones (WCF01-WCF05) from Waukesha County GIS.
// "Waukesha Village Fire" (WVF*) zones are intentionally excluded.
const FIRE_URL = "https://gis.waukeshacounty.gov/host/rest/services/Districts/MapServer/4/query";
const fireParams = new URLSearchParams({
  where: "zone_name LIKE 'WCF%'",
  outFields: "zone_name,esz_number,dsplayname",
  returnGeometry: "true",
  outSR: "4326",
  f: "json",
});
console.log("Fetching Waukesha City Fire zones...");
const fire = await (await fetch(FIRE_URL + "?" + fireParams, { headers: { "User-Agent": HEADERS["User-Agent"] } })).json();
writeFileSync("raw/fire-zones.json", JSON.stringify(fire));
console.log("  zone pieces:", fire.features.length);

console.log("Done. Now run: node tools/build-data.mjs");
