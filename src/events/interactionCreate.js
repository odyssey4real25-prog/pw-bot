// ============================================================
// src/events/interactionCreate.js
// Handles slash commands AND all button clicks
// ============================================================

const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../utils/logger');
const { checkPermission } = require('../utils/permissions');
const { run, queryOne, query } = require('../utils/database');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction, client) {

    // ── SLASH COMMANDS ───────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      if (command.requiredRole) {
        const hasPermission = checkPermission(interaction, command.requiredRole);
        if (!hasPermission) {
          return interaction.reply({
            content: '❌ You do not have permission to use this command.',
            flags: 64,
          });
        }
      }

      try {
        await command.execute(interaction, client);
      } catch (error) {
        logger.error(`Error in /${interaction.commandName}: ${error.message}`, error);
        const msg = { content: '❌ Something went wrong. The error has been logged.', flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg).catch(() => {});
        } else {
          await interaction.reply(msg).catch(() => {});
        }
      }
    }

    // ── BUTTON CLICKS ────────────────────────────────────────
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith('assignment_accept_')) {
        const id = parseInt(customId.replace('assignment_accept_', ''));
        await handleAssignmentAccept(interaction, id, client);
        return;
      }

      if (customId.startsWith('assignment_decline_')) {
        const id = parseInt(customId.replace('assignment_decline_', ''));
        await handleAssignmentDecline(interaction, id, client);
        return;
      }

      if (customId.startsWith('assignment_complete_')) {
        const id = parseInt(customId.replace('assignment_complete_', ''));
        await handleAssignmentComplete(interaction, id, client);
        return;
      }
    }
  },
};

// ============================================================
// HELPER: Get the wars channel or intel channel for a guild
// Used to post notifications to the server
// ============================================================
async function getOpsChannel(client, guildId) {
  const row =
    queryOne(`SELECT discord_channel_id FROM guild_channels WHERE guild_id = ? AND channel_type = 'wars'`, [guildId]) ||
    queryOne(`SELECT discord_channel_id FROM guild_channels WHERE guild_id = ? AND channel_type = 'intel'`, [guildId]);
  if (!row) return null;
  return client.channels.cache.get(row.discord_channel_id);
}

// ============================================================
// HELPER: DM the officer who created the assignment
// ============================================================
async function notifyOfficer(client, officerId, message, embed) {
  try {
    const officer = await client.users.fetch(officerId);
    await officer.send({ content: message, embeds: embed ? [embed] : [] });
  } catch { /* officer DMs closed */ }
}

// ============================================================
// ACCEPT
// ============================================================
async function handleAssignmentAccept(interaction, assignmentId, client) {
  try {
    const assignment = queryOne('SELECT * FROM target_assignments WHERE id = ?', [assignmentId]);

    if (!assignment) {
      return interaction.reply({ content: `❌ Assignment #${assignmentId} not found.`, flags: 64 });
    }
    if (assignment.assigned_to_discord_id !== interaction.user.id) {
      return interaction.reply({ content: '❌ This assignment is not for you.', flags: 64 });
    }
    if (assignment.status === 'accepted') {
      return interaction.reply({ content: `✅ You already accepted assignment #${assignmentId}.`, flags: 64 });
    }
    if (['completed', 'cancelled', 'expired'].includes(assignment.status)) {
      return interaction.reply({ content: `❌ Assignment #${assignmentId} is already **${assignment.status}**.`, flags: 64 });
    }

    run(`UPDATE target_assignments SET status = 'accepted', updated_at = datetime('now') WHERE id = ?`, [assignmentId]);

    // Reply to the member with a "Mark Complete" button
    const completeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`assignment_complete_${assignmentId}`)
        .setLabel('🏆 Mark as Completed')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setLabel('🔗 View Target')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://politicsandwar.com/nation/id=${assignment.target_nation_id}`),
    );

    const acceptEmbed = new EmbedBuilder()
      .setTitle('✅ Assignment Accepted')
      .setColor(0x2ecc71)
      .setDescription(
        `You accepted the assignment to attack **[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})**.\n\n` +
        `Click **Mark as Completed** below once you have declared war.`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [acceptEmbed], components: [completeButton], flags: 64 });

    // ── Notify the officer who assigned it ──────────────────
    const officerEmbed = new EmbedBuilder()
      .setTitle('✅ Assignment Accepted')
      .setColor(0x2ecc71)
      .addFields(
        { name: '👤 Accepted By', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
        { name: '🎯 Target', value: `[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})`, inline: true },
        { name: '🆔 Assignment', value: `#${assignmentId}`, inline: true },
      )
      .setTimestamp();

    await notifyOfficer(
      client, assignment.assigned_by_discord_id,
      `✅ <@${interaction.user.id}> accepted assignment **#${assignmentId}** — **${assignment.target_nation_name}**`,
      officerEmbed
    );

    // ── Also post to ops channel if available ───────────────
    const guildId = assignment.guild_id;
    const opsChannel = await getOpsChannel(client, guildId);
    if (opsChannel) {
      await opsChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setDescription(`✅ <@${interaction.user.id}> accepted assignment **#${assignmentId}** — Target: **[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})**`)
            .setTimestamp()
        ]
      });
    }

    logger.info(`Assignment #${assignmentId} accepted by ${interaction.user.tag}`);
  } catch (err) {
    logger.error(`Error handling accept for #${assignmentId}: ${err.message}`);
    await interaction.reply({ content: '❌ Something went wrong.', flags: 64 }).catch(() => {});
  }
}

// ============================================================
// DECLINE
// ============================================================
async function handleAssignmentDecline(interaction, assignmentId, client) {
  try {
    const assignment = queryOne('SELECT * FROM target_assignments WHERE id = ?', [assignmentId]);

    if (!assignment) {
      return interaction.reply({ content: `❌ Assignment #${assignmentId} not found.`, flags: 64 });
    }
    if (assignment.assigned_to_discord_id !== interaction.user.id) {
      return interaction.reply({ content: '❌ This assignment is not for you.', flags: 64 });
    }
    if (['completed', 'cancelled', 'expired'].includes(assignment.status)) {
      return interaction.reply({ content: `❌ Assignment #${assignmentId} is already **${assignment.status}**.`, flags: 64 });
    }

    run(`UPDATE target_assignments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [assignmentId]);

    await interaction.reply({
      content: `❌ You declined assignment **#${assignmentId}** — **${assignment.target_nation_name}**. The officer has been notified.`,
      flags: 64,
    });

    // ── Notify the officer ───────────────────────────────────
    const officerEmbed = new EmbedBuilder()
      .setTitle('❌ Assignment Declined')
      .setColor(0xe74c3c)
      .addFields(
        { name: '👤 Declined By', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
        { name: '🎯 Target', value: `[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})`, inline: true },
        { name: '🆔 Assignment', value: `#${assignmentId}`, inline: true },
        { name: '⚡ Action Required', value: 'This target needs to be reassigned. Use `/assign create` or `/counter assign` to assign a new member.', inline: false },
      )
      .setTimestamp();

    await notifyOfficer(
      client, assignment.assigned_by_discord_id,
      `❌ <@${interaction.user.id}> **declined** assignment **#${assignmentId}** — **${assignment.target_nation_name}**. Please reassign!`,
      officerEmbed
    );

    // ── Also post to ops channel ─────────────────────────────
    const guildId = assignment.guild_id;
    const opsChannel = await getOpsChannel(client, guildId);
    if (opsChannel) {
      await opsChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`❌ <@${interaction.user.id}> **declined** assignment **#${assignmentId}** — Target: **[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})**\n⚡ This target needs to be reassigned!`)
            .setTimestamp()
        ]
      });
    }

    logger.info(`Assignment #${assignmentId} declined by ${interaction.user.tag}`);
  } catch (err) {
    logger.error(`Error handling decline for #${assignmentId}: ${err.message}`);
    await interaction.reply({ content: '❌ Something went wrong.', flags: 64 }).catch(() => {});
  }
}

// ============================================================
// COMPLETE
// ============================================================
async function handleAssignmentComplete(interaction, assignmentId, client) {
  try {
    const assignment = queryOne('SELECT * FROM target_assignments WHERE id = ?', [assignmentId]);

    if (!assignment) {
      return interaction.reply({ content: `❌ Assignment #${assignmentId} not found.`, flags: 64 });
    }
    if (assignment.assigned_to_discord_id !== interaction.user.id) {
      return interaction.reply({ content: '❌ This assignment is not for you.', flags: 64 });
    }
    if (assignment.status === 'completed') {
      return interaction.reply({ content: `✅ Assignment #${assignmentId} is already marked completed!`, flags: 64 });
    }
    if (assignment.status === 'cancelled') {
      return interaction.reply({ content: `❌ Assignment #${assignmentId} was cancelled and cannot be completed.`, flags: 64 });
    }

    run(`UPDATE target_assignments SET status = 'completed', updated_at = datetime('now') WHERE id = ?`, [assignmentId]);

    // Confirm to the member
    const completeEmbed = new EmbedBuilder()
      .setTitle('🏆 Assignment Completed!')
      .setColor(0xf1c40f)
      .setDescription(
        `Great work! Assignment **#${assignmentId}** has been marked as completed.\n\n` +
        `Target: **[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})**`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [completeEmbed], flags: 64 });

    // ── Notify the assigning officer ─────────────────────────
    const officerEmbed = new EmbedBuilder()
      .setTitle('🏆 Assignment Completed!')
      .setColor(0xf1c40f)
      .addFields(
        { name: '👤 Completed By', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
        { name: '🎯 Target', value: `[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})`, inline: true },
        { name: '🆔 Assignment', value: `#${assignmentId}`, inline: true },
      )
      .setTimestamp();

    await notifyOfficer(
      client, assignment.assigned_by_discord_id,
      `🏆 <@${interaction.user.id}> completed assignment **#${assignmentId}** — **${assignment.target_nation_name}** has been attacked!`,
      officerEmbed
    );

    // ── Notify Government role in ops channel ────────────────
    const guildId = assignment.guild_id;
    const opsChannel = await getOpsChannel(client, guildId);
    if (opsChannel) {
      // Ping the government role if configured
      const govRole = queryOne(
        `SELECT discord_role_id FROM guild_roles WHERE guild_id = ? AND role_type = 'government'`,
        [guildId]
      );
      const ping = govRole ? `<@&${govRole.discord_role_id}>` : '';

      await opsChannel.send({
        content: ping || undefined,
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('🏆 Target Eliminated!')
            .setDescription(
              `<@${interaction.user.id}> has completed their assignment.\n\n` +
              `Target: **[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})**\n` +
              `Assignment: **#${assignmentId}**`
            )
            .setTimestamp()
        ]
      });
    }

    logger.info(`Assignment #${assignmentId} completed by ${interaction.user.tag}`);
  } catch (err) {
    logger.error(`Error handling complete for #${assignmentId}: ${err.message}`);
    await interaction.reply({ content: '❌ Something went wrong.', flags: 64 }).catch(() => {});
  }
}
