const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const express = require('express');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const fs = require('fs');

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
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - 86400000);
  return d.toISOString().slice(0, 10);
}
function levelFromXp(xp) {
  return Math.floor(xp / 100) + 1;
}
function nextLevelXp(level) {
  return (level - 1) * 100 + 100;
}
function getMember(guildId, userId, username) {
  let row = db.prepare('SELECT * FROM members WHERE guild_id=? AND user_id=?').get(guildId, userId);
  if (!row) {
    db.prepare('INSERT INTO members (guild_id,user_id,username) VALUES (?,?,?)')
      .run(guildId, userId, username);
    row = db.prepare('SELECT * FROM members WHERE guild_id=? AND user_id=?').get(guildId, userId);
  }
  if (row.username !== username) {
    db.prepare('UPDATE members SET username=? WHERE guild_id=? AND user_id=?')
      .run(username, guildId, userId);
    row.username = username;
  }
  return row;
}

async function makeCard({ username, streak, total, level, xpInLevel, xpNeeded, points, rewardXp, rewardPoints }) {
  const pct = Math.max(0, Math.min(1, xpInLevel / xpNeeded));
  const W = 1400, H = 780;
  const safe = String(username).replace(/[<>&"]/g, '');
  const svg = `
  <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#08090b"/><stop offset="0.55" stop-color="#151619"/><stop offset="1" stop-color="#050506"/>
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ff3b16"/><stop offset="1" stop-color="#ff7a18"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <path d="M0 95 L1400 0 L1400 45 L0 145Z" fill="#111216"/>
    <path d="M0 735 L1400 650 L1400 700 L0 780Z" fill="#111216"/>
    <g opacity=".18" stroke="#ff4b20" stroke-width="2">
      <path d="M40 190L280 40M80 250L340 20M1120 760L1390 500M1180 780L1400 590"/>
    </g>
    <text x="700" y="82" text-anchor="middle" fill="#fff" font-family="${FONT}" font-size="56" font-weight="900" letter-spacing="8">ORI</text>
    <text x="700" y="118" text-anchor="middle" fill="#d9d9d9" font-family="${FONT}" font-size="18" letter-spacing="7">TEAM ORI  •  ATTENDANCE</text>

    <rect x="55" y="160" width="430" height="465" rx="20" fill="#0c0d0f" stroke="#ff4b20" stroke-width="3"/>
    <circle cx="270" cy="335" r="132" fill="#050506" stroke="#ff4b20" stroke-width="5"/>
    <text x="270" y="350" text-anchor="middle" fill="#fff" font-family="${FONT}" font-size="92" font-weight="900" font-style="italic">ORI</text>
    <text x="270" y="455" text-anchor="middle" fill="#fff" font-family="${FONT}" font-size="30" font-weight="700">${safe}</text>
    <text x="270" y="492" text-anchor="middle" fill="#ff5a22" font-family="${FONT}" font-size="17" letter-spacing="5">TEAM ORI</text>
    <text x="270" y="566" text-anchor="middle" fill="#999" font-family="${FONT}" font-size="16">TODAY'S ATTENDANCE COMPLETE</text>

    ${panel(520,160,410,150,'ST','연속 출석',String(streak)+'일')}
    ${panel(950,160,395,150,'ALL','총 출석 횟수',String(total)+'회')}
    ${panel(520,330,410,150,'LV','현재 레벨','LV. '+String(level))}
    ${panel(950,330,395,150,'XP','현재 XP',String(xpInLevel)+' / '+String(xpNeeded)+' XP')}
    ${panel(520,500,825,125,'P','보유 포인트',String(points.toLocaleString())+' P')}

    <rect x="55" y="650" width="1290" height="62" rx="15" fill="#0c0d0f" stroke="#33353a"/>
    <text x="80" y="688" fill="#ddd" font-family="${FONT}" font-size="20">현재 XP</text>
    <rect x="220" y="670" width="660" height="24" rx="12" fill="#222428"/>
    <rect x="220" y="670" width="${660*pct}" height="24" rx="12" fill="url(#accent)"/>
    <text x="900" y="689" fill="#ff6a2b" font-family="${FONT}" font-size="20" font-weight="700">출석 보상  +${rewardXp} XP  ·  +${rewardPoints.toLocaleString()} P</text>
    <text x="700" y="748" text-anchor="middle" fill="#aaa" font-family="${FONT}" font-size="17" letter-spacing="3">내일도 출석하고 연속 보너스를 이어가세요!  •  BATTLEGROUNDS CLAN</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function panel(x,y,w,h,icon,title,value) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#0d0e10" stroke="#33353a" stroke-width="2"/>
  <text x="${x+28}" y="${y+54}" fill="#ff5a22" font-family="${FONT}" font-size="28" font-weight="900">${icon}</text>
  <text x="${x+82}" y="${y+48}" fill="#bbb" font-family="${FONT}" font-size="19">${title}</text>
  <text x="${x+82}" y="${y+93}" fill="#fff" font-family="${FONT}" font-size="31" font-weight="800">${value}</text>`;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName('출석').setDescription('TEAM ORI 출석체크를 합니다.'),
  new SlashCommandBuilder().setName('내정보').setDescription('내 출석/XP/포인트 정보를 확인합니다.')
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Guild slash commands registered.');
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Global slash commands registered.');
  }
}

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const username = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const guildId = interaction.guildId;
  if (!guildId) return interaction.reply({ content: '서버에서만 사용할 수 있어요!', ephemeral: true });

  const row = getMember(guildId, interaction.user.id, username);

  if (interaction.commandName === '출석') {
    const today = todayKST();
    if (row.last_date === today) {
      return interaction.reply({ content: `**${username}님은 오늘 이미 출석했어요!**\n연속 출석: ${row.streak}일 · 총 출석: ${row.total_attendance}회`, ephemeral: true });
    }

    const streak = row.last_date === yesterdayKST() ? row.streak + 1 : 1;
    const rewardXp = 100 + Math.min(streak * 10, 150);
    const rewardPoints = 500 + Math.min(streak * 50, 1000);
    const total = row.total_attendance + 1;
    const xp = row.xp + rewardXp;
    const points = row.points + rewardPoints;
    db.prepare(`UPDATE members SET total_attendance=?, streak=?, xp=?, points=?, last_date=? WHERE guild_id=? AND user_id=?`)
      .run(total, streak, xp, points, today, guildId, interaction.user.id);

    const level = levelFromXp(xp);
    const levelBase = (level - 1) * 100;
    const xpInLevel = xp - levelBase;
    const xpNeeded = 100;
    const image = await makeCard({ username, streak, total, level, xpInLevel, xpNeeded, points, rewardXp, rewardPoints });
    const attachment = new AttachmentBuilder(image, { name: 'ori-attendance.png' });

    const embed = new EmbedBuilder()
      .setColor(0xff4b20)
      .setTitle('TEAM ORI 출석 완료!')
      .setDescription(`**${username}님, 오늘도 출석 완료!**\n연속 출석 **${streak}일**`)
      .setImage('attachment://ori-attendance.png')
      .setFooter({ text: 'TEAM ORI • BATTLEGROUNDS CLAN' });

    return interaction.reply({ embeds: [embed], files: [attachment] });
  }

  if (interaction.commandName === '내정보') {
    const level = levelFromXp(row.xp);
    const base = (level - 1) * 100;
    const xpInLevel = row.xp - base;
    const embed = new EmbedBuilder()
      .setColor(0xff4b20)
      .setTitle(`${username}님의 TEAM ORI 정보`)
      .addFields(
        { name: '연속 출석', value: `${row.streak}일`, inline: true },
        { name: '총 출석', value: `${row.total_attendance}회`, inline: true },
        { name: '레벨', value: `LV. ${level}`, inline: true },
        { name: 'XP', value: `${xpInLevel} / 100 XP`, inline: true },
        { name: '포인트', value: `${row.points.toLocaleString()} P`, inline: true }
      );
    return interaction.reply({ embeds: [embed] });
  }
});

registerCommands().catch(console.error);
client.login(TOKEN);

// Tiny HTTP server so the process has a health endpoint if deployed as a Web Service.
const app = express();
app.get('/', (_req,res) => res.send('TEAM ORI bot is running.'));
app.listen(PORT, () => console.log(`Health server listening on ${PORT}`));
