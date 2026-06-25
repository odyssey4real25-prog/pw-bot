// ============================================================
// src/commands/military/war.js
// /war — View and manage active alliance wars
// P&W API uses alliance_id (not att/def_alliance_id)
// Nation IDs must be integers
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { queryOne } = require('../../utils/database');
const { pwQuery, resolveNation } = require('../../utils/pwApi');

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

    const allianceId = parseInt(guildRow.alliance_id);

    // Shared war fetcher — gets all wars involving our alliance
    async function fetchAllianceWars() {
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
                soldiers tanks aircraft ships missiles nukes
                alliance { name }
              }
              turnsleft
            }
          }
        }
      `, { allianceId: [allianceId] });
      return data?.wars?.data || [];
    }

    // ── STATUS ───────────────────────────────────────────────
    if (sub === 'status') {
      await interaction.deferReply();
      await interaction.editReply('⏳ Fetching war data from P&W...');

      const allWars = await fetchAllianceWars();
      const offWars = allWars.filter(w => w.att_alliance_id === allianceId);
      const defWars = allWars.filter(w => w.def_alliance_id === allianceId);

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Alliance War Status')
        .setColor(0xe74c3c)
        .addFields(
          {
            name: `⚔️ Offensive Wars — ${offWars.length}`,
            value: offWars.length > 0
              ? offWars.slice(0, 10).map(w =>
                  `• **[${w.attacker.nation_name}](https://politicsandwar.com/nation/id=${w.attacker.id})** → **[${w.defender.nation_name}](https://politicsandwar.com/nation/id=${w.defender.id})** (${w.defender.alliance?.name || 'None'})`
                ).join('\n') + (offWars.length > 10 ? `\n_...and ${offWars.length - 10} more_` : '')
              : '✅ No active offensive wars',
          },
          {
            name: `🛡️ Defensive Wars — ${defWars.length}`,
            value: defWars.length > 0
              ? defWars.slice(0, 10).map(w =>
                  `• **[${w.defender.nation_name}](https://politicsandwar.com/nation/id=${w.defender.id})** ← **[${w.attacker.nation_name}](https://politicsandwar.com/nation/id=${w.attacker.id})** (${w.attacker.alliance?.name || 'None'})`
                ).join('\n') + (defWars.length > 10 ? `\n_...and ${defWars.length - 10} more_` : '')
              : '✅ No active defensive wars',
          },
          {
            name: '📊 Summary',
            value: `Total: **${allWars.length}** | Attacking: **${offWars.length}** | Defending: **${defWars.length}**`,
          },
        )
        .setFooter({ text: 'Use /war defensive or /war offensive for detailed views' })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
    }

    // ── DEFENSIVE ────────────────────────────────────────────
    if (sub === 'defensive') {
      await interaction.deferReply();
      await interaction.editReply('⏳ Checking defensive wars...');

      const allWars  = await fetchAllianceWars();
      const defWars  = allWars.filter(w => w.def_alliance_id === allianceId);

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

      const lines = defWars.slice(0, 15).map(w =>
        `🛡️ **[${w.defender.nation_name}](https://politicsandwar.com/nation/id=${w.defender.id})** (Score: ${w.defender.score?.toLocaleString()})\n` +
        `└ Attacked by: **[${w.attacker.nation_name}](https://politicsandwar.com/nation/id=${w.attacker.id})** — ${w.attacker.alliance?.name || 'None'}\n` +
        `└ Enemy mil: ✈️ ${w.attacker.aircraft || 0} | 🚗 ${w.attacker.tanks || 0} | 🚀 ${w.attacker.missiles || 0} | ☢️ ${w.attacker.nukes || 0}\n` +
        `└ [View War](https://politicsandwar.com/nation/war/timeline/war=${w.id})`
      );

      const embed = new EmbedBuilder()
        .setTitle(`🛡️ Members Under Attack — ${defWars.length}`)
        .setColor(0xe74c3c)
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: 'Use /counter find [attacker] to coordinate counter-attacks' })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
    }

    // ── OFFENSIVE ────────────────────────────────────────────
    if (sub === 'offensive') {
      await interaction.deferReply();
      await interaction.editReply('⏳ Checking offensive wars...');

      const allWars = await fetchAllianceWars();
      const offWars = allWars.filter(w => w.att_alliance_id === allianceId);

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

      const lines = offWars.slice(0, 15).map(w =>
        `⚔️ **[${w.attacker.nation_name}](https://politicsandwar.com/nation/id=${w.attacker.id})**\n` +
        `└ Attacking: **[${w.defender.nation_name}](https://politicsandwar.com/nation/id=${w.defender.id})** — ${w.defender.alliance?.name || 'None'}\n` +
        `└ Target mil: ✈️ ${w.defender.aircraft || 0} | 🚗 ${w.defender.tanks || 0} | Score: ${w.defender.score?.toLocaleString()}\n` +
        `└ Turns left: ${w.turnsleft} | [View War](https://politicsandwar.com/nation/war/timeline/war=${w.id})`
      );

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ Active Offensive Wars — ${offWars.length}`)
        .setColor(0x3498db)
        .setDescription(lines.join('\n\n'))
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

      // Nation ID must be an integer
      const data = await pwQuery(`
        query GetNationWars($id: [Int]) {
          wars(nation_id: $id, active: true, first: 10) {
            data {
              id
              att_alliance_id
              def_alliance_id
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
              .setTitle(`⚔️ War Status — ${nation.nation_name}`)
              .setColor(0x2ecc71)
              .setDescription('✅ This nation has no active wars.')
              .setTimestamp()
          ]
        });
      }

      const lines = wars.map(w => {
        const isAttacker = parseInt(w.attid) === parseInt(nation.id);
        const opponent   = isAttacker ? w.defender : w.attacker;
        const role       = isAttacker ? '⚔️ Attacking' : '🛡️ Defending';
        return (
          `${role} **[${opponent.nation_name}](https://politicsandwar.com/nation/id=${opponent.id})**\n` +
          `└ Alliance: ${opponent.alliance?.name || 'None'} | Score: ${opponent.score?.toLocaleString()}\n` +
          `└ Turns left: ${w.turnsleft} | [View War](https://politicsandwar.com/nation/war/timeline/war=${w.id})`
        );
      });

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ War Status — ${nation.nation_name}`)
        .setColor(0xe74c3c)
        .setDescription(lines.join('\n\n'))
        .addFields({
          name: '🪖 Military',
          value: `✈️ ${nation.aircraft || 0} | 🚗 ${nation.tanks || 0} | 👮 ${nation.soldiers?.toLocaleString() || 0} | 🚢 ${nation.ships || 0} | 🚀 ${nation.missiles || 0} | ☢️ ${nation.nukes || 0}`,
        })
        .setFooter({ text: `Nation ID: ${nation.id}` })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [embed] });
    }
  },
};
