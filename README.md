# Ship Tracker

> Version: 0.1.0

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

The project uses two separate entry points:

- `npm start` starts the AIS tracker backend (`tracker.js`).
- `npm run server` starts the frontend server (`server.js`).

```bash
npm start
```

Then in another terminal:

```bash
npm run server
```

The tracker will connect to AISStream and begin recording location data. Each position update is saved immediately to `ship_locations.json`.

## Release

This project uses the version in `package.json` as the canonical release version.

To perform a release:

```bash
npm run release -- patch
```

This will:

- bump `package.json` version (patch/ minor/ major or explicit version)
- build Docker images tagged as:
  - `braveheart:<version>`
  - `plek243/braveheart:<version>`
  - `plek243/braveheart:latest`
- push the Docker images to Docker Hub
- push the git commit and tag

If you want to build locally without pushing:

```bash
npm run release -- patch --no-push --no-git-push
```

To build and push the current version without changing `package.json`:

```bash
npm run release -- current
```

## Docker

You can run this application in a Docker container. The ship location data is stored in a named volume that can be shared with other applications.

### Prerequisites

- Docker
- Docker Compose

### Setup

1. **Configure secrets**

   Create a `secrets.env` file in the project root:

   ```env
   AIS_API_KEY=your_actual_api_key
   MMSI_TO_TRACK=123456789
   ```

### Running with Docker

```bash
# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

### Sharing Data with Other Applications

The ship location data is stored in a Docker volume named `braveheart_ship-data`. Other containers can mount this volume to access the data:

```yaml
services:
  my-app:
    image: my-app
    volumes:
      - braveheart_ship-data:/app/data
```

Or directly with Docker:

```bash
docker run -v braveheart_ship-data:/app/data my-app
```

The data file is located at `/app/data/ship_locations.json` inside the container.

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

## Battery Simulation

Alongside the tracker, `npm run server` also serves a battery simulation page
at `/battery-simulation`. It's a standalone, client-side tool for modeling a
210 Ah house battery charged by a 10 A-peak PV system against configurable
consumers and per-day cloud cover, plotted over a 7-day hourly forecast.

See [docs/battery-simulation.md](docs/battery-simulation.md) for the model
details, known simplifications, and how to run its tests.

## Notes

- The tracker uses a global bounding box to ensure the ship is captured wherever it is
- Data is written to disk immediately upon receiving each location update
- Position reports are typically received every 3 minutes

## License

ISC
