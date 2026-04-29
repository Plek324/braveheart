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
    const timestamp = point.time_utc ? new Date(point.time_utc) : null;

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

// DOM elements
const shipSelect = document.getElementById("ship-select");
const yearSelect = document.getElementById("year-select");
const monthYearSpan = document.getElementById("month-year");
const calendarDays = document.getElementById("calendar-days");
const prevMonthBtn = document.getElementById("prev-month");
const nextMonthBtn = document.getElementById("next-month");
const trackInfo = document.getElementById("track-info");

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

  renderCalendar();
}

// Load tracks from API
async function loadTracks() {
  try {
    const response = await fetch("/api/tracks");
    const data = await response.json();
    tracks = data.tracks;
    mmsis = data.mmsis;
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
            const distanceMeters = calculateTrackDistance(points);
            const distanceKm = (distanceMeters / 1000).toFixed(2);
            const distanceNm = (distanceMeters / 1852).toFixed(2); // 1 nautical mile = 1852 meters

            const sailingTimes = calculateSailingTimes(points);
            const startTimeStr = formatTime(sailingTimes.startTime);
            const endTimeStr = formatTime(sailingTimes.endTime);
            const durationStr = formatDuration(sailingTimes.totalSailingMs);

            trackInfo.innerHTML = `<h2>Track for ${selectedMmsi} on ${selectedYear}-${monthDay.slice(0, 2)}-${monthDay.slice(2)}</h2>
              <p>Distance travelled: <b>${distanceKm} km</b> (<b>${distanceNm} nm</b>)</p>
              <p>Started moving: <b>${startTimeStr}</b> | Stopped moving: <b>${endTimeStr}</b></p>
              <p>Total time sailing: <b>${durationStr}</b></p>`;

            // Show map
            let mapDiv = document.getElementById("map");
            mapDiv.style.display = "block";
            if (!window._leafletMap) {
              window._leafletMap = L.map("map");
              L.tileLayer(
                "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                {
                  maxZoom: 19,
                  attribution: "© OpenStreetMap contributors",
                },
              ).addTo(window._leafletMap);
            }
            let map = window._leafletMap;

            // Remove old layers
            if (window._trackLayer) {
              map.removeLayer(window._trackLayer);
            }
            if (window._pointCircles) {
              map.removeLayer(window._pointCircles);
            }

            // Extract lat/lngs
            const latlngs = Array.isArray(points)
              ? points
                  .map((p) => [p.latitude, p.longitude])
                  .filter(([lat, lng]) => lat && lng)
              : [];

            if (latlngs.length > 0) {
              window._trackLayer = L.polyline(latlngs, {
                color: "blue",
                weight: 4,
              }).addTo(map);

              // Add circles at each point (only visible when zoomed in)
              window._pointCircles = L.layerGroup().addTo(map);
              const circleRadius = 25; // meters
              const minZoomForCircles = 15;

              // Calculate destination point given start, bearing, and distance
              const destinationPoint = (lat, lon, bearing, distance) => {
                const R = 6371000; // Earth radius in meters
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

              // Create arrow icon function
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

              // Create compass needle icon (half red, half white)
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
                  // Circle
                  L.circle([p.latitude, p.longitude], {
                    radius: circleRadius,
                    color: "#9370DB",
                    fillColor: "#9370DB",
                    fillOpacity: 0.5,
                    weight: 2,
                  }).addTo(window._pointCircles);

                  // Compass needle pointing in heading direction (if valid 0-360)
                  if (p.heading != null && p.heading >= 0 && p.heading <= 360) {
                    L.marker([p.latitude, p.longitude], {
                      icon: createCompassNeedle(p.heading),
                    }).addTo(window._pointCircles);
                  }

                  // Arrow pointing in COG direction, placed on edge of circle
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

              // Show/hide circles based on zoom level
              const updateCircleVisibility = () => {
                if (window._pointCircles) {
                  if (map.getZoom() >= minZoomForCircles) {
                    window._pointCircles.addTo(map);
                  } else {
                    map.removeLayer(window._pointCircles);
                  }
                }
              };
              map.on("zoomend", updateCircleVisibility);
              updateCircleVisibility();

              map.fitBounds(window._trackLayer.getBounds(), {
                padding: [20, 20],
              });
            } else {
              mapDiv.style.display = "none";
            }
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
});

yearSelect.addEventListener("change", (e) => {
  selectedYear = e.target.value ? parseInt(e.target.value) : null;
  if (selectedYear) {
    currentYear = selectedYear;
    currentMonth = 0;
  }
  renderCalendar();
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
