// ============================================================
// src/events/interactionCreate.js
// ============================================================

const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { checkPermission } = require('../utils/permissions');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      if (command.requiredRole) {
        const hasPermission = checkPermission(interaction, command.requiredRole); // no await needed
        if (!hasPermission) {
          return interaction.reply({
            content: '❌ You do not have permission to use this command.',
            ephemeral: true,
          });
        }
      }

      try {
        await command.execute(interaction, client);
      } catch (error) {
        logger.error(`Error in /${interaction.commandName}:`, error);
        const msg = { content: '❌ Something went wrong. The error has been logged.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg);
        } else {
          await interaction.reply(msg);
        }
      }
    }
  },
};
