// ============================================================
// src/systems/defense/warMonitor.js
// Instant war detection using frequent polling (every 60 seconds)
// This is as close to "instant" as the P&W API allows —
// the API doesn't push events, so we poll frequently instead
// ============================================================

const { EmbedBuilder } = require('discord.js');
const { query, run, queryOne } = require('../../utils/database');
const { pwQuery } = require('../../utils/pwApi');
const logger = require('../../utils/logger');

// Track which guilds are currently being checked to avoid overlap
const checking = new Set();

async function checkAllianceDefense(client) {
  const guilds = query(
    'SELECT guild_id, alliance_id FROM guilds WHERE alliance_id IS NOT NULL', []
  ).rows;

  for (const guild of guilds) {
    // Skip if already checking this guild
    if (checking.has(guild.guild_id)) continue;
    checking.add(guild.guild_id);
    try {
      await processGuildDefense(client, guild.guild_id, guild.alliance_id);
    } finally {
      checking.delete(guild.guild_id);
    }
  }
}

async function processGuildDefense(client, guildId, allianceId) {
  try {
    const channelRow =
      queryOne(`SELECT discord_channel_id FROM guild_channels WHERE guild_id = ? AND channel_type = 'wars'`, [guildId]) ||
      queryOne(`SELECT discord_channel_id FROM guild_channels WHERE guild_id = ? AND channel_type = 'intel'`, [guildId]);
    if (!channelRow) return;

    const channel = client.channels.cache.get(channelRow.discord_channel_id);
    if (!channel) return;

    const data = await pwQuery(`
      query GetAllianceWars($allianceId: [Int]) {
        wars(alliance_id: $allianceId, active: true, first: 100) {
          data {
            id
            att_alliance_id
            def_alliance_id
            attacker {
              id nation_name score
              soldiers tanks aircraft ships missiles nukes
              alliance { name }
            }
            defender {
              id nation_name score
              alliance { name }
            }
            turnsleft
          }
        }
      }
    `, { allianceId: [parseInt(allianceId)] });

    const allWars = data?.wars?.data || [];
    const allianceIdStr = String(allianceId);
    const defWars = allWars.filter(w => String(w.def_alliance_id) === allianceIdStr);

    if (defWars.length === 0) return;

    const newWars = [];
    for (const war of defWars) {
      const seen = queryOne(
        'SELECT id FROM defense_alerts_sent WHERE guild_id = ? AND war_id = ?',
        [guildId, String(war.id)]
      );
      if (!seen) {
        newWars.push(war);
        run('INSERT OR IGNORE INTO defense_alerts_sent (guild_id, war_id) VALUES (?, ?)',
          [guildId, String(war.id)]);
      }
    }

    if (newWars.length === 0) return;

    const roleRow = queryOne(
      `SELECT discord_role_id FROM guild_roles WHERE guild_id = ? AND role_type = 'military'`,
      [guildId]
    );
    const ping = roleRow ? `<@&${roleRow.discord_role_id}>` : '';

    if (newWars.length >= 3) {
      await sendMassAttackAlert(channel, ping, newWars);
    } else {
      for (const war of newWars) {
        await sendDefenseAlert(channel, ping, war);
      }
    }
  } catch (err) {
    logger.error(`Defense monitor error for guild ${guildId}: ${err.message}`);
  }
}

async function sendDefenseAlert(channel, ping, war) {
  try {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const attacker = war.attacker;
    const defender = war.defender;

    const embed = new EmbedBuilder()
      .setTitle('🆘 Member Under Attack!')
      .setColor(0xe74c3c)
      .addFields(
        {
          name: '🛡️ Defender (Our Member)',
          value: `**[${defender.nation_name || 'Unknown'}](https://politicsandwar.com/nation/id=${defender.id})**\nScore: ${defender.score?.toLocaleString() || '?'}`,
          inline: true,
        },
        {
          name: '⚔️ Attacker (Enemy)',
          value: `**[${attacker.nation_name || 'Unknown'}](https://politicsandwar.com/nation/id=${attacker.id})**\nAlliance: ${attacker.alliance?.name || 'None'}\nScore: ${attacker.score?.toLocaleString() || '?'}`,
          inline: true,
        },
        {
          name: '🪖 Enemy Military',
          value: `✈️ ${attacker.aircraft || 0} | 🚗 ${attacker.tanks || 0} | 👮 ${attacker.soldiers?.toLocaleString() || 0} | 🚢 ${attacker.ships || 0} | 🚀 ${attacker.missiles || 0} | ☢️ ${attacker.nukes || 0}`,
          inline: false,
        },
      )
      .setFooter({ text: `War ID: ${war.id} | Use /counter find to coordinate` })
      .setTimestamp();

    // Quick action buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('View War')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://politicsandwar.com/nation/war/timeline/war=${war.id}`),
      new ButtonBuilder()
        .setLabel('View Attacker')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://politicsandwar.com/nation/id=${attacker.id}`),
    );

    await channel.send({
      content: ping ? `${ping} — 🆘 **${defender.nation_name || 'A member'} is under attack!**` : `🆘 **${defender.nation_name || 'A member'} is under attack!**`,
      embeds: [embed],
      components: [row],
    });

    logger.info(`Defense alert sent for war ${war.id}`);
  } catch (err) {
    logger.error(`Failed to send defense alert for war ${war.id}: ${err.message}`);
  }
}

async function sendMassAttackAlert(channel, ping, wars) {
  try {
    const attackerAlliances = [...new Set(wars.map(w => w.attacker?.alliance?.name || 'Unknown'))];
    const memberLines = wars.slice(0, 10).map(w =>
      `• [${w.defender?.nation_name || 'Unknown'}](https://politicsandwar.com/nation/id=${w.defender?.id}) ← [${w.attacker?.nation_name || 'Unknown'}](https://politicsandwar.com/nation/id=${w.attacker?.id}) (${w.attacker?.alliance?.name || 'None'})`
    );

    const embed = new EmbedBuilder()
      .setTitle(`🚨 MASS ATTACK — ${wars.length} Members Hit!`)
      .setColor(0xff0000)
      .setDescription(
        `**${wars.length} members attacked simultaneously!**\n` +
        `Attacking: **${attackerAlliances.join(', ')}**`
      )
      .addFields(
        {
          name: '🛡️ Members Under Attack',
          value: memberLines.join('\n') + (wars.length > 10 ? `\n_...and ${wars.length - 10} more_` : ''),
        },
        {
          name: '⚡ Immediate Actions',
          value: '`/counter check` — all members under attack\n`/counter find` — find counter options\n`/war defensive` — full list',
        },
      )
      .setFooter({ text: 'PW Defense Bot • Emergency Defense Alert' })
      .setTimestamp();

    await channel.send({
      content: ping ? `${ping} 🚨 **EMERGENCY — MASS ATTACK!**` : '🚨 **EMERGENCY — MASS ATTACK!**',
      embeds: [embed],
    });
    logger.warn(`Mass attack alert sent — ${wars.length} wars`);
  } catch (err) {
    logger.error(`Failed to send mass attack alert: ${err.message}`);
  }
}

module.exports = { checkAllianceDefense };
