const WebSocket = require("ws");
const path = require("path");
const { JsonStorage } = require("./src/storage");

let ws = null;
let inactivityTimer = null;
let reconnectTimer = null;
const INACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const RECONNECT_DELAY_MS = 5000; // 5 seconds

function resetInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }
  inactivityTimer = setTimeout(() => {
    console.warn("No AISStream data for 4 hours, restarting connection...");
    restartConnection();
  }, INACTIVITY_TIMEOUT_MS);
}

function clearInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function restartConnection() {
  clearInactivityTimer();
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.terminate();
    } catch (err) {
      console.error("Error terminating AISStream socket:", err.message);
    }
    ws = null;
  }
  scheduleReconnect();
}

// Load secrets from .env file
function loadSecrets() {
  const fs = require("fs");
  const secretsPath = path.join(__dirname, "secrets.env");
  if (!fs.existsSync(secretsPath)) {
    console.error("Error: secrets.env file not found!");
    console.log(
      "Please copy .env.example to secrets.env and fill in your values",
    );
    process.exit(1);
  }

  const secrets = {};
  const content = fs.readFileSync(secretsPath, "utf8");
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        secrets[key.trim()] = valueParts.join("=").trim();
      }
    }
  });
  return secrets;
}

const secrets = loadSecrets();
const API_KEY = secrets.AIS_API_KEY;
const MMSI_TO_TRACK = secrets.MMSI_TO_TRACK;

// Initialize storage
const storage = new JsonStorage(MMSI_TO_TRACK);

// Extract relevant data from AIS message
function extractLocationData(message) {
  const messageType = message.MessageType;

  // Only process PositionReport messages (most common for location data)
  if (
    messageType !== "PositionReport" &&
    messageType !== "StandardClassBPositionReport" &&
    messageType !== "ExtendedClassBPositionReport"
  ) {
    return null;
  }

  let aisMessage;
  if (messageType === "PositionReport") {
    aisMessage = message.Message.PositionReport;
  } else if (messageType === "StandardClassBPositionReport") {
    aisMessage = message.Message.StandardClassBPositionReport;
  } else if (messageType === "ExtendedClassBPositionReport") {
    aisMessage = message.Message.ExtendedClassBPositionReport;
  }

  if (!aisMessage) {
    return null;
  }

  // Extract time from metadata
  const timeUtc = message.MetaData?.time_utc || new Date().toISOString();

  return {
    time_utc: timeUtc,
    sog: aisMessage.Sog, // Speed over ground (knots)
    cog: aisMessage.Cog, // Course over ground (degrees)
    latitude: message.MetaData?.latitude || aisMessage.Latitude,
    longitude: message.MetaData?.longitude || aisMessage.Longitude,
    mmsi: message.MetaData?.MMSI || aisMessage.UserID,
    heading: aisMessage.TrueHeading,
    navigationalStatus: aisMessage.NavigationalStatus,
  };
}

// Connect to AISStream
function connect() {
  if (ws) {
    console.log("AISStream connection already exists, skipping connect");
    return;
  }

  console.log(`Connecting to AISStream to track MMSI: ${MMSI_TO_TRACK}`);

  ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  ws.on("open", function open() {
    console.log("Connected to AISStream");
    resetInactivityTimer();

    // Send subscription message
    const subscriptionMessage = {
      APIKey: API_KEY,
      // Use a large bounding box to ensure we catch the ship
      // The ship could be anywhere, so we use the whole world
      BoundingBoxes: [
        [
          [40, -20],
          [65, 3180],
        ],
      ],
      // Filter by specific MMSI
      FiltersShipMMSI: [MMSI_TO_TRACK],
      // Only get position reports to reduce data
      FilterMessageTypes: [
        "PositionReport",
        "StandardClassBPositionReport",
        "ExtendedClassBPositionReport",
      ],
    };

    ws.send(JSON.stringify(subscriptionMessage));
    console.log("Subscription sent");
  });

  ws.on("message", function incoming(data) {
    resetInactivityTimer();
    try {
      const message = JSON.parse(data);

      // Check for error messages
      if (message.error) {
        console.error("Error from AISStream:", message.error);
        return;
      }

      // Extract location data
      const location = extractLocationData(message);

      if (location) {
        console.log(
          `[${location.time_utc}] SOG: ${location.sog} kn, COG: ${location.cog}°, Lat: ${location.latitude}, Lon: ${location.longitude}`,
        );

        // Add to storage
        storage.add(location);
      }
    } catch (err) {
      console.error("Error parsing message:", err.message);
    }
  });

  ws.on("close", function close(code, reason) {
    console.log(`Disconnected from AISStream (code=${code}, reason=${reason})`);
    ws = null;
    clearInactivityTimer();
    scheduleReconnect();
  });

  ws.on("error", function error(err) {
    console.error("WebSocket error:", err.message);
    clearInactivityTimer();
    if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      ws = null;
      scheduleReconnect();
    }
  });
}

// Handle graceful shutdown
process.on("SIGINT", function () {
  console.log("\nShutting down...");
  storage.close();
  process.exit(0);
});

process.on("SIGTERM", function () {
  console.log("\nShutting down...");
  storage.close();
  process.exit(0);
});

// Main
async function main() {
  console.log("=== Ship Tracker by MMSI ===");
  console.log(`Target MMSI: ${MMSI_TO_TRACK}`);
  console.log(`Output file: ${storage.filePath}`);
  console.log("");

  // Initialize storage
  await storage.init();

  // Load existing data
  await storage.load();

  // Start tracking
  connect();
}

main();
