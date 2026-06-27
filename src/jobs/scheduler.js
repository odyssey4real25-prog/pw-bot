// ============================================================
// src/jobs/scheduler.js
// Defense check runs every 60 seconds for near-instant alerts
// ============================================================

const cron = require('node-cron');
const logger = require('../utils/logger');
const { checkBeigeExits } = require('./beigeJob');
const { generateDailyReport } = require('./reportJob');
const { checkMilitaryChanges } = require('../systems/intelligence/militaryMonitor');
const { checkAllianceDefense } = require('../systems/defense/warMonitor');

async function startAllJobs(client) {
  logger.info('Starting background job scheduler...');

  // Run startup checks after 10 seconds
  setTimeout(async () => {
    logger.info('Running startup checks...');
    await checkBeigeExits(client);
    await checkAllianceDefense(client);
  }, 10000);

  // Defense check every 60 seconds — near-instant attack detection
  // (P&W API doesn't push events so polling is the only option)
  cron.schedule('* * * * *', async () => {
    await checkAllianceDefense(client);
  });

  // Beige check every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    logger.debug('⏰ Running beige check...');
    await checkBeigeExits(client);
  });

  // Military change detection every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.debug('🔍 Checking military changes...');
    await checkMilitaryChanges(client);
  });

  // Daily report at 08:00 UTC
  cron.schedule('0 8 * * *', async () => {
    logger.info('📅 Sending daily reports...');
    await generateDailyReport(client);
  });

  logger.info('✅ Scheduler — defense every 60s, beige every 5min, military every 15min, daily at 08:00 UTC');
}

module.exports = { startAllJobs };
