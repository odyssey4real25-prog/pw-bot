// ============================================================
// src/systems/defense/defenseMonitor.js
// Monitors alliance members for new defensive wars
// Sends alerts when members are attacked
// Detects coordinated mass attacks (blitzes against us)
// ============================================================

const { EmbedBuilder } = require('discord.js');
const { query, run, queryOne } = require('../../utils/database');
const { pwQuery, MEMBER_POSITIONS } = require('../../utils/pwApi');
const logger = require('../../utils/logger');

// ============================================================
// CHECK ALL ALLIANCE MEMBERS FOR NEW DEFENSIVE WARS
// ============================================================
async function checkAllianceDefense(client) {
  const guilds = query(
    'SELECT guild_id, alliance_id FROM guilds WHERE alliance_id IS NOT NULL', []
  ).rows;

  for (const guild of guilds) {
    await processGuildDefense(client, guild.guild_id, guild.alliance_id);
  }
}

async function processGuildDefense(client, guildId, allianceId) {
  try {
    // Get war alert channel
    const channelRow =
      queryOne(`SELECT discord_channel_id FROM guild_channels WHERE guild_id = ? AND channel_type = 'wars'`, [guildId]) ||
      queryOne(`SELECT discord_channel_id FROM guild_channels WHERE guild_id = ? AND channel_type = 'intel'`, [guildId]);

    if (!channelRow) return;
    const channel = client.channels.cache.get(channelRow.discord_channel_id);
    if (!channel) return;

    // Fetch current wars involving our alliance members
    const data = await pwQuery(`
      query GetAllianceWars($allianceId: [Int]) {
        wars(def_alliance_id: $allianceId, active: true, first: 100) {
          data {
            id
            date
            attid
            defid
            att_alliance_id
            def_alliance_id
            war_type
            attacker {
              id
              nation_name
              score
              alliance { name }
              soldiers tanks aircraft ships
            }
            defender {
              id
              nation_name
              score
              alliance { name }
            }
            turnsleft
          }
        }
      }
    `, { allianceId: [parseInt(allianceId)] });

    const activeWars = data?.wars?.data || [];
    if (activeWars.length === 0) return;

    // Check each war — alert if we haven't seen it before
    const newWars = [];
    for (const war of activeWars) {
      const alreadySeen = queryOne(
        'SELECT id FROM defense_alerts_sent WHERE guild_id = ? AND war_id = ?',
        [guildId, war.id]
      );
      if (!alreadySeen) {
        newWars.push(war);
        run(
          'INSERT OR IGNORE INTO defense_alerts_sent (guild_id, war_id) VALUES (?, ?)',
          [guildId, war.id]
        );
      }
    }

    if (newWars.length === 0) return;

    // Get military role for pinging
    const roleRow = queryOne(
      `SELECT discord_role_id FROM guild_roles WHERE guild_id = ? AND role_type = 'military'`,
      [guildId]
    );
    const ping = roleRow ? `<@&${roleRow.discord_role_id}>` : '';

    // Check for mass attack (blitz against us)
    // If 3+ new wars in same check = coordinated attack
    if (newWars.length >= 3) {
      await sendMassAttackAlert(channel, ping, newWars, guildId, client);
    } else {
      // Send individual alerts for each new war
      for (const war of newWars) {
        await sendDefenseAlert(channel, ping, war);
      }
    }

  } catch (err) {
    logger.error(`Defense monitor error for guild ${guildId}: ${err.message}`);
  }
}

// ============================================================
// SEND ALERT FOR A SINGLE NEW DEFENSIVE WAR
// ============================================================
async function sendDefenseAlert(channel, ping, war) {
  try {
    const attacker = war.attacker;
    const defender = war.defender;

    // Military comparison
    const milLines = [
      `👮 Soldiers: ${attacker.soldiers?.toLocaleString() || '?'}`,
      `🚗 Tanks: ${attacker.tanks?.toLocaleString() || '?'}`,
      `✈️ Aircraft: ${attacker.aircraft?.toLocaleString() || '?'}`,
      `🚢 Ships: ${attacker.ships?.toLocaleString() || '?'}`,
    ];

    const embed = new EmbedBuilder()
      .setTitle(`🆘 Member Under Attack!`)
      .setColor(0xe74c3c)
      .addFields(
        {
          name: '🛡️ Defender (Our Member)',
          value: `**[${defender.nation_name}](https://politicsandwar.com/nation/id=${defender.id})**\n` +
                 `Score: ${defender.score?.toLocaleString() || '?'}`,
          inline: true,
        },
        {
          name: '⚔️ Attacker (Enemy)',
          value: `**[${attacker.nation_name}](https://politicsandwar.com/nation/id=${attacker.id})**\n` +
                 `Alliance: ${attacker.alliance?.name || 'None'}\n` +
                 `Score: ${attacker.score?.toLocaleString() || '?'}`,
          inline: true,
        },
        {
          name: '🪖 Enemy Military',
          value: milLines.join(' | '),
          inline: false,
        },
        {
          name: '🔗 Quick Links',
          value: `[View War](https://politicsandwar.com/nation/war/timeline/war=${war.id}) | ` +
                 `[Counter Attacker](https://politicsandwar.com/nation/id=${attacker.id})`,
          inline: false,
        },
      )
      .setFooter({ text: `War ID: ${war.id} | Use /counter find to see who can counter` })
      .setTimestamp();

    await channel.send({ content: ping ? `${ping} — Member under attack!` : '🆘 Member under attack!', embeds: [embed] });
    logger.info(`Defense alert sent for war ${war.id}`);

  } catch (err) {
    logger.error(`Failed to send defense alert for war ${war.id}: ${err.message}`);
  }
}

// ============================================================
// SEND MASS ATTACK (BLITZ) ALERT
// ============================================================
async function sendMassAttackAlert(channel, ping, wars, guildId, client) {
  try {
    const attackerAlliances = [...new Set(wars.map(w => w.attacker?.alliance?.name || 'Unknown'))];
    const defendersHit = wars.map(w =>
      `• **[${w.defender.nation_name}](https://politicsandwar.com/nation/id=${w.defender.id})** — attacked by **${w.attacker.nation_name}** (${w.attacker.alliance?.name || 'None'})`
    );

    const embed = new EmbedBuilder()
      .setTitle(`🚨 MASS ATTACK DETECTED — ${wars.length} Members Hit!`)
      .setColor(0xff0000)
      .setDescription(
        `**${wars.length} alliance members have been attacked simultaneously!**\n` +
        `This may be a coordinated blitz against us.\n\n` +
        `**Attacking Alliance(s):** ${attackerAlliances.join(', ')}`
      )
      .addFields({
        name: '🛡️ Members Under Attack',
        value: defendersHit.slice(0, 10).join('\n') +
               (wars.length > 10 ? `\n_...and ${wars.length - 10} more_` : ''),
      })
      .addFields({
        name: '⚡ Immediate Actions',
        value: '• Use `/counter check` to see all members under attack\n' +
               '• Use `/counter find [attacker]` to find counter options\n' +
               '• Use `/blitz create` to coordinate a counter-blitz\n' +
               '• Use `/hq` for full command overview',
      })
      .setFooter({ text: 'PW Defense Bot • Emergency Defense Alert' })
      .setTimestamp();

    await channel.send({
      content: ping ? `${ping} 🚨 **EMERGENCY — MASS ATTACK DETECTED!**` : '🚨 **EMERGENCY — MASS ATTACK DETECTED!**',
      embeds: [embed],
    });

    logger.warn(`Mass attack alert sent for guild ${guildId} — ${wars.length} wars detected`);

  } catch (err) {
    logger.error(`Failed to send mass attack alert: ${err.message}`);
  }
}

module.exports = { checkAllianceDefense };
