// ---------- Compass (rotating tape, read through a fixed window) ----------

const compassWindow = document.getElementById("compass-window");
const compassTape = document.getElementById("compass-tape");

// Neither compass is perfectly calibrated. Each has its own fixed error,
// picked once, that gets baked into what it displays — the boat's real
// heading (state.heading, defined further down) stays accurate for the
// actual simulation (wind, steering, track), only the readouts are thrown
// off.
const COMPASS_ERROR = (Math.random() * 2 - 1) * 10; // own compass: +/-10deg
const AUTOPILOT_COMPASS_ERROR = (Math.random() * 2 - 1) * 70; // +/-70deg

// Departure point: San Sebastián de La Gomera — a real Atlantic rowing
// race start. The route waypoint (27°30'N 017°48'W) must be passed to the
// south; see the weather-router logic further down.
const START_LAT = 28.0916;
const START_LON = -17.1133;
const START_HEADING = 180; // due south, to clear the island before turning
const WAYPOINT = { lat: 27 + 30 / 60, lon: -(17 + 48 / 60) };
const DEPARTURE_CLEAR_NM = 3;

let compassLastHeading = START_HEADING;
const SIXTEEN_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];
const TAPE_PX_PER_DEG = 4.5;
// Built well past a single 0-360 turn in each direction so the visible
// window (heading +/- a few dozen degrees) is always covered and the tape
// never needs to jump/wrap under the lubber line. -180..540 divides evenly
// by 22.5 too, so the 16-point cardinal labels line up across the range.
const TAPE_RANGE_MIN = -180;
const TAPE_RANGE_MAX = 540;

function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

function buildCompassTape() {
  // Ticks + the numeric degree scale (row 1), every integer degree.
  for (let deg = TAPE_RANGE_MIN; deg <= TAPE_RANGE_MAX; deg++) {
    const shown = normalizeDeg(deg);
    const x = (deg - TAPE_RANGE_MIN) * TAPE_PX_PER_DEG;
    const isCardinal = shown % 90 === 0;
    const isTen = shown % 10 === 0;
    // 45/135/225/315 fall through to here too (they're multiples of 5, not
    // 10), so they get the same smaller tick as the other *5 marks.
    const isFive = shown % 5 === 0;

    const tick = document.createElement("div");
    tick.className = "tape-tick";
    if (isCardinal) tick.classList.add("tick-cardinal");
    else if (isTen) tick.classList.add("tick-major");
    else if (isFive) tick.classList.add("tick-mid");
    tick.style.left = `${x}px`;
    tick.style.height = isCardinal
      ? "36px"
      : isTen
        ? "30px"
        : isFive
          ? "16px"
          : "9px";
    compassTape.appendChild(tick);

    if (isTen) {
      const label = document.createElement("div");
      label.className = "tape-label";
      label.style.left = `${x}px`;
      label.textContent = String(shown);
      compassTape.appendChild(label);
    }
  }

  // Cardinal / intercardinal letters (row 2), every 22.5 degrees (16-point
  // compass rose). The primary 8 points are bigger/bolder; the 8 in
  // between (NNE, ENE, ...) use a smaller, dimmer font.
  for (let deg = TAPE_RANGE_MIN; deg <= TAPE_RANGE_MAX; deg += 22.5) {
    const shown = normalizeDeg(deg);
    const x = (deg - TAPE_RANGE_MIN) * TAPE_PX_PER_DEG;
    const index = Math.round(shown / 22.5) % 16;

    const label = document.createElement("div");
    label.style.left = `${x}px`;
    if (index % 4 === 0) {
      label.className = "tape-cardinal-label cardinal-primary";
    } else if (index % 2 === 0) {
      label.className = "tape-cardinal-label cardinal-inter";
    } else {
      label.className = "tape-cardinal-label cardinal-fine";
    }
    label.textContent = SIXTEEN_POINTS[index];
    compassTape.appendChild(label);
  }
}
buildCompassTape();

function moveCompassTape(headingDeg) {
  compassLastHeading = headingDeg;
  const windowWidth = compassWindow.clientWidth || 300;
  const offset =
    windowWidth / 2 - (headingDeg - TAPE_RANGE_MIN) * TAPE_PX_PER_DEG;
  compassTape.style.transform = `translateX(${offset.toFixed(1)}px)`;
}

window.addEventListener("resize", () => moveCompassTape(compassLastHeading));

// Eases an on-screen angle toward a target, always taking the shortest way
// round (e.g. 358deg -> 2deg animates as +4, never as a -356deg sweep) and
// applies the rotation itself every frame instead of via a CSS transition
// (CSS can't interpolate rotate() across the 0/360 wrap or >180deg deltas
// without spinning the wrong way, which is what made the needle look like
// it was sliding side to side rather than turning around its pivot).
function createRotator(applyFn, initialDeg) {
  let current = initialDeg;
  let target = initialDeg;

  function frame() {
    const diff = shortestTurn(current, target);
    current = normalizeDeg(
      Math.abs(diff) < 0.05 ? target : current + diff * 0.15,
    );
    applyFn(current);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setTarget(deg) {
      target = normalizeDeg(deg);
    },
  };
}

const compassRotator = createRotator(
  moveCompassTape,
  normalizeDeg(START_HEADING + COMPASS_ERROR),
);

// ---------- Wind dial ----------

function polarPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

const windTicksGroup = document.getElementById("wind-ticks");
const windNeedle = document.getElementById("wind-needle");
const windSpeedEl = document.getElementById("wind-speed");

function buildWindTicks() {
  const cx = 80;
  const cy = 80;
  for (let deg = 0; deg < 360; deg += 30) {
    const [x1, y1] = polarPoint(cx, cy, 72, deg);
    const [x2, y2] = polarPoint(cx, cy, 62, deg);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1.toFixed(1));
    line.setAttribute("y1", y1.toFixed(1));
    line.setAttribute("x2", x2.toFixed(1));
    line.setAttribute("y2", y2.toFixed(1));
    windTicksGroup.appendChild(line);
  }
}
buildWindTicks();

const windRotator = createRotator((deg) => {
  windNeedle.setAttribute("transform", `rotate(${deg.toFixed(1)} 80 80)`);
}, 40);

// ---------- Autopilot ----------

const autopilotHdgEl = document.getElementById("autopilot-hdg");
const autopilotSetEl = document.getElementById("autopilot-set");

const state = {
  heading: START_HEADING,
  setHeading: START_HEADING,
  sog: 3.1,
  stw: 2.6,
  cog: START_HEADING,
  // True wind: real wind over the earth, independent of the boat.
  trueWindDir: 55, // degrees true, direction the wind is blowing FROM
  trueWindSpeed: 16, // knots
  // Apparent wind: what the boat's own instrument actually measures —
  // the true wind combined with the boat's own motion (SOG/COG).
  awa: 40, // degrees relative to the bow, 0-360 clockwise
  aws: 14, // knots
  // Ocean current — direction is the nautical "set", i.e. where it flows
  // TOWARD. Pushes the boat's actual position (see computeGroundTrack).
  currentDir: 205, // degrees true
  currentSpeed: 0.7, // knots ("drift")
  // Actual position over ground vs. dead-reckoning position, which only
  // advances by heading + STW and ignores current/wind entirely — the gap
  // between the two on the map IS the drift.
  lat: START_LAT,
  lon: START_LON,
  drLat: START_LAT,
  drLon: START_LON,
  // Weather router route script: "departure" (heading south clear of the
  // island) -> "toWaypoint" (rounding 27deg30'N 017deg48'W to the south,
  // course held) -> "openOcean" (waypoint cleared, normal updates resume).
  routerPhase: "departure",
  routerNextDailyAt: null,
};

// Vector (true-wind + boat-motion) apparent wind model. Angles are degrees
// true (0 = north, clockwise), directions are "from" bearings as on a
// compass. Returns apparent wind as a from-bearing (true) and a speed.
function computeApparentWind(trueWindFromDeg, trueWindSpeed, boatCourseDeg, boatSpeed) {
  const windTowardRad = ((trueWindFromDeg + 180) * Math.PI) / 180;
  const boatCourseRad = (boatCourseDeg * Math.PI) / 180;

  const windVx = trueWindSpeed * Math.sin(windTowardRad);
  const windVy = trueWindSpeed * Math.cos(windTowardRad);
  const boatVx = boatSpeed * Math.sin(boatCourseRad);
  const boatVy = boatSpeed * Math.cos(boatCourseRad);

  const relVx = windVx - boatVx;
  const relVy = windVy - boatVy;

  const speed = Math.hypot(relVx, relVy);
  const towardDeg = (Math.atan2(relVx, relVy) * 180) / Math.PI;
  const fromDeg = normalizeDeg(towardDeg + 180);

  return { fromDeg, speed };
}

// A light, high-sided ocean rowing boat gets blown downwind a bit too
// ("leeway") — here as a fixed fraction of true wind speed, applied in the
// direction the wind is blowing TOWARD.
const LEEWAY_COEFFICIENT = 0.04; // ~4% of true wind speed becomes drift

// Course/speed over ground = the boat's own travel through the water
// (heading + STW) vector-added with the ocean current (set + drift) AND
// wind leeway. This is why SOG/COG can diverge from HDG/STW — and since
// the autopilot only steers by its own compass, it never notices or
// corrects for either push.
function computeGroundTrack(
  headingDeg,
  stw,
  currentDirDeg,
  currentSpeed,
  windFromDeg,
  windSpeed,
) {
  const headingRad = (headingDeg * Math.PI) / 180;
  const currentRad = (currentDirDeg * Math.PI) / 180;
  const windTowardRad = ((windFromDeg + 180) * Math.PI) / 180;
  const leewaySpeed = windSpeed * LEEWAY_COEFFICIENT;

  const waterVx = stw * Math.sin(headingRad);
  const waterVy = stw * Math.cos(headingRad);
  const currentVx = currentSpeed * Math.sin(currentRad);
  const currentVy = currentSpeed * Math.cos(currentRad);
  const leewayVx = leewaySpeed * Math.sin(windTowardRad);
  const leewayVy = leewaySpeed * Math.cos(windTowardRad);

  const groundVx = waterVx + currentVx + leewayVx;
  const groundVy = waterVy + currentVy + leewayVy;

  const sog = Math.hypot(groundVx, groundVy);
  const cog = normalizeDeg((Math.atan2(groundVx, groundVy) * 180) / Math.PI);

  return { sog, cog };
}

// Each simulation tick represents this many minutes of boat time — purely
// a game-pacing choice so drift becomes visible on the map within a
// reasonable play session instead of requiring real hours to accumulate.
const TICK_SIM_MINUTES = 1;

// Flat-earth dead-reckoning step: move `distanceNm` along `courseDeg` from
// (lat, lon). Fine at this scale/duration; not meant for real navigation.
function advancePosition(lat, lon, courseDeg, distanceNm) {
  const rad = (courseDeg * Math.PI) / 180;
  const dLat = (distanceNm * Math.cos(rad)) / 60;
  const dLon =
    (distanceNm * Math.sin(rad)) / (60 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

function distanceNm(lat1, lon1, lat2, lon2) {
  const R_NM = 3440.065;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Flat-earth bearing from (lat1,lon1) to (lat2,lon2), degrees true. Same
// approximation as advancePosition/distanceNm — fine at this scale.
function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLatNm = (lat2 - lat1) * 60;
  const dLonNm = (lon2 - lon1) * 60 * Math.cos((lat1 * Math.PI) / 180);
  return normalizeDeg((Math.atan2(dLonNm, dLatNm) * 180) / Math.PI);
}

function renderAutopilot() {
  autopilotHdgEl.textContent = Math.round(
    normalizeDeg(state.heading + AUTOPILOT_COMPASS_ERROR),
  )
    .toString()
    .padStart(3, "0");
  autopilotSetEl.textContent = Math.round(normalizeDeg(state.setHeading))
    .toString()
    .padStart(3, "0");
}

document.querySelectorAll(".ap-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const delta = parseInt(btn.dataset.delta, 10);
    state.setHeading = normalizeDeg(state.setHeading + delta);
    renderAutopilot();
  });
});

// ---------- Live instrument simulation ----------

function shortestTurn(from, to) {
  let diff = normalizeDeg(to - from);
  if (diff > 180) diff -= 360;
  return diff;
}

function jitter(value, amount, min, max) {
  const next = value + (Math.random() - 0.5) * amount;
  return Math.min(max, Math.max(min, next));
}

function tickSimulation() {
  // The autopilot only knows its own (miscalibrated) compass reading, not
  // the boat's true heading — it steers to make THAT reading match SET.
  // So if its compass is off by, say, +49deg, the boat actually settles on
  // a true heading 49deg away from SET while the autopilot reports success.
  const measuredHeading = normalizeDeg(state.heading + AUTOPILOT_COMPASS_ERROR);
  const turn = shortestTurn(measuredHeading, state.setHeading);
  const step = Math.max(-2, Math.min(2, turn * 0.15)) + (Math.random() - 0.5) * 0.6;
  state.heading = normalizeDeg(state.heading + step);
  state.stw = jitter(state.stw, 0.15, 0.4, 5);

  // The real wind wanders slowly on its own, independent of the boat.
  state.trueWindDir = normalizeDeg(state.trueWindDir + (Math.random() - 0.5) * 3);
  state.trueWindSpeed = jitter(state.trueWindSpeed, 0.5, 3, 30);

  // Ocean current wanders slowly too, and — together with wind leeway —
  // actually pushes the boat: SOG/COG (over ground) are the boat's own
  // travel through the water (heading/STW) vector-added with the current
  // and the wind, so either one can make good speed/course visibly
  // diverge from HDG/STW — a real clue, since the autopilot only steers by
  // heading and never notices either push.
  state.currentDir = normalizeDeg(state.currentDir + (Math.random() - 0.5) * 1.5);
  state.currentSpeed = jitter(state.currentSpeed, 0.08, 0, 2.5);
  const ground = computeGroundTrack(
    state.heading,
    state.stw,
    state.currentDir,
    state.currentSpeed,
    state.trueWindDir,
    state.trueWindSpeed,
  );
  state.sog = ground.sog;
  state.cog = ground.cog;

  // Advance both positions: the actual track (COG/SOG, current included)
  // and the dead-reckoning track (heading/STW only) — the space between
  // them on the map is the drift.
  const stepDistanceNm = state.sog * (TICK_SIM_MINUTES / 60);
  const drStepDistanceNm = state.stw * (TICK_SIM_MINUTES / 60);
  const actualPos = advancePosition(
    state.lat,
    state.lon,
    state.cog,
    stepDistanceNm,
  );
  state.lat = actualPos.lat;
  state.lon = actualPos.lon;
  const drPos = advancePosition(
    state.drLat,
    state.drLon,
    state.heading,
    drStepDistanceNm,
  );
  state.drLat = drPos.lat;
  state.drLon = drPos.lon;

  // Weather router: may change state.setHeading (departure clear /
  // waypoint rounded / daily update) before the readouts below render.
  updateRouterPhase();

  // What the instrument on board actually reads: true wind as modified by
  // the boat's own speed and direction over ground (SOG/COG), then
  // expressed relative to the bow (since the dial is fixed to the boat).
  const apparent = computeApparentWind(
    state.trueWindDir,
    state.trueWindSpeed,
    state.cog,
    state.sog,
  );
  state.aws = apparent.speed;
  state.awa = normalizeDeg(apparent.fromDeg - state.heading);

  compassRotator.setTarget(normalizeDeg(state.heading + COMPASS_ERROR));
  renderAutopilot();
  windRotator.setTarget(state.awa);
  windSpeedEl.textContent = state.aws.toFixed(1);
  document.getElementById("stw-value").textContent = state.stw.toFixed(1);
  document.getElementById("sog-value").textContent = state.sog.toFixed(1);
  document.getElementById("cog-value").textContent = Math.round(state.cog)
    .toString()
    .padStart(3, "0");

  if (revealPanel.classList.contains("visible")) updateRevealPanel();
  updateTrackMap();
}

function tickClock() {
  const now = new Date();
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  document.getElementById("time-value").textContent = `${hh}:${mm}:${ss}`;
}

moveCompassTape(normalizeDeg(state.heading + COMPASS_ERROR));
renderAutopilot();
windSpeedEl.textContent = state.aws.toFixed(1);
tickClock();
setInterval(tickSimulation, 1200);
setInterval(tickClock, 1000);

// ---------- Weather router ----------

function nextSixAm(from) {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      6,
      0,
      0,
    ),
  );
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function formatUtc(date) {
  return `${date.toISOString().slice(0, 10)} ${date
    .toISOString()
    .slice(11, 16)} UTC`;
}

// Synthesized two-tone chime (no audio asset needed) played whenever the
// router posts. Browsers block audio until a user gesture has happened on
// the page at least once — the resume-on-first-interaction listener below
// unlocks it, so the very first message at page load may stay silent.
let audioCtx = null;
function getAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioCtx) audioCtx = new AudioCtor();
  return audioCtx;
}
["pointerdown", "keydown"].forEach((evt) =>
  window.addEventListener(
    evt,
    () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    },
    { once: true },
  ),
);

function playChimeTone(ctx, freq, startTime, duration, peakGain) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

function playDingDong() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  playChimeTone(ctx, 880, now, 0.45, 0.25); // "ding"
  playChimeTone(ctx, 659.25, now + 0.35, 0.6, 0.22); // "dong"
}

function postRouterMessage(text, badge, nextLabel) {
  document.getElementById("router-timestamp").textContent = formatUtc(
    new Date(),
  );
  document.getElementById("router-badge").textContent = badge;
  document.getElementById("router-body").textContent = text;
  document.getElementById("router-next").textContent = nextLabel;
  playDingDong();
}

// Miles of clearance to aim south of the waypoint's exact latitude, so a
// course that's a degree or two off (or a bit of drift) doesn't put the
// boat right on top of it.
const WAYPOINT_CLEARANCE_NM = 8;

// Scripted route: head south clear of the island, then hold a course that
// rounds the 27deg30'N 017deg48'W waypoint to the south, then (once past
// its meridian) resume the normal ~06:00 UTC daily updates.
function updateRouterPhase() {
  if (state.routerPhase === "departure") {
    if (distanceNm(START_LAT, START_LON, state.lat, state.lon) < DEPARTURE_CLEAR_NM) {
      return;
    }
    state.routerPhase = "toWaypoint";
    // Bearing from HERE (not a fixed number) to a point a few miles south
    // of the waypoint — otherwise a fixed course picked for one position
    // can end up crossing the waypoint's meridian north of it instead.
    const aimLat = WAYPOINT.lat - WAYPOINT_CLEARANCE_NM / 60;
    const recommendedCourse = Math.round(
      bearingDeg(state.lat, state.lon, aimLat, WAYPOINT.lon),
    );
    postRouterMessage(
      `Clear of the island. Recommend steering ${recommendedCourse}T to ` +
        "round the waypoint at 27°30'N 017°48'W — keep it to your north, " +
        "pass south of it. Set it on the autopilot yourself. Next update " +
        "once you're past 017°48'W.",
      "COURSE UPDATE",
      "Holding course until past 017°48'W",
    );
    return;
  }

  if (state.routerPhase === "toWaypoint") {
    if (state.lon > WAYPOINT.lon) return;
    state.routerPhase = "openOcean";
    state.routerNextDailyAt = nextSixAm(new Date());
    postRouterMessage(
      "Waypoint passed well to the south. Ridge building to the NE over " +
        "the next 48h — recommend steering 240T to stay south of the high " +
        "and pick up the trades. Set it yourself. Next update 06:00 UTC.",
      "COURSE UPDATE",
      `Next update ~${formatUtc(state.routerNextDailyAt)}`,
    );
    return;
  }

  // openOcean: resume the normal daily ~06:00 UTC schedule.
  const now = new Date();
  if (!state.routerNextDailyAt) state.routerNextDailyAt = nextSixAm(now);
  if (now >= state.routerNextDailyAt) {
    postRouterMessage(
      "Ridge easing. Recommend holding your present course for now — " +
        "full update at the next daily check-in.",
      "COURSE UPDATE",
      `Next update ~${formatUtc(nextSixAm(now))}`,
    );
    state.routerNextDailyAt = nextSixAm(now);
  }
}

postRouterMessage(
  "Depart San Sebastián de La Gomera heading 180T (due south) to clear " +
    "the island before turning onto your ocean course.",
  "DEPARTURE",
  "Next update once clear of the island",
);

// ---------- Track map ----------
//
// Plots the live simulation, not historical AIS data: the actual track
// (COG/SOG, current included) alongside the dead-reckoning track (heading
// + STW only, as if there were no current). The gap between the two lines
// IS the drift — visible without needing the hidden-values panel.

let trackMap = null;
let actualTrackLine = null;
let drTrackLine = null;
let actualPositionMarker = null;
const actualTrackPoints = [];
const drTrackPoints = [];

function initTrackMap() {
  const mapEl = document.getElementById("course-map");
  if (!mapEl || typeof L === "undefined") return;

  trackMap = L.map(mapEl, { zoomControl: true, attributionControl: true });
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 18,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  ).addTo(trackMap);

  actualTrackPoints.push([state.lat, state.lon]);
  drTrackPoints.push([state.drLat, state.drLon]);
  trackMap.setView([state.lat, state.lon], 13);

  drTrackLine = L.polyline(drTrackPoints, {
    color: "#82aabb",
    weight: 2,
    dashArray: "4, 6",
  })
    .bindTooltip("Dead reckoning (heading + STW only, no current)")
    .addTo(trackMap);

  actualTrackLine = L.polyline(actualTrackPoints, {
    color: "#3ad4e6",
    weight: 3,
  })
    .bindTooltip("Actual track over ground (COG/SOG, includes drift)")
    .addTo(trackMap);

  actualPositionMarker = L.circleMarker([state.lat, state.lon], {
    radius: 5,
    color: "#ffb020",
    fillColor: "#ffb020",
    fillOpacity: 1,
    weight: 2,
  })
    .bindTooltip("Current position")
    .addTo(trackMap);

  // The waypoint that must be passed to the south, plus a guide line
  // marking the latitude it sits on (stay below this line).
  L.polyline(
    [
      [WAYPOINT.lat, WAYPOINT.lon - 0.35],
      [WAYPOINT.lat, WAYPOINT.lon + 0.35],
    ],
    { color: "#ff5a4e", weight: 1, dashArray: "2, 5", opacity: 0.7 },
  ).addTo(trackMap);
  L.circleMarker([WAYPOINT.lat, WAYPOINT.lon], {
    radius: 6,
    color: "#ff5a4e",
    fillColor: "#ff5a4e",
    fillOpacity: 0.3,
    weight: 2,
  })
    .bindTooltip("Waypoint 27°30'N 017°48'W — pass to the south")
    .addTo(trackMap);
}
initTrackMap();

function updateTrackMap() {
  if (!trackMap) return;

  actualTrackPoints.push([state.lat, state.lon]);
  drTrackPoints.push([state.drLat, state.drLon]);
  actualTrackLine.setLatLngs(actualTrackPoints);
  drTrackLine.setLatLngs(drTrackPoints);
  actualPositionMarker.setLatLng([state.lat, state.lon]);

  const boundsPoints = actualTrackPoints.concat(drTrackPoints);
  // Once the router has pointed the boat at the waypoint, keep it in view
  // too, so you can see yourself approaching and passing it to the south.
  if (state.routerPhase !== "departure") {
    boundsPoints.push([WAYPOINT.lat, WAYPOINT.lon]);
  }
  const bounds = L.latLngBounds(boundsPoints);
  trackMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: false });
}

// ---------- Hidden values reveal ----------

const revealBtn = document.getElementById("reveal-btn");
const revealPanel = document.getElementById("reveal-panel");
let revealHideTimer = null;

function formatSignedDeg(deg) {
  return `${deg >= 0 ? "+" : ""}${deg.toFixed(1)}°`;
}

function updateRevealPanel() {
  document.getElementById("reveal-compass-error").textContent =
    formatSignedDeg(COMPASS_ERROR);
  document.getElementById("reveal-autopilot-error").textContent =
    formatSignedDeg(AUTOPILOT_COMPASS_ERROR);
  document.getElementById("reveal-true-wind").textContent =
    `${Math.round(state.trueWindDir)}° @ ${state.trueWindSpeed.toFixed(1)} kts`;
  document.getElementById("reveal-current").textContent =
    `${Math.round(state.currentDir)}° @ ${state.currentSpeed.toFixed(1)} kts`;
}

revealBtn.addEventListener("click", () => {
  updateRevealPanel();
  revealPanel.classList.add("visible");
  clearTimeout(revealHideTimer);
  revealHideTimer = setTimeout(() => {
    revealPanel.classList.remove("visible");
  }, 15000);
});
