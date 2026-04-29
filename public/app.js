// State
let tracks = [];
let mmsis = [];
let selectedMmsi = null;
let selectedYear = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

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
    const monthDay = String(currentMonth + 1).padStart(2, "0") + String(day).padStart(2, "0");
    if (availableDates.has(monthDay)) {
      dayEl.classList.add("has-track");
      dayEl.title = "Track available";
      dayEl.style.cursor = "pointer";
      dayEl.addEventListener("click", async () => {
        // Find the track file for this ship/date
        const dateStr = String(selectedYear).slice(-2) + monthDay;
        const track = tracks.find(t => t.mmsi === selectedMmsi && t.date === dateStr);
        if (track) {
          try {
            const resp = await fetch(`/api/track/${track.filename}`);
            if (!resp.ok) throw new Error("Failed to load track");
            const points = await resp.json();
            trackInfo.innerHTML = `<h2>Track for ${selectedMmsi} on ${selectedYear}-${monthDay.slice(0,2)}-${monthDay.slice(2)}</h2><p>Number of points: <b>${Array.isArray(points) ? points.length : 0}</b></p>`;

            // Show map
            let mapDiv = document.getElementById("map");
            mapDiv.style.display = "block";
            if (!window._leafletMap) {
              window._leafletMap = L.map("map");
              L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap contributors'
              }).addTo(window._leafletMap);
            }
            let map = window._leafletMap;

            // Remove old layers
            if (window._trackLayer) {
              map.removeLayer(window._trackLayer);
            }

            // Extract lat/lngs
            const latlngs = Array.isArray(points)
              ? points.map(p => [p.latitude, p.longitude]).filter(([lat, lng]) => lat && lng)
              : [];

            if (latlngs.length > 0) {
              window._trackLayer = L.polyline(latlngs, { color: 'blue', weight: 4 }).addTo(map);
              map.fitBounds(window._trackLayer.getBounds(), { padding: [20, 20] });
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
