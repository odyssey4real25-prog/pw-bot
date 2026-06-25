// ============================================================
// src/jobs/scheduler.js — Background job scheduler
// ============================================================

const cron = require('node-cron');
const logger = require('../utils/logger');
const { checkBeigeExits } = require('./beigeJob');
const { generateDailyReport } = require('./reportJob');
const { checkMilitaryChanges } = require('../systems/intelligence/militaryMonitor');
const { checkAllianceDefense } = require('../systems/defense/defenseMonitor');

async function startAllJobs(client) {
  logger.info('Starting background job scheduler...');

  // Run initial checks 10 seconds after startup
  setTimeout(async () => {
    logger.info('Running startup checks...');
    await checkBeigeExits(client);
    await checkAllianceDefense(client);
  }, 10000);

  // Beige check every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    logger.debug('⏰ Running beige check...');
    await checkBeigeExits(client);
  });

  // Defense check every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    logger.debug('🛡️ Running defense check...');
    await checkAllianceDefense(client);
  });

  // Military change detection every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.debug('🔍 Checking military changes...');
    await checkMilitaryChanges(client);
  });

  // Daily report every day at 08:00 UTC
  cron.schedule('0 8 * * *', async () => {
    logger.info('📅 Sending daily reports...');
    await generateDailyReport(client);
  });

  logger.info('✅ Scheduler running — beige/defense every 5min, military every 15min, daily report at 08:00 UTC');
}

module.exports = { startAllJobs };
