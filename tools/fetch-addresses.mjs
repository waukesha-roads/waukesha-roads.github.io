// Downloads every City of Waukesha address point from the county's NG911 "Site Address" layer
// (the same address data 911 dispatch uses) and saves a compact copy to raw/addresses.json.
//   node tools/fetch-addresses.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const URL = "https://gis.waukeshacounty.gov/host/rest/services/NG911_Features/FeatureServer/4/query";
const PAGE = 5000;
mkdirSync("raw", { recursive: true });

const out = [];
for (let offset = 0; ; offset += PAGE) {
  const params = new URLSearchParams({
    where: "municipality='WAUK_C'",
    outFields: "add_number,addnum_suf,fullname,unittype,unitnumber,pointtype,address_use",
    returnGeometry: "true",
    outSR: "4326",
    orderByFields: "OBJECTID",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: "json",
  });
  const res = await fetch(URL + "?" + params, { headers: { "User-Agent": "WaukeshaStreetTrainer/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  for (const f of j.features) {
    if (!f.geometry) continue;
    const a = f.attributes;
    out.push({
      n: a.add_number, suf: a.addnum_suf || "", st: (a.fullname || "").trim(),
      unit: !!(a.unittype || a.unitnumber) || /^Unit/.test(a.pointtype || ""),
      use: a.address_use || "", lat: f.geometry.y, lon: f.geometry.x,
    });
  }
  console.log(`  ${out.length} records...`);
  if (j.features.length < PAGE && !j.exceededTransferLimit) break;
}
writeFileSync("raw/addresses.json", JSON.stringify(out));
console.log(`saved ${out.length} address records to raw/addresses.json. Now run: node tools/build-data.mjs`);
