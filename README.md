# Ship Tracker

Track a ship's location by MMSI using the AISStream websocket API.

## Prerequisites

- Node.js (v14 or higher)
- AISStream API key (get it at [aisstream.io](https://aisstream.io/apikeys))
- The MMSI number of the ship you want to track

## Setup

1. **Clone the repository**

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure secrets**

   ```bash
   cp .env.example secrets.env
   ```

   Edit `secrets.env` with your settings:

   ```env
   AIS_API_KEY=your_actual_api_key
   MMSI_TO_TRACK=123456789
   ```

## Usage

```bash
npm start
```

The tracker will connect to AISStream and begin recording location data. Each position update is saved immediately to `ship_locations.json`.

## Output

Location data is saved to `ship_locations.json` with the following format:

```json
[
  {
    "time_utc": "2026-04-25T12:34:56.000Z",
    "sog": 12.5,
    "cog": 308.0,
    "latitude": 51.444588,
    "longitude": 3.590816,
    "mmsi": "123456789",
    "heading": 305,
    "navigationalStatus": 0
  }
]
```

### Fields

| Field                | Description                  |
| -------------------- | ---------------------------- |
| `time_utc`           | Timestamp in UTC             |
| `sog`                | Speed over ground (knots)    |
| `cog`                | Course over ground (degrees) |
| `latitude`           | Latitude coordinate          |
| `longitude`          | Longitude coordinate         |
| `mmsi`               | Ship's MMSI number           |
| `heading`            | True heading (degrees)       |
| `navigationalStatus` | Navigation status code       |

## Configuration

Edit `secrets.env` to change:

- `AIS_API_KEY` - Your AISStream API key
- `MMSI_TO_TRACK` - The 9-digit MMSI of the ship to track

## Notes

- The tracker uses a global bounding box to ensure the ship is captured wherever it is
- Data is written to disk immediately upon receiving each location update
- Position reports are typically received every 3 minutes

## License

ISC
