// ============================================================
// src/events/interactionCreate.js
// Handles slash commands AND button clicks
// ============================================================

const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { checkPermission } = require('../utils/permissions');
const { run, queryOne } = require('../utils/database');
const { EmbedBuilder } = require('discord.js');

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

      // Assignment Accept button: assignment_accept_[id]
      if (customId.startsWith('assignment_accept_')) {
        const assignmentId = parseInt(customId.replace('assignment_accept_', ''));
        await handleAssignmentAccept(interaction, assignmentId);
        return;
      }

      // Assignment Decline button: assignment_decline_[id]
      if (customId.startsWith('assignment_decline_')) {
        const assignmentId = parseInt(customId.replace('assignment_decline_', ''));
        await handleAssignmentDecline(interaction, assignmentId);
        return;
      }
    }
  },
};

// ── HANDLE ACCEPT BUTTON ─────────────────────────────────────
async function handleAssignmentAccept(interaction, assignmentId) {
  try {
    const assignment = queryOne(
      'SELECT * FROM target_assignments WHERE id = ?',
      [assignmentId]
    );

    if (!assignment) {
      return interaction.reply({ content: `❌ Assignment #${assignmentId} not found.`, flags: 64 });
    }

    // Only the assigned member can accept
    if (assignment.assigned_to_discord_id !== interaction.user.id) {
      return interaction.reply({
        content: `❌ This assignment belongs to someone else, not you.`,
        flags: 64,
      });
    }

    if (assignment.status === 'accepted') {
      return interaction.reply({ content: `✅ You already accepted assignment #${assignmentId}.`, flags: 64 });
    }

    if (['completed', 'cancelled', 'expired'].includes(assignment.status)) {
      return interaction.reply({
        content: `❌ Assignment #${assignmentId} is already **${assignment.status}** and cannot be accepted.`,
        flags: 64,
      });
    }

    run(`UPDATE target_assignments SET status = 'accepted', updated_at = datetime('now') WHERE id = ?`, [assignmentId]);

    const embed = new EmbedBuilder()
      .setTitle('✅ Assignment Accepted')
      .setColor(0x2ecc71)
      .setDescription(
        `You have accepted the assignment to attack **[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})**.\n\n` +
        `Use \`/assign complete ${assignmentId}\` when you have declared war.`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });

    // Notify the officer who assigned it
    try {
      const officer = await interaction.client.users.fetch(assignment.assigned_by_discord_id);
      await officer.send({
        content: `✅ <@${interaction.user.id}> accepted assignment **#${assignmentId}** — Target: **${assignment.target_nation_name}**`,
      });
    } catch { /* DMs closed */ }

    logger.info(`Assignment #${assignmentId} accepted by ${interaction.user.tag}`);
  } catch (err) {
    logger.error(`Error handling assignment accept: ${err.message}`);
    await interaction.reply({ content: '❌ Something went wrong processing your response.', flags: 64 });
  }
}

// ── HANDLE DECLINE BUTTON ────────────────────────────────────
async function handleAssignmentDecline(interaction, assignmentId) {
  try {
    const assignment = queryOne(
      'SELECT * FROM target_assignments WHERE id = ?',
      [assignmentId]
    );

    if (!assignment) {
      return interaction.reply({ content: `❌ Assignment #${assignmentId} not found.`, flags: 64 });
    }

    if (assignment.assigned_to_discord_id !== interaction.user.id) {
      return interaction.reply({ content: `❌ This assignment belongs to someone else.`, flags: 64 });
    }

    if (['completed', 'cancelled', 'expired'].includes(assignment.status)) {
      return interaction.reply({
        content: `❌ Assignment #${assignmentId} is already **${assignment.status}**.`,
        flags: 64,
      });
    }

    run(`UPDATE target_assignments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [assignmentId]);

    await interaction.reply({
      content: `❌ You declined assignment **#${assignmentId}** — Target: **${assignment.target_nation_name}**.`,
      flags: 64,
    });

    // Notify the officer
    try {
      const officer = await interaction.client.users.fetch(assignment.assigned_by_discord_id);
      await officer.send({
        content: `❌ <@${interaction.user.id}> **declined** assignment **#${assignmentId}** — Target: **${assignment.target_nation_name}**.\nYou may want to reassign this target.`,
      });
    } catch { /* DMs closed */ }

    logger.info(`Assignment #${assignmentId} declined by ${interaction.user.tag}`);
  } catch (err) {
    logger.error(`Error handling assignment decline: ${err.message}`);
    await interaction.reply({ content: '❌ Something went wrong.', flags: 64 });
  }
}
