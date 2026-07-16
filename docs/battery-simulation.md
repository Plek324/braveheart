# Battery Simulation

The battery simulation page (`/battery-simulation`) is a standalone, client-side
"what if" tool for sizing a boat's house battery against a solar (PV) charging
system. It is not connected to the AIS tracker — it does not read live data
and nothing is persisted server-side. All logic lives in
`public/battery-simulation.js` and runs entirely in the browser.

## Files

| File | Purpose |
| --- | --- |
| `public/battery-simulation.html` | Page markup: controls (latitude, date, consumers, cloud sliders) and the chart container. |
| `public/battery-simulation.js` | Simulation model, control wiring, and SVG chart rendering. |
| `tests/battery-simulation.test.js` | `node:test` unit tests for the model functions. |
| `server.js` | Routes `/battery-simulation` (and `/battery-simulation/`) to `battery-simulation.html`. |

## Inputs

- **Latitude** — a fixed dropdown of representative latitudes (e.g. Amsterdam
  52.37°, La Gomera 28.1°, Antigua and Barbuda 17.06°). Latitude drives the
  sun's elevation angle throughout the day.
- **Start date** — the first of the 7 simulated days. Defaults to today.
- **Consumers** — 5 toggles, each a fixed 1 A draw when switched on. This is a
  placeholder: the original spec calls for per-consumer current values later
  (see [Known simplifications](#known-simplifications)).
- **Cloud cover** — one slider per simulated day, 0 (clear sky) to 10 (fully
  overcast). Reduces solar yield for that entire day.

## Model

Constants (`public/battery-simulation.js`):

- `BATTERY_CAPACITY_AH = 210`
- `CONSUMER_CURRENT_A = 1`
- `PV_PEAK_CURRENT_A = 10`
- `CONSUMER_COUNT = 5`

### Solar current (`calculateSolarCurrent`)

For a given latitude and timestamp, the function computes an approximate PV
output current:

1. **Declination** — the sun's declination angle for the day of year, using
   the standard `23.45° * sin(360/365 * (284 + day))` approximation.
2. **Hour angle** — derived from the local hour (`(hour - 12) * 15°`),
   i.e. it assumes solar noon is at 12:00 local time (no timezone/longitude
   correction).
3. **Solar elevation** — computed from latitude, declination, and hour angle
   via the standard elevation formula. Negative elevation (sun below the
   horizon) is clamped to 0, which is what produces night-time zero output.
4. **Seasonal boost** — a smooth multiplier (`0.7` to `1.1`) that peaks
   mid-year, layered on top of the elevation-based daylight factor. This is a
   coarse stand-in for seasonal atmospheric/day-length effects, not a
   physically derived term.
5. **Output** — `PV_PEAK_CURRENT_A * daylightFactor * seasonalBoost`, i.e. the
   panel is assumed to hit its full 10 A rating only at the theoretical best
   moment of the simulated period.

This is a simplified irradiance model for relative day/night and seasonal
shape — it does not model panel tilt/azimuth, atmospheric transmission, or
real irradiance data.

### Cloud effect

Per simulated day, the cloud slider value (0–10) reduces solar current
linearly:

```
effectiveYield = solarCurrent * (1 - cloudFactor / 10)
actualChargingCurrent = min(PV_PEAK_CURRENT_A, effectiveYield)
```

A slider at 10 fully zeroes out solar charging for that day; the same value
applies to every hour of that day.

### Battery state (`simulateBattery`)

The simulation starts the battery **full** (`batteryAh = 210`) and steps
hour-by-hour for 7 days × 24 hours = 168 points:

```
netDeltaAh = actualChargingCurrent - loadCurrentA
batteryAh = clamp(batteryAh + netDeltaAh, 0, capacityAh)
batteryPercent = batteryAh / capacityAh * 100
```

`loadCurrentA` is constant across the whole run — it's the count of enabled
consumers × 1 A, computed once up front rather than per hour.

### Chart

`renderChart` draws an SVG line chart (`#battery-graph`) with two series
sharing the x-axis (168 hourly points, labeled by day):

- **Charge %** (blue, `#1a5f7a`), scaled 0–100.
- **Charge Ah** (orange, `#e67e22`), scaled 0–210.

Both lines are drawn as plain SVG paths with a circle per data point;
gridlines are drawn for both scales independently.

## Known simplifications

These were explicit in the original build prompt or are natural follow-ups:

- **Consumers are fixed at 1 A each.** The intent was to make per-consumer
  current configurable later.
- **No charge efficiency losses** (e.g. charge controller/MPPT efficiency,
  Peukert effect, temperature derating).
- **Battery always starts at 100%** at the beginning of the 7-day window —
  there's no way to simulate starting from a partial charge.
- **Cloud cover is a single value per day**, not per hour, so it can't model
  e.g. a clear morning with an overcast afternoon.
- **No timezone/longitude correction** — solar noon is always assumed to be
  12:00 local time.
- **Load is constant** — no day/night consumer scheduling (e.g. lights only
  drawing at night).

## Testing

Unit tests cover the pure model functions and live in
`tests/battery-simulation.test.js`. Run them with:

```bash
node --test tests/**/*.test.js
```

Note: `npm test` currently points at a placeholder script in `package.json`
and does not run this suite.

## TODO

- Decide whether to wire `npm test` to `node --test tests/**/*.test.js` (or a
  broader test runner) once there's more than one test file to justify it.
