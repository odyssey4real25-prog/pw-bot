// ============================================================
// src/commands/admin/help.js — Updated Phase 5
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const COMMAND_CATEGORIES = [
  {
    name: '⚙️ Setup & Configuration',
    role: '🔒 Admin only',
    color: 0x95a5a6,
    commands: [
      { cmd: '/config alliance',        desc: 'Set your P&W alliance ID' },
      { cmd: '/config channel beige',   desc: 'Set the channel for beige exit alerts' },
      { cmd: '/config channel wars',    desc: 'Set the channel for war/defense alerts' },
      { cmd: '/config channel intel',   desc: 'Set the channel for intelligence alerts' },
      { cmd: '/config role military',   desc: 'Set which Discord role = Military Officer' },
      { cmd: '/config role government', desc: 'Set which Discord role = Government' },
      { cmd: '/config view',            desc: 'View all current bot settings' },
      { cmd: '/alerts intervals',       desc: 'Set beige alert timing e.g. 60,30,15,5 minutes' },
    ],
  },
  {
    name: '🟡 Beige Tracking',
    role: '🔒 Military+',
    color: 0xf1c40f,
    commands: [
      { cmd: '/beige',            desc: 'All enemy nations currently in beige, sorted by expiry' },
      { cmd: '/alerts beige on',  desc: 'Enable personal DM alerts when beige targets expire' },
      { cmd: '/alerts beige off', desc: 'Disable personal beige DM alerts' },
      { cmd: '/alerts view',      desc: 'View your current alert settings' },
    ],
  },
  {
    name: '🕵️ Intelligence & Watchlists',
    role: '🔒 Military+',
    color: 0x3498db,
    commands: [
      { cmd: '/intel',                  desc: 'Full intelligence dashboard — enemy alliances, watched nations' },
      { cmd: '/targets',                desc: 'Recommended attack targets scored and ranked from watchlists' },
      { cmd: '/watch nation add',       desc: 'Watch a nation — enter name, ID, or P&W link (any case)' },
      { cmd: '/watch nation remove',    desc: 'Remove a nation from the watchlist' },
      { cmd: '/watch nation list',      desc: 'Show all watched nations' },
      { cmd: '/watch alliance add',     desc: 'Watch an alliance — enter name, ID, or P&W link (any case)' },
      { cmd: '/watch alliance remove',  desc: 'Remove an alliance from the watchlist' },
      { cmd: '/watch alliance list',    desc: 'Show all watched alliances' },
    ],
  },
  {
    name: '⚔️ Military Operations',
    role: '🔒 Military+',
    color: 0xe74c3c,
    commands: [
      { cmd: '/assign create',    desc: 'Assign a target nation to an alliance member' },
      { cmd: '/assign list',      desc: 'View all active target assignments' },
      { cmd: '/assign mine',      desc: 'View assignments given to you personally' },
      { cmd: '/assign accept',    desc: 'Accept an assignment given to you' },
      { cmd: '/assign complete',  desc: 'Mark your assignment as completed' },
      { cmd: '/assign cancel',    desc: 'Cancel an assignment (Military Officer+)' },
      { cmd: '/counter find',     desc: 'Find who can counter-attack a specific enemy' },
      { cmd: '/counter assign',   desc: 'Assign a member to counter a specific attacker' },
      { cmd: '/counter check',    desc: 'See which alliance members are currently under attack' },
      { cmd: '/reserve add',      desc: 'Reserve a target to prevent double-attacks' },
      { cmd: '/reserve release',  desc: 'Release your reservation on a target' },
      { cmd: '/reserve list',     desc: 'See all currently reserved targets' },
    ],
  },
  {
    name: '📊 Dashboards & Reports',
    role: '🔒 Military+',
    color: 0x9b59b6,
    commands: [
      { cmd: '/hq',        desc: 'Military command dashboard — assignments, beige exits, reservations' },
      { cmd: '/readiness', desc: 'Alliance military readiness — scores every member as a percentage' },
    ],
  },
  {
    name: '🛠️ Utility',
    role: '✅ Everyone',
    color: 0x2ecc71,
    commands: [
      { cmd: '/ping', desc: 'Check if the bot is online and see response times' },
      { cmd: '/help', desc: 'Show this help menu' },
    ],
  },
];

const COMING_SOON = [
  '💥  `/blitz` — Plan and coordinate timed alliance blitzes with countdown alerts',
  '🏴  `/operation` — Create and manage full war operations with dedicated war rooms',
  '📈  `/health` — Alliance health score and strategic overview report',
  '🏆  `/participation` — War participation leaderboards and statistics',
  '🗓️  `/report daily` — Automated daily alliance reports sent to a channel',
  '🔔  `/alerts counters on/off` — Personal counter-alert DM preferences',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available bot commands')
    .addStringOption(opt =>
      opt.setName('category')
        .setDescription('Show commands for one specific category')
        .addChoices(
          { name: '⚙️ Setup & Configuration', value: 'setup' },
          { name: '🟡 Beige Tracking', value: 'beige' },
          { name: '🕵️ Intelligence & Watchlists', value: 'intel' },
          { name: '⚔️ Military Operations', value: 'military' },
          { name: '📊 Dashboards & Reports', value: 'dashboards' },
          { name: '🛠️ Utility', value: 'utility' },
        )
    ),

  requiredRole: null,

  async execute(interaction) {
    const categoryFilter = interaction.options.getString('category');

    if (categoryFilter) {
      const map = {
        setup: 0, beige: 1, intel: 2, military: 3, dashboards: 4, utility: 5,
      };
      const cat = COMMAND_CATEGORIES[map[categoryFilter]];
      if (!cat) return interaction.reply({ content: '❌ Unknown category.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(cat.name)
        .setColor(cat.color)
        .setDescription(`**Permission:** ${cat.role}\n\u200b`)
        .addFields(cat.commands.map(c => ({ name: c.cmd, value: c.desc, inline: false })))
        .setFooter({ text: 'Use /help to see all categories' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const embeds = [
      new EmbedBuilder()
        .setTitle('🛡️ PW Defense Bot — Command Reference')
        .setColor(0xe74c3c)
        .setDescription(
          'Here is everything this bot can do.\n\n' +
          '**Permission levels:**\n' +
          '✅ Everyone — any member\n' +
          '🔒 Military+ — requires Military Officer role or higher\n' +
          '🔒 Admin only — requires Discord Administrator\n\n' +
          '💡 Tip: names, IDs, and P&W links all work in any command that asks for a nation or alliance.\n' +
          'Spelling is case-insensitive — `rose`, `Rose`, and `ROSE` all find the same alliance.\n\u200b'
        ),

      ...COMMAND_CATEGORIES.map(cat =>
        new EmbedBuilder()
          .setTitle(cat.name)
          .setColor(cat.color)
          .setDescription(
            `**Permission:** ${cat.role}\n\n` +
            cat.commands.map(c => `\`${c.cmd}\` — ${c.desc}`).join('\n')
          )
      ),

      new EmbedBuilder()
        .setTitle('🚧 Coming Soon')
        .setColor(0x7f8c8d)
        .setDescription(COMING_SOON.join('\n'))
        .setFooter({ text: 'PW Defense Bot • More features added every phase' })
        .setTimestamp(),
    ];

    return interaction.reply({ embeds, ephemeral: true });
  },
};
