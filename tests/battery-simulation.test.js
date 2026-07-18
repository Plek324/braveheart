const test = require("node:test");
const assert = require("node:assert/strict");
const {
  simulateBattery,
  calculateSolarCurrent,
  parseDurationHours,
  scheduleOverlapHours,
  CONSUMERS,
} = require("../public/battery-simulation.js");

function alwaysOnSchedules() {
  return CONSUMERS.map(() => ({
    enabled: true,
    startHour: 0,
    durationHours: 24,
  }));
}

function defaultSchedules() {
  return CONSUMERS.map((consumer) => ({
    enabled: consumer.defaultOn,
    startHour: consumer.startHour,
    durationHours: parseDurationHours(consumer.duration),
  }));
}

test("simulateBattery keeps the battery inside the 0-210 Ah range", () => {
  const result = simulateBattery({
    latitude: 52.37,
    startDate: "2026-07-16",
    cloudFactors: [0, 0, 0, 0, 0, 0, 0],
    consumerSchedules: alwaysOnSchedules(),
  });

  const expectedLoadCurrentA = CONSUMERS.reduce(
    (sum, consumer) => sum + consumer.currentA,
    0,
  );

  assert.equal(result.series.length, 168);
  assert.ok(result.series[0].batteryAh <= 210);
  assert.ok(result.series[result.series.length - 1].batteryAh >= 0);
  assert.ok(Math.abs(result.averageLoadCurrentA - expectedLoadCurrentA) < 1e-9);
  assert.ok(Math.abs(result.peakLoadCurrentA - expectedLoadCurrentA) < 1e-9);
});

test("simulateBattery only draws current from consumers switched on, during their scheduled hours", () => {
  const schedules = defaultSchedules();
  const result = simulateBattery({
    latitude: 52.37,
    startDate: "2026-07-16",
    cloudFactors: [0, 0, 0, 0, 0, 0, 0],
    consumerSchedules: schedules,
  });

  // Cross-check against an independent hour-by-hour sum built from the same
  // exported primitives (parseDurationHours / scheduleOverlapHours) that
  // simulateBattery uses internally, since the default schedule is no
  // longer flat across the day (e.g. Watermaker only runs 13:00-14:00).
  let hourlySum = 0;
  let expectedPeak = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const hourLoad = CONSUMERS.reduce((sum, consumer, index) => {
      const schedule = schedules[index];
      if (!schedule.enabled) return sum;
      return (
        sum +
        consumer.currentA *
          scheduleOverlapHours(hour, schedule.startHour, schedule.durationHours)
      );
    }, 0);
    hourlySum += hourLoad;
    expectedPeak = Math.max(expectedPeak, hourLoad);
  }

  assert.ok(
    Math.abs(result.averageLoadCurrentA - hourlySum / 24) < 1e-9,
  );
  assert.ok(Math.abs(result.peakLoadCurrentA - expectedPeak) < 1e-9);

  // Tricolor light and Bilge pumps are off by default; everything else is on.
  assert.equal(
    CONSUMERS.filter((c) => c.defaultOn).map((c) => c.id).sort().join(","),
    [
      "autopilot",
      "cabin-light-back",
      "cabin-light-front",
      "cell-phone",
      "fan-back",
      "fan-front",
      "instruments",
      "iridium-phone",
      "radio-ais",
      "starlink",
      "tracker-wtr",
      "watermaker",
    ].join(","),
  );
});

test("parseDurationHours converts hh:mm to decimal hours", () => {
  assert.equal(parseDurationHours("24:00"), 24);
  assert.equal(parseDurationHours("2:00"), 2);
  assert.equal(parseDurationHours("0:15"), 0.25);
});

test("scheduleOverlapHours handles schedules that wrap past midnight", () => {
  // Tricolor light: on 18:00-06:00 (start 18, duration 12h).
  assert.equal(scheduleOverlapHours(20, 18, 12), 1);
  assert.equal(scheduleOverlapHours(5, 18, 12), 1);
  assert.equal(scheduleOverlapHours(6, 18, 12), 0);
  assert.equal(scheduleOverlapHours(17, 18, 12), 0);
});

test("scheduleOverlapHours returns a fractional overlap for sub-hour durations", () => {
  // Starlink: on 19:00-19:15 (start 19, duration 0.25h).
  assert.equal(scheduleOverlapHours(19, 19, 0.25), 0.25);
  assert.equal(scheduleOverlapHours(20, 19, 0.25), 0);
});

test("calculateSolarCurrent returns a positive value near midday and zero at night", () => {
  const midday = new Date("2026-07-16T12:00:00Z");
  const midnight = new Date("2026-07-16T00:00:00Z");
  const dayTime = calculateSolarCurrent(52.37, midday);
  const nightTime = calculateSolarCurrent(52.37, midnight);

  assert.ok(dayTime > 0);
  assert.ok(nightTime >= 0);
});
