// db/cache.js
class Cache {
    constructor() {
      this.store = new Map();
    }
  
    set(key, value, ttlSeconds = 600) {
      const expiresAt = Date.now() + ttlSeconds * 1000;
      this.store.set(key, { value, expiresAt });
    }
  
    get(key) {
      const item = this.store.get(key);
      if (!item) return null;
      if (Date.now() > item.expiresAt) {
        this.store.delete(key);
        return null;
      }
      return item.value;
    }
  
    delete(key) {
      this.store.delete(key);
    }
  
    has(key) {
      return this.get(key) !== null;
    }
  
    clear() {
      this.store.clear();
    }
  
    // Cleanup expired keys periodically
    startCleanup() {
      setInterval(() => {
        const now = Date.now();
        for (const [key, item] of this.store.entries()) {
          if (now > item.expiresAt) {
            this.store.delete(key);
          }
        }
      }, 60000); // every minute
    }
  }
  
  const cache = new Cache();
  cache.startCleanup();
  
  module.exports = cache;