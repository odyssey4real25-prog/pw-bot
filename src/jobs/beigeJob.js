// ============================================================
// src/jobs/beigeJob.js
// Runs every 5 minutes. Checks all guilds for beige exits
// and sends alerts when intervals are reached.
// ============================================================

const { query } = require('../utils/database');
const {
  getBeigeTargets,
  getAlertsDue,
  wasAlertSent,
  markAlertSent,
  cleanOldAlerts,
} = require('../systems/beige/beigeTracker');
const { sendBeigeAlert, getAlertIntervals } = require('../systems/beige/beigeAlerts');
const logger = require('../utils/logger');

async function checkBeigeExits(client) {
  logger.debug('Running beige exit check...');

  try {
    // Get all guilds that have the bot
    const guilds = query('SELECT guild_id, alliance_id FROM guilds WHERE alliance_id IS NOT NULL').rows;

    for (const guild of guilds) {
      await processGuildBeige(client, guild.guild_id);
    }

  } catch (error) {
    logger.error('Beige job error:', error);
  }
}

async function processGuildBeige(client, guildId) {
  try {
    // Get all beige nations from watchlisted enemies
    const beigeNations = await getBeigeTargets(guildId);

    if (beigeNations.length === 0) {
      // Clean up old alert records since no one is in beige
      cleanOldAlerts(guildId, []);
      return;
    }

    // Keep track of which nations are still in beige for cleanup
    const activeNationIds = beigeNations.map(n => n.id);
    cleanOldAlerts(guildId, activeNationIds);

    // Get configured alert intervals for this guild (e.g. [60, 30, 15, 5])
    const intervals = getAlertIntervals(guildId);

    for (const nation of beigeNations) {
      // Which alerts are due for this nation right now?
      const alertsDue = getAlertsDue(nation, intervals);

      for (const interval of alertsDue) {
        // Skip if we already sent this alert
        if (wasAlertSent(guildId, nation.id, interval)) continue;

        // Send the alert
        await sendBeigeAlert(client, guildId, nation, interval);

        // Mark it as sent so we don't send again
        markAlertSent(guildId, nation.id, interval);
      }
    }

  } catch (error) {
    logger.error(`Error processing beige for guild ${guildId}:`, error);
  }
}

module.exports = { checkBeigeExits };
