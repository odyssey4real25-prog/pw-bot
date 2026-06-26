// ============================================================
// src/commands/military/war.js
// P&W returns all IDs as strings — compare with String()
// All field values guaranteed non-empty for Discord
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { queryOne } = require('../../utils/database');
const { pwQuery, resolveNation } = require('../../utils/pwApi');

// Safe name helper — never returns undefined/null
function safeName(n) { return n || 'Unknown'; }
function safeScore(s) { return s ? Number(s).toLocaleString() : '?'; }
function safeMil(m) { return m || 0; }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('war')
    .setDescription('View and manage active wars involving your alliance')
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show all active wars your alliance is involved in right now')
    )
    .addSubcommand(sub =>
      sub.setName('defensive')
        .setDescription('Show all members currently being attacked')
    )
    .addSubcommand(sub =>
      sub.setName('offensive')
        .setDescription('Show all members currently attacking')
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

    // P&W returns att_alliance_id and def_alliance_id as STRINGS
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

      // Discord field values max 1024 chars — with 84 wars we must cap early
      function buildWarList(wars, isOff) {
        if (wars.length === 0) return isOff ? '✅ No active offensive wars' : '✅ No active defensive wars';
        const lines = [];
        for (const w of wars.slice(0, 5)) {
          const att = safeName(w.attacker?.nation_name);
          const def = safeName(w.defender?.nation_name);
          const attId = w.attacker?.id || 0;
          const defId = w.defender?.id || 0;
          lines.push(isOff
            ? `• [${att}](https://politicsandwar.com/nation/id=${attId}) → [${def}](https://politicsandwar.com/nation/id=${defId})`
            : `• [${def}](https://politicsandwar.com/nation/id=${defId}) ← [${att}](https://politicsandwar.com/nation/id=${attId})`
          );
        }
        if (wars.length > 5) lines.push(`_...and ${wars.length - 5} more. Use /war ${isOff ? 'offensive' : 'defensive'} for full list._`);
        const result = lines.join('\n');
        return result.length > 1020 ? result.slice(0, 1017) + '...' : result;
      }

      const offValue = buildWarList(offWars, true);
      const defValue = buildWarList(defWars, false);

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Alliance War Status')
        .setColor(0xe74c3c)
        .addFields(
          { name: `⚔️ Offensive Wars — ${offWars.length}`, value: offValue },
          { name: `🛡️ Defensive Wars — ${defWars.length}`, value: defValue },
          { name: '📊 Summary', value: `Total wars fetched: **${allWars.length}** | Attacking: **${offWars.length}** | Defending: **${defWars.length}**` },
        )
        .setFooter({ text: 'Use /war defensive or /war offensive for detailed views' })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
    }

    // ── DEFENSIVE ────────────────────────────────────────────
    if (sub === 'defensive') {
      await interaction.deferReply();
      await interaction.editReply('⏳ Checking defensive wars...');

      const allWars = await fetchAllianceWars();
      const defWars = allWars.filter(w => String(w.def_alliance_id) === allianceIdStr);

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

      const lines = defWars.slice(0, 5).map(w =>
        `🛡️ **[${safeName(w.defender?.nation_name)}](https://politicsandwar.com/nation/id=${w.defender?.id})** (Score: ${safeScore(w.defender?.score)})\n` +
        `└ Attacked by: **[${safeName(w.attacker?.nation_name)}](https://politicsandwar.com/nation/id=${w.attacker?.id})** — ${safeName(w.attacker?.alliance?.name)}\n` +
        `└ Enemy mil: ✈️ ${safeMil(w.attacker?.aircraft)} | 🚗 ${safeMil(w.attacker?.tanks)} | 🚀 ${safeMil(w.attacker?.missiles)} | ☢️ ${safeMil(w.attacker?.nukes)}\n` +
        `└ [View War](https://politicsandwar.com/nation/war/timeline/war=${w.id})`
      );

      const defDesc = lines.join('\n\n').slice(0, 3900);
      const embed = new EmbedBuilder()
        .setTitle(`🛡️ Members Under Attack — ${defWars.length}`)
        .setColor(0xe74c3c)
        .setDescription(defDesc + (defWars.length > 5 ? `\n\n_Showing 5 of ${defWars.length}. All wars shown in /war status._` : ''))
        .setFooter({ text: 'Use /counter find [attacker] to coordinate counter-attacks' })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
    }

    // ── OFFENSIVE ────────────────────────────────────────────
    if (sub === 'offensive') {
      await interaction.deferReply();
      await interaction.editReply('⏳ Checking offensive wars...');

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

      const lines = offWars.slice(0, 5).map(w =>
        `⚔️ **[${safeName(w.attacker?.nation_name)}](https://politicsandwar.com/nation/id=${w.attacker?.id})**\n` +
        `└ Attacking: **[${safeName(w.defender?.nation_name)}](https://politicsandwar.com/nation/id=${w.defender?.id})** — ${safeName(w.defender?.alliance?.name)}\n` +
        `└ Target mil: ✈️ ${safeMil(w.defender?.aircraft)} | 🚗 ${safeMil(w.defender?.tanks)} | Score: ${safeScore(w.defender?.score)}\n` +
        `└ Turns left: ${w.turnsleft || '?'} | [View War](https://politicsandwar.com/nation/war/timeline/war=${w.id})`
      );

      const offDesc = lines.join('\n\n').slice(0, 3900);
      const embed = new EmbedBuilder()
        .setTitle(`⚔️ Active Offensive Wars — ${offWars.length}`)
        .setColor(0x3498db)
        .setDescription(offDesc + (offWars.length > 5 ? `\n\n_Showing 5 of ${offWars.length}. Use /war status for overview._` : ''))
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
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
              id
              attid
              defid
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
