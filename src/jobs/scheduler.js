// ============================================================
// src/jobs/scheduler.js — Background job scheduler
// ============================================================

const cron = require('node-cron');
const logger = require('../utils/logger');
const { checkBeigeExits } = require('./beigeJob');
const { generateDailyReport } = require('./reportJob');
const { checkMilitaryChanges } = require('../systems/intelligence/militaryMonitor');

async function startAllJobs(client) {
  logger.info('Starting background job scheduler...');

  // Run beige check once on startup after 10s delay
  setTimeout(async () => {
    logger.info('Running initial beige check on startup...');
    await checkBeigeExits(client);
  }, 10000);

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

  // Daily report every day at 08:00 UTC
  cron.schedule('0 8 * * *', async () => {
    logger.info('📅 Sending daily reports...');
    await generateDailyReport(client);
  });

  logger.info('✅ Scheduler running — beige every 5min, military checks every 15min, daily reports at 08:00 UTC');
}

module.exports = { startAllJobs };
