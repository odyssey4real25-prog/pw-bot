// ============================================================
// src/commands/military/war.js
// Fix 1: Multiple embeds for full war lists (no page limit)
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { queryOne } = require('../../utils/database');
const { pwQuery, resolveNation } = require('../../utils/pwApi');

function safeName(n) { return n || 'Unknown'; }
function safeScore(s) { return s ? Number(s).toLocaleString() : '?'; }
function safeMil(m) { return m || 0; }

// Split array into chunks of N
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('war')
    .setDescription('View and manage active wars involving your alliance')
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Overview of all active wars your alliance is involved in')
    )
    .addSubcommand(sub =>
      sub.setName('defensive')
        .setDescription('Full list of all members currently being attacked')
    )
    .addSubcommand(sub =>
      sub.setName('offensive')
        .setDescription('Full list of all members currently attacking')
    )
    .addSubcommand(sub =>
      sub.setName('check')
        .setDescription('Check the war status of a specific nation')
        .addStringOption(opt =>
          opt.setName('nation')
            .setDescription('Nation name, ID, or P&W link')
            .setRequired(true)
        )
    ),

  requiredRole: 'military',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const guildRow = queryOne('SELECT alliance_id FROM guilds WHERE guild_id = ?', [interaction.guildId]);
    if (!guildRow?.alliance_id) {
      return interaction.reply({ content: '❌ No alliance configured. Use `/config alliance` first.', flags: 64 });
    }

    const allianceIdStr = String(guildRow.alliance_id);

    async function fetchAllianceWars() {
      const data = await pwQuery(`
        query GetAllianceWars($allianceId: [Int]) {
          wars(alliance_id: $allianceId, active: true, first: 100) {
            data {
              id
              att_alliance_id
              def_alliance_id
              attid
              defid
              attacker {
                id nation_name score
                soldiers tanks aircraft ships missiles nukes
                alliance { name }
              }
              defender {
                id nation_name score
                soldiers tanks aircraft ships missiles nukes
                alliance { name }
              }
              turnsleft
            }
          }
        }
      `, { allianceId: [parseInt(guildRow.alliance_id)] });
      return data?.wars?.data || [];
    }

    // ── STATUS ───────────────────────────────────────────────
    if (sub === 'status') {
      await interaction.deferReply();
      await interaction.editReply('⏳ Fetching war data from P&W...');

      const allWars = await fetchAllianceWars();
      const offWars = allWars.filter(w => String(w.att_alliance_id) === allianceIdStr);
      const defWars = allWars.filter(w => String(w.def_alliance_id) === allianceIdStr);

      function buildWarList(wars, isOff) {
        if (wars.length === 0) return isOff ? '✅ No active offensive wars' : '✅ No active defensive wars';
        const lines = wars.slice(0, 5).map(w => isOff
          ? `• [${safeName(w.attacker?.nation_name)}](https://politicsandwar.com/nation/id=${w.attacker?.id}) → [${safeName(w.defender?.nation_name)}](https://politicsandwar.com/nation/id=${w.defender?.id})`
          : `• [${safeName(w.defender?.nation_name)}](https://politicsandwar.com/nation/id=${w.defender?.id}) ← [${safeName(w.attacker?.nation_name)}](https://politicsandwar.com/nation/id=${w.attacker?.id})`
        );
        if (wars.length > 5) lines.push(`_...and ${wars.length - 5} more. Use /war ${isOff ? 'offensive' : 'defensive'} for full list._`);
        return lines.join('\n').slice(0, 1020);
      }

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Alliance War Status')
        .setColor(0xe74c3c)
        .addFields(
          { name: `⚔️ Offensive Wars — ${offWars.length}`, value: buildWarList(offWars, true) },
          { name: `🛡️ Defensive Wars — ${defWars.length}`, value: buildWarList(defWars, false) },
          { name: '📊 Summary', value: `Total: **${allWars.length}** | Attacking: **${offWars.length}** | Defending: **${defWars.length}**` },
        )
        .setFooter({ text: 'Use /war defensive or /war offensive for the FULL list of all wars' })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
    }

    // ── DEFENSIVE — Full list across multiple embeds ──────────
    if (sub === 'defensive') {
      await interaction.deferReply();
      await interaction.editReply('⏳ Fetching defensive war data...');

      const allWars  = await fetchAllianceWars();
      const defWars  = allWars.filter(w => String(w.def_alliance_id) === allianceIdStr);

      if (defWars.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('🛡️ Defensive Wars')
              .setColor(0x2ecc71)
              .setDescription('✅ No alliance members are currently under attack.')
              .setTimestamp()
          ]
        });
      }

      // Split into pages of 5 wars each
      const pages   = chunk(defWars, 5);
      const embeds  = pages.map((page, i) => {
        const lines = page.map(w =>
          `🛡️ **[${safeName(w.defender?.nation_name)}](https://politicsandwar.com/nation/id=${w.defender?.id})** — Score: ${safeScore(w.defender?.score)}\n` +
          `└ Attacked by: **[${safeName(w.attacker?.nation_name)}](https://politicsandwar.com/nation/id=${w.attacker?.id})** (${safeName(w.attacker?.alliance?.name)})\n` +
          `└ Enemy: ✈️ ${safeMil(w.attacker?.aircraft)} | 🚗 ${safeMil(w.attacker?.tanks)} | 🚀 ${safeMil(w.attacker?.missiles)} | ☢️ ${safeMil(w.attacker?.nukes)}\n` +
          `└ [View War](https://politicsandwar.com/nation/war/timeline/war=${w.id})`
        );
        return new EmbedBuilder()
          .setTitle(i === 0 ? `🛡️ Members Under Attack — ${defWars.length} total` : `🛡️ Defensive Wars (continued)`)
          .setColor(0xe74c3c)
          .setDescription(lines.join('\n\n'))
          .setFooter({ text: `Page ${i + 1} of ${pages.length} | Use /counter find [attacker] to coordinate counters` });
      });

      // Discord allows max 10 embeds per message — split into batches if needed
      await interaction.editReply({ content: '', embeds: embeds.slice(0, 10) });
      for (let i = 10; i < embeds.length; i += 10) {
        await interaction.followUp({ embeds: embeds.slice(i, i + 10) });
      }
    }

    // ── OFFENSIVE — Full list across multiple embeds ──────────
    if (sub === 'offensive') {
      await interaction.deferReply();
      await interaction.editReply('⏳ Fetching offensive war data...');

      const allWars = await fetchAllianceWars();
      const offWars = allWars.filter(w => String(w.att_alliance_id) === allianceIdStr);

      if (offWars.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('⚔️ Offensive Wars')
              .setColor(0x2ecc71)
              .setDescription('No active offensive wars right now.')
              .setTimestamp()
          ]
        });
      }

      const pages  = chunk(offWars, 5);
      const embeds = pages.map((page, i) => {
        const lines = page.map(w =>
          `⚔️ **[${safeName(w.attacker?.nation_name)}](https://politicsandwar.com/nation/id=${w.attacker?.id})**\n` +
          `└ Attacking: **[${safeName(w.defender?.nation_name)}](https://politicsandwar.com/nation/id=${w.defender?.id})** (${safeName(w.defender?.alliance?.name)})\n` +
          `└ Target: ✈️ ${safeMil(w.defender?.aircraft)} | 🚗 ${safeMil(w.defender?.tanks)} | Score: ${safeScore(w.defender?.score)}\n` +
          `└ Turns left: ${w.turnsleft || '?'} | [View War](https://politicsandwar.com/nation/war/timeline/war=${w.id})`
        );
        return new EmbedBuilder()
          .setTitle(i === 0 ? `⚔️ Active Offensive Wars — ${offWars.length} total` : `⚔️ Offensive Wars (continued)`)
          .setColor(0x3498db)
          .setDescription(lines.join('\n\n'))
          .setFooter({ text: `Page ${i + 1} of ${pages.length}` });
      });

      await interaction.editReply({ content: '', embeds: embeds.slice(0, 10) });
      for (let i = 10; i < embeds.length; i += 10) {
        await interaction.followUp({ embeds: embeds.slice(i, i + 10) });
      }
    }

    // ── CHECK ─────────────────────────────────────────────────
    if (sub === 'check') {
      await interaction.deferReply();
      const input = interaction.options.getString('nation');
      await interaction.editReply(`🔍 Looking up **${input}**...`);

      const nation = await resolveNation(input);
      if (!nation) {
        return interaction.editReply(`❌ Could not find nation **"${input}"**. Try name, ID, or P&W link.`);
      }

      const data = await pwQuery(`
        query GetNationWars($id: [Int]) {
          wars(nation_id: $id, active: true, first: 10) {
            data {
              id attid defid
              attacker { id nation_name score alliance { name } }
              defender { id nation_name score alliance { name } }
              turnsleft
            }
          }
        }
      `, { id: [parseInt(nation.id)] });

      const wars = data?.wars?.data || [];

      if (wars.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`⚔️ War Status — ${safeName(nation.nation_name)}`)
              .setColor(0x2ecc71)
              .setDescription('✅ This nation has no active wars.')
              .setTimestamp()
          ]
        });
      }

      const nationIdStr = String(nation.id);
      const lines = wars.map(w => {
        const isAttacker = String(w.attid) === nationIdStr;
        const opponent   = isAttacker ? w.defender : w.attacker;
        const role       = isAttacker ? '⚔️ Attacking' : '🛡️ Defending';
        return (
          `${role} **[${safeName(opponent?.nation_name)}](https://politicsandwar.com/nation/id=${opponent?.id})**\n` +
          `└ Alliance: ${safeName(opponent?.alliance?.name)} | Score: ${safeScore(opponent?.score)}\n` +
          `└ Turns left: ${w.turnsleft || '?'} | [View War](https://politicsandwar.com/nation/war/timeline/war=${w.id})`
        );
      });

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ War Status — ${safeName(nation.nation_name)}`)
        .setColor(0xe74c3c)
        .setDescription(lines.join('\n\n'))
        .addFields({
          name: '🪖 Military',
          value: `✈️ ${safeMil(nation.aircraft)} | 🚗 ${safeMil(nation.tanks)} | 👮 ${nation.soldiers?.toLocaleString() || 0} | 🚢 ${safeMil(nation.ships)} | 🚀 ${safeMil(nation.missiles)} | ☢️ ${safeMil(nation.nukes)}`,
        })
        .setFooter({ text: `Nation ID: ${nation.id}` })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
    }
  },
};
