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

process.env.FONTCONFIG_PATH = __dirname;
process.env.FONTCONFIG_FILE = path.join(__dirname, 'fonts.conf');

const sharp = require('sharp');

const FONT = 'Noto Sans CJK KR, Noto Sans, sans-serif';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID environment variable.');
  process.exit(1);
}

const dbPath = process.env.DB_PATH || './ori.sqlite';
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    total_attendance INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    last_date TEXT,
    PRIMARY KEY (guild_id, user_id)
  );
`);

function todayKST() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function yesterdayKST() {
  const d = new Date(
    Date.now() + 9 * 60 * 60 * 1000 - 86400000
  );
  return d.toISOString().slice(0, 10);
}

function levelFromXp(xp) {
  return Math.floor(xp / 100) + 1;
}

function getMember(guildId, userId, username) {
  let row = db
    .prepare('SELECT * FROM members WHERE guild_id=? AND user_id=?')
    .get(guildId, userId);

  if (!row) {
    db.prepare(
      'INSERT INTO members (guild_id,user_id,username) VALUES (?,?,?)'
    ).run(guildId, userId, username);

    row = db
      .prepare('SELECT * FROM members WHERE guild_id=? AND user_id=?')
      .get(guildId, userId);
  }

  if (row.username !== username) {
    db.prepare(
      'UPDATE members SET username=? WHERE guild_id=? AND user_id=?'
    ).run(username, guildId, userId);

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


function icon(kind, x, y) {
  const common = `stroke="#ff541f" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"`;

  if (kind === 'calendar') {
    return `
      <g transform="translate(${x} ${y})">
        <rect x="0" y="7" width="42" height="36" rx="5" ${common}/>
        <path d="M10 0v14M32 0v14M0 18h42" ${common}/>
        <path d="M11 27h5M21 27h5M31 27h5M11 36h5M21 36h5" ${common}/>
      </g>`;
  }

  if (kind === 'people') {
    return `
      <g transform="translate(${x} ${y})" ${common}>
        <circle cx="21" cy="12" r="8"/>
        <path d="M7 40c1-10 7-15 14-15s13 5 14 15"/>
        <circle cx="40" cy="15" r="6"/>
        <path d="M34 39c1-7 5-11 11-11"/>
      </g>`;
  }

  if (kind === 'level') {
    return `
      <g transform="translate(${x} ${y})" fill="#ff541f">
        <rect x="2" y="27" width="8" height="16" rx="2"/>
        <rect x="15" y="18" width="8" height="25" rx="2"/>
        <rect x="28" y="7" width="8" height="36" rx="2"/>
      </g>`;
  }

  if (kind === 'xp') {
    return `
      <g transform="translate(${x} ${y})">
        <rect x="0" y="0" width="44" height="44" rx="9" fill="#ff541f"/>
        <text x="22" y="29" text-anchor="middle" fill="#08090b"
          font-family="${FONT}" font-size="18" font-weight="900">XP</text>
      </g>`;
  }

  return `
    <g transform="translate(${x} ${y})" fill="#ff541f">
      <ellipse cx="22" cy="10" rx="16" ry="7"/>
      <path d="M6 10v10c0 4 7 7 16 7s16-3 16-7V10c0 4-7 7-16 7S6 14 6 10z"/>
      <path d="M6 21v10c0 4 7 7 16 7s16-3 16-7V21c0 4-7 7-16 7S6 25 6 21z"/>
    </g>`;
}

function statPanel(x, y, w, h, kind, title, value) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16"
      fill="#0b0c0e" stroke="#303238" stroke-width="2"/>
    <path d="M${x + w - 78} ${y + h - 28} L${x + w - 28} ${y + h - 78}"
      stroke="#ff541f" stroke-width="2" opacity=".7"/>
    ${icon(kind, x + 28, y + 42)}
    <text x="${x + 90}" y="${y + 53}" fill="#b9bcc1"
      font-family="${FONT}" font-size="19">${esc(title)}</text>
    <text x="${x + 90}" y="${y + 102}" fill="#fff"
      font-family="${FONT}" font-size="34" font-weight="900">${esc(value)}</text>`;
}
async function makeCard({
  username,
  streak,
  total,
  level,
  xpInLevel,
  xpNeeded,
  points,
  rewardXp,
  rewardPoints
}) {
  const pct = Math.max(0, Math.min(1, xpInLevel / xpNeeded));
  const W = 1500;
  const H = 900;
  const safe = esc(username);

  const svg = `
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
       xmlns="http://www.w3.org/2000/svg">

    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#050608"/>
        <stop offset=".5" stop-color="#111316"/>
        <stop offset="1" stop-color="#030405"/>
      </linearGradient>

      <linearGradient id="orange" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ff3f16"/>
        <stop offset="1" stop-color="#ff7a1a"/>
      </linearGradient>

      <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#121417"/>
        <stop offset="1" stop-color="#08090b"/>
      </linearGradient>

      <filter id="glow">
        <feGaussianBlur stdDeviation="7" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>

    <rect width="${W}" height="${H}" fill="url(#bg)"/>

    <g opacity=".16" stroke="#ff4d1b" stroke-width="2">
      <path d="M0 145L210 0"/>
      <path d="M0 205L300 0"/>
      <path d="M1190 900L1500 600"/>
      <path d="M1280 900L1500 690"/>
    </g>

    <g opacity=".12" stroke="#fff" stroke-width="1">
      <path d="M20 760L520 300"/>
      <path d="M960 870L1450 410"/>
      <path d="M1050 110L1460 0"/>
    </g>

    <!-- TEAM ORI LOGO -->
    <text x="80" y="100" fill="#fff"
      font-family="${FONT}" font-size="72"
      font-weight="900" font-style="italic"
      letter-spacing="-5">ORI</text>

    <path d="M245 46l38-38-15 42-34 26z"
      fill="#ff4b18"/>

    <path d="M82 116h50M205 116h62"
      stroke="#fff" stroke-width="2" opacity=".8"/>

    <text x="145" y="119" text-anchor="middle"
      fill="#d8d8d8" font-family="${FONT}"
      font-size="15" letter-spacing="6">TEAM ORI</text>

    <text x="1420" y="62" text-anchor="end"
      fill="#777b81" font-family="${FONT}"
      font-size="15" letter-spacing="4">MORE</text>

    <text x="1420" y="86" text-anchor="end"
      fill="#777b81" font-family="${FONT}"
      font-size="15" letter-spacing="4">PLAY</text>

    <text x="1420" y="110" text-anchor="end"
      fill="#777b81" font-family="${FONT}"
      font-size="15" letter-spacing="4">TOGETHER</text>

    <path d="M1380 45h35"
      stroke="#ff541f" stroke-width="2"/>

    <text x="1420" y="145" text-anchor="end"
      fill="#666a70" font-family="${FONT}"
      font-size="12" letter-spacing="3">
      BATTLEGROUNDS • DISCORD CLAN
    </text>

    <!-- MAIN CONTAINER -->
    <rect x="55" y="175" width="1390" height="655"
      rx="28" fill="url(#panel)"
      stroke="#26292d" stroke-width="2"/>

    <!-- PLAYER CARD -->
    <rect x="82" y="205" width="435" height="535"
      rx="22" fill="#08090b"
      stroke="#ff541f" stroke-width="3"/>

    <path d="M105 226L200 205M105 715L205 740
             M494 226L520 252M494 715L520 690"
      stroke="#ff541f" stroke-width="3"/>

    <!-- HELMET -->
    <g transform="translate(132 245)">
      <path d="M70 155C65 85 108 35 175 32
               C240 29 286 74 290 143L269 175
               C243 187 204 194 153 190
               L104 176Z"
        fill="#16191d" stroke="#ff541f" stroke-width="3"/>

      <path d="M92 104C105 65 138 48 179 48
               C220 48 251 69 263 105L242 120
               C214 112 169 109 124 123Z"
        fill="#24282d"/>

      <path d="M116 124L250 124L270 153
               L246 171L128 168L103 149Z"
        fill="#0a0b0d" stroke="#3a3d42" stroke-width="2"/>

      <path d="M116 139L246 139"
        stroke="#ff541f" stroke-width="3" opacity=".8"/>

      <path d="M153 32L145 12M202 35L213 14M248 56L270 34"
        stroke="#575b61" stroke-width="8"
        stroke-linecap="round"/>

      <path d="M69 154L36 170L53 199L105 177"
        fill="#101216"/>

      <path d="M269 174L302 193L285 218L241 180"
        fill="#101216"/>
    </g>

    <!-- ORI -->
    <text x="300" y="510" text-anchor="middle"
      fill="#fff" font-family="${FONT}"
      font-size="88" font-weight="900"
      font-style="italic"
      letter-spacing="-6">ORI</text>

    <path d="M345 451l40-38-16 43-35 26z"
      fill="#ff4b18"/>

    <path d="M210 530h70M330 530h70"
      stroke="#fff" stroke-width="2" opacity=".8"/>

    <text x="300" y="535" text-anchor="middle"
      fill="#d8d8d8" font-family="${FONT}"
      font-size="14" letter-spacing="6">TEAM ORI</text>

    <text x="300" y="602" text-anchor="middle"
      fill="#fff" font-family="${FONT}"
      font-size="28" font-weight="800">${safe}</text>

    <text x="300" y="635" text-anchor="middle"
      fill="#777b81" font-family="${FONT}"
      font-size="13" letter-spacing="4">
      TEAM ORI DISCORD CLAN
    </text>

    <text x="300" y="691" text-anchor="middle"
      fill="#ff5a22" font-family="${FONT}"
      font-size="25" font-style="italic">
      Play Together
    </text>

    <!-- ATTENDANCE TITLE -->
    <text x="565" y="245"
      fill="#f1f1f1" font-family="${FONT}"
      font-size="42" font-weight="900"
      letter-spacing="6">ATTENDANCE</text>

    <text x="1410" y="242" text-anchor="end"
      fill="#8b8e93" font-family="${FONT}"
      font-size="16">오늘도 함께, 더 멀리.</text>

    <path d="M1360 210h35"
      stroke="#ff541f" stroke-width="3"/>

    ${statPanel(565, 275, 400, 145,
      'calendar', '연속 출석', `${streak}일`)}

    ${statPanel(990, 275, 400, 145,
      'people', '총 출석 횟수', `${total}회`)}

    ${statPanel(565, 440, 400, 145,
      'level', '현재 레벨', `LV. ${level}`)}

    ${statPanel(990, 440, 400, 145,
      'xp', '현재 XP', `${xpInLevel} / ${xpNeeded} XP`)}

    <!-- POINTS -->
    <rect x="565" y="605" width="825" height="92"
      rx="16" fill="#0b0c0e"
      stroke="#303238" stroke-width="2"/>

    ${icon('points', 595, 627)}

    <text x="675" y="640"
      fill="#b9bcc1" font-family="${FONT}"
      font-size="18">보유 포인트</text>

    <text x="675" y="678"
      fill="#fff" font-family="${FONT}"
      font-size="32" font-weight="900">
      ${points.toLocaleString()} P
    </text>

    <!-- XP -->
    <text x="565" y="748"
      fill="#aeb1b6" font-family="${FONT}"
      font-size="17">현재 XP</text>

    <text x="1390" y="748" text-anchor="end"
      fill="#ff5a22" font-family="${FONT}"
      font-size="18" font-weight="800">
      출석 보상 +${rewardXp} XP · +${rewardPoints.toLocaleString()} P
    </text>

    <rect x="565" y="765" width="825" height="18"
      rx="9" fill="#24272b"/>

    <rect x="565" y="765"
      width="${825 * pct}" height="18"
      rx="9" fill="url(#orange)" filter="url(#glow)"/>

    <text x="1390" y="803"
      text-anchor="end" fill="#8e9298"
      font-family="${FONT}" font-size="14">
      ${xpInLevel} / ${xpNeeded} XP
    </text>

    <!-- FOOTER -->
    <text x="750" y="865"
      text-anchor="middle" fill="#8d9196"
      font-family="${FONT}" font-size="15"
      letter-spacing="4">
      게임을 넘어, 하나의 팀으로 —
      <tspan fill="#ff541f"> TEAM ORI</tspan>
    </text>

    <text x="82" y="865"
      fill="#555960" font-family="${FONT}"
      font-size="11" letter-spacing="3">
      BATTLEGROUNDS DISCORD CLAN
    </text>

  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
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
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    console.log('슬래시 명령어 등록 중...');

    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands.map(command => command.toJSON()) }
      );
    } else {
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands.map(command => command.toJSON()) }
      );
    }

    console.log('슬래시 명령어 등록 완료!');
  } catch (error) {
    console.error('명령어 등록 실패:', error);
  }
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

    const member = getMember(guildId, userId, username);

    if (member.last_date === today) {
      const level = levelFromXp(member.xp);
      const xpNeeded = 100;
      const xpInLevel = member.xp % 100;

      const image = await makeCard({
        username,
        streak: member.streak,
        total: member.total_attendance,
        level,
        xpInLevel,
        xpNeeded,
        points: member.points,
        rewardXp: 0,
        rewardPoints: 0
      });

      const attachment = new AttachmentBuilder(image, {
        name: 'team-ori-attendance.png'
      });

      const embed = new EmbedBuilder()
        .setColor(0xff541f)
        .setTitle('🦆 TEAM ORI 출석체크')
        .setDescription(
          `**${username}**님은 오늘 이미 출석했어요!`
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
    const rewardPoints = 550;

    const newTotal = member.total_attendance + 1;
    const newXp = member.xp + rewardXp;
    const newPoints = member.points + rewardPoints;

    db.prepare(`
      UPDATE members
      SET total_attendance=?,
          streak=?,
          xp=?,
          points=?,
          last_date=?,
          username=?
      WHERE guild_id=? AND user_id=?
    `).run(
      newTotal,
      newStreak,
      newXp,
      newPoints,
      today,
      username,
      guildId,
      userId
    );

    const level = levelFromXp(newXp);
    const xpNeeded = 100;
    const xpInLevel = newXp % 100;

    const image = await makeCard({
      username,
      streak: newStreak,
      total: newTotal,
      level,
      xpInLevel,
      xpNeeded,
      points: newPoints,
      rewardXp,
      rewardPoints
    });

    const attachment = new AttachmentBuilder(image, {
      name: 'team-ori-attendance.png'
    });

    const embed = new EmbedBuilder()
      .setColor(0xff541f)
      .setTitle('🦆 TEAM ORI 출석체크 완료!')
      .setDescription(
        `**${username}**님 출석 완료!\n\n` +
        `🔥 연속 출석 **${newStreak}일**\n` +
        `✨ +${rewardXp} XP\n` +
        `🪙 +${rewardPoints} P`
      )
      .setImage('attachment://team-ori-attendance.png');

    await interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });
  }

  if (interaction.commandName === '내정보') {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const username =
      interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username;

    const member = getMember(guildId, userId, username);

    const level = levelFromXp(member.xp);
    const xpInLevel = member.xp % 100;

    const embed = new EmbedBuilder()
      .setColor(0xff541f)
      .setTitle('🦆 TEAM ORI 내 정보')
      .setDescription(
        `**${username}**님의 TEAM ORI 정보입니다.`
      )
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
          name: '🏆 레벨',
          value: `LV. ${level}`,
          inline: true
        },
        {
          name: '✨ XP',
          value: `${xpInLevel} / 100 XP`,
          inline: true
        },
        {
          name: '🪙 포인트',
          value: `${member.points.toLocaleString()} P`,
          inline: true
        }
      );

    await interaction.reply({ embeds: [embed] });
  }
});

const app = express();

app.get('/', (req, res) => {
  res.send('TEAM ORI BOT ONLINE');
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
