# Battery Simulation

The battery simulation page (`/battery-simulation`) is a standalone, client-side
"what if" tool for sizing a boat's house battery against a solar (PV) charging
system. It is not connected to the AIS tracker — it does not read live data
and nothing is persisted server-side. All logic lives in
`public/battery-simulation.js` and runs entirely in the browser.

## Files

| File | Purpose |
| --- | --- |
| `public/battery-simulation.html` | Page markup: controls (latitude, date, cloud sliders), the chart container, and the consumers schedule table. |
| `public/battery-simulation.js` | Simulation model, control wiring, and SVG chart rendering. |
| `tests/battery-simulation.test.js` | `node:test` unit tests for the model functions. |
| `server.js` | Routes `/battery-simulation` (and `/battery-simulation/`) to `battery-simulation.html`. |

## Inputs

- **Latitude** — a fixed dropdown of representative latitudes (e.g. Amsterdam
  52.37°, La Gomera 28.1°, Antigua and Barbuda 17.06°). Latitude drives the
  sun's elevation angle throughout the day.
- **Start date** — the first of the 7 simulated days. Defaults to today. Two
  preset buttons below it jump to a specific latitude + date in one click
  (`PRESETS` in `public/battery-simulation.js`):
  - **To the start** — La Gomera (28.1°), 2026-12-12.
  - **Half way** — 15°, 2027-01-20.
- **Consumers** — a table of 14 named consumers below the chart, each with a
  fixed current draw and a daily schedule (start hour + duration), defined in
  the `CONSUMERS` array in `public/battery-simulation.js`. The on/off toggle,
  start hour, and duration are all editable in the table; the defaults are:

  | Consumer | Current | On by default | Start hour | Duration |
  | --- | --- | --- | --- | --- |
  | Autopilot | 0.7 A | Yes | 0 | 24:00 |
  | Radio + AIS | 1 A | Yes | 0 | 24:00 |
  | Instruments | 0.6 A | Yes | 0 | 24:00 |
  | Tricolor light | 0.2 A | No | 18 | 12:00 |
  | Fan front | 0.3 A | Yes | 0 | 8:00 |
  | Fan back | 0.3 A | Yes | 8 | 16:00 |
  | Cabin light front | 0.05 A | Yes | 0 | 1:00 |
  | Cabin light back | 0.05 A | Yes | 12 | 2:00 |
  | Tracker WTR | 0.1 A | Yes | 0 | 24:00 |
  | Starlink | 3 A | Yes | 19 | 0:15 |
  | Iridium phone | 0.5 A | Yes | 10 | 2:00 |
  | Cell phone | 2 A | Yes | 10 | 1:00 |
  | Watermaker | 10 A | Yes | 13 | 1:00 |
  | Bilge pumps | 4 A | No | 17 | 0:10 |

  A schedule that runs past 24:00 wraps to the next day — e.g. Tricolor light
  (start 18, duration 12:00) is on 18:00–06:00.
- **Cloud cover** — one slider per simulated day, 0 (clear sky) to 10 (fully
  overcast). Reduces solar yield for that entire day. Three preset buttons
  below the sliders set every day at once: **Sunny** (1), **Cloudy** (5),
  **Bad weather** (8).

## Model

Constants (`public/battery-simulation.js`):

- `BATTERY_CAPACITY_AH = 210`
- `PV_PEAK_CURRENT_A = 10`
- `CONSUMERS` — array of `{ id, name, currentA, defaultOn, startHour,
  duration }` (see the table above); `duration` is a `"H:MM"` string parsed
  by `parseDurationHours`

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
4. **Output** — `PV_PEAK_CURRENT_A * daylightFactor`. The declination term
   already accounts for season and latitude (both peak sun angle and day
   length), so no separate seasonal correction is applied on top of it.

This is a simplified irradiance model for relative day/night and seasonal
shape — it does not model panel tilt/azimuth, atmospheric transmission, or
real irradiance data.

> **Fixed 2026-07-17:** an earlier version applied an extra `seasonalBoost`
> multiplier hard-coded to peak in Northern Hemisphere summer (~day 182) and
> trough around Dec/Jan, regardless of latitude or hemisphere. It was
> redundant with `daylightFactor` (which already derives the correct
> seasonal effect from declination) and produced badly pessimistic output
> near the equator — e.g. Antigua (17°N) on Dec 30 fell to ~23% of its June
> peak — and backwards results in the Southern Hemisphere, where December
> (summer) showed less yield than June (winter). Removing it fixed both.

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

`loadCurrentA` is recomputed every hour: for each consumer switched on,
`scheduleOverlapHours` finds what fraction (0–1) of that hour bucket
`[hour, hour+1)` falls inside the consumer's daily on-window
(`[startHour, startHour + durationHours)`, wrapped past midnight if needed),
and that fraction is multiplied by the consumer's `currentA`. This means a
15-minute consumer like Starlink (0:15) contributes its full current for a
quarter of the hour it starts in, rather than being rounded up to a full
hour or dropped entirely. `simulateBattery` also returns
`averageLoadCurrentA` and `peakLoadCurrentA` across the whole run, used for
the summary card.

### Chart

`renderChart` draws an SVG line chart (`#battery-graph`) with four series
sharing the x-axis (168 hourly points, labeled by day):

- **Charge %** (blue, `#1a5f7a`), scaled 0–100.
- **Charge Ah** (orange, `#e67e22`), scaled 0–210.
- **Potential PV current (A)** (green, `#16a34a`, dashed), scaled 0–25.
- **Load current (A)** (red, `#dc2626`), scaled 0–25.

All lines are plain SVG paths with a circle per data point; gridlines are
drawn for each scale independently. The PV current line is the
`potentialPvCurrentA` value computed each hour in `simulateBattery` — the
current the panels would deliver after cloud reduction and the 10 A panel
cap. It's called "potential" because the model has no absorption/float
tapering based on battery state of charge, so this is the same current a
battery sitting around 50% (comfortably mid-charge, not near full) would
actually accept — it isn't reduced as the battery fills up. The load current
line makes each consumer's schedule visible directly on the chart (e.g. the
Watermaker's 1-hour spike).

## Known simplifications

These were explicit in the original build prompt or are natural follow-ups:

- **No charge efficiency losses** (e.g. charge controller/MPPT efficiency,
  Peukert effect, temperature derating).
- **No SoC-based charge tapering** — the "Potential PV current" line is what
  actually goes into the battery model too; there's no separate
  bulk/absorption/float behavior for a battery approaching full.
- **Battery always starts at 100%** at the beginning of the 7-day window —
  there's no way to simulate starting from a partial charge.
- **Cloud cover is a single value per day**, not per hour, so it can't model
  e.g. a clear morning with an overcast afternoon.
- **No timezone/longitude correction** — solar noon is always assumed to be
  12:00 local time.
- **Consumer schedules repeat identically every simulated day** — there's no
  way to give a consumer a different schedule on, say, day 3 vs. day 5.
- **Schedule resolution is the hour bucket, not the wall clock** — a
  consumer's overlap with `[hour, hour+1)` is computed exactly, but the
  underlying simulation still only produces one data point per hour, so two
  sub-hour consumers active in the same hour are averaged into that hour's
  current rather than shown at their real relative timing within it.

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
