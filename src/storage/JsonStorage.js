const fs = require("fs");
const path = require("path");
const { StorageInterface } = require("./StorageInterface");

/**
 * JSON file storage implementation
 * Stores ship location data in JSON files
 */
class JsonStorage extends StorageInterface {
  constructor(mmsi) {
    super();
    this.mmsi = mmsi;
    this.data = [];
    this.currentDate = this._getTodayString();
    this.filePath = this._makeFilePath(this.currentDate);
  }

  _getTodayString() {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yy}${mm}${dd}`;
  }

  _makeFilePath(dateStr) {
    return path.join("data", `${this.mmsi}_${dateStr}_locations.json`);
  }

  /**
   * Initialize the storage
   * @param {Object} config - Configuration options (unused for file storage)
   * @returns {Promise<void>}
   */
  async init(config) {
    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    console.log(`JSON storage initialized at: ${this.filePath}`);
  }

  /**
   * Load existing data from file
   * @returns {Promise<Array>} Array of location records
   */
  async load() {
    this.currentDate = this._getTodayString();
    this.filePath = this._makeFilePath(this.currentDate);
    if (fs.existsSync(this.filePath)) {
      try {
        const content = fs.readFileSync(this.filePath, "utf8");
        this.data = JSON.parse(content);
        console.log(`Loaded ${this.data.length} existing location records`);
      } catch (err) {
        console.error("Error loading data:", err.message);
        this.data = [];
      }
    } else {
      this.data = [];
    }
    return this.data;
  }

  /**
   * Save all data to file
   * @param {Array} data - Array of location records
   * @returns {Promise<void>}
   */
  async save(data) {
    this.data = data;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
      console.log(`Saved ${data.length} records to ${this.filePath}`);
    } catch (err) {
      console.error("Error saving data:", err.message);
    }
  }

  /**
   * Add a single location record
   * @param {Object} location - Location record
   * @returns {Promise<void>}
   */
  async add(location) {
    // Check if the date has changed
    const today = this._getTodayString();
    if (today !== this.currentDate) {
      // New day: switch file and reset data
      this.currentDate = today;
      this.filePath = this._makeFilePath(today);
      this.data = [];
      await this.save(this.data); // create new file for the day
    }
    this.data.push(location);
    // Save immediately after adding
    await this.save(this.data);
  }

  /**
   * Close storage (no-op for file storage)
   * @returns {Promise<void>}
   */
  async close() {
    // No cleanup needed for file storage
  }
}

module.exports = { JsonStorage };
