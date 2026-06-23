// ============================================================
// src/jobs/scheduler.js
// Runs background tasks on a timer
// ============================================================

const cron = require('node-cron');
const logger = require('../utils/logger');
const { checkBeigeExits } = require('./beigeJob');

async function startAllJobs(client) {
  logger.info('Starting background job scheduler...');

  // Run once immediately on startup
  setTimeout(async () => {
    logger.info('Running initial beige check on startup...');
    await checkBeigeExits(client);
  }, 10000); // Wait 10 seconds after bot is ready

  // Then run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    logger.debug('⏰ Running scheduled beige check...');
    await checkBeigeExits(client);
  });

  logger.info('✅ Scheduler running — beige checks every 5 minutes');
}

module.exports = { startAllJobs };
