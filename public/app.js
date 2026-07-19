// State
let tracks = [];
let mmsis = [];
let selectedMmsi = null;
let selectedYear = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

// Calculate distance between two coordinates using Haversine formula (returns meters)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate total track distance, ignoring points less than 25m apart
function calculateTrackDistance(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;

  let totalDistance = 0;
  let prevLat = null;
  let prevLon = null;

  for (const point of points) {
    if (point.latitude == null || point.longitude == null) continue;

    if (prevLat !== null && prevLon !== null) {
      const dist = haversineDistance(
        prevLat,
        prevLon,
        point.latitude,
        point.longitude,
      );
      if (dist >= 25) {
        // Only count points at least 25m apart
        totalDistance += dist;
      }
    }
    prevLat = point.latitude;
    prevLon = point.longitude;
  }

  return totalDistance;
}

// Calculate sailing times: start time, end time, and total sailing duration
function calculateSailingTimes(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return { startTime: null, endTime: null, totalSailingMs: 0 };
  }

  let startTime = null;
  let endTime = null;
  let prevLat = null;
  let prevLon = null;
  let prevTimestamp = null;
  let totalSailingMs = 0;

  for (const point of points) {
    if (point.latitude == null || point.longitude == null) continue;

    // Parse time_utc string to timestamp
    const timestamp = parseTrackTimestamp(point.time_utc);

    if (prevLat !== null && prevLon !== null && prevTimestamp && timestamp) {
      const dist = haversineDistance(
        prevLat,
        prevLon,
        point.latitude,
        point.longitude,
      );
      if (dist >= 25) {
        // This segment is moving
        if (startTime === null) {
          startTime = prevTimestamp;
        }
        endTime = timestamp;
        totalSailingMs += timestamp.getTime() - prevTimestamp.getTime();
      }
    }

    prevLat = point.latitude;
    prevLon = point.longitude;
    prevTimestamp = timestamp;
  }

  return { startTime, endTime, totalSailingMs };
}

// Format duration in hours and minutes
function formatDuration(ms) {
  if (!ms || ms <= 0) return "0h 0m";
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

// Format time as HH:MM
function formatTime(date) {
  if (!date) return "-";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseTrackTimestamp(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const directDate = new Date(trimmed);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:\s+([+-]\d{2})(\d{2})\s*(UTC|GMT))?$/i,
  );

  if (!match) {
    return null;
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    fractional,
    offsetHours,
    offsetMinutes,
  ] = match;
  const fractionalPart = fractional ? `.${fractional}` : "";
  const offset =
    offsetHours && offsetMinutes
      ? `${offsetHours.startsWith("+") || offsetHours.startsWith("-") ? offsetHours : `+${offsetHours}`}:${offsetMinutes}`
      : "Z";

  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}${fractionalPart}${offset === "Z" ? "Z" : offset}`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTooltipTime(point) {
  if (!point?.time_utc) return "-";

  const date = parseTrackTimestamp(point.time_utc);
  if (!date) return "-";

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Calculate initial bearing (heading) in degrees from point 1 to point 2
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);

  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;

  return (bearing + 360) % 360;
}

function getLastTrackedPoint(points) {
  if (!Array.isArray(points)) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.latitude != null && p.longitude != null) return p;
  }
  return null;
}

// Format a latitude/longitude pair as degrees, minutes and seconds, e.g. 52°37'52"N 5°53'17"E
function formatCoordinatesDM(lat, lon) {
  const formatComponent = (value, positiveLabel, negativeLabel) => {
    const hemisphere = value >= 0 ? positiveLabel : negativeLabel;
    const absValue = Math.abs(value);
    let degrees = Math.floor(absValue);
    let minutesFloat = (absValue - degrees) * 60;
    let minutes = Math.floor(minutesFloat);
    let seconds = Math.round((minutesFloat - minutes) * 60);
    if (seconds === 60) {
      seconds = 0;
      minutes += 1;
    }
    if (minutes === 60) {
      minutes = 0;
      degrees += 1;
    }
    const paddedMinutes = String(minutes).padStart(2, "0");
    const paddedSeconds = String(seconds).padStart(2, "0");
    return `${degrees}°${paddedMinutes}'${paddedSeconds}"${hemisphere}`;
  };

  const latStr = formatComponent(lat, "N", "S");
  const lonStr = formatComponent(lon, "E", "W");
  return `${latStr} ${lonStr}`;
}

function getNearestTrackPoint(latlng, points) {
  if (!latlng || !Array.isArray(points) || points.length === 0) return null;

  let nearestPoint = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  points.forEach((point) => {
    if (point.latitude == null || point.longitude == null) return;

    const distance = haversineDistance(
      point.latitude,
      point.longitude,
      latlng.lat,
      latlng.lng,
    );

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = point;
    }
  });

  return nearestPoint;
}

// DOM elements
const shipSelect = document.getElementById("ship-select");
const yearSelect = document.getElementById("year-select");
const monthYearSpan = document.getElementById("month-year");
const calendarDays = document.getElementById("calendar-days");
const prevMonthBtn = document.getElementById("prev-month");
const nextMonthBtn = document.getElementById("next-month");
const trackInfo = document.getElementById("track-info");
const refreshIndicator = document.getElementById("refresh-indicator");
const downloadGpxBtn = document.getElementById("download-gpx");
const downloadAllTracksBtn = document.getElementById("download-all-tracks");

let nextRefreshAt = null;
let lastRefreshAt = null;
let refreshCountdownTimer = null;
let currentTrackPoints = [];
let currentTrackMeta = null;

// Initialize
async function init() {
  await loadTracks();
  populateShipSelect();
  populateYearSelect();

  // Preselect first ship if available
  if (mmsis.length > 0) {
    selectedMmsi = mmsis[0];
    shipSelect.value = selectedMmsi;
  }
  // Preselect current year if available
  const thisYear = new Date().getFullYear();
  let yearOptions = Array.from(yearSelect.options)
    .map((o) => parseInt(o.value))
    .filter(Boolean);
  if (yearOptions.includes(thisYear)) {
    selectedYear = thisYear;
    yearSelect.value = thisYear;
    currentYear = thisYear;
  } else if (yearOptions.length > 0) {
    selectedYear = yearOptions[0];
    yearSelect.value = selectedYear;
    currentYear = selectedYear;
  }
  // Preselect current month
  currentMonth = new Date().getMonth();
  downloadGpxBtn.addEventListener("click", downloadTrackAsGpx);
  downloadAllTracksBtn.addEventListener("click", downloadAllTracksAsZip);
  downloadGpxBtn.disabled = true;
  downloadAllTracksBtn.disabled = true;

  renderCalendar();
  updateDownloadButtonsState();
}

// Load tracks from API
async function loadTracks() {
  try {
    const response = await fetch("/api/tracks");
    const data = await response.json();
    tracks = data.tracks;
    mmsis = data.mmsis;
    updateDownloadButtonsState();
  } catch (err) {
    console.error("Error loading tracks:", err);
  }
}

// Populate ship dropdown
function populateShipSelect() {
  shipSelect.innerHTML = '<option value="">Select a ship...</option>';
  mmsis.forEach((mmsi) => {
    const option = document.createElement("option");
    option.value = mmsi;
    option.textContent = mmsi;
    shipSelect.appendChild(option);
  });
}

// Populate year dropdown
function populateYearSelect() {
  const years = new Set();
  tracks.forEach((track) => {
    if (track.date) {
      const year = 2000 + parseInt(track.date.substring(0, 2));
      years.add(year);
    }
  });

  // Add current year if not present
  years.add(new Date().getFullYear());

  yearSelect.innerHTML = '<option value="">Select a year...</option>';
  Array.from(years)
    .sort((a, b) => b - a)
    .forEach((year) => {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      yearSelect.appendChild(option);
    });
}

function getDisplayDate(trackMeta) {
  if (!trackMeta) return "-";
  return `${trackMeta.year}-${trackMeta.monthDay.slice(0, 2)}-${trackMeta.monthDay.slice(2)}`;
}

function isTrackForToday(trackMeta) {
  if (!trackMeta) return false;
  const now = new Date();
  const trackDate = new Date(
    trackMeta.year,
    parseInt(trackMeta.monthDay.slice(0, 2), 10) - 1,
    parseInt(trackMeta.monthDay.slice(2), 10),
  );
  return (
    trackDate.getFullYear() === now.getFullYear() &&
    trackDate.getMonth() === now.getMonth() &&
    trackDate.getDate() === now.getDate()
  );
}

function getTrackFileName(trackMeta) {
  const trackName = trackMeta?.mmsi ? `ship-${trackMeta.mmsi}` : "track";
  const trackDate =
    trackMeta?.year && trackMeta?.monthDay
      ? `${trackMeta.year}-${trackMeta.monthDay.slice(0, 2)}-${trackMeta.monthDay.slice(2)}`
      : "track";
  return `${trackName}-${trackDate}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildGpxContent(points, trackMeta) {
  const safeName = getTrackFileName(trackMeta);
  const gpxTracks = (Array.isArray(points) ? points : [])
    .filter((point) => point.latitude != null && point.longitude != null)
    .map((point) => {
      const timestamp =
        parseTrackTimestamp(point.time_utc)?.toISOString() ?? null;
      const lat = point.latitude;
      const lon = point.longitude;
      const ele = point.altitude ?? point.elevation ?? 0;
      const speed = point.sog != null ? point.sog : 0;

      return `<trkpt lat="${lat}" lon="${lon}">${
        timestamp ? `<time>${timestamp}</time>` : ""
      }<ele>${ele}</ele><extensions><speed>${speed}</speed></extensions></trkpt>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Shiptracker" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeName}</name>
  </metadata>
  <trk>
    <name>${safeName}</name>
    <trkseg>
      ${gpxTracks}
    </trkseg>
  </trk>
</gpx>`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Safari can miss the download if the object URL is revoked immediately.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadTrackAsGpx() {
  if (!currentTrackPoints || currentTrackPoints.length === 0) {
    return;
  }

  const safeName = getTrackFileName(currentTrackMeta);
  const gpx = buildGpxContent(currentTrackPoints, currentTrackMeta);
  const blob = new Blob([gpx], { type: "application/gpx+xml;charset=utf-8" });
  downloadBlob(blob, `${safeName}.gpx`);
}

function getTracksForSelection() {
  if (!selectedMmsi || !selectedYear) return [];

  return tracks.filter((track) => {
    if (track.mmsi !== selectedMmsi || !track.date) return false;
    const trackYear = 2000 + parseInt(track.date.substring(0, 2));
    return trackYear === selectedYear;
  });
}

function updateDownloadButtonsState() {
  const hasCurrentTrack = currentTrackPoints.length > 0;
  downloadGpxBtn.disabled = !hasCurrentTrack;

  const matchingTracks = getTracksForSelection();
  downloadAllTracksBtn.disabled =
    !selectedMmsi || !selectedYear || matchingTracks.length === 0;
}

async function downloadAllTracksAsZip() {
  if (!selectedMmsi || !selectedYear) return;

  const matchingTracks = getTracksForSelection();
  if (matchingTracks.length === 0) return;

  downloadAllTracksBtn.disabled = true;
  downloadAllTracksBtn.textContent = "Preparing...";

  try {
    const zip = new JSZip();

    for (const track of matchingTracks) {
      try {
        const resp = await fetch(`/api/track/${track.filename}`);
        if (!resp.ok) throw new Error(`Failed to load ${track.filename}`);
        const points = await resp.json();
        const monthDay = track.date.substring(2);
        const trackMeta = {
          filename: track.filename,
          mmsi: track.mmsi,
          year: selectedYear,
          monthDay,
        };
        zip.file(
          `${getTrackFileName(trackMeta)}.gpx`,
          buildGpxContent(points, trackMeta),
        );
      } catch (err) {
        console.error("Error exporting track to ZIP:", err);
      }
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, `${selectedMmsi}-${selectedYear}-tracks.zip`);
  } finally {
    downloadAllTracksBtn.textContent = "Download all tracks";
    updateDownloadButtonsState();
  }
}

function handleMapClickForBearing(event) {
  const lastPoint = getLastTrackedPoint(currentTrackPoints);
  if (!lastPoint) return;

  const map = window._leafletMap;
  if (window._clickLineLayer) {
    map.removeLayer(window._clickLineLayer);
  }

  const fromLatLng = [lastPoint.latitude, lastPoint.longitude];
  const toLatLng = [event.latlng.lat, event.latlng.lng];

  const bearing = calculateBearing(
    lastPoint.latitude,
    lastPoint.longitude,
    event.latlng.lat,
    event.latlng.lng,
  );
  const distanceMeters = haversineDistance(
    lastPoint.latitude,
    lastPoint.longitude,
    event.latlng.lat,
    event.latlng.lng,
  );
  const distanceNm = distanceMeters / 1852;
  const coordsStr = formatCoordinatesDM(event.latlng.lat, event.latlng.lng);

  window._clickLineLayer = L.layerGroup().addTo(map);

  L.polyline([fromLatLng, toLatLng], {
    color: "#FF8C00",
    weight: 3,
    dashArray: "6, 6",
  }).addTo(window._clickLineLayer);

  L.marker(toLatLng, {
    icon: L.divIcon({
      className: "bearing-label",
      html: `<div class="bearing-label-content">${bearing.toFixed(0)}°<br/>${distanceNm.toFixed(2)} nm<br/>${coordsStr}</div>`,
      iconSize: [0, 0],
      iconAnchor: [-8, 8],
    }),
  }).addTo(window._clickLineLayer);
}

const SLIPWAY_MAX_SPAN_DEGREES = 2;
const SLIPWAY_ICON_MAX_SPAN_DEGREES = 0.5;
let slipwayUpdateTimer = null;

const BOAT_RAMP_ICON_HTML = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="26" height="26">
    <polygon points="4,22 26,6 26,12 10,24" fill="#1B4F72" stroke="#0B2942" stroke-width="1"/>
    <path d="M2 24 Q8 20 14 24 L12 27 Q7 29 4 27 Z" fill="#D35400" stroke="#7B341E" stroke-width="1"/>
    <path d="M0 27 q4 -3 8 0 t8 0 t8 0 t8 0" stroke="#2E86C1" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>
`;

const boatRampIcon = L.divIcon({
  className: "boat-ramp-icon",
  html: BOAT_RAMP_ICON_HTML,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function scheduleSlipwayUpdate() {
  clearTimeout(slipwayUpdateTimer);
  slipwayUpdateTimer = setTimeout(updateSlipwaysVisibility, 300);
}

function clearSlipwayLayer() {
  const map = window._leafletMap;
  if (map && window._slipwayLayer) {
    map.removeLayer(window._slipwayLayer);
  }
  window._slipwayLayer = null;
}

function renderSlipways(slipways, useIcons) {
  const map = window._leafletMap;
  if (!map) return;

  clearSlipwayLayer();

  window._slipwayLayer = L.layerGroup().addTo(map);
  slipways.forEach((p) => {
    const marker = useIcons
      ? L.marker([p.lat, p.lon], { icon: boatRampIcon })
      : L.circleMarker([p.lat, p.lon], {
          radius: 5,
          color: "#1E8449",
          fillColor: "#58D68D",
          fillOpacity: 0.9,
          weight: 1,
        });

    marker.bindTooltip(p.name || "Slipway").addTo(window._slipwayLayer);
  });
}

async function updateSlipwaysVisibility() {
  const map = window._leafletMap;
  if (!map) return;

  const bounds = map.getBounds();
  const latSpan = bounds.getNorth() - bounds.getSouth();
  const lonSpan = bounds.getEast() - bounds.getWest();
  const maxSpan = Math.max(latSpan, lonSpan);

  if (maxSpan > SLIPWAY_MAX_SPAN_DEGREES) {
    clearSlipwayLayer();
    return;
  }

  const params = new URLSearchParams({
    minLat: bounds.getSouth(),
    maxLat: bounds.getNorth(),
    minLon: bounds.getWest(),
    maxLon: bounds.getEast(),
  });

  try {
    const resp = await fetch(`/api/slipways?${params}`);
    if (!resp.ok) throw new Error("Failed to load slipways");
    const slipways = await resp.json();
    renderSlipways(slipways, maxSpan <= SLIPWAY_ICON_MAX_SPAN_DEGREES);
  } catch (err) {
    console.error("Error loading slipways:", err);
  }
}

function renderTrackOnMap(points, trackMeta) {
  if (!trackMeta) return;

  currentTrackPoints = Array.isArray(points) ? points : [];
  downloadGpxBtn.disabled = currentTrackPoints.length === 0;
  currentTrackMeta = trackMeta;
  const distanceMeters = calculateTrackDistance(points);
  const distanceKm = (distanceMeters / 1000).toFixed(2);
  const distanceNm = (distanceMeters / 1852).toFixed(2);
  const sailingTimes = calculateSailingTimes(points);
  const startTimeStr = formatTime(sailingTimes.startTime);
  const endTimeStr = formatTime(sailingTimes.endTime);
  const durationStr = formatDuration(sailingTimes.totalSailingMs);

  const isCurrentDay = (() => {
    const now = new Date();
    const trackDate = new Date(
      trackMeta.year,
      parseInt(trackMeta.monthDay.slice(0, 2), 10) - 1,
      parseInt(trackMeta.monthDay.slice(2), 10),
    );
    return (
      trackDate.getFullYear() === now.getFullYear() &&
      trackDate.getMonth() === now.getMonth() &&
      trackDate.getDate() === now.getDate()
    );
  })();

  const isStillMoving = (() => {
    if (!isCurrentDay || !sailingTimes.endTime) return false;
    const now = new Date();
    const diffMs = now.getTime() - sailingTimes.endTime.getTime();
    return diffMs >= 0 && diffMs <= 10 * 60 * 1000;
  })();

  let timeSegment = "";
  if (startTimeStr !== "-") {
    timeSegment = `from ${startTimeStr}`;
    if (!isStillMoving && endTimeStr !== "-") {
      timeSegment += ` till ${endTimeStr}`;
    }
  }

  trackInfo.innerHTML = `<h2>Track for ${trackMeta.mmsi} on ${getDisplayDate(trackMeta)}</h2>
    <p>Travelled: <b>${distanceKm} km</b> (<b>${distanceNm} nm</b>)${timeSegment ? ` ${timeSegment}` : ""} total <b>${durationStr}</b></p>`;

  let mapDiv = document.getElementById("map");
  mapDiv.style.display = "block";
  if (isTrackForToday(trackMeta)) {
    lastRefreshAt = new Date();
    nextRefreshAt = new Date(lastRefreshAt.getTime() + 120000);
  } else {
    lastRefreshAt = null;
    nextRefreshAt = null;
  }
  updateRefreshIndicator();
  if (!window._leafletMap) {
    window._leafletMap = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(window._leafletMap);
    window._leafletMap.on("click", handleMapClickForBearing);
    window._leafletMap.on("moveend", scheduleSlipwayUpdate);
  }
  let map = window._leafletMap;

  if (window._trackLayer) {
    map.removeLayer(window._trackLayer);
  }
  if (window._pointCircles) {
    map.removeLayer(window._pointCircles);
  }
  if (window._clickLineLayer) {
    map.removeLayer(window._clickLineLayer);
    window._clickLineLayer = null;
  }

  const latlngs = Array.isArray(points)
    ? points
        .map((p) => [Number(p.latitude), Number(p.longitude)])
        .filter(
          ([lat, lng]) =>
            typeof lat === "number" &&
            typeof lng === "number" &&
            !Number.isNaN(lat) &&
            !Number.isNaN(lng),
        )
    : [];

  if (latlngs.length > 0) {
    window._trackLayer = L.polyline(latlngs, {
      color: "blue",
      weight: 4,
    }).addTo(map);
    map.invalidateSize();

    window._trackLayer.bindTooltip("Hover over the track", {
      sticky: true,
      direction: "top",
      opacity: 0.9,
    });

    window._trackLayer.on("mousemove", (event) => {
      const nearestPoint = getNearestTrackPoint(event.latlng, points);
      const timeText = nearestPoint?.time_utc
        ? formatTooltipTime(nearestPoint)
        : "-";
      const speedText =
        nearestPoint?.sog != null ? `${nearestPoint.sog.toFixed(1)} kn` : "-";

      window._trackLayer.setTooltipContent(
        `<div><strong>${timeText}</strong><br/>Speed: ${speedText}</div>`,
      );
      window._trackLayer.openTooltip(event.latlng);
    });

    window._trackLayer.on("mouseout", () => {
      window._trackLayer.closeTooltip();
    });

    window._pointCircles = L.layerGroup().addTo(map);
    const circleRadius = 25;
    const minZoomForCircles = 15;

    const trackBounds = window._trackLayer.getBounds();
    try {
      if (trackBounds.isValid()) {
        map.fitBounds(trackBounds, { padding: [20, 20] });
      } else if (latlngs.length > 0) {
        map.setView(latlngs[0], 13);
      }
    } catch (err) {
      console.warn("Leaflet fitBounds failed, falling back to setView:", err);
      if (latlngs.length > 0) {
        map.setView(latlngs[0], 13);
      }
    }

    const destinationPoint = (lat, lon, bearing, distance) => {
      const R = 6371000;
      const brng = (bearing * Math.PI) / 180;
      const lat1 = (lat * Math.PI) / 180;
      const lon1 = (lon * Math.PI) / 180;
      const d = distance;

      const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d / R) +
          Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng),
      );
      const lon2 =
        lon1 +
        Math.atan2(
          Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1),
          Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2),
        );

      return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
    };

    const createArrowIcon = (cog) => {
      return L.divIcon({
        className: "arrow-marker",
        html: `<svg width="20" height="20" viewBox="0 0 20 20" style="transform: rotate(${cog}deg);">
                  <polygon points="10,0 16,16 10,12 4,16" fill="#4169E1" stroke="white" stroke-width="1"/>
                </svg>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
    };

    const createCompassNeedle = (heading) => {
      return L.divIcon({
        className: "compass-marker",
        html: `<svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate(${heading}deg);">
                  <polygon points="8,0 12,8 8,8 4,8" fill="#CC0000"/>
                  <polygon points="8,16 12,8 8,8 4,8" fill="#FFFFFF"/>
                </svg>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
    };

    points.forEach((p) => {
      if (p.latitude && p.longitude) {
        L.circle([p.latitude, p.longitude], {
          radius: circleRadius,
          color: "#9370DB",
          fillColor: "#9370DB",
          fillOpacity: 0.5,
          weight: 2,
        }).addTo(window._pointCircles);

        if (p.heading != null && p.heading >= 0 && p.heading <= 360) {
          L.marker([p.latitude, p.longitude], {
            icon: createCompassNeedle(p.heading),
          }).addTo(window._pointCircles);
        }

        if (p.cog != null) {
          const arrowPos = destinationPoint(
            p.latitude,
            p.longitude,
            p.cog,
            circleRadius,
          );
          L.marker(arrowPos, {
            icon: createArrowIcon(p.cog),
          }).addTo(window._pointCircles);
        }
      }
    });

    const updateCircleVisibility = () => {
      if (window._pointCircles) {
        if (map.getZoom() >= minZoomForCircles) {
          window._pointCircles.addTo(map);
        } else {
          map.removeLayer(window._pointCircles);
        }
      }
    };
    if (window._pointCircleZoomHandler) {
      map.off("zoomend", window._pointCircleZoomHandler);
    }
    window._pointCircleZoomHandler = updateCircleVisibility;
    map.on("zoomend", window._pointCircleZoomHandler);
    updateCircleVisibility();
  } else {
    mapDiv.style.display = "none";
  }
}

function updateRefreshIndicator() {
  if (!currentTrackMeta?.filename) {
    refreshIndicator.textContent =
      "Auto-refresh is idle until a track is selected.";
    return;
  }

  if (!isTrackForToday(currentTrackMeta)) {
    refreshIndicator.textContent =
      "Auto-refresh is disabled for the selected day.";
    return;
  }

  if (!lastRefreshAt || !nextRefreshAt) {
    refreshIndicator.textContent =
      "Auto-refresh is preparing for today's track...";
    return;
  }

  const now = new Date();
  const remainingMs = Math.max(0, nextRefreshAt - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");

  refreshIndicator.textContent = `Last refreshed: ${lastRefreshAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}. Next refresh in ${minutes}:${paddedSeconds}.`;
}

async function refreshCurrentTrack() {
  if (!currentTrackMeta?.filename || !isTrackForToday(currentTrackMeta)) return;

  try {
    const resp = await fetch(`/api/track/${currentTrackMeta.filename}`);
    if (!resp.ok) throw new Error("Failed to refresh track");
    const points = await resp.json();
    renderTrackOnMap(points, currentTrackMeta);
    nextRefreshAt = new Date(Date.now() + 120000);
    updateRefreshIndicator();
  } catch (err) {
    console.error("Auto-refresh failed:", err);
    refreshIndicator.textContent = `Auto-refresh failed at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`;
  }
}

function startRefreshCountdown() {
  if (refreshCountdownTimer) {
    clearInterval(refreshCountdownTimer);
  }
  refreshCountdownTimer = setInterval(updateRefreshIndicator, 1000);
}

setInterval(refreshCurrentTrack, 120000);
startRefreshCountdown();

// Get tracks for selected ship
function getTracksForShip(mmsi) {
  return tracks.filter((t) => t.mmsi === mmsi);
}

// Get available dates for selected ship and year
function getAvailableDates(mmsi, year) {
  const shipTracks = getTracksForShip(mmsi);
  const dates = new Set();

  shipTracks.forEach((track) => {
    if (track.date) {
      const trackYear = 2000 + parseInt(track.date.substring(0, 2));
      if (trackYear === year) {
        const monthDay = track.date.substring(2); // MMDD
        dates.add(monthDay);
      }
    }
  });

  return dates;
}

// Render calendar
function renderCalendar() {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  monthYearSpan.textContent = `${monthNames[currentMonth]} ${currentYear}`;

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

  calendarDays.innerHTML = "";

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const dayEl = document.createElement("div");
    dayEl.className = "calendar-day other-month";
    dayEl.textContent = day;
    calendarDays.appendChild(dayEl);
  }

  // Current month days
  const availableDates =
    selectedMmsi && selectedYear
      ? getAvailableDates(selectedMmsi, selectedYear)
      : new Set();

  for (let day = 1; day <= daysInMonth; day++) {
    const dayEl = document.createElement("div");
    dayEl.className = "calendar-day";
    dayEl.textContent = day;

    // Check if track exists for this day
    const monthDay =
      String(currentMonth + 1).padStart(2, "0") + String(day).padStart(2, "0");
    if (availableDates.has(monthDay)) {
      dayEl.classList.add("has-track");
      dayEl.title = "Track available";
      dayEl.style.cursor = "pointer";
      dayEl.addEventListener("click", async () => {
        // Find the track file for this ship/date
        const dateStr = String(selectedYear).slice(-2) + monthDay;
        const track = tracks.find(
          (t) => t.mmsi === selectedMmsi && t.date === dateStr,
        );
        if (track) {
          try {
            const resp = await fetch(`/api/track/${track.filename}`);
            if (!resp.ok) throw new Error("Failed to load track");
            const points = await resp.json();

            currentTrackMeta = {
              filename: track.filename,
              mmsi: selectedMmsi,
              year: selectedYear,
              monthDay,
            };

            renderTrackOnMap(points, currentTrackMeta);
          } catch (err) {
            trackInfo.innerHTML = `<p style='color:red'>Error loading track: ${err.message}</p>`;
            let mapDiv = document.getElementById("map");
            mapDiv.style.display = "none";
          }
        }
      });
    }

    calendarDays.appendChild(dayEl);
  }

  updateDownloadButtonsState();

  // Next month days
  const totalCells = firstDay + daysInMonth;
  const remainingCells = 7 - (totalCells % 7);
  if (remainingCells < 7) {
    for (let day = 1; day <= remainingCells; day++) {
      const dayEl = document.createElement("div");
      dayEl.className = "calendar-day other-month";
      dayEl.textContent = day;
      calendarDays.appendChild(dayEl);
    }
  }
}

// Event listeners
shipSelect.addEventListener("change", (e) => {
  selectedMmsi = e.target.value || null;
  renderCalendar();
  updateDownloadButtonsState();
});

yearSelect.addEventListener("change", (e) => {
  selectedYear = e.target.value ? parseInt(e.target.value) : null;
  if (selectedYear) {
    currentYear = selectedYear;
    currentMonth = 0;
  }
  renderCalendar();
  updateDownloadButtonsState();
});

prevMonthBtn.addEventListener("click", () => {
  currentMonth--;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  }
  renderCalendar();
});

nextMonthBtn.addEventListener("click", () => {
  currentMonth++;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  renderCalendar();
});

// Start
init();
