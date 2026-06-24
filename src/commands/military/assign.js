// ============================================================
// src/commands/military/assign.js
// Assign enemy nations as targets to alliance members
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { query, run, queryOne } = require('../../utils/database');
const { resolveNation } = require('../../utils/pwApi');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('assign')
    .setDescription('Manage target assignments')

    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Assign a target nation to an alliance member')
        .addStringOption(opt =>
          opt.setName('target')
            .setDescription('Target nation — name, ID, or P&W link')
            .setRequired(true)
        )
        .addUserOption(opt =>
          opt.setName('member')
            .setDescription('Alliance member to assign this target to')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('priority')
            .setDescription('Priority level')
            .addChoices(
              { name: '🟡 Normal', value: 'normal' },
              { name: '🟠 High', value: 'high' },
              { name: '🔴 Critical', value: 'critical' },
            )
        )
        .addStringOption(opt =>
          opt.setName('notes')
            .setDescription('Instructions for the assigned member')
        )
        .addIntegerOption(opt =>
          opt.setName('expires')
            .setDescription('Hours until this assignment expires (default: 6)')
            .addChoices(
              { name: '1 hour', value: 1 },
              { name: '3 hours', value: 3 },
              { name: '6 hours', value: 6 },
              { name: '12 hours', value: 12 },
              { name: '24 hours', value: 24 },
            )
        )
    )

    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('View all active assignments')
        .addStringOption(opt =>
          opt.setName('filter')
            .setDescription('Filter by status')
            .addChoices(
              { name: 'All active', value: 'active' },
              { name: 'Assigned (pending)', value: 'assigned' },
              { name: 'Accepted', value: 'accepted' },
              { name: 'In progress', value: 'in_progress' },
              { name: 'Completed', value: 'completed' },
            )
        )
    )

    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('Cancel an assignment by its ID number')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('Assignment ID (shown in /assign list)')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName('accept')
        .setDescription('Accept a target assignment given to you')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('Assignment ID')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName('complete')
        .setDescription('Mark your assignment as completed')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('Assignment ID')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName('mine')
        .setDescription('View assignments given to you')
    ),

  requiredRole: null, // Handled per-subcommand

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── CREATE ──────────────────────────────────────────────
    if (sub === 'create') {
      // Only military+ can create assignments
      const { checkPermission } = require('../../utils/permissions');
      if (!checkPermission(interaction, 'military')) {
        return interaction.reply({ content: '❌ You need the Military Officer role to assign targets.', flags: 64 });
      }

      await interaction.deferReply();

      const targetInput = interaction.options.getString('target');
      const member = interaction.options.getUser('member');
      const priority = interaction.options.getString('priority') || 'normal';
      const notes = interaction.options.getString('notes') || null;
      const expiresHours = interaction.options.getInteger('expires') || 6;

      await interaction.editReply(`🔍 Looking up target **${targetInput}**...`);

      const nation = await resolveNation(targetInput);
      if (!nation) {
        return interaction.editReply(`❌ Could not find nation **"${targetInput}"**. Try the exact name, ID, or P&W link.`);
      }

      const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString();

      run(
        `INSERT INTO target_assignments
         (guild_id, target_nation_id, target_nation_name, assigned_to_discord_id,
          assigned_by_discord_id, status, priority, notes, expires_at)
         VALUES (?, ?, ?, ?, ?, 'assigned', ?, ?, ?)`,
        [interaction.guildId, nation.id, nation.nation_name,
         member.id, interaction.user.id, priority, notes, expiresAt]
      );

      // Get the ID of the assignment we just created
      const assignment = queryOne(
        `SELECT id FROM target_assignments
         WHERE guild_id = ? AND target_nation_id = ? AND assigned_to_discord_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [interaction.guildId, nation.id, member.id]
      );

      const priorityEmoji = { normal: '🟡', high: '🟠', critical: '🔴' };
      const embed = new EmbedBuilder()
        .setTitle(`${priorityEmoji[priority]} Target Assignment Created`)
        .setColor(priority === 'critical' ? 0xe74c3c : priority === 'high' ? 0xe67e22 : 0x3498db)
        .addFields(
          { name: '🎯 Target Nation', value: `[${nation.nation_name}](https://politicsandwar.com/nation/id=${nation.id})`, inline: true },
          { name: '🏛️ Alliance', value: nation.alliance?.name || 'None', inline: true },
          { name: '⭐ Score', value: nation.score?.toLocaleString() || '?', inline: true },
          { name: '👤 Assigned To', value: `<@${member.id}>`, inline: true },
          { name: '📋 Priority', value: `${priorityEmoji[priority]} ${priority}`, inline: true },
          { name: '⏰ Expires', value: `<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>`, inline: true },
        )
        .setFooter({ text: `Assignment ID: ${assignment?.id || '?'} • Use /assign accept ${assignment?.id || '?'} to accept` })
        .setTimestamp();

      if (notes) embed.addFields({ name: '📝 Notes', value: notes });

      await interaction.editReply({ content: `📌 <@${member.id}> you have been assigned a target!`, embeds: [embed] });

      // Try to DM the assigned member
      try {
        await member.send({
          content: `📌 You have been assigned a target in **${interaction.guild.name}**!`,
          embeds: [embed],
        });
      } catch {
        // DMs may be closed — that's fine
      }
    }

    // ── LIST ────────────────────────────────────────────────
    if (sub === 'list') {
      const { checkPermission } = require('../../utils/permissions');
      if (!checkPermission(interaction, 'military')) {
        return interaction.reply({ content: '❌ You need the Military Officer role to view all assignments.', flags: 64 });
      }

      const filter = interaction.options.getString('filter') || 'active';

      let assignments;
      if (filter === 'active') {
        assignments = query(
          `SELECT * FROM target_assignments
           WHERE guild_id = ? AND status NOT IN ('completed','cancelled','expired')
           ORDER BY priority DESC, created_at ASC`,
          [interaction.guildId]
        ).rows;
      } else {
        assignments = query(
          `SELECT * FROM target_assignments WHERE guild_id = ? AND status = ?
           ORDER BY created_at DESC LIMIT 20`,
          [interaction.guildId, filter]
        ).rows;
      }

      if (assignments.length === 0) {
        return interaction.reply({ content: `📋 No assignments found for filter: **${filter}**.`, flags: 64 });
      }

      const statusEmoji = {
        assigned: '📌', accepted: '✅', in_progress: '⚔️',
        completed: '🏆', failed: '❌', expired: '⏰', cancelled: '🚫',
      };
      const priorityEmoji = { normal: '🟡', high: '🟠', critical: '🔴' };

      const lines = assignments.map(a =>
        `${priorityEmoji[a.priority] || '🟡'} **[${a.target_nation_name}](https://politicsandwar.com/nation/id=${a.target_nation_id})** ${statusEmoji[a.status] || ''}\n` +
        `└ Assigned to: <@${a.assigned_to_discord_id}> | ID: \`#${a.id}\` | Expires: <t:${Math.floor(new Date(a.expires_at).getTime() / 1000)}:R>`
        + (a.notes ? `\n  └ _${a.notes}_` : '')
      );

      const embed = new EmbedBuilder()
        .setTitle(`📋 Target Assignments — ${assignments.length} result(s)`)
        .setColor(0x3498db)
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: 'Use /assign cancel [id] to cancel | /assign complete [id] to complete' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // ── CANCEL ──────────────────────────────────────────────
    if (sub === 'cancel') {
      const { checkPermission } = require('../../utils/permissions');
      if (!checkPermission(interaction, 'military')) {
        return interaction.reply({ content: '❌ You need the Military Officer role to cancel assignments.', flags: 64 });
      }

      const id = interaction.options.getInteger('id');
      const assignment = queryOne(
        'SELECT * FROM target_assignments WHERE id = ? AND guild_id = ?',
        [id, interaction.guildId]
      );

      if (!assignment) return interaction.reply({ content: `❌ Assignment #${id} not found.`, flags: 64 });
      if (['completed', 'cancelled'].includes(assignment.status)) {
        return interaction.reply({ content: `❌ Assignment #${id} is already **${assignment.status}**.`, flags: 64 });
      }

      run(`UPDATE target_assignments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [id]);
      return interaction.reply({ content: `✅ Assignment **#${id}** (${assignment.target_nation_name}) has been cancelled.`, flags: 64 });
    }

    // ── ACCEPT ──────────────────────────────────────────────
    if (sub === 'accept') {
      const id = interaction.options.getInteger('id');
      const assignment = queryOne(
        'SELECT * FROM target_assignments WHERE id = ? AND guild_id = ? AND assigned_to_discord_id = ?',
        [id, interaction.guildId, interaction.user.id]
      );

      if (!assignment) return interaction.reply({ content: `❌ Assignment #${id} not found or not assigned to you.`, flags: 64 });
      if (assignment.status !== 'assigned') {
        return interaction.reply({ content: `❌ Assignment #${id} is already **${assignment.status}**.`, flags: 64 });
      }

      run(`UPDATE target_assignments SET status = 'accepted', updated_at = datetime('now') WHERE id = ?`, [id]);
      return interaction.reply({
        content: `✅ You accepted assignment **#${id}** — Target: **[${assignment.target_nation_name}](https://politicsandwar.com/nation/id=${assignment.target_nation_id})**\nGood luck! Use \`/assign complete ${id}\` when done.`,
        flags: 64,
      });
    }

    // ── COMPLETE ────────────────────────────────────────────
    if (sub === 'complete') {
      const id = interaction.options.getInteger('id');
      const assignment = queryOne(
        'SELECT * FROM target_assignments WHERE id = ? AND guild_id = ? AND assigned_to_discord_id = ?',
        [id, interaction.guildId, interaction.user.id]
      );

      if (!assignment) return interaction.reply({ content: `❌ Assignment #${id} not found or not assigned to you.`, flags: 64 });
      if (assignment.status === 'completed') return interaction.reply({ content: `✅ Assignment #${id} is already marked complete.`, flags: 64 });

      run(`UPDATE target_assignments SET status = 'completed', updated_at = datetime('now') WHERE id = ?`, [id]);
      return interaction.reply({
        content: `🏆 Assignment **#${id}** marked as **completed**!\nTarget: **${assignment.target_nation_name}** — Great work!`,
        ephemeral: false,
      });
    }

    // ── MINE ────────────────────────────────────────────────
    if (sub === 'mine') {
      const assignments = query(
        `SELECT * FROM target_assignments
         WHERE guild_id = ? AND assigned_to_discord_id = ?
         AND status NOT IN ('cancelled','expired')
         ORDER BY created_at DESC LIMIT 10`,
        [interaction.guildId, interaction.user.id]
      ).rows;

      if (assignments.length === 0) {
        return interaction.reply({ content: '📋 You have no active assignments.', flags: 64 });
      }

      const statusEmoji = { assigned: '📌', accepted: '✅', in_progress: '⚔️', completed: '🏆' };
      const lines = assignments.map(a =>
        `${statusEmoji[a.status] || '📌'} **[${a.target_nation_name}](https://politicsandwar.com/nation/id=${a.target_nation_id})** — \`#${a.id}\`\n` +
        `└ Status: **${a.status}** | Expires: <t:${Math.floor(new Date(a.expires_at).getTime() / 1000)}:R>`
      );

      const embed = new EmbedBuilder()
        .setTitle('📋 Your Assignments')
        .setColor(0x2ecc71)
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: 'Use /assign accept [id] or /assign complete [id]' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });
    }
  },
};
