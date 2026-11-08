/* Waukesha Street Trainer - game logic.
 * Data comes from data/*.js (window.CITY_BOUNDARY, window.DISTRICTS, window.STREET_INDEX).
 */
(function () {
  "use strict";

  // ------------------------------------------------------------ geometry helpers
  const M_LAT = 111320;
  const M_LON = 111320 * Math.cos((43.0 * Math.PI) / 180);
  const xy = (p) => [p[1] * M_LON, p[0] * M_LAT];

  // Distance (m) from point p to the nearest point on any of `lines`; also returns that point.
  function nearestOnLines(p, lines) {
    const [px, py] = xy(p);
    let best = Infinity, bestPt = null;
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = xy(line[i]);
        const [bx, by] = xy(line[i + 1]);
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        const d = Math.hypot(px - cx, py - cy);
        if (d < best) { best = d; bestPt = [cy / M_LAT, cx / M_LON]; }
      }
      if (line.length === 1) {
        const d = Math.hypot(px - xy(line[0])[0], py - xy(line[0])[1]);
        if (d < best) { best = d; bestPt = line[0]; }
      }
    }
    return { dist: best, point: bestPt };
  }

  function inRing(p, ring) {
    const [y, x] = p;
    // cached bounding box check first - this runs tens of thousands of times at startup
    if (!ring.bbox) {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [la, lo] of ring) { a = Math.min(a, la); b = Math.min(b, lo); c = Math.max(c, la); d = Math.max(d, lo); }
      ring.bbox = [a, b, c, d];
    }
    const bb = ring.bbox;
    if (y < bb[0] || x < bb[1] || y > bb[2] || x > bb[3]) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inCity = (p) =>
    CITY_BOUNDARY.outer.some((r) => inRing(p, r)) && !CITY_BOUNDARY.inner.some((r) => inRing(p, r));
  // even-odd: a point inside an island/hole ring of a zone is outside that zone
  const inDistrict = (p, d) => d.rings.filter((r) => inRing(p, r)).length % 2 === 1;

  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1609.34).toFixed(2)} mi`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ------------------------------------------------------------ prepare street index
  // Only roads that are really in the City of Waukesha are ASKED about, but a click anywhere on
  // the named road counts - outside city limits or outside the chosen station area included.
  //   - a road qualifies if at least half of it, or at least 150 m of it, is inside city limits
  //   - it belongs to a station area if at least 75 m (or half of its in-city length) is in that zone
  const STEP_M = 20; // sampling step along each road
  const MIN_CITY_M = 150, MIN_CITY_SHARE = 0.5;
  const MIN_ZONE_M = 75, MIN_ZONE_SHARE = 0.5;
  const segLen = (a, b) => Math.hypot((b[0] - a[0]) * M_LAT, (b[1] - a[1]) * M_LON);

  // Split a street into its in-city pieces, measuring length per station zone as we go.
  function clipToCity(lines) {
    const pieces = [];
    const zoneLen = new Map();
    let total = 0, inside = 0;
    for (const line of lines) {
      let cur = null;
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const len = segLen(a, b);
        const n = Math.max(1, Math.ceil(len / STEP_M));
        for (let k = 0; k < n; k++) {
          const p0 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          const p1 = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
          const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          const l = len / n;
          total += l;
          if (inCity(mid)) {
            inside += l;
            if (!cur) { cur = [p0]; pieces.push(cur); }
            cur.push(p1);
            for (const d of DISTRICTS) if (inDistrict(mid, d)) zoneLen.set(d.name, (zoneLen.get(d.name) || 0) + l);
          } else cur = null;
        }
      }
    }
    return { pieces, total, inside, zoneLen };
  }

  const STREETS = [];
  for (const s of STREET_INDEX) {
    const c = clipToCity(s.lines);
    if (c.inside < Math.min(MIN_CITY_M, c.total * MIN_CITY_SHARE)) continue;
    const districts = s.district && s.district.length
      ? s.district
      : DISTRICTS.filter((d) => {
          const z = c.zoneLen.get(d.name) || 0;
          return z > 0 && z >= Math.min(MIN_ZONE_M, c.inside * MIN_ZONE_SHARE);
        }).map((d) => d.name);
    // lines = the whole street (scoring + highlight); cityLines = in-city part (framing the view)
    STREETS.push({ ...s, cityLines: c.pieces, districts });
  }

  // ------------------------------------------------------------ map
  const map = L.map("map", { zoomControl: false, doubleClickZoom: false, minZoom: 12, maxZoom: 19, preferCanvas: true });
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const ATTR = 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  // "Street map" is drawn entirely from our own OSM data (water, parks, rail, roads) so there are
  // NO labels at any zoom. Third-party "no label" basemaps still print street names when zoomed in.
  map.createPane("basePane").style.zIndex = 250; // above tiles, below roads
  // Everything else (city mask, highlighted answer, click marker) draws above the road network.
  map.createPane("topPane").style.zIndex = 450;
  map.options.renderer = L.canvas({ pane: "topPane", padding: 0.5 });
  const baseRenderer = L.canvas({ pane: "basePane", padding: 0.5 });
  const fopts = { renderer: baseRenderer, interactive: false };
  const drawnBase = L.layerGroup([
    L.polygon(MAP_FEATURES.park, { ...fopts, stroke: false, fillColor: "#d4ead0", fillOpacity: 1 }),
    L.polygon(MAP_FEATURES.water, { ...fopts, stroke: false, fillColor: "#aad3df", fillOpacity: 1 }),
    L.polyline(MAP_FEATURES.river, { ...fopts, color: "#aad3df", weight: 4 }),
    L.polyline(MAP_FEATURES.rail, { ...fopts, color: "#9a9a9a", weight: 2, dashArray: "8 5" }),
  ]);
  drawnBase.getAttribution = () => ATTR + " | Buildings &copy; Waukesha County";

  // Building footprints (street map only, when zoomed in). Decoded from integer offsets and grouped
  // into ~1 km cells so the canvas only redraws cells on screen.
  const BLDG = (window.BUILDINGS || []).map((b) =>
    b.map((enc) => {
      const ring = [];
      let la = 0, lo = 0;
      for (let i = 0; i < enc.length; i += 2) {
        la += enc[i]; lo += enc[i + 1];
        ring.push([BUILDING_BASE[0] + la / 1e5, BUILDING_BASE[1] + lo / 1e5]);
      }
      return ring;
    }));
  const BUILDING_MIN_ZOOM = 15;
  const buildingLayer = L.layerGroup();
  {
    const cells = new Map();
    for (const b of BLDG) {
      const k = `${Math.floor(b[0][0][0] / 0.01)},${Math.floor(b[0][0][1] / 0.01)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(...b.map((r) => [r])); // each ring its own part (even-odd fill)
    }
    for (const parts of cells.values()) {
      buildingLayer.addLayer(L.polygon(parts, { ...fopts, color: "#bfb3a8", weight: 1, fillColor: "#ddd5cc", fillOpacity: 1 }));
    }
  }
  const inBuilding = (p, i) => i >= 0 && BLDG[i] && BLDG[i].filter((r) => inRing(p, r)).length % 2 === 1;
  const basemaps = {
    streets: drawnBase,
    satellite: L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: ATTR + " | Imagery &copy; Esri", maxZoom: 19, maxNativeZoom: 19,
    }),
  };
  // Street names - only added to the map after a guess.
  const labels = L.tileLayer(ESRI + "Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, maxNativeZoom: 16, pane: "shadowPane",
  });

  // Our own drawing of every named road (no names), so roads are crisp and match the click test.
  const roadRenderer = L.canvas({ padding: 0.5 });
  const roadStyle = {
    streets: {
      minor: { color: "#ffffff", weight: 3 }, major: { color: "#fbe7b5", weight: 5 },
      highway: { color: "#f3a65a", weight: 6 }, casing: "#b9b9b9",
    },
    satellite: {
      minor: { color: "#ffffff", weight: 1.5, opacity: 0.55 }, major: { color: "#ffe08a", weight: 2.5, opacity: 0.7 },
      highway: { color: "#ffb74d", weight: 3, opacity: 0.8 }, casing: null,
    },
  };
  const TIERS = ["minor", "major", "highway"]; // drawn bottom to top
  const roadLayer = L.layerGroup().addTo(map);
  let roadMode = "streets";
  function drawNetwork(mode = roadMode) {
    roadMode = mode;
    roadLayer.clearLayers();
    const z = map.getZoom();
    const k = z <= 12 ? 0.35 : z === 13 ? 0.55 : z === 14 ? 0.8 : z <= 16 ? 1 : 1.5; // thinner when zoomed out
    const st = roadStyle[mode];
    const opts = { renderer: roadRenderer, interactive: false, lineCap: "round", lineJoin: "round" };
    const tiers = TIERS.filter((t) => ROAD_NETWORK[t] && ROAD_NETWORK[t].length);
    if (st.casing) {
      for (const t of tiers) roadLayer.addLayer(L.polyline(ROAD_NETWORK[t], { ...opts, color: st.casing, weight: st[t].weight * k + 2 }));
    }
    for (const t of tiers) roadLayer.addLayer(L.polyline(ROAD_NETWORK[t], { ...opts, ...st[t], weight: st[t].weight * k }));
  }


  let currentBase = basemaps.streets.addTo(map);
  document.getElementById("basemap").addEventListener("change", (e) => {
    map.removeLayer(currentBase);
    currentBase = basemaps[e.target.value].addTo(map);
    document.getElementById("map").classList.toggle("sat", e.target.value === "satellite");
    drawNetwork(e.target.value);
    updateBuildings();
  });
  // buildings show on the street map once zoomed in close enough to pick one out
  function updateBuildings() {
    const show = roadMode === "streets" && map.getZoom() >= BUILDING_MIN_ZOOM;
    if (show && !map.hasLayer(buildingLayer)) buildingLayer.addTo(map);
    if (!show && map.hasLayer(buildingLayer)) map.removeLayer(buildingLayer);
  }

  // Grey out everything outside the city limits.
  const world = [[-90, -360], [-90, 360], [90, 360], [90, -360]];
  L.polygon([world, ...CITY_BOUNDARY.outer], { stroke: false, fillColor: "#222", fillOpacity: 0.35, interactive: false }).addTo(map);
  CITY_BOUNDARY.inner.forEach((r) =>
    L.polygon(r, { stroke: false, fillColor: "#222", fillOpacity: 0.35, interactive: false }).addTo(map));
  const cityLine = L.polygon(CITY_BOUNDARY.outer, { color: "#b3121b", weight: 2, fill: false, interactive: false }).addTo(map);
  const cityBounds = cityLine.getBounds();
  map.fitBounds(cityBounds, { padding: [10, 10] });
  drawNetwork();
  map.on("zoomend", () => { drawNetwork(); updateBuildings(); });
  updateBuildings();
  window.trainerMap = map; // handy for debugging in the browser console
  map.setMaxBounds(cityBounds.pad(0.35));

  const districtLayer = L.layerGroup().addTo(map);
  const guessLayer = L.layerGroup().addTo(map);

  let activeDistrictPoly = null;
  function showDistrict(name) {
    activeDistrictPoly = null;
    districtLayer.clearLayers();
    // each ring is its own part; canvas even-odd fill turns nested rings into holes
    const shape = (d, o) => L.polygon(d.rings.map((r) => [r]), { interactive: false, ...o });
    const d = DISTRICTS.find((x) => x.name === name);
    if (!d) {
      // whole city: faint outlines of every station area
      DISTRICTS.forEach((x) => districtLayer.addLayer(shape(x, { color: x.color, weight: 1.5, opacity: 0.6, fillOpacity: 0.04 })));
      return null;
    }
    const poly = shape(d, { color: d.color, weight: 2.5, dashArray: "6 6", fillColor: d.color, fillOpacity: 0.08 });
    districtLayer.addLayer(poly);
    activeDistrictPoly = poly;
    return poly;
  }

  function viewArea() {
    const poly = activeDistrictPoly;
    if (!poly) return map.fitBounds(cityBounds, { padding: [10, 10] });
    // district wedges extend past the city, so clip the view to the city limits
    const b = poly.getBounds();
    const clipped = L.latLngBounds(
      [Math.max(b.getSouth(), cityBounds.getSouth()), Math.max(b.getWest(), cityBounds.getWest())],
      [Math.min(b.getNorth(), cityBounds.getNorth()), Math.min(b.getEast(), cityBounds.getEast())]
    );
    map.fitBounds(clipped, { padding: [10, 10] });
  }

  // ------------------------------------------------------------ setup screen
  const $ = (id) => document.getElementById(id);
  const districtSel = $("district");
  districtSel.innerHTML = '<option value="">Whole city</option>' +
    DISTRICTS.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("");

  // Click accuracy. Street mode: always within 50 m of the road (no choice shown).
  // Address mode: within the chosen distance of the address point, or on the road (50 m) within
  // that distance of the spot in front of the address. Default is the most generous, 250 m.
  const STREET_TOLERANCE = 50;
  const ACCURACY = {
    street: { easy: STREET_TOLERANCE, normal: STREET_TOLERANCE, strict: STREET_TOLERANCE },
    address: { easy: 250, normal: 125, strict: 75 },
  };
  const ACC_LABEL = { easy: "Easy", normal: "Normal", strict: "Strict" };
  const MAX_QUESTIONS = 50;

  function settings() {
    const mode = $("addrMode").checked ? "address" : "street";
    const level = $("tolerance").value;
    return {
      cats: [...document.querySelectorAll('input[name="cat"]:checked')].map((c) => c.value),
      district: districtSel.value,
      // street mode: the last notch (51) means every matching street
      count: mode === "street" && +$("qcount").value > MAX_QUESTIONS ? Infinity : +$("qcount").value,
      mode,
      level,
      tolerance: ACCURACY[mode][level],
      roadTolerance: ACCURACY.street[level],
    };
  }

  const districtByName = (n) => DISTRICTS.find((d) => d.name === n);
  // Addresses on a street, limited to the chosen station area.
  function addressesFor(street, district) {
    const list = (window.ADDRESSES && ADDRESSES[street.name]) || [];
    const d = district && districtByName(district);
    return d ? list.filter((a) => inDistrict([a[1], a[2]], d)) : list;
  }
  // Secondary streets are mostly curated per station: in a station that doesn't list it, a secondary
  // street counts as Tertiary. One with no station list is secondary wherever it runs.
  // "Whole city" keeps every secondary street.
  const catIn = (s, district) => {
    const list = s.secondaryFor || [];
    return s.category === "Secondary" && district && list.length && !list.includes(district) ? "Tertiary" : s.category;
  };
  const CAT_LABEL = { "Dead end": "Court / dead end" };
  const catOf = (q) => q.cat || q.street.category;
  const catText = (q) => CAT_LABEL[catOf(q)] || catOf(q);
  function streetPool(st) {
    return STREETS.filter((s) => {
      const cat = catIn(s, st.district);
      if (!st.cats.includes(cat)) return false;
      if (!st.district) return true;
      // a station's own secondary list counts even where the road just touches the area
      return (cat === "Secondary" && s.secondaryFor.includes(st.district)) || s.districts.includes(st.district);
    });
  }
  // A pool entry is one street; in address mode only streets that have addresses in the area.
  function poolFor(st) {
    const streets = streetPool(st);
    return st.mode === "address" ? streets.filter((s) => addressesFor(s, st.district).length) : streets;
  }
  function makeQuestions(st) {
    return shuffle(poolFor(st)).slice(0, st.count).map((s) => {
      const cat = catIn(s, st.district);
      if (st.mode !== "address") return { street: s, addr: null, cat };
      const list = addressesFor(s, st.district);
      const a = list[Math.floor(Math.random() * list.length)];
      return { street: s, addr: { label: a[0], at: [a[1], a[2]], b: a[3] ?? -1 }, cat };
    });
  }

  function refreshSetup() {
    // Number of questions: 5-50, plus an "All streets" notch at the end in street mode only
    const addrMode = $("addrMode").checked;
    $("qcount").max = addrMode ? MAX_QUESTIONS : MAX_QUESTIONS + 1; // browser clamps the value if needed
    $("qcountHint").classList.toggle("hidden", addrMode);
    const st = settings();
    const poolSize = poolFor(st).length;
    $("qcountLabel").textContent = st.count === Infinity ? `All streets (${poolSize})` : st.count;
    // filled part of the slider track, and a little fire when going for every street
    const q = $("qcount");
    q.style.setProperty("--fill", `${((q.value - q.min) / (q.max - q.min)) * 100}%`);
    document.querySelector("#setup .card").classList.toggle("on-fire", st.count === Infinity);
    // accuracy is only a choice in address mode; street mode is a fixed 50 m
    $("accuracyBox").classList.toggle("hidden", st.mode !== "address");
    for (const opt of $("tolerance").options) {
      opt.textContent = `${ACC_LABEL[opt.value]} (within ${ACCURACY.address[opt.value]} m of the address)`;
    }
    document.querySelectorAll(".count").forEach((el) => {
      const n = poolFor({ ...st, cats: [el.dataset.cat] }).length;
      el.textContent = `(${n})`;
    });
    const pool = poolFor(st);
    const what = st.mode === "address" ? "streets with addresses" : "streets";
    $("poolInfo").textContent = pool.length
      ? `${pool.length} ${what} match.` + (pool.length < st.count ? ` Round will be ${pool.length} questions.` : "")
      : "No streets match - pick at least one street type.";
    $("startBtn").disabled = !pool.length;
    showDistrict(st.district);
  }
  document.querySelectorAll("#setup input, #setup select").forEach((el) => el.addEventListener("input", refreshSetup));
  refreshSetup();

  // ------------------------------------------------------------ game state
  // game = { questions: [{ street, addr }], i, results, tolerance, roadTolerance, answered }
  let game = null;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function startRound(questions) {
    const st = settings();
    game = { questions, i: 0, results: [], answered: false, level: st.level };
    $("setup").classList.add("hidden");
    $("summary").classList.add("hidden");
    $("hud").classList.remove("hidden");
    askQuestion();
  }

  $("startBtn").addEventListener("click", () => startRound(makeQuestions(settings())));

  // Debug helper (browser console): trainerPractice("2000 S West Ave") or trainerPractice("Madison Street")
  window.trainerPractice = (text) => {
    for (const s of STREETS) {
      if (s.name === text) return startRound([{ street: s, addr: null }]);
      const a = ((window.ADDRESSES && ADDRESSES[s.name]) || []).find((x) => x[0] === text);
      if (a) return startRound([{ street: s, addr: { label: a[0], at: [a[1], a[2]], b: a[3] ?? -1 } }]);
    }
    return "not found";
  };

  const questionTitle = (q) => (q.addr ? q.addr.label : q.street.name);

  function askQuestion() {
    const q = game.questions[game.i];
    game.answered = false;
    guessLayer.clearLayers();
    map.removeLayer(labels);
    $("map").classList.remove("revealed");
    $("feedback").classList.add("hidden");
    $("giveUpBtn").classList.remove("hidden");
    $("progress").textContent = `Question ${game.i + 1} of ${game.questions.length}` + (q.addr ? " - address" : "");
    $("target").textContent = questionTitle(q);
    $("targetCat").textContent = catText(q);
    updateScore();
    viewArea();
  }

  function updateScore() {
    const right = game.results.filter((r) => r.correct).length;
    $("score").textContent = `${right} / ${game.results.length}`;
  }

  // What street did they actually click on? (nearest street within 60 m, any category)
  function streetAt(latlng) {
    let best = null, bestD = 60;
    for (const s of STREETS) {
      const { dist } = nearestOnLines(latlng, s.lines);
      if (dist < bestD) { bestD = dist; best = s; }
    }
    return best;
  }

  function drawStreet(s, color, layer, withLabel) {
    const shadow = L.polyline(s.lines, { color: "#fff", weight: 12, opacity: 0.9, interactive: false });
    const line = L.polyline(s.lines, { color, weight: 7, opacity: 0.95, interactive: false });
    layer.addLayer(shadow).addLayer(line);
    if (withLabel) {
      // put the label on the longest piece of the road that is inside the city
      const longest = [...s.cityLines].sort((a, b) => b.length - a.length)[0] || s.lines[0];
      const mid = longest[Math.floor(longest.length / 2)];
      layer.addLayer(L.tooltip({ permanent: true, direction: "top", className: "road-label", offset: [0, -6] })
        .setLatLng(mid).setContent(esc(s.name)));
    }
    return line;
  }

  function drawAddress(addr, color, layer, radius) {
    if (radius) layer.addLayer(L.circle(addr.at, { radius, color, weight: 1, dashArray: "4 4", fillOpacity: 0.06, interactive: false }));
    // highlight the address's own building
    if (addr.b >= 0 && BLDG[addr.b]) {
      layer.addLayer(L.polygon(BLDG[addr.b].map((r) => [r]), { color, weight: 2.5, fillColor: color, fillOpacity: 0.35, interactive: false }));
    }
    layer.addLayer(L.circleMarker(addr.at, { radius: 9, color: "#fff", weight: 3, fillColor: color, fillOpacity: 1, interactive: false }));
    layer.addLayer(L.tooltip({ permanent: true, direction: "right", className: "road-label addr-label", offset: [10, 0] })
      .setLatLng(addr.at).setContent(esc(addr.label)));
  }

  function blocksHtml(s) {
    if (!s.blocks || !s.blocks.length) return '<span class="hint">not entered yet</span>';
    return s.blocks.map((b) => (b.from != null ? `${b.from}&ndash;${b.to}` : "") + (b.label ? ` ${esc(b.label)}` : "")).join("<br>")
      + (s.blocksAuto ? ' <span class="hint">(from county addresses)</span>' : "");
  }

  // Score a click. Street question: on the road. Address question: near the address point,
  // or on the road within the same distance of the address.
  function score(q, click) {
    const road = nearestOnLines(click, q.street.lines);
    if (!q.addr) {
      return { correct: road.dist <= ACCURACY.street[game.level], dist: road.dist, toward: road.point };
    }
    const R = ACCURACY.address[game.level];
    const front = frontage(q);
    const toAddr = nearestOnLines(click, [[q.addr.at]]).dist;
    const toFront = nearestOnLines(click, [[front]]).dist;
    // on the right road, close to the spot in front of the address (big lots sit far back from the road)
    const onRoadNearAddr = road.dist <= ACCURACY.street[game.level] && toFront <= R;
    // anywhere on the address's own building always counts, however big the building is
    if (inBuilding(click, q.addr.b)) return { correct: true, dist: 0, toward: q.addr.at, onBuilding: true };
    return { correct: toAddr <= R || onRoadNearAddr, dist: Math.min(toAddr, toFront), toward: toAddr <= toFront ? q.addr.at : front, radius: R };
  }

  // The point on the street directly in front of an address.
  function frontage(q) {
    return (q.addr.front ??= nearestOnLines(q.addr.at, q.street.lines).point);
  }

  function reveal(clickLatLng) {
    const q = game.questions[game.i];
    const s = q.street;
    game.answered = true;
    $("map").classList.add("revealed");
    $("giveUpBtn").classList.add("hidden");
    labels.addTo(map);

    let res = { correct: false, dist: null }, clicked = null;
    if (clickLatLng) {
      res = score(q, clickLatLng);
      clicked = streetAt(clickLatLng);
      if (!res.correct) {
        if (clicked && clicked !== s) drawStreet(clicked, "#888", guessLayer, true);
        guessLayer.addLayer(L.polyline([clickLatLng, res.toward], { color: "#c62828", weight: 2, dashArray: "5 6", interactive: false }));
      }
    }
    const color = res.correct ? "#1a8f3c" : "#d81b60";
    drawStreet(s, color, guessLayer, !q.addr);
    if (q.addr) {
      // driveway line from the address to its spot on the street
      guessLayer.addLayer(L.polyline([q.addr.at, frontage(q)], { color, weight: 3, opacity: 0.8, interactive: false }));
      drawAddress(q.addr, color, guessLayer, ACCURACY.address[game.level]);
    }
    if (clickLatLng) {
      guessLayer.addLayer(L.circleMarker(clickLatLng, {
        radius: 7, color: "#fff", weight: 2, fillColor: res.correct ? "#1a8f3c" : "#c62828", fillOpacity: 1, interactive: false,
      }));
    }

    game.results.push({
      q, correct: res.correct, dist: res.dist, skipped: !clickLatLng,
      clickedName: clicked && clicked !== s ? clicked.name : null,
      click: clickLatLng, onBuilding: !!res.onBuilding, clickedAny: clicked ? clicked.name : null,
    });
    updateScore();

    // frame the address (with some street around it), or the in-city part of the street
    let bounds;
    if (q.addr) {
      bounds = L.latLng(q.addr.at).toBounds(500);
    } else {
      bounds = L.latLngBounds(s.cityLines.flat());
    }
    if (clickLatLng) bounds.extend(clickLatLng);
    map.flyToBounds(bounds, { paddingTopLeft: [40, 110], paddingBottomRight: [40, 290], maxZoom: 17, duration: 0.6 });

    const title = $("fbTitle");
    title.className = "fb-title " + (res.correct ? "ok" : "bad");
    title.textContent = res.correct ? "Correct!" : clickLatLng ? "Not quite" : "Here it is";
    let html = "";
    if (clickLatLng && (!res.correct || q.addr)) {
      html += res.onBuilding
        ? "You clicked the building."
        : `You were <strong>${fmtDist(res.dist)}</strong> from ${esc(questionTitle(q))}.`;
      if (!res.correct && clicked && clicked !== s) html += ` You clicked <strong>${esc(clicked.name)}</strong>.`;
    }
    html += `<dl>
      ${q.addr ? `<dt>Address</dt><dd>${esc(q.addr.label)}</dd>` : ""}
      <dt>Street</dt><dd>${esc(s.name)}</dd>
      <dt>Type</dt><dd>${esc(catText(q))}${s.secondaryFor && s.secondaryFor.length ? ` <span class="hint">(on the ${esc(s.secondaryFor.join(" &amp; "))} list)</span>` : ""}</dd>
      <dt>Area</dt><dd>${esc(q.addr ? areaOf(q.addr.at) : s.districts.join(", ") || "-")}</dd>
      <dt>Blocks</dt><dd>${blocksHtml(s)}</dd>
      ${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ""}
    </dl>`;
    $("fbBody").innerHTML = html;
    $("nextBtn").textContent = game.i + 1 < game.questions.length ? "Next" : "See results";
    resetDispute(!res.correct);
    $("feedback").classList.remove("hidden");
    $("nextBtn").focus();
  }

  // ------------------------------------------------------------ "I was right" dispute log
  // Kept in this browser's local storage (the app has no server). Download it as a CSV from the
  // home screen to review answers that may be wrong in the data.
  const LOG_KEY = "waukeshaStreetTrainer.disputes.v1";
  function readLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
  }
  function writeLog(list) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); return true; } catch { return false; }
  }
  function refreshLogBar() {
    const n = readLog().length;
    $("logCount").textContent = `Answer disputes: ${n}`;
    $("logDownload").disabled = !n;
    $("logClear").disabled = !n;
  }

  function resetDispute(show) {
    $("dispute").classList.toggle("hidden", !show);
    $("disputeBtn").classList.remove("hidden");
    $("disputeForm").classList.add("hidden");
    $("disputeDone").classList.add("hidden");
    $("disputeNote").value = "";
  }
  $("disputeBtn").addEventListener("click", () => {
    $("disputeBtn").classList.add("hidden");
    $("disputeForm").classList.remove("hidden");
    $("disputeNote").focus();
  });
  $("disputeCancel").addEventListener("click", () => resetDispute(true));
  $("disputeSave").addEventListener("click", () => {
    const r = game.results[game.results.length - 1];
    const q = r.q;
    const r5 = (n) => Math.round(n * 1e5) / 1e5;
    const answerAt = q.addr ? q.addr.at : nearestOnLines(r.click || q.street.cityLines[0][0], q.street.lines).point;
    const entry = {
      time: new Date().toISOString(),
      question: questionTitle(q),
      type: q.addr ? "address" : "street",
      street: q.street.name,
      category: catOf(q),
      station: q.addr ? areaOf(q.addr.at) : q.street.districts.join(" / "),
      result: r.skipped ? "skipped" : "marked wrong",
      distance_m: r.dist == null ? "" : Math.round(r.dist),
      clicked_street: r.clickedAny || "",
      click_lat: r.click ? r5(r.click[0]) : "",
      click_lon: r.click ? r5(r.click[1]) : "",
      answer_lat: r5(answerAt[0]),
      answer_lon: r5(answerAt[1]),
      accuracy: q.addr ? `${ACCURACY.address[game.level]} m` : `${STREET_TOLERANCE} m`,
      note: $("disputeNote").value.trim(),
    };
    const list = readLog();
    list.push(entry);
    if (!writeLog(list)) { alert("Could not save to the log in this browser."); return; }
    $("disputeForm").classList.add("hidden");
    $("disputeDone").classList.remove("hidden");
    refreshLogBar();
    $("nextBtn").focus();
  });
  // keep Enter/Space inside the note box from jumping to the next question
  $("disputeNote").addEventListener("keydown", (e) => e.stopPropagation());

  const LOG_COLUMNS = ["time", "question", "type", "street", "category", "station", "result", "distance_m",
    "clicked_street", "click_lat", "click_lon", "answer_lat", "answer_lon", "accuracy", "note", "click_map", "answer_map"];
  $("logDownload").addEventListener("click", () => {
    const gm = (la, lo) => (la === "" ? "" : `https://www.google.com/maps?q=${la},${lo}`);
    const rows = readLog().map((e) => ({ ...e, click_map: gm(e.click_lat, e.click_lon), answer_map: gm(e.answer_lat, e.answer_lon) }));
    const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [LOG_COLUMNS.join(","), ...rows.map((r) => LOG_COLUMNS.map((c) => cell(r[c])).join(","))].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv" }); // BOM so Excel reads it as UTF-8
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `street-trainer-disputes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $("logClear").addEventListener("click", () => {
    const n = readLog().length;
    if (n && confirm(`Delete all ${n} logged disputes from this computer? Download the log first if you need it.`)) {
      writeLog([]);
      refreshLogBar();
    }
  });
  refreshLogBar();

  const areaOf = (p) => (DISTRICTS.find((d) => inDistrict(p, d)) || { name: "-" }).name;

  map.on("click", (e) => {
    if (!game || game.answered || !$("setup").classList.contains("hidden")) return;
    reveal([e.latlng.lat, e.latlng.lng]);
  });
  $("giveUpBtn").addEventListener("click", () => game && !game.answered && reveal(null));

  $("nextBtn").addEventListener("click", () => {
    game.i++;
    if (game.i < game.questions.length) askQuestion();
    else showSummary();
  });

  $("quitBtn").addEventListener("click", backToSetup);

  // ------------------------------------------------------------ summary
  function showSummary() {
    $("feedback").classList.add("hidden");
    $("hud").classList.add("hidden");
    const right = game.results.filter((r) => r.correct).length;
    const pct = Math.round((100 * right) / game.results.length);
    $("sumTitle").textContent = `${right} of ${game.results.length} correct (${pct}%)`;
    $("sumList").innerHTML = game.results.map((r, idx) => {
      const detail = r.correct ? "" : r.skipped ? "skipped" : `off by ${fmtDist(r.dist)}` + (r.clickedName ? ` &middot; clicked ${esc(r.clickedName)}` : "");
      return `<li data-idx="${idx}"><span class="mark ${r.correct ? "ok" : "bad"}">${r.correct ? "&#10003;" : "&#10007;"}</span>${esc(questionTitle(r.q))}
        <span class="dist">${detail}</span></li>`;
    }).join("");
    $("retryMissedBtn").disabled = right === game.results.length;
    $("summary").classList.remove("hidden");
    guessLayer.clearLayers();
    map.removeLayer(labels);
  }

  $("sumList").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const q = game.results[+li.dataset.idx].q;
    guessLayer.clearLayers();
    labels.addTo(map);
    drawStreet(q.street, "#d81b60", guessLayer, !q.addr);
    if (q.addr) drawAddress(q.addr, "#d81b60", guessLayer);
    $("summary").classList.add("hidden");
    const b = q.addr ? L.latLng(q.addr.at).toBounds(500) : L.latLngBounds(q.street.cityLines.flat());
    map.flyToBounds(b, { padding: [80, 80], maxZoom: 17, duration: 0.6 });
    // click anywhere on the map to return to the summary
    setTimeout(() => map.once("click", () => { $("summary").classList.remove("hidden"); }), 700);
  });

  $("retryMissedBtn").addEventListener("click", () => {
    const level = game.level;
    startRound(shuffle(game.results.filter((r) => !r.correct).map((r) => r.q)));
    game.level = level;
  });
  $("againBtn").addEventListener("click", backToSetup);

  function backToSetup() {
    game = null;
    guessLayer.clearLayers();
    map.removeLayer(labels);
    $("map").classList.remove("revealed");
    ["hud", "feedback", "summary"].forEach((id) => $(id).classList.add("hidden"));
    $("setup").classList.remove("hidden");
    refreshSetup();
    viewArea();
  }

  // Enter / Space advances after a guess
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("#dispute")) return; // let the dispute buttons work normally
    if ((e.key === "Enter" || e.key === " ") && game && game.answered && !$("feedback").classList.contains("hidden")) {
      e.preventDefault();
      $("nextBtn").click();
    }
  });
})();
