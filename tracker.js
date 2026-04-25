const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

// Load secrets from .env file
function loadSecrets() {
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
const OUTPUT_FILE = path.join("data", "ship_locations.json");

// Global array to store location data
let locationData = [];

// Load existing data if file exists
function loadExistingData() {
  const filePath = path.join(__dirname, OUTPUT_FILE);
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, "utf8");
      locationData = JSON.parse(data);
      console.log(`Loaded ${locationData.length} existing location records`);
    } catch (err) {
      console.error("Error loading existing data:", err.message);
      locationData = [];
    }
  }
}

// Save data to JSON file
function saveData() {
  const filePath = path.join(__dirname, OUTPUT_FILE);
  try {
    fs.writeFileSync(filePath, JSON.stringify(locationData, null, 2));
    console.log(`Saved ${locationData.length} records to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("Error saving data:", err.message);
  }
}

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
  console.log(`Connecting to AISStream to track MMSI: ${MMSI_TO_TRACK}`);

  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  ws.on("open", function open() {
    console.log("Connected to AISStream");

    // Send subscription message
    const subscriptionMessage = {
      APIKey: API_KEY,
      // Use a large bounding box to ensure we catch the ship
      // The ship could be anywhere, so we use the whole world
      BoundingBoxes: [
        [
          [-90, -180],
          [90, 180],
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

        // Add to our data array
        locationData.push(location);

        // Save immediately after receiving each location
        saveData();
      }
    } catch (err) {
      console.error("Error parsing message:", err.message);
    }
  });

  ws.on("close", function close() {
    console.log("Disconnected from AISStream");
    // Save data before exiting
    saveData();
  });

  ws.on("error", function error(err) {
    console.error("WebSocket error:", err.message);
  });
}

// Handle graceful shutdown
process.on("SIGINT", function () {
  console.log("\nShutting down...");
  saveData();
  process.exit(0);
});

process.on("SIGTERM", function () {
  console.log("\nShutting down...");
  saveData();
  process.exit(0);
});

// Main
console.log("=== Ship Tracker by MMSI ===");
console.log(`Target MMSI: ${MMSI_TO_TRACK}`);
console.log(`Output file: ${OUTPUT_FILE}`);
console.log("");

loadExistingData();
connect();
