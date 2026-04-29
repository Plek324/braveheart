const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

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

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // API: Get all available tracks
  if (req.url === "/api/tracks") {
    const tracks = getAvailableTracks();
    const mmsis = getUniqueMmsis(tracks);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tracks, mmsis }));
    return;
  }

  // API: Get specific track data
  if (req.url.startsWith("/api/track/")) {
    const filename = req.url.replace("/api/track/", "");
    const filepath = path.join(DATA_DIR, filename);

    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Track not found" }));
    }
    return;
  }

  // Serve static files
  let filepath = req.url === "/" ? "/index.html" : req.url;
  const fullPath = path.join(__dirname, "public", filepath);
  const ext = path.extname(fullPath);

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "text/plain" });
    res.end(fs.readFileSync(fullPath));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
