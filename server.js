const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const POI_DIR = path.join(__dirname, "poi");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function isValidTrackFilename(name) {
  return /^\d+(?:_\d{6})?_locations\.json$/.test(name);
}
function getAvailableTracks() {
  const files = fs.readdirSync(DATA_DIR);
  const tracks = [];

  files.forEach((file) => {
    // Match pattern: {mmsi}_{YYMMDD}_locations.json or {mmsi}_locations.json
    const match = file.match(/^(\d+)(?:_(\d{6}))?_locations\.json$/);
    if (match) {
      const mmsi = match[1];
      const date = match[2] || null; // null for legacy files without date
      tracks.push({ mmsi, date, filename: file });
    }
  });

  return tracks;
}

function getUniqueMmsis(tracks) {
  const mmsis = new Set(tracks.map((t) => t.mmsi));
  return Array.from(mmsis).sort();
}

let slipwaysCache = null;
function getSlipways() {
  if (slipwaysCache) return slipwaysCache;

  const filepath = path.join(POI_DIR, "slipways_osm.json");
  const raw = JSON.parse(fs.readFileSync(filepath, "utf8"));

  slipwaysCache = (raw.elements || [])
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) return null;
      return { id: el.id, lat, lon, name: el.tags?.name || null };
    })
    .filter(Boolean);

  return slipwaysCache;
}

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // API: Get all available tracks
  if (req.url === "/api/tracks") {
    const tracks = getAvailableTracks();
    const mmsis = getUniqueMmsis(tracks);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tracks, mmsis }));
    console.log(
      `${req.method} ${req.url} 200 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
    );
    return;
  }

  // API: Get specific track data
  if (req.url.startsWith("/api/track/")) {
    let filename = req.url.replace("/api/track/", "");
    try {
      filename = decodeURIComponent(filename);
    } catch (e) {}

    if (!isValidTrackFilename(filename)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid track filename" }));
      console.log(
        `${req.method} ${req.url} 400 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
      );
      return;
    }

    const filepath = path.join(DATA_DIR, filename);

    if (fs.existsSync(filepath) && fs.statSync(filepath).isFile()) {
      const content = fs.readFileSync(filepath, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
      console.log(
        `${req.method} ${req.url} 200 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
      );
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Track not found" }));
      console.log(
        `${req.method} ${req.url} 404 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
      );
    }
    return;
  }

  // API: Get slipways within a bounding box
  if (req.url.startsWith("/api/slipways")) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const minLat = parseFloat(parsedUrl.searchParams.get("minLat"));
    const maxLat = parseFloat(parsedUrl.searchParams.get("maxLat"));
    const minLon = parseFloat(parsedUrl.searchParams.get("minLon"));
    const maxLon = parseFloat(parsedUrl.searchParams.get("maxLon"));

    if (
      ![minLat, maxLat, minLon, maxLon].every((n) => Number.isFinite(n)) ||
      minLat > maxLat ||
      minLon > maxLon
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid bounding box" }));
      console.log(
        `${req.method} ${req.url} 400 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
      );
      return;
    }

    try {
      const slipways = getSlipways().filter(
        (p) =>
          p.lat >= minLat &&
          p.lat <= maxLat &&
          p.lon >= minLon &&
          p.lon <= maxLon,
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(slipways));
      console.log(
        `${req.method} ${req.url} 200 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to load slipways" }));
      console.log(
        `${req.method} ${req.url} 500 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
      );
    }
    return;
  }

  if (req.url === "/battery-simulation" || req.url === "/battery-simulation/") {
    req.url = "/battery-simulation.html";
  }

  // Serve static files
  let filepath = req.url === "/" ? "/index.html" : req.url;
  const publicDir = path.join(__dirname, "public");
  const requested = path.join(publicDir, filepath);
  const resolved = path.resolve(requested);

  if (!resolved.startsWith(path.resolve(publicDir))) {
    res.writeHead(403);
    res.end("Forbidden");
    console.log(
      `${req.method} ${req.url} 403 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
    );
    return;
  }

  const ext = path.extname(resolved);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "text/plain" });
    res.end(fs.readFileSync(resolved));
    console.log(
      `${req.method} ${req.url} 200 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
  console.log(
    `${req.method} ${req.url} 404 ${req.socket.remoteAddress} ${req.headers["user-agent"] || ""}`,
  );
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
