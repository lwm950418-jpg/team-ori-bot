const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder
} = require('discord.js');

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

process.env.FONTCONFIG_PATH = __dirname;
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts.conf');

const sharp = require('sharp');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 10000;

const FONT = 'Noto Sans CJK KR, Noto Sans, sans-serif';
const ORANGE = '#ff541f';
const BG = '#080a0d';

const db = new Database(process.env.DB_PATH || 'attendance.db');

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  last_date TEXT DEFAULT '',
  streak INTEGER DEFAULT 0,
  total_attendance INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
)
`);

function todayKST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul'
  }).format(new Date());
}

function yesterdayKST() {
  const d = new Date();
  d.setDate(d.getDate() - 1);

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul'
  }).format(d);
}

function levelFromXp(xp) {
  return Math.floor(xp / 100) + 1;
}

function getMember(guildId, userId, username) {
  let row = db.prepare(`
    SELECT * FROM members
    WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId);

  if (!row) {
    db.prepare(`
      INSERT INTO members
      (guild_id, user_id, username)
      VALUES (?, ?, ?)
    `).run(guildId, userId, username);

    row = db.prepare(`
      SELECT * FROM members
      WHERE guild_id = ? AND user_id = ?
    `).get(guildId, userId);
  }

  if (row.username !== username) {
    db.prepare(`
      UPDATE members
      SET username = ?
      WHERE guild_id = ? AND user_id = ?
    `).run(username, guildId, userId);

    row.username = username;
  }

  return row;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function makeCard({
  username,
  streak,
  total,
  level,
  xpInLevel,
  points,
  rewardXp,
  rewardPoints
}) {
  const W = 1500;
  const H = 900;

  const pct = Math.max(0, Math.min(1, xpInLevel / 100));

  const logoPath = path.join(__dirname, '오리.jpg');

  let logoData = '';

  if (fs.existsSync(logoPath)) {
    logoData = fs.readFileSync(logoPath).toString('base64');
  }

  const safeName = esc(username);

  const svg = `
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
       xmlns="http://www.w3.org/2000/svg">

    <defs>

      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#050608"/>
        <stop offset="0.55" stop-color="#111316"/>
        <stop offset="1" stop-color="#030405"/>
      </linearGradient>

      <linearGradient id="orange" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ff3212"/>
        <stop offset="1" stop-color="#ff7a1a"/>
      </linearGradient>

      <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#15181c"/>
        <stop offset="1" stop-color="#0b0d10"/>
      </linearGradient>

      <filter id="glow">
        <feGaussianBlur stdDeviation="10"/>
      </filter>

    </defs>

    <!-- BACKGROUND -->
    <rect width="${W}" height="${H}" fill="url(#bg)"/>

    <!-- ORANGE EDGE -->
    <path d="M0 0 L55 0 L55 900 L0 900 Z"
          fill="url(#orange)"/>

    <path d="M55 0 L1500 0"
          stroke="#25282d"
          stroke-width="2"/>

    <!-- TOP BRAND -->
    ${
      logoData
        ? `<image
            href="data:image/jpeg;base64,${logoData}"
            x="85"
            y="55"
            width="330"
            height="180"
            preserveAspectRatio="xMidYMid meet"
          />`
        : `
          <text x="90" y="130"
                fill="#ffffff"
                font-family="${FONT}"
                font-size="76"
                font-weight="900">ORI</text>

          <text x="93" y="168"
                fill="#777"
                font-family="${FONT}"
                font-size="15"
                letter-spacing="7">TEAM ORI</text>
        `
    }

    <!-- TITLE -->
    <text x="500" y="105"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="48"
          font-weight="900"
          letter-spacing="3">
      ATTENDANCE
    </text>

    <text x="503" y="145"
          fill="#777"
          font-family="${FONT}"
          font-size="17"
          letter-spacing="5">
      TEAM ORI MEMBER SYSTEM
    </text>

    <!-- USER CARD -->
    <rect x="85" y="275"
          width="330" height="385"
          rx="18"
          fill="url(#card)"
          stroke="#34383d"
          stroke-width="2"/>

    <rect x="85" y="275"
          width="330" height="5"
          rx="2"
          fill="${ORANGE}"/>

    <circle cx="250" cy="390"
            r="82"
            fill="#080a0d"
            stroke="${ORANGE}"
            stroke-width="3"/>

    <circle cx="250" cy="390"
            r="69"
            fill="none"
            stroke="#30343a"
            stroke-width="2"/>

    <text x="250" y="408"
          text-anchor="middle"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="44"
          font-weight="900">
      ORI
    </text>

    <text x="250" y="505"
          text-anchor="middle"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="27"
          font-weight="700">
      ${safeName}
    </text>

    <text x="250" y="540"
          text-anchor="middle"
          fill="#777"
          font-family="${FONT}"
          font-size="15"
          letter-spacing="3">
      TEAM ORI MEMBER
    </text>

    <line x1="145" y1="570"
          x2="355" y2="570"
          stroke="#30343a"
          stroke-width="2"/>

    <text x="250" y="610"
          text-anchor="middle"
          fill="${ORANGE}"
          font-family="${FONT}"
          font-size="17"
          font-weight="700"
          letter-spacing="3">
      ACTIVE MEMBER
    </text>

    <!-- STAT AREA -->

    <rect x="475" y="190"
          width="450" height="175"
          rx="16"
          fill="url(#card)"
          stroke="#292d32"
          stroke-width="2"/>

    <rect x="950" y="190"
          width="450" height="175"
          rx="16"
          fill="url(#card)"
          stroke="#292d32"
          stroke-width="2"/>

    <rect x="475" y="390"
          width="450" height="175"
          rx="16"
          fill="url(#card)"
          stroke="#292d32"
          stroke-width="2"/>

    <rect x="950" y="390"
          width="450" height="175"
          rx="16"
          fill="url(#card)"
          stroke="#292d32"
          stroke-width="2"/>

    <rect x="475" y="590"
          width="925" height="110"
          rx="16"
          fill="url(#card)"
          stroke="#292d32"
          stroke-width="2"/>

    <!-- STAT 1 -->
    <rect x="505" y="220"
          width="7" height="105"
          rx="3"
          fill="${ORANGE}"/>

    <text x="540" y="250"
          fill="#777"
          font-family="${FONT}"
          font-size="17"
          letter-spacing="3">
      CONSECUTIVE
    </text>

    <text x="540" y="305"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="44"
          font-weight="900">
      ${streak}
    </text>

    <text x="630" y="305"
          fill="${ORANGE}"
          font-family="${FONT}"
          font-size="22"
          font-weight="700">
      DAYS
    </text>

    <!-- STAT 2 -->
    <rect x="980" y="220"
          width="7" height="105"
          rx="3"
          fill="${ORANGE}"/>

    <text x="1015" y="250"
          fill="#777"
          font-family="${FONT}"
          font-size="17"
          letter-spacing="3">
      TOTAL ATTENDANCE
    </text>

    <text x="1015" y="305"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="44"
          font-weight="900">
      ${total}
    </text>

    <text x="1110" y="305"
          fill="${ORANGE}"
          font-family="${FONT}"
          font-size="22"
          font-weight="700">
      TIMES
    </text>

    <!-- STAT 3 -->
    <rect x="505" y="420"
          width="7" height="105"
          rx="3"
          fill="${ORANGE}"/>

    <text x="540" y="450"
          fill="#777"
          font-family="${FONT}"
          font-size="17"
          letter-spacing="3">
      CURRENT LEVEL
    </text>

    <text x="540" y="505"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="44"
          font-weight="900">
      LV. ${level}
    </text>

    <!-- STAT 4 -->
    <rect x="980" y="420"
          width="7" height="105"
          rx="3"
          fill="${ORANGE}"/>

    <text x="1015" y="450"
          fill="#777"
          font-family="${FONT}"
          font-size="17"
          letter-spacing="3">
      POINTS
    </text>

    <text x="1015" y="505"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="44"
          font-weight="900">
      ${points}
    </text>

    <text x="1170" y="505"
          fill="${ORANGE}"
          font-family="${FONT}"
          font-size="22"
          font-weight="700">
      P
    </text>

    <!-- XP BAR -->
    <text x="510" y="625"
          fill="#777"
          font-family="${FONT}"
          font-size="16"
          letter-spacing="3">
      EXPERIENCE
    </text>

    <text x="1365" y="625"
          text-anchor="end"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="17"
          font-weight="700">
      ${xpInLevel} / 100 XP
    </text>

    <rect x="510" y="650"
          width="825" height="18"
          rx="9"
          fill="#24282d"/>

    <rect x="510" y="650"
          width="${825 * pct}" height="18"
          rx="9"
          fill="url(#orange)"/>

    <!-- REWARD -->
    <text x="85" y="745"
          fill="#777"
          font-family="${FONT}"
          font-size="15"
          letter-spacing="4">
      TODAY'S REWARD
    </text>

    <text x="85" y="795"
          fill="#ffffff"
          font-family="${FONT}"
          font-size="27"
          font-weight="700">
      +${rewardXp} XP
    </text>

    <text x="285" y="795"
          fill="${ORANGE}"
          font-family="${FONT}"
          font-size="27"
          font-weight="700">
      +${rewardPoints} P
    </text>

    <!-- FOOTER -->
    <line x1="85" y1="825"
          x2="1415" y2="825"
          stroke="#292d32"
          stroke-width="2"/>

    <text x="85" y="860"
          fill="#777"
          font-family="${FONT}"
          font-size="15"
          letter-spacing="5">
      STAY TOGETHER, GO FURTHER
    </text>

    <text x="1415" y="860"
          text-anchor="end"
          fill="#555"
          font-family="${FONT}"
          font-size="13"
          letter-spacing="4">
      TEAM ORI / DISCORD CLAN
    </text>

  </svg>
  `;

  return sharp(Buffer.from(svg))
    .png()
    .toBuffer();
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('출석')
    .setDescription('TEAM ORI 출석체크'),

  new SlashCommandBuilder()
    .setName('내정보')
    .setDescription('내 출석 및 XP 정보를 확인합니다.')
].map(command => command.toJSON());

const rest = new REST({ version: '10' })
  .setToken(TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('TEAM ORI 슬래시 명령어 등록 완료');
}

client.once('ready', () => {
  console.log(`TEAM ORI 봇 로그인 완료: ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === '출석') {

    await interaction.deferReply();

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    const username =
      interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username;

    const today = todayKST();
    const yesterday = yesterdayKST();

    const member = getMember(
      guildId,
      userId,
      username
    );

    if (member.last_date === today) {

      const level = levelFromXp(member.xp);
      const xpInLevel = member.xp % 100;

      const image = await makeCard({
        username,
        streak: member.streak,
        total: member.total_attendance,
        level,
        xpInLevel,
        points: member.points,
        rewardXp: 0,
        rewardPoints: 0
      });

      const attachment =
        new AttachmentBuilder(image, {
          name: 'team-ori-attendance.png'
        });

      const embed =
        new EmbedBuilder()
          .setColor(ORANGE)
          .setTitle('🦆 TEAM ORI 출석체크')
          .setDescription(
            `**${username}**님은 오늘 이미 출석했어요!\n\n` +
            `연속 출석: **${member.streak}일** · ` +
            `총 출석: **${member.total_attendance}회**`
          )
          .setImage('attachment://team-ori-attendance.png');

      return interaction.editReply({
        embeds: [embed],
        files: [attachment]
      });
    }

    const newStreak =
      member.last_date === yesterday
        ? member.streak + 1
        : 1;

    const rewardXp = 10;
    const rewardPoints = 50;

    const newTotal =
      member.total_attendance + 1;

    const newXp =
      member.xp + rewardXp;

    const newPoints =
      member.points + rewardPoints;

    db.prepare(`
      UPDATE members
      SET
        last_date = ?,
        streak = ?,
        total_attendance = ?,
        xp = ?,
        points = ?
      WHERE guild_id = ?
        AND user_id = ?
    `).run(
      today,
      newStreak,
      newTotal,
      newXp,
      newPoints,
      guildId,
      userId
    );

    const level = levelFromXp(newXp);
    const xpInLevel = newXp % 100;

    const image = await makeCard({
      username,
      streak: newStreak,
      total: newTotal,
      level,
      xpInLevel,
      points: newPoints,
      rewardXp,
      rewardPoints
    });

    const attachment =
      new AttachmentBuilder(image, {
        name: 'team-ori-attendance.png'
      });

    const embed =
      new EmbedBuilder()
        .setColor(ORANGE)
        .setTitle('🦆 TEAM ORI 출석체크 완료!')
        .setDescription(
          `**${username}**님 출석 완료!\n\n` +
          `🔥 연속 출석 **${newStreak}일**\n` +
          `✨ +${rewardXp} XP\n` +
          `🪙 +${rewardPoints} P`
        )
        .setImage('attachment://team-ori-attendance.png');

    return interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });
  }

  if (interaction.commandName === '내정보') {

    const member = getMember(
      interaction.guildId,
      interaction.user.id,
      interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username
    );

    const level = levelFromXp(member.xp);
    const xpInLevel = member.xp % 100;

    const embed =
      new EmbedBuilder()
        .setColor(ORANGE)
        .setTitle('🦆 TEAM ORI 내 정보')
        .addFields(
          {
            name: '🔥 연속 출석',
            value: `${member.streak}일`,
            inline: true
          },
          {
            name: '📅 총 출석',
            value: `${member.total_attendance}회`,
            inline: true
          },
          {
            name: '⭐ 레벨',
            value: `LV. ${level}`,
            inline: true
          },
          {
            name: '✨ XP',
            value: `${xpInLevel} / 100`,
            inline: true
          },
          {
            name: '🪙 포인트',
            value: `${member.points} P`,
            inline: true
          }
        );

    return interaction.reply({
      embeds: [embed]
    });
  }
});

const app = express();

app.get('/', (req, res) => {
  res.send('TEAM ORI BOT ONLINE');
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

(async () => {
  try {
    await registerCommands();
    await client.login(TOKEN);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
