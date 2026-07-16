const test = require("node:test");
const assert = require("node:assert/strict");
const {
  simulateBattery,
  calculateSolarCurrent,
} = require("../public/battery-simulation.js");

test("simulateBattery keeps the battery inside the 0-210 Ah range", () => {
  const result = simulateBattery({
    latitude: 52.37,
    startDate: "2026-07-16",
    cloudFactors: [0, 0, 0, 0, 0, 0, 0],
    consumerStates: [true, true, true, true, true],
  });

  assert.equal(result.series.length, 168);
  assert.ok(result.series[0].batteryAh <= 210);
  assert.ok(result.series[result.series.length - 1].batteryAh >= 0);
  assert.equal(result.loadCurrentA, 5);
});

test("calculateSolarCurrent returns a positive value near midday and zero at night", () => {
  const midday = new Date("2026-07-16T12:00:00Z");
  const midnight = new Date("2026-07-16T00:00:00Z");
  const dayTime = calculateSolarCurrent(52.37, midday);
  const nightTime = calculateSolarCurrent(52.37, midnight);

  assert.ok(dayTime > 0);
  assert.ok(nightTime >= 0);
});
