// ============================================================
// src/commands/admin/help.js — Updated Phase 10
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
      { cmd: '/config channel wars',    desc: 'Set the channel for war/defense alerts (also receives instant attack alerts)' },
      { cmd: '/config channel intel',   desc: 'Set the intel channel (military change alerts, daily reports)' },
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
      { cmd: '/beige',            desc: 'All enemy nations currently in beige, sorted by expiry time' },
      { cmd: '/alerts beige on',  desc: 'Enable personal DM alerts when beige targets are expiring' },
      { cmd: '/alerts beige off', desc: 'Disable personal beige DM alerts' },
      { cmd: '/alerts view',      desc: 'View your current alert settings' },
    ],
  },
  {
    name: '🕵️ Intelligence & Watchlists',
    role: '🔒 Military+ (coalition requires Government+)',
    color: 0x3498db,
    commands: [
      { cmd: '/intel',                    desc: 'Intelligence dashboard — enemy alliances, watched nations' },
      { cmd: '/targets',                  desc: 'Recommended attack targets scored and ranked from watchlists' },
      { cmd: '/watch nation add',         desc: 'Watch a nation — name, ID, or P&W link (any case)' },
      { cmd: '/watch nation remove',      desc: 'Remove a nation from the watchlist' },
      { cmd: '/watch nation list',        desc: 'Show all watched nations' },
      { cmd: '/watch alliance add',       desc: 'Watch an alliance — name, ID, or P&W link (any case)' },
      { cmd: '/watch alliance remove',    desc: 'Remove an alliance from the watchlist' },
      { cmd: '/watch alliance list',      desc: 'Show all watched alliances' },
      { cmd: '/coalition add',            desc: 'Add an alliance to your friendly or enemy coalition' },
      { cmd: '/coalition remove',         desc: 'Remove an alliance from the coalition list' },
      { cmd: '/coalition list',           desc: 'Show all coalition members and enemies' },
      { cmd: '/coalition compare',        desc: 'Side-by-side military comparison: our coalition vs enemy coalition' },
    ],
  },
  {
    name: '⚔️ Military Operations',
    role: '🔒 Military+',
    color: 0xe74c3c,
    commands: [
      { cmd: '/assign create',       desc: 'Assign a target to a member — they receive a DM with Accept/Decline buttons' },
      { cmd: '/assign list',         desc: 'View all active target assignments' },
      { cmd: '/assign mine',         desc: 'View your own assignments with one-click Accept buttons' },
      { cmd: '/assign complete',     desc: 'Mark your assignment as completed' },
      { cmd: '/assign cancel',       desc: 'Cancel an assignment — member is DM\'d with the reason' },
      { cmd: '/counter find',        desc: 'Find who can counter-attack a specific enemy nation' },
      { cmd: '/counter assign',      desc: 'Assign a member to counter a specific attacker' },
      { cmd: '/counter check',       desc: 'See which alliance members are currently under attack' },
      { cmd: '/reserve add',         desc: 'Reserve a target to prevent double-attacks' },
      { cmd: '/reserve release',     desc: 'Release your reservation on a target' },
      { cmd: '/reserve list',        desc: 'See all currently reserved targets' },
      { cmd: '/blitz create',        desc: 'Create a timed blitz operation with launch countdown' },
      { cmd: '/blitz list',          desc: 'View all active blitz operations' },
      { cmd: '/blitz view',          desc: 'View full details and readiness of a blitz' },
      { cmd: '/blitz ready',         desc: 'Mark yourself ready/not ready for a blitz' },
      { cmd: '/blitz ping',          desc: 'Ping all members about a blitz with an alert embed' },
      { cmd: '/blitz cancel',        desc: 'Cancel a blitz operation' },
      { cmd: '/operation create',    desc: 'Create a full war operation with objectives' },
      { cmd: '/operation list',      desc: 'View all operations filtered by status' },
      { cmd: '/operation view',      desc: 'View full details and target list of an operation' },
      { cmd: '/operation addtarget', desc: 'Add a target nation to an operation' },
      { cmd: '/operation status',    desc: 'Update an operation status (planning/active/completed)' },
      { cmd: '/operation report',    desc: 'Generate a completion report for an operation' },
      { cmd: '/compliance set',      desc: 'Set minimum military standards (soldiers, tanks, aircraft, ships)' },
      { cmd: '/compliance view',     desc: 'View current compliance standards' },
      { cmd: '/compliance check',    desc: 'Check which members meet or fail compliance standards' },
      { cmd: '/compliance report',   desc: 'Full compliance report with pass rate and breakdown by category' },
      { cmd: '/war status',          desc: 'Overview of all active wars your alliance is in right now' },
      { cmd: '/war defensive',       desc: 'Full paginated list of all members currently under attack' },
      { cmd: '/war offensive',       desc: 'Full paginated list of all members currently attacking' },
      { cmd: '/war check',           desc: 'Check the full war status of any specific nation' },
    ],
  },
  {
    name: '📊 Dashboards & Reports',
    role: '🔒 Military+ (gov-dashboard requires Government+)',
    color: 0x9b59b6,
    commands: [
      { cmd: '/hq',                        desc: 'Military command dashboard — assignments, beige exits, reservations' },
      { cmd: '/readiness',                 desc: 'Alliance military readiness — scores every member as a percentage' },
      { cmd: '/health',                    desc: 'Alliance health score — overall grade with strengths and improvements' },
      { cmd: '/gov-dashboard',             desc: 'Government strategic overview — military strength, enemy comparison, ops' },
      { cmd: '/participation leaderboard', desc: 'Leaderboards — most wars, assignments completed, counters done' },
      { cmd: '/participation snapshot',    desc: 'Pull a fresh war activity snapshot from P&W for leaderboards' },
      { cmd: '/participation inactive',    desc: 'Show members with zero offensive wars right now' },
      { cmd: '/report daily',              desc: 'Manually trigger the daily alliance report now (Government+)' },
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

const AUTOMATIC_FEATURES = [
  '🆘  **Instant attack alerts** — bot checks every 60 seconds and pings your wars channel the moment a member is attacked',
  '🚨  **Mass attack detection** — if 3+ members are hit at once, sends an emergency alert automatically',
  '🟡  **Beige exit alerts** — fires at your configured intervals before enemy nations leave beige',
  '📈  **Military change alerts** — detects significant enemy military buildups every 15 minutes',
  '📅  **Daily report** — automatic alliance status report sent to your intel channel at 08:00 UTC',
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
      const map = { setup: 0, beige: 1, intel: 2, military: 3, dashboards: 4, utility: 5 };
      const cat = COMMAND_CATEGORIES[map[categoryFilter]];
      if (!cat) return interaction.reply({ content: '❌ Unknown category.', flags: 64 });

      const embed = new EmbedBuilder()
        .setTitle(cat.name)
        .setColor(cat.color)
        .setDescription(`**Permission:** ${cat.role}\n\u200b`)
        .addFields(cat.commands.map(c => ({ name: c.cmd, value: c.desc, inline: false })))
        .setFooter({ text: 'Use /help to see all categories' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });
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
          '🔒 Government+ — requires Government role or higher\n' +
          '🔒 Admin only — requires Discord Administrator\n\n' +
          '💡 Names, IDs, and P&W links all work in any field asking for a nation or alliance.\n' +
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
        .setTitle('🤖 Automatic Background Features')
        .setColor(0x1abc9c)
        .setDescription(AUTOMATIC_FEATURES.join('\n'))
        .setFooter({ text: 'These run automatically — no commands needed' }),
    ];

    return interaction.reply({ embeds, flags: 64 });
  },
};
