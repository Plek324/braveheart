(function (root) {
  const BATTERY_CAPACITY_AH = 210;
  const CONSUMER_CURRENT_A = 1;
  const PV_PEAK_CURRENT_A = 10;
  const CONSUMER_COUNT = 5;

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
    const seasonalBoost =
      0.7 + 0.4 * Math.sin((day / 365) * 2 * Math.PI - Math.PI / 2);
    const normalized = Math.max(0, daylightFactor * seasonalBoost);

    return PV_PEAK_CURRENT_A * normalized;
  }

  function simulateBattery({
    latitude,
    startDate,
    cloudFactors,
    consumerStates,
  }) {
    const capacityAh = BATTERY_CAPACITY_AH;
    const loadCurrentA =
      consumerStates.filter(Boolean).length * CONSUMER_CURRENT_A;
    const series = [];
    let batteryAh = capacityAh;
    const baseDate = new Date(startDate);
    baseDate.setHours(0, 0, 0, 0);

    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const timestamp = new Date(baseDate);
        timestamp.setDate(baseDate.getDate() + day);
        timestamp.setHours(hour, 0, 0, 0);

        const solarCurrent = calculateSolarCurrent(latitude, timestamp);
        const cloudFactor = cloudFactors[day] || 0;
        const effectiveYield = Math.max(
          0,
          solarCurrent * (1 - cloudFactor / 10),
        );
        const actualChargingCurrent = Math.min(
          PV_PEAK_CURRENT_A,
          effectiveYield,
        );
        const netDeltaAh = actualChargingCurrent - loadCurrentA;
        batteryAh = clamp(batteryAh + netDeltaAh, 0, capacityAh);

        series.push({
          timestamp,
          solarCurrent: actualChargingCurrent,
          loadCurrentA,
          batteryAh,
          batteryPercent: (batteryAh / capacityAh) * 100,
        });
      }
    }

    return { series, loadCurrentA };
  }

  function renderChart(series) {
    const svg = document.getElementById("battery-graph");
    const width = 1000;
    const height = 440;
    const padding = { top: 20, right: 70, bottom: 60, left: 70 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

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

    const percentScale = (value) =>
      padding.top + plotHeight - (value / 100) * plotHeight;
    const ahScale = (value) =>
      padding.top + plotHeight - (value / 210) * plotHeight;

    const legend = [
      {
        label: "Charge %",
        color: "#1a5f7a",
        path: makeLinePath(percentValues, percentScale),
      },
      {
        label: "Charge Ah",
        color: "#e67e22",
        path: makeLinePath(ahValues, ahScale),
      },
    ];

    const gridLines = [0, 25, 50, 75, 100];
    const ahGridLines = [0, 52.5, 105, 157.5, 210];

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
      ...xLabelPositions.map(
        (pos) =>
          `<line x1="${pos.x}" y1="${padding.top}" x2="${pos.x}" y2="${height - padding.bottom}" stroke="#f3f4f6" />`,
      ),
    ].join("");

    const seriesMarkup = legend
      .map((entry, index) => {
        const points = series
          .map((point, pointIndex) => {
            const x =
              padding.left + (pointIndex / (series.length - 1)) * plotWidth;
            const y =
              index === 0
                ? percentScale(point.batteryPercent)
                : ahScale(point.batteryAh);
            return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.4" fill="${entry.color}" />`;
          })
          .join("");

        return `<path d="${entry.path}" fill="none" stroke="${entry.color}" stroke-width="2.5" />${points}`;
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
      ${xLabelPositions.map((pos) => `<text x="${pos.x}" y="${height - padding.bottom + 24}" font-size="11" text-anchor="middle" fill="#4b5563">${pos.label}</text>`).join("")}
      <text x="${padding.left - 45}" y="${padding.top + 10}" font-size="12" fill="#4b5563">100%</text>
      <text x="${padding.left - 45}" y="${height - padding.bottom}" font-size="12" fill="#4b5563">0%</text>
      <text x="${width - padding.right + 8}" y="${padding.top + 10}" font-size="12" fill="#4b5563">210 Ah</text>
      <text x="${width - padding.right + 8}" y="${height - padding.bottom}" font-size="12" fill="#4b5563">0 Ah</text>
    `;
  }

  function updateSummary({ loadCurrentA, startDate, latitude }) {
    const summary = document.getElementById("summary-load-current");
    const statusDate = document.getElementById("status-date");
    const statusLatitude = document.getElementById("status-latitude");

    summary.innerHTML = `<strong>Load current:</strong> ${loadCurrentA.toFixed(0)} A`;
    statusDate.textContent = `Start: ${new Date(startDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
    statusLatitude.textContent = `Latitude: ${latitude}°`;
  }

  function buildConsumerControls() {
    const container = document.getElementById("consumer-list");
    const controls = [];

    for (let index = 1; index <= CONSUMER_COUNT; index += 1) {
      const wrapper = document.createElement("label");
      wrapper.className = "consumer-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.dataset.consumer = index;
      const span = document.createElement("span");
      span.textContent = `Consumer ${index}`;
      wrapper.appendChild(input);
      wrapper.appendChild(span);
      container.appendChild(wrapper);
      controls.push(input);
    }

    return controls;
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

  function getConsumerStates(consumerControls) {
    return consumerControls.map((control) => control.checked);
  }

  function renderSimulation() {
    const latitudeInput = document.getElementById("latitude-select");
    const dateInput = document.getElementById("simulation-date");
    const consumerControls = Array.from(
      document.querySelectorAll("#consumer-list input[type='checkbox']"),
    );
    const cloudControls = Array.from(
      document.querySelectorAll("#cloud-slider-list input[type='range']"),
    );

    const latitude = Number(latitudeInput.value);
    const startDate = dateInput.value || new Date().toISOString().slice(0, 10);
    const consumerStates = getConsumerStates(consumerControls);
    const cloudFactors = getCloudFactors(cloudControls);

    const { series, loadCurrentA } = simulateBattery({
      latitude,
      startDate,
      cloudFactors,
      consumerStates,
    });

    renderChart(series);
    updateSummary({ loadCurrentA, startDate, latitude });
  }

  function init() {
    const dateInput = document.getElementById("simulation-date");
    dateInput.value = new Date().toISOString().slice(0, 10);
    const consumerControls = buildConsumerControls();
    buildCloudControls();

    [dateInput].forEach((element) =>
      element.addEventListener("change", renderSimulation),
    );
    document
      .getElementById("latitude-select")
      .addEventListener("change", renderSimulation);
    consumerControls.forEach((control) =>
      control.addEventListener("change", renderSimulation),
    );

    renderSimulation();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", init);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      BATTERY_CAPACITY_AH,
      CONSUMER_CURRENT_A,
      PV_PEAK_CURRENT_A,
      calculateSolarCurrent,
      simulateBattery,
      clamp,
      dayOfYear,
    };
  }

  root.BatterySimulation = {
    BATTERY_CAPACITY_AH,
    CONSUMER_CURRENT_A,
    PV_PEAK_CURRENT_A,
    calculateSolarCurrent,
    simulateBattery,
    clamp,
    dayOfYear,
  };
})(typeof window !== "undefined" ? window : globalThis);
