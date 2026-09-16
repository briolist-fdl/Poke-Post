const saved = require('../config/vivillonThreads.json');
function resolveThreadConfig(guildId, override) {
  if (override !== undefined) return override.trim() ? JSON.parse(override) : null;
  return Object.hasOwn(saved, guildId) ? saved[guildId] : null;
}
module.exports = { resolveThreadConfig };
