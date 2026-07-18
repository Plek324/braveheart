(function (root) {
  const BATTERY_CAPACITY_AH = 210;
  const PV_PEAK_CURRENT_A = 10;

  // startHour: 0-23, hour of day the consumer switches on.
  // duration: "H:MM" the consumer stays on for; may run past midnight
  // (e.g. startHour 18 + duration 12:00 = on 18:00-06:00).
  const CONSUMERS = [
    { id: "autopilot", name: "Autopilot", currentA: 0.7, defaultOn: true, startHour: 0, duration: "24:00" },
    { id: "radio-ais", name: "Radio + AIS", currentA: 1, defaultOn: true, startHour: 0, duration: "24:00" },
    { id: "instruments", name: "Instruments", currentA: 0.6, defaultOn: true, startHour: 0, duration: "24:00" },
    { id: "tricolor-light", name: "Tricolor light", currentA: 0.2, defaultOn: false, startHour: 18, duration: "12:00" },
    { id: "fan-front", name: "Fan front", currentA: 0.3, defaultOn: true, startHour: 0, duration: "8:00" },
    { id: "fan-back", name: "Fan back", currentA: 0.3, defaultOn: true, startHour: 8, duration: "16:00" },
    { id: "cabin-light-front", name: "Cabin light front", currentA: 0.05, defaultOn: true, startHour: 0, duration: "1:00" },
    { id: "cabin-light-back", name: "Cabin light back", currentA: 0.05, defaultOn: true, startHour: 12, duration: "2:00" },
    { id: "tracker-wtr", name: "Tracker WTR", currentA: 0.1, defaultOn: true, startHour: 0, duration: "24:00" },
    { id: "starlink", name: "Starlink", currentA: 3, defaultOn: true, startHour: 19, duration: "0:15" },
    { id: "iridium-phone", name: "Iridium phone", currentA: 0.5, defaultOn: true, startHour: 10, duration: "2:00" },
    { id: "cell-phone", name: "Cell phone", currentA: 2, defaultOn: true, startHour: 10, duration: "1:00" },
    { id: "watermaker", name: "Watermaker", currentA: 10, defaultOn: true, startHour: 13, duration: "1:00" },
    { id: "bilge-pumps", name: "Bilge pumps", currentA: 4, defaultOn: false, startHour: 17, duration: "0:10" },
  ];

  function parseDurationHours(duration) {
    const [hours, minutes] = duration.split(":").map(Number);
    return hours + minutes / 60;
  }

  // Fraction (0-1) of the hour bucket [hourStart, hourStart+1) during which a
  // consumer that switches on at startHour for durationHours is active.
  // Handles schedules that wrap past midnight (startHour + durationHours > 24).
  function scheduleOverlapHours(hourStart, startHour, durationHours) {
    if (durationHours <= 0) return 0;

    const end = startHour + durationHours;
    const segments =
      end <= 24 ? [[startHour, end]] : [[startHour, 24], [0, end - 24]];

    const hourEnd = hourStart + 1;
    return segments.reduce((overlap, [segStart, segEnd]) => {
      const overlapStart = Math.max(hourStart, segStart);
      const overlapEnd = Math.min(hourEnd, segEnd);
      return overlap + Math.max(0, overlapEnd - overlapStart);
    }, 0);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function dayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  }

  function calculateSolarCurrent(latitude, datetime) {
    const latRad = (latitude * Math.PI) / 180;
    const day = dayOfYear(datetime);
    const declination =
      ((23.45 * Math.PI) / 180) *
      Math.sin((360 / 365) * (284 + day) * (Math.PI / 180));
    const hour = datetime.getHours() + datetime.getMinutes() / 60;
    const hourAngle = (hour - 12) * 15 * (Math.PI / 180);

    const elevation = Math.asin(
      Math.sin(latRad) * Math.sin(declination) +
        Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle),
    );

    const daylightFactor = Math.max(0, Math.sin(elevation));

    return PV_PEAK_CURRENT_A * daylightFactor;
  }

  function simulateBattery({
    latitude,
    startDate,
    cloudFactors,
    consumerSchedules,
  }) {
    const capacityAh = BATTERY_CAPACITY_AH;
    const series = [];
    let batteryAh = capacityAh;
    let loadCurrentSum = 0;
    let peakLoadCurrentA = 0;
    const baseDate = new Date(startDate);
    baseDate.setHours(0, 0, 0, 0);

    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const timestamp = new Date(baseDate);
        timestamp.setDate(baseDate.getDate() + day);
        timestamp.setHours(hour, 0, 0, 0);

        const loadCurrentA = CONSUMERS.reduce((sum, consumer, index) => {
          const schedule = consumerSchedules[index];
          if (!schedule || !schedule.enabled) return sum;
          const overlap = scheduleOverlapHours(
            hour,
            schedule.startHour,
            schedule.durationHours,
          );
          return sum + consumer.currentA * overlap;
        }, 0);

        const solarCurrent = calculateSolarCurrent(latitude, timestamp);
        const cloudFactor = cloudFactors[day] || 0;
        const effectiveYield = Math.max(
          0,
          solarCurrent * (1 - cloudFactor / 10),
        );
        // Not tapered by battery SoC (no absorption/float stage modeled), so this
        // is the same current a mid-charge (~50%) battery would actually accept.
        const potentialPvCurrentA = Math.min(PV_PEAK_CURRENT_A, effectiveYield);
        const netDeltaAh = potentialPvCurrentA - loadCurrentA;
        batteryAh = clamp(batteryAh + netDeltaAh, 0, capacityAh);

        loadCurrentSum += loadCurrentA;
        peakLoadCurrentA = Math.max(peakLoadCurrentA, loadCurrentA);

        series.push({
          timestamp,
          potentialPvCurrentA,
          loadCurrentA,
          batteryAh,
          batteryPercent: (batteryAh / capacityAh) * 100,
        });
      }
    }

    return {
      series,
      averageLoadCurrentA: loadCurrentSum / series.length,
      peakLoadCurrentA,
    };
  }

  function renderChart(series) {
    const svg = document.getElementById("battery-graph");
    const width = 1080;
    const height = 440;
    const padding = { top: 20, right: 130, bottom: 60, left: 70 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const CURRENT_SCALE_MAX = 25;

    const makeLinePath = (values, scaleFn) =>
      values
        .map((value, index) => {
          const x = padding.left + (index / (values.length - 1)) * plotWidth;
          const y = scaleFn(value);
          return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");

    const percentValues = series.map((point) => point.batteryPercent);
    const ahValues = series.map((point) => point.batteryAh);
    const pvCurrentValues = series.map((point) => point.potentialPvCurrentA);
    const loadCurrentValues = series.map((point) => point.loadCurrentA);

    const percentScale = (value) =>
      padding.top + plotHeight - (value / 100) * plotHeight;
    const ahScale = (value) =>
      padding.top + plotHeight - (value / 210) * plotHeight;
    const currentScale = (value) =>
      padding.top + plotHeight - (value / CURRENT_SCALE_MAX) * plotHeight;

    const legend = [
      {
        label: "Charge %",
        color: "#1a5f7a",
        scaleFn: percentScale,
        values: percentValues,
      },
      {
        label: "Charge Ah",
        color: "#e67e22",
        scaleFn: ahScale,
        values: ahValues,
      },
      {
        label: "Potential PV current (A)",
        color: "#16a34a",
        scaleFn: currentScale,
        values: pvCurrentValues,
        dashed: true,
      },
      {
        label: "Load current (A)",
        color: "#dc2626",
        scaleFn: currentScale,
        values: loadCurrentValues,
      },
    ];

    const gridLines = [0, 25, 50, 75, 100];
    const ahGridLines = [0, 52.5, 105, 157.5, 210];
    const currentGridLines = [0, 6.25, 12.5, 18.75, 25];

    const xLabelPositions = Array.from({ length: 8 }, (_, index) => {
      const x = padding.left + (index / 7) * plotWidth;
      return { x, label: `Day ${index + 1}` };
    });

    const gridMarkup = [
      ...gridLines.map((line) => {
        const y = padding.top + plotHeight - (line / 100) * plotHeight;
        return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="3 3" />`;
      }),
      ...ahGridLines.map((line) => {
        const y = padding.top + plotHeight - (line / 210) * plotHeight;
        return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#f5d7b0" stroke-dasharray="2 2" />`;
      }),
      ...currentGridLines.map((line) => {
        const y = padding.top + plotHeight - (line / CURRENT_SCALE_MAX) * plotHeight;
        return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#bbf7d0" stroke-dasharray="1 4" />`;
      }),
      ...xLabelPositions.map(
        (pos) =>
          `<line x1="${pos.x}" y1="${padding.top}" x2="${pos.x}" y2="${height - padding.bottom}" stroke="#f3f4f6" />`,
      ),
    ].join("");

    const seriesMarkup = legend
      .map((entry) => {
        const path = makeLinePath(entry.values, entry.scaleFn);
        const points = entry.values
          .map((value, pointIndex) => {
            const x =
              padding.left + (pointIndex / (entry.values.length - 1)) * plotWidth;
            const y = entry.scaleFn(value);
            return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.4" fill="${entry.color}" />`;
          })
          .join("");
        const dashAttr = entry.dashed ? ' stroke-dasharray="6 4"' : "";

        return `<path d="${path}" fill="none" stroke="${entry.color}" stroke-width="2.5"${dashAttr} />${points}`;
      })
      .join("");

    svg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="#fff" />
      ${gridMarkup}
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#4b5563" />
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#4b5563" />
      ${seriesMarkup}
      <text x="${padding.left}" y="${padding.top - 8}" font-size="14" fill="#4b5563">Battery charge over 7 days</text>
      <text x="${width - padding.right + 8}" y="${padding.top + 16}" font-size="12" fill="#1a5f7a">Charge %</text>
      <text x="${width - padding.right + 8}" y="${padding.top + 34}" font-size="12" fill="#e67e22">Charge Ah</text>
      <text x="${width - padding.right + 8}" y="${padding.top + 52}" font-size="12" fill="#16a34a">Potential PV current (A)</text>
      <text x="${width - padding.right + 8}" y="${padding.top + 70}" font-size="12" fill="#dc2626">Load current (A)</text>
      ${xLabelPositions.map((pos) => `<text x="${pos.x}" y="${height - padding.bottom + 24}" font-size="11" text-anchor="middle" fill="#4b5563">${pos.label}</text>`).join("")}
      <text x="${padding.left - 45}" y="${padding.top + 10}" font-size="12" fill="#4b5563">100%</text>
      <text x="${padding.left - 45}" y="${height - padding.bottom}" font-size="12" fill="#4b5563">0%</text>
      <text x="${width - padding.right + 8}" y="${padding.top + 10}" font-size="12" fill="#4b5563">210 Ah</text>
      <text x="${width - padding.right + 8}" y="${height - padding.bottom}" font-size="12" fill="#4b5563">0 Ah</text>
      <text x="${width - 6}" y="${padding.top + 10}" font-size="12" text-anchor="end" fill="#16a34a">25 A</text>
      <text x="${width - 6}" y="${height - padding.bottom}" font-size="12" text-anchor="end" fill="#16a34a">0 A</text>
    `;
  }

  function updateSummary({
    averageLoadCurrentA,
    peakLoadCurrentA,
    startDate,
    latitude,
  }) {
    const summary = document.getElementById("summary-load-current");
    const statusDate = document.getElementById("status-date");
    const statusLatitude = document.getElementById("status-latitude");

    summary.innerHTML = `<strong>Load current:</strong> ${averageLoadCurrentA.toFixed(2)} A avg / ${peakLoadCurrentA.toFixed(2)} A peak`;
    statusDate.textContent = `Start: ${new Date(startDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
    statusLatitude.textContent = `Latitude: ${latitude}°`;
  }

  function buildConsumerTable() {
    const tbody = document.getElementById("consumer-table-body");

    CONSUMERS.forEach((consumer, index) => {
      const durationHours = parseDurationHours(consumer.duration);
      const wholeHours = Math.floor(durationHours);
      const minutes = Math.round((durationHours - wholeHours) * 60);

      const row = document.createElement("tr");
      row.dataset.consumerIndex = String(index);
      row.innerHTML = `
        <td><input type="checkbox" data-role="enabled" ${consumer.defaultOn ? "checked" : ""}></td>
        <td>${consumer.name}</td>
        <td>${consumer.currentA} A</td>
        <td><input type="number" class="hour-input" data-role="start-hour" min="0" max="23" value="${consumer.startHour}"></td>
        <td class="duration-cell">
          <input type="number" class="duration-input" data-role="duration-hours" min="0" max="24" value="${wholeHours}"><span>:</span><input type="number" class="duration-input" data-role="duration-minutes" min="0" max="59" value="${minutes}">
        </td>
      `;
      tbody.appendChild(row);
    });
  }

  function buildCloudControls() {
    const container = document.getElementById("cloud-slider-list");
    const controls = [];

    for (let index = 0; index < 7; index += 1) {
      const wrapper = document.createElement("div");
      wrapper.className = "cloud-control";
      const label = document.createElement("label");
      label.textContent = `Day ${index + 1}`;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "10";
      slider.value = "0";
      slider.dataset.day = index;
      const output = document.createElement("output");
      output.textContent = "0";
      slider.addEventListener("input", () => {
        output.textContent = slider.value;
        renderSimulation();
      });
      wrapper.appendChild(label);
      wrapper.appendChild(slider);
      wrapper.appendChild(output);
      container.appendChild(wrapper);
      controls.push({ slider, output });
    }

    return controls;
  }

  function getCloudFactors(cloudControls) {
    return cloudControls.map((control) => Number(control.value));
  }

  function applyCloudPreset(value) {
    const wrappers = document.querySelectorAll(
      "#cloud-slider-list .cloud-control",
    );
    wrappers.forEach((wrapper) => {
      const slider = wrapper.querySelector("input[type='range']");
      const output = wrapper.querySelector("output");
      slider.value = String(value);
      output.textContent = String(value);
    });
    renderSimulation();
  }

  function getConsumerSchedules() {
    const rows = Array.from(
      document.querySelectorAll("#consumer-table-body tr"),
    );

    return rows.map((row) => {
      const enabled = row.querySelector('[data-role="enabled"]').checked;
      const startHour = clamp(
        Number(row.querySelector('[data-role="start-hour"]').value) || 0,
        0,
        23,
      );
      const durationHoursPart =
        Number(row.querySelector('[data-role="duration-hours"]').value) || 0;
      const durationMinutesPart =
        Number(row.querySelector('[data-role="duration-minutes"]').value) ||
        0;
      const durationHours = clamp(
        durationHoursPart + durationMinutesPart / 60,
        0,
        24,
      );

      return { enabled, startHour, durationHours };
    });
  }

  function renderSimulation() {
    const latitudeInput = document.getElementById("latitude-select");
    const dateInput = document.getElementById("simulation-date");
    const cloudControls = Array.from(
      document.querySelectorAll("#cloud-slider-list input[type='range']"),
    );

    const latitude = Number(latitudeInput.value);
    const startDate = dateInput.value || new Date().toISOString().slice(0, 10);
    const consumerSchedules = getConsumerSchedules();
    const cloudFactors = getCloudFactors(cloudControls);

    const { series, averageLoadCurrentA, peakLoadCurrentA } = simulateBattery({
      latitude,
      startDate,
      cloudFactors,
      consumerSchedules,
    });

    renderChart(series);
    updateSummary({ averageLoadCurrentA, peakLoadCurrentA, startDate, latitude });
  }

  const PRESETS = {
    start: { latitude: "28.1", date: "2026-12-12" },
    halfway: { latitude: "15", date: "2027-01-20" },
  };

  function applyPreset(preset) {
    document.getElementById("latitude-select").value = preset.latitude;
    document.getElementById("simulation-date").value = preset.date;
    renderSimulation();
  }

  function init() {
    const dateInput = document.getElementById("simulation-date");
    dateInput.value = new Date().toISOString().slice(0, 10);
    buildConsumerTable();
    buildCloudControls();

    [dateInput].forEach((element) =>
      element.addEventListener("change", renderSimulation),
    );
    document
      .getElementById("latitude-select")
      .addEventListener("change", renderSimulation);
    document
      .getElementById("consumer-table-body")
      .addEventListener("input", renderSimulation);
    document
      .getElementById("preset-start")
      .addEventListener("click", () => applyPreset(PRESETS.start));
    document
      .getElementById("preset-halfway")
      .addEventListener("click", () => applyPreset(PRESETS.halfway));
    document
      .getElementById("preset-sunny")
      .addEventListener("click", () => applyCloudPreset(1));
    document
      .getElementById("preset-cloudy")
      .addEventListener("click", () => applyCloudPreset(5));
    document
      .getElementById("preset-bad-weather")
      .addEventListener("click", () => applyCloudPreset(8));

    renderSimulation();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", init);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      BATTERY_CAPACITY_AH,
      PV_PEAK_CURRENT_A,
      CONSUMERS,
      calculateSolarCurrent,
      simulateBattery,
      parseDurationHours,
      scheduleOverlapHours,
      clamp,
      dayOfYear,
    };
  }

  root.BatterySimulation = {
    BATTERY_CAPACITY_AH,
    PV_PEAK_CURRENT_A,
    CONSUMERS,
    calculateSolarCurrent,
    simulateBattery,
    parseDurationHours,
    scheduleOverlapHours,
    clamp,
    dayOfYear,
  };
})(typeof window !== "undefined" ? window : globalThis);
