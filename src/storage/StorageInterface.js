/**
 * Storage interface for ship location data
 * Implement this interface to add new storage backends (database, cloud storage, etc.)
 */
class StorageInterface {
  /**
   * Initialize the storage
   * @param {Object} config - Configuration options
   * @returns {Promise<void>}
   */
  async init(config) {
    throw new Error("init() must be implemented");
  }

  /**
   * Load existing data
   * @returns {Promise<Array>} Array of location records
   */
  async load() {
    throw new Error("load() must be implemented");
  }

  /**
   * Save data
   * @param {Array} data - Array of location records
   * @returns {Promise<void>}
   */
  async save(data) {
    throw new Error("save() must be implemented");
  }

  /**
   * Add a single location record
   * @param {Object} location - Location record
   * @returns {Promise<void>}
   */
  async add(location) {
    throw new Error("add() must be implemented");
  }

  /**
   * Close/cleanup storage connections
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error("close() must be implemented");
  }
}

module.exports = { StorageInterface };
