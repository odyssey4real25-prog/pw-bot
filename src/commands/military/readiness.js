// ============================================================
// src/commands/military/readiness.js
// /readiness — View alliance military readiness overview
// Pulls live data from P&W API for your alliance members
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { queryOne } = require('../../utils/database');
const { getAllianceMembers } = require('../../utils/pwApi');

const { getMilStandards, scoreReadiness } = require('../../utils/milStandards');

// Return a colour based on readiness score
function readinessColor(score) {
  if (score >= 75) return 0x2ecc71; // Green
  if (score >= 50) return 0xf1c40f; // Yellow
  if (score >= 25) return 0xe67e22; // Orange
  return 0xe74c3c;                  // Red
}

// Return an emoji based on score
function readinessEmoji(score) {
  if (score >= 75) return '🟢';
  if (score >= 50) return '🟡';
  if (score >= 25) return '🟠';
  return '🔴';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('readiness')
    .setDescription('View alliance military readiness')
    .addStringOption(opt =>
      opt.setName('view')
        .setDescription('What to show')
        .addChoices(
          { name: '📊 Summary (default)', value: 'summary' },
          { name: '⚠️ Low readiness members only', value: 'low' },
          { name: '✅ Full member list', value: 'full' },
        )
    ),

  requiredRole: 'military',

  async execute(interaction) {
    await interaction.deferReply();

    const view = interaction.options.getString('view') || 'summary';

    const guildRow = queryOne('SELECT alliance_id FROM guilds WHERE guild_id = ?', [interaction.guildId]);
    if (!guildRow?.alliance_id) {
      return interaction.editReply('❌ No alliance configured. Use `/config alliance` first.');
    }

    await interaction.editReply('⏳ Fetching alliance military data from P&W...');

    let members;
    try {
      members = await getAllianceMembers(guildRow.alliance_id);
    } catch (err) {
      return interaction.editReply('❌ Failed to fetch alliance data from P&W. Try again in a moment.');
    }

    if (!members || members.length === 0) {
      return interaction.editReply('❌ No members found for this alliance. Check your alliance ID with `/config view`.');
    }

    // Score every member
    const STANDARDS = getMilStandards(interaction.guildId);
    const scored = members
      .filter(m => m.vacation_mode_turns === 0)
      .map(m => ({ ...m, readinessScore: scoreReadiness(m, STANDARDS) }))
      .sort((a, b) => a.readinessScore - b.readinessScore); // Lowest first

    const vacationCount = members.filter(m => m.vacation_mode_turns > 0).length;
    const avgReadiness = Math.round(scored.reduce((s, m) => s + m.readinessScore, 0) / (scored.length || 1));
    const fullyReady = scored.filter(m => m.readinessScore >= 75).length;
    const lowReadiness = scored.filter(m => m.readinessScore < 50);
    const openOffSlots = scored.reduce((s, m) => s + Math.max(0, 5 - m.offensive_wars_count), 0);

    // ── SUMMARY EMBED ────────────────────────────────────────
    const summaryEmbed = new EmbedBuilder()
      .setTitle(`🪖 Alliance Readiness Report`)
      .setColor(readinessColor(avgReadiness))
      .addFields(
        {
          name: '📊 Overall Readiness',
          value: `${readinessEmoji(avgReadiness)} **${avgReadiness}%** average across ${scored.length} active member(s)`,
          inline: false,
        },
        {
          name: '✅ Fully Ready (75%+)',
          value: `${fullyReady} / ${scored.length} members`,
          inline: true,
        },
        {
          name: '⚠️ Low Readiness (<50%)',
          value: `${lowReadiness.length} member(s)`,
          inline: true,
        },
        {
          name: '🏖️ Vacation Mode',
          value: `${vacationCount} member(s)`,
          inline: true,
        },
        {
          name: '⚔️ Open Offensive Slots',
          value: `${openOffSlots} total across alliance`,
          inline: true,
        },
        {
          name: '📏 Readiness Standards',
          value: [
            `Soldiers: ${STANDARDS.soldiers.toLocaleString()}`,
            `Tanks: ${STANDARDS.tanks.toLocaleString()}`,
            `Aircraft: ${STANDARDS.aircraft.toLocaleString()}`,
            `Ships: ${STANDARDS.ships.toLocaleString()}`,
            `(Set via /compliance set)`,
          ].join(' | '),
          inline: false,
        },
      )
      .setTimestamp()
      .setFooter({ text: 'Vacation mode members excluded • Data from P&W API' });

    const embeds = [summaryEmbed];

    // ── LOW READINESS LIST ───────────────────────────────────
    if ((view === 'summary' || view === 'low') && lowReadiness.length > 0) {
      const lines = lowReadiness.slice(0, 15).map(m =>
        `${readinessEmoji(m.readinessScore)} **[${m.nation_name}](https://politicsandwar.com/nation/id=${m.id})** — **${m.readinessScore}%**\n` +
        `└ ✈️ ${m.aircraft} | 🚗 ${m.tanks} | 👮 ${m.soldiers.toLocaleString()} | 🚢 ${m.ships}`
      );

      embeds.push(
        new EmbedBuilder()
          .setTitle(`⚠️ Low Readiness Members (${lowReadiness.length})`)
          .setColor(0xe74c3c)
          .setDescription(lines.join('\n\n'))
          .setFooter({ text: lowReadiness.length > 15 ? `Showing 15 of ${lowReadiness.length}` : 'These members need to rebuild military' })
      );
    }

    // ── FULL MEMBER LIST ─────────────────────────────────────
    if (view === 'full') {
      // Break into chunks of 10 so Discord doesn't reject it
      const chunks = [];
      for (let i = 0; i < scored.length; i += 10) chunks.push(scored.slice(i, i + 10));

      for (const chunk of chunks.slice(0, 3)) { // Max 3 extra embeds
        const lines = chunk.map(m =>
          `${readinessEmoji(m.readinessScore)} **[${m.nation_name}](https://politicsandwar.com/nation/id=${m.id})** — **${m.readinessScore}%** | Slots: ${5 - m.offensive_wars_count}/5\n` +
          `└ ✈️ ${m.aircraft} | 🚗 ${m.tanks} | 👮 ${m.soldiers.toLocaleString()} | 🚢 ${m.ships}`
        );
        embeds.push(
          new EmbedBuilder()
            .setColor(0x3498db)
            .setDescription(lines.join('\n\n'))
        );
      }

      if (chunks.length > 3) {
        embeds[embeds.length - 1].setFooter({ text: `Showing first 30 of ${scored.length} members` });
      }
    }

    await interaction.editReply({ content: '', embeds });
  },
};
