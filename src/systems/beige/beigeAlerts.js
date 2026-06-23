// ============================================================
// src/systems/beige/beigeAlerts.js
// Builds and sends beige alert messages to Discord channels
// ============================================================

const { EmbedBuilder } = require('discord.js');
const { query, queryOne } = require('../../utils/database');
const {
  getEligibleAttackers,
  formatTimeRemaining,
} = require('./beigeTracker');
const logger = require('../../utils/logger');

// Default alert intervals in minutes if not configured
const DEFAULT_INTERVALS = [60, 30, 15, 5];

// ============================================================
// GET CONFIGURED ALERT INTERVALS FOR A GUILD
// ============================================================
function getAlertIntervals(guildId) {
  const rows = query(
    `SELECT setting_value FROM alert_settings
     WHERE guild_id = ? AND alert_type = 'beige' AND setting_key = 'intervals'`,
    [guildId]
  ).rows;

  if (rows.length > 0) {
    try {
      return JSON.parse(rows[0].setting_value);
    } catch {
      return DEFAULT_INTERVALS;
    }
  }
  return DEFAULT_INTERVALS;
}

// ============================================================
// GET THE BEIGE ALERT CHANNEL FOR A GUILD
// ============================================================
function getBeigeChannel(client, guildId) {
  const row = queryOne(
    `SELECT discord_channel_id FROM guild_channels
     WHERE guild_id = ? AND channel_type = 'beige'`,
    [guildId]
  );
  if (!row) return null;
  return client.channels.cache.get(row.discord_channel_id);
}

// ============================================================
// GET THE MILITARY PING ROLE FOR A GUILD
// ============================================================
function getMilitaryRole(guildId) {
  const row = queryOne(
    `SELECT discord_role_id FROM guild_roles
     WHERE guild_id = ? AND role_type = 'military'`,
    [guildId]
  );
  return row?.discord_role_id || null;
}

// ============================================================
// BUILD THE BEIGE ALERT EMBED MESSAGE
// ============================================================
async function buildBeigeEmbed(nation, interval, eligibleAttackers) {
  const timeLeft = formatTimeRemaining(nation.minutesRemaining);
  const isUrgent = nation.minutesRemaining <= 15;
  const isExpiring = nation.minutesRemaining <= 5;

  // Color changes based on urgency
  const color = isExpiring ? 0xff0000   // Red — very urgent
               : isUrgent  ? 0xff9900   // Orange — urgent
               :              0xf1c40f; // Yellow — normal beige alert

  const embed = new EmbedBuilder()
    .setTitle(`${isExpiring ? '🚨' : isUrgent ? '⚠️' : '🟡'} Beige Exit Alert — ${nation.nation_name}`)
    .setColor(color)
    .setDescription(
      interval === 0
        ? '**This nation has exited beige and is now attackable!**'
        : `This nation exits beige in approximately **${timeLeft}**`
    )
    .addFields(
      {
        name: '🏴 Nation',
        value: `[${nation.nation_name}](https://politicsandwar.com/nation/id=${nation.id})`,
        inline: true,
      },
      {
        name: '🏛️ Alliance',
        value: nation.allianceName || 'None',
        inline: true,
      },
      {
        name: '⭐ Score',
        value: nation.score?.toLocaleString() || 'Unknown',
        inline: true,
      },
      {
        name: '🏙️ Cities',
        value: `${nation.num_cities}`,
        inline: true,
      },
      {
        name: '⚔️ Wars',
        value: `${nation.offensive_wars_count} off / ${nation.defensive_wars_count} def`,
        inline: true,
      },
      {
        name: '⏰ Beige Expires',
        value: `<t:${nation.expiryTimestamp}:R> (<t:${nation.expiryTimestamp}:f>)`,
        inline: false,
      },
    )
    .setFooter({ text: `Nation ID: ${nation.id} • PW Defense Bot` })
    .setTimestamp();

  // Add military info
  const milLines = [
    `👮 Soldiers: ${nation.soldiers?.toLocaleString()}`,
    `🚗 Tanks: ${nation.tanks?.toLocaleString()}`,
    `✈️ Aircraft: ${nation.aircraft?.toLocaleString()}`,
    `🚢 Ships: ${nation.ships?.toLocaleString()}`,
  ];
  if (nation.missiles > 0) milLines.push(`🚀 Missiles: ${nation.missiles}`);
  if (nation.nukes > 0) milLines.push(`☢️ Nukes: ${nation.nukes}`);
  embed.addFields({ name: '🪖 Military', value: milLines.join('\n'), inline: false });

  // Add eligible attackers
  if (eligibleAttackers.length > 0) {
    const attackerList = eligibleAttackers
      .slice(0, 10) // Show max 10
      .map(a => `• **${a.nation_name}** — Score: ${Math.round(a.score).toLocaleString()} | ${a.openSlots} slot(s) open`)
      .join('\n');

    embed.addFields({
      name: `✅ Eligible Attackers (${eligibleAttackers.length})`,
      value: attackerList + (eligibleAttackers.length > 10 ? `\n_...and ${eligibleAttackers.length - 10} more_` : ''),
      inline: false,
    });
  } else {
    embed.addFields({
      name: '❌ Eligible Attackers',
      value: 'No alliance members are currently in range or have open slots.',
      inline: false,
    });
  }

  return embed;
}

// ============================================================
// SEND A BEIGE ALERT TO THE CONFIGURED CHANNEL
// ============================================================
async function sendBeigeAlert(client, guildId, nation, interval) {
  try {
    const channel = getBeigeChannel(client, guildId);
    if (!channel) {
      logger.warn(`Guild ${guildId}: No beige alert channel configured`);
      return;
    }

    // Find who can attack this target
    const eligibleAttackers = await getEligibleAttackers(guildId, nation.score);

    // Build the embed
    const embed = await buildBeigeEmbed(nation, interval, eligibleAttackers);

    // Build the ping message
    const militaryRoleId = getMilitaryRole(guildId);
    const pingText = militaryRoleId ? `<@&${militaryRoleId}>` : '';
    const intervalLabel = interval === 0 ? '**BEIGE EXPIRED**' : `**${formatTimeRemaining(interval * 60 / 60)} warning**`;

    await channel.send({
      content: pingText ? `${pingText} — ${intervalLabel}` : intervalLabel,
      embeds: [embed],
    });

    logger.info(`Sent beige alert for nation ${nation.nation_name} (${interval}min) to guild ${guildId}`);

  } catch (error) {
    logger.error(`Failed to send beige alert for nation ${nation.id}:`, error);
  }
}

module.exports = {
  sendBeigeAlert,
  getAlertIntervals,
  getBeigeChannel,
  buildBeigeEmbed,
};
