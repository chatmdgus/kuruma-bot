require("dotenv").config();
const fs = require("fs");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const tts = require("./tts");

// ===== 이름 사전 =====
const NAME_PAIRS = [
  ["주연", ["ジュヨン", "チュヨン"]],
  ["소연", ["ソヨン"]],
  ["언형", ["オンヒョン", "アンヒョン"]],
  ["햄찌", ["ハムチ", "ヘムチ", "ハムッチ", "ヘムジ", "HAMZZI"]],
  ["츈츈", ["チュンチュン", "Chunchun"]],
  ["닛타", ["ニッタ", "にった", "新田"]],
  ["유이", ["ユイ", "ゆい", "結衣"]],
  ["포치", ["ポチ", "ぽち"]],
  ["류아", ["リュア", "りゅあ"]],
  ["조랭", ["チョレン", "ジョレン", "チョレング"]],
  ["곰", ["コム"]],
  ["세나", ["セナ", "せな", "瀬名"]],
  ["서현", ["ソヒョン"]],
];
const NAME_MAP = {};
for (const [ko, jaList] of NAME_PAIRS) {
  NAME_MAP[ko] = jaList[0];
  for (const ja of jaList) NAME_MAP[ja] = ko;
}
const NAME_KEYS = Object.keys(NAME_MAP).sort((a, b) => b.length - a.length);

// ===== 게임 사전 =====
const GAME_DB = [
  { name: "발로란트", url: "https://playvalorant.com/ja-jp/", image: "",
    aliases: ["발로란트", "발로", "valorant", "valo", "ヴァロラント", "ヴァロ", "バロ"] },
  { name: "리그오브레전드", url: "https://www.leagueoflegends.com/ja-jp/", image: "",
    aliases: ["롤", "lol", "리그오브레전드", "리그", "ロル", "リーグオブレジェンド"] },
  { name: "오버워치2", url: "https://overwatch.blizzard.com/ja-jp/", image: "",
    aliases: ["오버워치", "옵치", "overwatch", "ow", "ow2", "オーバーウォッチ", "オバウォ"] },
  { name: "원신", url: "https://genshin.hoyoverse.com/ja/", image: "",
    aliases: ["원신", "genshin", "原神", "げんしん"] },
  { name: "포트나이트", url: "https://www.fortnite.com/?lang=ja", image: "",
    aliases: ["포트나이트", "포나", "fortnite", "フォートナイト", "フォトナ"] },
  { name: "마리오카트", url: "https://www.nintendo.com/jp/software/switch/mariokart/", image: "",
    aliases: ["마리오카트", "마카", "mariokart", "マリオカート", "マリカ", "マリカー"] },
  { name: "스플래툰3", url: "https://www.nintendo.com/jp/switch/av5ja/", image: "",
    aliases: ["스플래툰", "스플라", "splatoon", "スプラトゥーン", "スプラ"] },
  { name: "몬스터헌터", url: "https://store.steampowered.com/app/2246340/",
    image: "https://cdn.akamai.steamstatic.com/steam/apps/2246340/header.jpg",
    aliases: ["몬헌", "몬스터헌터", "monsterhunter", "mh", "モンハン", "モンスターハンター"] },
  { name: "R.E.P.O.", url: "https://store.steampowered.com/app/3241660/",
    image: "https://cdn.akamai.steamstatic.com/steam/apps/3241660/header.jpg",
    aliases: ["레포", "repo", "r.e.p.o.", "r.e.p.o", "レポ", "リポ"] },
  { name: "PEAK", url: "https://store.steampowered.com/app/3527290/",
    image: "https://cdn.akamai.steamstatic.com/steam/apps/3527290/header.jpg",
    aliases: ["피크", "peak", "ピーク"] },
  { name: "Dead by Daylight", url: "https://store.steampowered.com/app/381210/",
    image: "https://cdn.akamai.steamstatic.com/steam/apps/381210/header.jpg",
    aliases: ["데바데", "데드바이데이라이트", "dbd", "deadbydaylight", "デドバ", "デッドバイデイライト"] },
  { name: "PUBG", url: "https://store.steampowered.com/app/578080/",
    image: "https://cdn.akamai.steamstatic.com/steam/apps/578080/header.jpg",
    aliases: ["배그", "배틀그라운드", "pubg", "battlegrounds", "パブジー", "ぱぶじー"] },
  { name: "Apex Legends", url: "https://store.steampowered.com/app/1172470/",
    image: "https://cdn.akamai.steamstatic.com/steam/apps/1172470/header.jpg",
    aliases: ["에펙", "에이펙스", "apex", "apexlegends", "エーペックス", "エペ", "apex"] },
  { name: "VRChat", url: "https://store.steampowered.com/app/438100/",
    image: "https://cdn.akamai.steamstatic.com/steam/apps/438100/header.jpg",
    aliases: ["vrchat", "vrc", "브챗", "브이알챗", "ブイチャ", "VRチャット"] },
];

function findGame(title) {
  const t = title.toLowerCase();
  for (const g of GAME_DB) {
    if (g.aliases.some((a) => a.toLowerCase() === t)) return g;
  }
  return null;
}

// ===== 밈/반응 사전 =====
const REACTION_MAP = {
  "응가": "💩",
  "うんち": "💩",
  "굿나잇": "잘 자~ おやすみ~ 🌙",
  "おやすみ": "잘 자~ おやすみ~ 🌙",
};

// ===== 데이터 저장 =====
const DATA_FILE = "./data.json";
let db = { reminders: [], parties: [] };
try { db = { reminders: [], parties: [], ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) }; } catch {}
function saveDb() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

const TRANSLATE_CHANNELS = (process.env.TRANSLATE_CHANNELS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// TTS 채널 (텍스트를 음성 채널에서 읽어줌)
const TTS_CHANNELS = (process.env.TTS_CHANNELS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// 명령어 원문을 지울 채널 (봇 명령어 전용 채널)
const CLEAN_COMMAND_CHANNELS = (process.env.CLEAN_COMMAND_CHANNELS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// BOOTH 링크 전용 채널 (booth.pm 링크 없는 메시지 자동 삭제)
const BOOTH_ONLY_CHANNELS = (process.env.BOOTH_ONLY_CHANNELS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// 영상 전용 채널 (영상 첨부/클립 링크 없는 메시지 자동 삭제)
const CLIP_ONLY_CHANNELS = (process.env.CLIP_ONLY_CHANNELS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers, // WELCOME: 입장 소개
    ...(process.env.PRESENCE_INTENT === '1' ? [GatewayIntentBits.GuildPresences] : []), // VOICE_STATUS: 포털에서 Presence Intent 켠 뒤 .env에 PRESENCE_INTENT=1 (안 켜고 넣으면 로그인 실패)
  ],
  partials: [Partials.Message, Partials.Reaction],
});
client.setMaxListeners(20); // WARNFIX: 모듈별 messageCreate 리스너 11개 이상

// ===== 번역 =====
function detectTargetLang(text) {
  const hangulCount = (text.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || []).length;
  const kanaCount = (text.match(/[\u3040-\u30FF]/g) || []).length;
  const kanjiCount = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
  if (hangulCount === 0 && kanaCount === 0 && kanjiCount === 0) return null;
  if (hangulCount > kanaCount + kanjiCount) return "JA";
  return "KO";
}

function protectNames(text, targetLang) {
  let out = text;
  const isHangul = (s) => /[\uAC00-\uD7AF]/.test(s);
  for (const key of NAME_KEYS) {
    const to = NAME_MAP[key];
    if (targetLang === "KO" && !isHangul(to)) continue;
    if (targetLang === "JA" && isHangul(to)) continue;
    out = out.split(key).join(`<x>${to}</x>`);
  }
  return out;
}

const tRules = require('./translate-rules');
async function translate(text, target, ...rest) {
  try { return await tRules.translate(text, target); } catch (e) { console.error('[tr] 재시도:', e.message); }
  try { return await tRules.translate(text, target); }
  catch (e) {
    console.error('[tr] 폴백:', e.message);
    const r = await translateLegacy(text, target, ...rest);
    return tRules.postFix ? tRules.postFix(r, target, text) : r;
  }
}
async function translateLegacy(text, targetLang) {
  const res = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [protectNames(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), targetLang)],
      target_lang: targetLang,
      tag_handling: "xml",
      ignore_tags: ["x"],
    }),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${await res.text()}`);
  return (await res.json()).translations[0].text.replace(/<\/?x>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// ===== 웹훅 =====
const webhookCache = new Map();
async function getWebhook(channel) {
  if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find((h) => h.owner?.id === client.user.id);
  if (!hook) hook = await channel.createWebhook({ name: "translator" });
  webhookCache.set(channel.id, hook);
  return hook;
}

// ===== 시간 유틸 (JST) =====
const JST_OFFSET = 9 * 60 * 60 * 1000;
const DAY_LABEL = ["일/日", "월/月", "화/火", "수/水", "목/木", "금/金", "토/土"];
function nowJst() { return new Date(Date.now() + JST_OFFSET); }

function parseRemindTime(str) {
  const rel = str.match(/^(\d+)(m|h|d)$/i);
  if (rel) {
    const mult = { m: 60000, h: 3600000, d: 86400000 }[rel[2].toLowerCase()];
    return Date.now() + parseInt(rel[1]) * mult;
  }
  const abs = str.match(/^(\d{1,2}):(\d{2})$/);
  if (abs) {
    const t = nowJst();
    t.setUTCHours(parseInt(abs[1]), parseInt(abs[2]), 0, 0);
    let ts = t.getTime() - JST_OFFSET;
    if (ts <= Date.now()) ts += 86400000;
    return ts;
  }
  return null;
}

function relativeDate(word) {
  const map = {
    "오늘": 0, "今日": 0, "きょう": 0,
    "내일": 1, "明日": 1, "あした": 1, "あす": 1,
    "모레": 2, "明後日": 2, "あさって": 2,
    "글피": 3, "明々後日": 3, "明明後日": 3,
  };
  let offset = null;
  if (word in map) offset = map[word];
  else {
    const m = word.match(/^(\d{1,2})(일후|일뒤|日後)$/);
    if (m) offset = parseInt(m[1]);
  }
  if (offset === null || offset > 30) return null;
  const t = new Date(Date.now() + JST_OFFSET + offset * 86400000);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`;
}

function partyTimestamp(dateStr, timeStr) {
  const n = nowJst();
  let [mo, d] = dateStr ? dateStr.split("/").map(Number) : [n.getUTCMonth() + 1, n.getUTCDate()];
  let [h, mi] = timeStr ? timeStr.split(":").map(Number) : [23, 59];
  const t = new Date(Date.UTC(n.getUTCFullYear(), mo - 1, d, h, mi, 0));
  let ts = t.getTime() - JST_OFFSET;
  if (ts <= Date.now()) {
    if (!dateStr) ts += 86400000;
    else ts = Date.UTC(n.getUTCFullYear() + 1, mo - 1, d, h, mi, 0) - JST_OFFSET;
  }
  return ts;
}

function fmtPartyDate(ts) {
  const t = new Date(ts + JST_OFFSET);
  const day = DAY_LABEL[t.getUTCDay()];
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}(${day}) ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

// ===== 리마인더 =====
function scheduleReminder(r) {
  const delay = r.at - Date.now();
  if (delay < 0) return fireReminder(r);
  setTimeout(() => fireReminder(r), Math.min(delay, 2147483647));
}

async function fireReminder(r) {
  if (!db.reminders.find((x) => x.id === r.id)) return;
  try {
    const ch = await client.channels.fetch(r.channelId);
    const who = [`<@${r.userId}>`, ...(r.mentions || [])].join(" ");
    await ch.send(`⏰ ${who} ${r.text}`);
  } catch (e) { console.error("리마인더 발송 실패:", e.message); }
  db.reminders = db.reminders.filter((x) => x.id !== r.id);
  saveDb();
}

// ===== 파티 =====
const PARTY_NOTIFY_BEFORE = 10 * 60 * 1000; // 10분 전 알림

function scheduleParty(p) {
  if (!p.at) return;
  const delay = p.at - PARTY_NOTIFY_BEFORE - Date.now();
  setTimeout(() => fireParty(p.id), Math.max(0, Math.min(delay, 2147483647)));
}

async function fireParty(partyId) {
  const p = db.parties.find((x) => x.id === partyId);
  if (!p || p.fired) return;
  p.fired = true; saveDb();
  try {
    const ch = await client.channels.fetch(p.channelId);
    const who = [...p.members.map((id) => `<@${id}>`), ...(p.guests || [])].join(" ");
    await ch.send(`🎮 ${who} **${p.title}** 10분 전이에요! / 10分前です！`);
  } catch (e) { console.error("파티 알림 실패:", e.message); }
  db.parties = db.parties.filter((x) => x.id !== partyId); saveDb();
}

function partyLines(p, names) {
  const lines = [`🎮 **${p.title}**`];
  if (p.at) lines.push(`📅 ${fmtPartyDate(p.at)} (JST)`);
  lines.push(`👥 ${names.join(", ")}${p.cap ? ` (${names.length}/${p.cap})` : ` (${names.length}名)`}`);
  if (p.desc) {
    lines.push(`📝 ${p.desc}`);
    if (p.descTr) lines.push(`-# ${p.descTr}`);
  }
  if (p.game) {
    lines.push(`🔗 ${p.game.url}`);
    if (p.game.image) lines.push(p.game.image);
  }
  if (p.urls && p.urls.length) lines.push(p.urls.map((u) => `🔗 ${u}`).join("\n"));
  lines.push(`✅ 참가 / 参加！`);
  return lines.join("\n");
}

async function updatePartyPost(p) {
  try {
    const ch = await client.channels.fetch(p.channelId);
    const post = await ch.messages.fetch(p.id);
    const names = [];
    for (const id of p.members) {
      const m = await post.guild.members.fetch(id).catch(() => null);
      names.push(m?.displayName || "?");
    }
    if (p.guests) names.push(...p.guests.map((g) => `${g}*`));
    await post.edit({ content: `@everyone\n` + partyLines(p, names), allowedMentions: { parse: [] } });
    const totalNow = p.members.length + (p.guests?.length || 0);
    if (p.cap && totalNow >= p.cap && !p.at) await fireParty(p.id);
  } catch (e) { console.error("파티 갱신 실패:", e.message); }
}

// ===== 명령어 =====
async function handleCommand(message) {
  const [cmd, ...args] = message.content.trim().split(/\s+/);

  if (["!remind", "!리마인드", "!リマインド"].includes(cmd)) {
    const at = parseRemindTime(args[0] || "");
    const text = args.slice(1).join(" ");
    if (!at || !text) {
      return message.reply("사용법: `!remind 30m 라면` / `!remind 21:00 게임` (시각은 JST, @멘션 포함 가능)");
    }
    const extraMentions = [
      ...message.mentions.users.map((u) => `<@${u.id}>`),
      ...message.mentions.roles.map((ro) => `<@&${ro.id}>`),
      ...(message.mentions.everyone ? ["@everyone"] : []),
    ];
    const r = { id: Date.now() + Math.random(), userId: message.author.id, channelId: message.channel.id, at, text, mentions: extraMentions };
    db.reminders.push(r); saveDb(); scheduleReminder(r);
    const when = new Date(at + JST_OFFSET).toISOString().slice(5, 16).replace("T", " ");
    return message.reply(`⏰ 등록 완료! ${when} (JST)`);
  }

  // !파티 [0823|8/23] [2100|21:00] 제목 [인원] [내용...]
  if (["!파티", "!募集", "!party"].includes(cmd)) {
    let dateStr = null, timeStr = null, cap = 0, title = null;
    const descParts = [];
    for (const a of args) {
      if (/^<@!?\d+>$/.test(a)) continue;
      const rel = (!title && !dateStr) ? relativeDate(a) : null;
      if (rel) { dateStr = rel; continue; }
      if (!title && !dateStr && /^\d{1,2}\/\d{1,2}$/.test(a)) dateStr = a;
      else if (!title && !dateStr && /^\d{4}$/.test(a) && !timeStr) {
        const mo = parseInt(a.slice(0, 2)), d = parseInt(a.slice(2));
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) dateStr = `${mo}/${d}`;
        else if (mo <= 23 && parseInt(a.slice(2)) <= 59) timeStr = `${a.slice(0, 2)}:${a.slice(2)}`;
      }
      else if (!title && !timeStr && /^\d{1,2}:\d{2}$/.test(a)) timeStr = a;
      else if (!title && !timeStr && /^\d{4}$/.test(a)) {
        const h = parseInt(a.slice(0, 2)), mi = parseInt(a.slice(2));
        if (h <= 23 && mi <= 59) timeStr = `${h}:${String(mi).padStart(2, "0")}`;
      }
      else if (title && !cap && /^\d{1,2}$/.test(a)) cap = parseInt(a);
      else if (!title) title = a;
      else descParts.push(a);
    }
    if (!title) {
      return message.reply("사용법: `!파티 0823 2100 발로란트 5 같이 랭크 돌려요` (날짜·시간·인원·내용 생략 가능, 제목은 한 단어)");
    }
    let desc = descParts.join(" ");
    const urls = desc.match(/https?:\/\/\S+/g) || [];
    for (const u of urls) desc = desc.replace(u, "").trim();
    desc = desc.replace(/\s{2,}/g, " ");
    let descTr = "";
    if (desc) {
      const t = detectTargetLang(desc);
      if (t) descTr = await translate(desc, t).catch(() => "");
    }
    const at = (dateStr || timeStr) ? partyTimestamp(dateStr, timeStr) : null;

    const preMembers = [message.author.id];
    for (const u of message.mentions.users.values()) {
      if (!u.bot && !preMembers.includes(u.id)) preMembers.push(u.id);
    }
    const p = {
      id: null, channelId: message.channel.id, title, cap, desc, descTr, urls, game: findGame(title),
      at, hostId: message.author.id, members: preMembers, guests: [], fired: false,
    };
    const preNames = [];
    for (const id of preMembers) {
      const m = await message.guild.members.fetch(id).catch(() => null);
      preNames.push(m?.displayName || "?");
    }
    const post = await message.channel.send({ content: `@everyone\n` + partyLines(p, preNames), allowedMentions: { parse: ["everyone"] } });
    await post.react("✅");
    await post.react("❌");
    await message.delete().catch(() => {});
    p.id = post.id;
    db.parties.push(p); saveDb();
    if (at) scheduleParty(p);
    return;
  }

  // !추가 이름 — 최신(또는 답장한) 모집글에 게스트 추가
  if (["!추가", "!追加", "!add"].includes(cmd)) {
    const name = args.join(" ").trim();
    if (!name) return message.reply("사용법: `!추가 이름` (모집글에 답장하면 그 파티에 추가)");
    let p = null;
    if (message.reference?.messageId) p = db.parties.find((x) => x.id === message.reference.messageId);
    if (!p) {
      const list = db.parties.filter((x) => x.channelId === message.channel.id && !x.fired);
      p = list[list.length - 1];
    }
    if (!p) return message.reply("진행 중인 모집이 없어요 / 進行中の募集がありません");
    p.guests = p.guests || [];
    const total = p.members.length + p.guests.length;
    if (p.cap && total >= p.cap) return message.reply("정원이 가득 찼어요 / 満員です");
    if (p.guests.includes(name)) return message.reply("이미 추가된 이름이에요");
    p.guests.push(name); saveDb();
    await updatePartyPost(p);
    return message.reply(`✅ **${name}** 추가! / 追加しました`);
  }

  // !제거 이름 — 게스트 제거
  if (["!제거", "!削除", "!remove"].includes(cmd)) {
    const name = args.join(" ").trim();
    let p = null;
    if (message.reference?.messageId) p = db.parties.find((x) => x.id === message.reference.messageId);
    if (!p) {
      const list = db.parties.filter((x) => x.channelId === message.channel.id && !x.fired);
      p = list[list.length - 1];
    }
    if (!p || !p.guests?.includes(name)) return message.reply("그 이름의 게스트가 없어요 / その名前のゲストはいません");
    p.guests = p.guests.filter((g) => g !== name); saveDb();
    await updatePartyPost(p);
    return message.reply(`🗑️ **${name}** 제거 / 削除しました`);
  }

  if (["!나가", "!退出", "!leave"].includes(cmd)) {
    tts.leaveVoice(message.guild.id);
    return message.react("👋").catch(() => {});
  }

  if (["!도움말", "!help", "!ヘルプ"].includes(cmd)) {
    return message.channel.send(
      "**명령어 목록**\n" +
      "`!파티 0823 2100 제목 5 내용` — 게임 모집 (✅로 참가, 시간되면 참가자 멘션)\n" +
      "`!remind 30m 내용` — 리마인더 (@멘션 포함 가능)\n" +
      "`!생일 3/5` — 생일 등록 (`!생일 목록`, `!생일 삭제`) · 그날 아침 자유채팅에서 축하"
    );
  }
}

// ===== 리액션 이벤트 =====
client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    // ❌ = 주최자 전용 모집 취소
    if (reaction.emoji.name === "❌") {
      const p = db.parties.find((x) => x.id === reaction.message.id);
      if (!p) return;
      if (user.id !== p.hostId) {
        await reaction.users.remove(user.id).catch(() => {});
        return;
      }
      db.parties = db.parties.filter((x) => x.id !== p.id); saveDb();
      await reaction.message.edit({
        content: `~~🎮 **${p.title}**~~\n❌ 모집이 취소됐어요 / 募集はキャンセルされました`,
        allowedMentions: { parse: [] },
      }).catch(() => {});
      await reaction.message.reactions.removeAll().catch(() => {});
      return;
    }

    if (reaction.emoji.name !== "✅") return;
    const p = db.parties.find((x) => x.id === reaction.message.id);
    if (!p || p.fired) return;
    const totalR = p.members.length + (p.guests?.length || 0);
    if (p.cap && totalR >= p.cap && !p.members.includes(user.id)) return;
    if (!p.members.includes(user.id)) {
      p.members.push(user.id); saveDb();
      await updatePartyPost(p);
    }
  } catch (e) { console.error("리액션 처리 실패:", e.message); }
});

client.on("messageReactionRemove", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.emoji.name !== "✅") return;
    const p = db.parties.find((x) => x.id === reaction.message.id);
    if (!p || p.fired) return;
    p.members = p.members.filter((id) => id !== user.id); saveDb();
    await updatePartyPost(p);
  } catch (e) { console.error("리액션 처리 실패:", e.message); }
});

// ===== 메시지 이벤트 =====
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot || message.webhookId) return;
    if (TRANSLATE_CHANNELS.length > 0 && !TRANSLATE_CHANNELS.includes(message.channel.id)) return;

    const content = message.content?.trim();
    if (!content) return;

    // 영상 전용 채널: 영상 없는 메시지 자동 삭제
    if (CLIP_ONLY_CHANNELS.includes(message.channel.id) && !message._kurumaAsk) {   // ASK_SKIP: '야 쿠루마봇' 질문은 번역만
      const hasVideoFile = [...message.attachments.values()].some(
        (a) => (a.contentType || "").startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(a.name || "")
      );
      const hasClipLink = /https?:\/\/(www\.)?(youtu\.be|youtube\.com|clips\.twitch\.tv|twitch\.tv\/\S+\/clip|medal\.tv|streamable\.com|x\.com|twitter\.com)\/\S+/i.test(content) ||
        /https?:\/\/\S+\.(mp4|mov|webm)(\?\S*)?$/i.test(content);
      if (!hasVideoFile && !hasClipLink) {
        await message.delete().catch(() => {});
        return;
      }
      return; // 영상 메시지는 번역 없이 통과
    }

    // BOOTH 전용 채널: booth.pm 링크 없는 메시지 자동 삭제
    if (BOOTH_ONLY_CHANNELS.includes(message.channel.id) && !message._kurumaAsk) {
      const hasBooth = /https?:\/\/([\w-]+\.)?booth\.pm\/\S*/i.test(content);
      if (!hasBooth) {
        await message.delete().catch(() => {});
        return;
      }
      return; // BOOTH 링크 있는 메시지는 번역 없이 통과
    }

    if (TTS_CHANNELS.includes(message.channel.id) && !content.startsWith("!") && !message._kurumaAsk) {
      await tts.handleTtsMessage(message);
      return;
    }

    if (content.startsWith("!")) {
      const result = await handleCommand(message);
      if (CLEAN_COMMAND_CHANNELS.includes(message.channel.id)) {
        await message.delete().catch(() => {});
      }
      return result;
    }

    // 봇 명령어 채널: 다른 봇 명령어(m! 등)도 잠시 후 삭제
    if (CLEAN_COMMAND_CHANNELS.includes(message.channel.id) && /^(m!|\?)/.test(content)) {
      setTimeout(() => message.delete().catch(() => {}), 3000);
      return;
    }

    if (!message._kurumaAsk) for (const [kw, resp] of Object.entries(REACTION_MAP)) {
      if (content.includes(kw)) {
        if (/^\p{Emoji}+$/u.test(resp)) await message.react(resp).catch(() => {});
        else await message.channel.send(resp);
        break;
      }
    }

    if (message._kurumaAsk) return; // ASK_SKIP: '야 쿠루마봇' 질문은 번역 안 함 (대답이 한/일 둘 다라서)
    await trPost(message, content); // TR_CATCHUP: 번역 부분은 trPost로 분리
  } catch (err) {
    console.error("처리 실패:", err.message);
  }
});

tts.setupVoiceCleanup(client);

// ===== TR_CATCHUP: 번역 + 재시작 동안 밀린 메시지 번역 =====
async function trPost(message, content) {
  if (message.channel.id === process.env.TR_TEST_CHANNEL) return; // NO_TR_TEST: 테스트 채널은 자동 번역/비교 안 함
  if (/^https?:\/\/\S+$/.test(content)) return;
  const targetLang = detectTargetLang(content);
  if (!targetLang) return;

  const translated = await translate(content, targetLang);
  if (translated.trim() === content) return;

  const hook = await getWebhook(message.channel);
  const sentTr = await hook.send({
    content: subtext(translated),
    username: message.member?.displayName || message.author.username,
    avatarURL: (message.member ?? message.author).displayAvatarURL({ extension: "png", size: 128 }),
    allowedMentions: { parse: [] },   // TR_NOPING: 번역 글의 @멘션은 보이기만 하고 알림은 안 감 (원문에서 이미 감)
  });
  if (sentTr?.id) { TR_MAP.set(message.id, { hook, id: sentTr.id }); if (TR_MAP.size > 500) TR_MAP.delete(TR_MAP.keys().next().value); }
}

// 살아있는 시각을 저장소 밖 파일에 기록 (30초마다 + 종료 직전). 다시 켜지면 그 뒤 메시지를 번역
const ALIVE_FILE = require("path").join(require("os").homedir(), ".tr-alive.json");
const CATCHUP_MAX = 15 * 60e3;   // 15분 넘게 꺼져 있었으면 밀린 번역은 안 함
const writeAlive = (exact) => { try { fs.writeFileSync(ALIVE_FILE, JSON.stringify({ t: Date.now(), exact })); } catch {} };
setInterval(() => writeAlive(false), 30e3);
for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { writeAlive(true); process.exit(0); });

async function trCatchup() {
  let alive = null;
  try { alive = JSON.parse(fs.readFileSync(ALIVE_FILE, "utf8")); } catch {}
  writeAlive(false);
  if (!alive || Date.now() - alive.t > CATCHUP_MAX) return;
  const after = String((BigInt(alive.t - 1420070400000) << 22n));
  const skip = new Set([...CLIP_ONLY_CHANNELS, ...BOOTH_ONLY_CHANNELS, ...TTS_CHANNELS, process.env.TR_TEST_CHANNEL]);
  let done = 0;
  for (const g of client.guilds.cache.values()) {
    for (const ch of g.channels.cache.values()) {
      if (!ch.isTextBased?.() || ch.isVoiceBased?.() || skip.has(ch.id)) continue;
      if (TRANSLATE_CHANNELS.length > 0 && !TRANSLATE_CHANNELS.includes(ch.id)) continue;
      if (!ch.viewable || ch.lastMessageId == null || BigInt(ch.lastMessageId) <= BigInt(after)) continue;
      const msgs = await ch.messages.fetch({ after, limit: 50 }).catch(() => null);
      if (!msgs?.size) continue;
      const list = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      for (const m of list) {
        if (m.author.bot || m.webhookId || m.createdTimestamp >= client.readyTimestamp) continue;   // 켜진 뒤 글은 평소대로 번역됨
        const content = m.content?.trim();
        if (!content || /^(!|m!|\?)/.test(content)) continue;
        // 종료 직전 시각이 정확하지 않으면(크래시) 이미 번역된 글인지 확인
        const name = m.member?.displayName || m.author.username;
        if (!alive.exact && list.some((x) => x.webhookId && x.author.username === name && x.createdTimestamp >= m.createdTimestamp && x.createdTimestamp - m.createdTimestamp < 60e3)) continue;
        await trPost(m, content).catch((e) => console.error("[catchup]", e.message));
        done++;
      }
    }
  }
  if (done) console.log(`[catchup] 밀린 메시지 ${done}개 번역`);
}

client.once("clientReady", () => {
  console.log(`✅ 로그인 완료: ${client.user.tag}`);
  setTimeout(() => trCatchup().catch((e) => console.error("[catchup]", e.message)), 3000);
  db.reminders.forEach(scheduleReminder);
  db.parties.filter((p) => p.at && !p.fired).forEach(scheduleParty);
});
require('./booth-watch')(client);
client.login(process.env.DISCORD_TOKEN);
require('./steam-sale')(client);
tRules.attach(client, typeof NAME_PAIRS !== 'undefined' ? NAME_PAIRS : [], typeof detectTargetLang === 'function' ? detectTargetLang : null);
require('./booth-free')(client);
require('./keep-mine');

// ───────── 원문 삭제/수정 시 번역도 같이 삭제/수정 ─────────
function subtext(t) { return String(t).split('\n').map((l) => (l.trim() ? `-# ${l}` : l)).join('\n'); }
const TR_MAP = new Map();
client.on('messageDelete', async (m) => {
  const r = TR_MAP.get(m.id);
  if (!r) return;
  TR_MAP.delete(m.id);
  await r.hook.deleteMessage(r.id).catch((e) => console.error('[tr-sync] 삭제 실패', e.message));
});
client.on('messageUpdate', async (oldM, m) => {
  const r = TR_MAP.get(m.id);
  if (!r) return;
  if (m.partial) m = await m.fetch().catch(() => null);
  if (!m?.content || (!oldM.partial && oldM.content === m.content)) return;
  const tl = detectTargetLang(m.content);
  if (!tl) return;
  const t = await translate(m.content, tl).catch(() => null);
  if (t) await r.hook.editMessage(r.id, { content: subtext(t), allowedMentions: { parse: [] } }).catch((e) => console.error('[tr-sync] 수정 실패', e.message));
});
require('./steam-picks')(client);

// ───────── 파티: GAME_DB에 없는 게임은 스팀에서 자동 검색해서 링크/이미지 붙이기 ─────────
{
  const _handleCommand = handleCommand;
  const camel = (t) => t.replace(/([a-z'])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
  const steamFind = async (q) => {
    const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=JP`);
    const items = (await r.json()).items || [];
    return items.find((i) => !i.name.includes(':')) || items[0] || null;
  };
  const ensureGame = async (title) => {
    if (!title || findGame(title)) return;
    let terms = [];
    try { terms = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'terms.json'), 'utf8')); } catch {}
    const alias = terms.find((t) => t.from.toLowerCase() === title.split('\u3164').join(' ').toLowerCase() && /^[\x20-\x7E]+$/.test(t.to))?.to;
    const plain = title.split('\u3164').join(' ');
    for (const q of [...new Set([alias, camel(plain), plain].filter(Boolean))]) {
      try {
        const it = await steamFind(q);
        if (!it) continue;
        const entry = {
          name: it.name, steamName: it.name, url: `https://store.steampowered.com/app/${it.id}/`,
          image: null,
          aliases: [title, plain, it.name, it.name.split(' ').join('\u3164')],
        };
        GAME_DB.push(entry);
        console.log('[party] 스팀 자동 등록:', title, '→', it.name);
        return;
      } catch (e) { console.error('[party] steam', e.message); }
    }
    console.log('[party] 스팀에서 못 찾음:', title);
  };
  const PARTY_FILL = '\u3164';
  const isMeta = (t) => /^<@/.test(t) || /^https?:/.test(t) || /^\d+([\/:]\d+)?$/.test(t) ||
    /^(오늘|내일|모레|글피|今日|明日|明後日|明々後日|\d+일\s*후|\d+日後)$/.test(t);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  handleCommand = async function (message, ...rest) {
    const m = (message.content || '').match(/^(!(?:파티|募集|party))\s+([\s\S]+)/i);
    if (m) {
      // PARTY_QUOTE_OPTIONAL: 따옴표는 있어도 되고 없어도 됨
      let body = m[2];
      body = body.replace(/["“”「『]([^"“”」』]+)["“”」』]/, (_, t) => t.trim().split(/\s+/).join(PARTY_FILL));
      const toks = body.split(/\s+/).filter(Boolean);
      const i = toks.findIndex((t) => !isMeta(t));
      if (i >= 0) {
        let j = i;
        while (j < toks.length && /^[\x21-\x7E]+$/.test(toks[j]) && !/^\d{1,2}$/.test(toks[j]) && !isMeta(toks[j])) j++;
        if (j - i >= 2) {
          const run = toks.slice(i, j);
          body = body.replace(new RegExp(run.map(esc).join('\\s+')), run.join(PARTY_FILL));
        }
        const title = body.split(/\s+/).filter(Boolean).find((t) => !isMeta(t));
        message.content = `${m[1]} ${body}`;
        await ensureGame(title).catch(() => {});
        const sg = findGame(title);
        if (sg && sg.steamName) message.content = message.content.replace(title, sg.steamName.split(' ').join(PARTY_FILL));
      }
    }
    return _handleCommand(message, ...rest);
  };
}

// ───────── PARTY_BOT_CHECK: 사람이 ✅ 누르면 봇 ✅는 빼서 숫자 = 실제 인원 ─────────
{
  const isParty = (id) => db.parties.some((p) => p.id === id);
  const fix = async (r) => {
    if (r.partial) await r.fetch().catch(() => {});
    if (r.emoji.name !== '✅' || !isParty(r.message.id)) return;
    const users = await r.users.fetch().catch(() => null);
    if (!users) return;
    const humans = users.filter((u) => !u.bot).size;
    const botIn = users.has(client.user.id);
    if (humans > 0 && botIn) await r.users.remove(client.user.id).catch(() => {});
    if (humans === 0 && !botIn) await r.message.react('✅').catch(() => {});
  };
  client.on('messageReactionAdd', (r, u) => { if (!u.bot) fix(r).catch(() => {}); });
  client.on('messageReactionRemove', (r, u) => { if (!u.bot) fix(r).catch(() => {}); });
  client.once('clientReady', async () => {
    for (const p of db.parties.slice(-20)) {
      try {
        const ch = await client.channels.fetch(p.channelId);
        const msg = await ch.messages.fetch(p.id);
        const r = msg.reactions.cache.get('✅');
        if (r) await fix(r);
      } catch {}
    }
  });
}

// ───────── 모집 채널: 자연어 문장을 !파티 명령으로 자동 변환 ─────────
function nlParty(raw, isKnown = () => false) {
  let s = raw.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/：/g, ':');
  const TRIG = /(할\s*사람|하실\s*분|할\s*분|하실분|할사람|모집|구함|괌|구해요|구해|구합니다|같이\s*해요|같이\s*하자|같이\s*할|ㄱㄱ|고고|やる人|やりませんか|しませんか|募集|一緒に|やろう|誰か|놀\s*사람|놀\s*분|노실\s*분|오실\s*분|들어올\s*사람|들어오실\s*분|뛸\s*사람|달릴\s*사람|모십니다|모셔요|모집해요|모집중|구인|파티원|팟\s*구|자리\s*있|명\s*남음|명\s*더|인큐|(?<![<\w])@\s*\d{1,2}(?!\d)|할래|하자|やらない|やらん|やりたい人|参加者|あと\s*\d+\s*人|来れる人|行ける人|入れる人)/;
  const WEAK = /(할래|하자|ㄱㄱ|고고|やろう|やらん|やらない)/;   // NL_PATTERNS2
  const weakOnly = !s.replace(new RegExp(WEAK.source, 'g'), ' ').match(TRIG);
  s = s.replace(/<(?:@[!&]?|#)\d+>|<a?:\w+:\d+>|https?:\/\/\S+/g, ' ');   // NL_STRIP_LINKS
  if (!s.trim()) return null;
  s = s.replace(/今夜|今晩/g, '今日 夜');
  if (!TRIG.test(s)) return null;
  let date = '', time = '', cap = '', title = '', m;
  const q = s.match(/["“”「『]([^"“”」』]+)["“”」』]/);
  if (q) { title = q[1].trim(); s = s.replace(q[0], ' '); }
  if ((m = s.match(/(오늘|내일|모레|글피|今日|明日|明後日|明々後日|\d+\s*일\s*후|\d+\s*日後)/))) { date = m[1].replace(/\s/g, ''); s = s.replace(m[0], ' '); }
  else if ((m = s.match(/(\d{1,2})\s*(?:월|\/|月)\s*(\d{1,2})\s*(?:일|日)?/))) { date = `${+m[1]}/${+m[2]}`; s = s.replace(m[0], ' '); }
  {
    const J0 = new Date(Date.now() + 9 * 3600e3); let add = null, rm;
    if ((rm = s.match(/(지금\s*바로|지금|ㅈㄱ|今すぐ|今から|いまから)/))) add = 0;
    else if ((rm = s.match(/(\d{1,3})\s*(분|分)\s*(뒤|후|있다가|이따|後|あと)/))) add = +rm[1];
    else if ((rm = s.match(/(\d{1,2})\s*(시간|時間)\s*(반)?\s*(뒤|후|있다가|이따|後|あと)/))) add = +rm[1] * 60 + (rm[3] ? 30 : 0);
    if (add !== null) {
      const t = new Date(J0.getTime() + (add + 4) * 60e3); const mm = Math.ceil(t.getUTCMinutes() / 5) * 5;
      t.setUTCMinutes(mm, 0, 0);
      time = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
      if (!date) date = t.getUTCDate() !== J0.getUTCDate() ? '내일' : '오늘';
      s = s.replace(rm[0], ' ');
    }
  }
  if (!time && ((m = s.match(/(오전|오후|아침|저녁|밤|낮|새벽|심야|午前|午後|朝|夜|深夜)?\s*(\d{1,2})\s*(?:시|時)\s*(반|半|(\d{1,2})\s*(?:분|分))?/)) ||
      (m = s.match(/(오전|오후|아침|저녁|밤|낮|새벽|심야|午前|午後|朝|夜|深夜)?\s*(\d{1,2}):(\d{2})()/)))) {
    let h = +m[2]; const ap = m[1] || '';
    const mi = m[3] === '반' || m[3] === '半' ? 30 : +(m[4] || (/^\d{2}$/.test(m[3] || '') ? m[3] : 0)) || 0;
    if (/오전|아침|새벽|午前|朝|深夜/.test(ap)) { if (h === 12) h = 0; } else if (/밤|夜/.test(ap) && h === 12) h = 0; else if (h >= 1 && h <= 11) h += 12;
    if (h <= 23 && mi <= 59) time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    s = s.replace(m[0], ' ');
  }
  const J = new Date(Date.now() + 9 * 3600e3);
  const ymd = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  if (!date && (m = s.match(/(다음\s*주\s*|담주\s*|来週\s*)?(월|화|수|목|금|토|일)(?:요일|욜)|(다음\s*주\s*|来週\s*)?(月|火|水|木|金|土|日)曜日?|(주말|週末)/))) {
    const k = m[2] || m[4] || (m[5] ? '토' : '');
    const want = '일월화수목금토'.indexOf(k) >= 0 ? '일월화수목금토'.indexOf(k) : '日月火水木金土'.indexOf(k);
    let add = (want - J.getUTCDay() + 7) % 7; if (m[1] || m[3]) add += 7;
    date = ymd(new Date(J.getTime() + add * 86400e3)); s = s.replace(m[0], ' ');
  }
  if ((m = s.match(/(\d{1,2})\s*(?:명\s*(?:더|남음|구함|구해요|모집)|人\s*募集)|(?<![<\w])@\s*(\d{1,2})(?!\d)|あと\s*(\d{1,2})\s*人/))) {
    cap = String(+(m[1] || m[2] || m[3]) + 1); s = s.replace(m[0], ' ');
  }
  if (!cap && (m = s.match(/(\d{1,2})\s*(?:명|인큐|인|人|名)/))) { cap = m[1]; s = s.replace(m[0], ' '); }
  const PART = /^(에서|부터|까지|쯤|정도|에|から|頃|ごろ|くらい|ぐらい|に|で|より)+/;
  if (!title) {   // NL_KNOWN_GAME: 문장 안에 등록된 게임(별명 포함)이 있으면 그걸 제목으로, 나머지는 설명으로
    const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const segs = s.split(TRIG)[0].replace(/[!！?？~～。、,.]/g, ' ').split(/\s+/).filter(Boolean);
    let best = null;
    for (let n = Math.min(4, segs.length); n >= 1 && !best; n--)
      for (let i = 0; i + n <= segs.length && !best; i++) {
        const j = segs.slice(i, i + n).join(' ');
        for (const cand of [j, j.replace(/(을|를|은|는|이|가|도|에서|부터|하고|を|は|が|も|で)$/, '')])
          if (!best && cand.length >= 2 && isKnown(cand)) best = { cand, raw: segs.slice(i, i + n) };
      }
    if (best) { title = best.cand; s = s.replace(new RegExp(best.raw.map(esc).join('\\s*')), ' '); }
  }
  if (!title) {
    const before = s.split(TRIG)[0].replace(/[!！?？~～。、,.]/g, ' ');
    const toks = before.split(/\s+/).map((t) => t.replace(PART, '').replace(/(에서|부터|까지|쯤|에|から|に|で)$/, ''))
      .filter((t) => t && !/^(같이|다같이|함께|하고|할|좀|게임|한판|판|우리|누구|혹시|또|밤|저녁|오후|오전|디코|빨리|한겜|한게임|상시|선착순|초보|ゲーム|誰か|VC|ボイチャ|一緒|今日|夜)$/.test(t));
    const NL_GENERIC = !toks.length;
    if (NL_GENERIC) toks.push(/[ぁ-んァ-ヶ]/.test(raw) && !/[가-힣]/.test(raw) ? 'ゲーム' : '게임');
    let i = toks.length - 1;
    if (/^[\x21-\x7E]+$/.test(toks[i])) while (i > 0 && /^[\x21-\x7E]+$/.test(toks[i - 1])) i--;
    title = toks.slice(i).join(' ').replace(/(을|를|은|는|이|가|도|を|は|が|も)$/, '');
    const words = title.split(' ');
    if (!NL_GENERIC) s = s.replace(new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*') + '\\S*'), ' ');
  }
  if (!title || !(date || time || cap || isKnown(title))) return null;
  if (weakOnly && !isKnown(title)) return null;
  const desc = s.split(/\s+/).map((t) => t.replace(PART, '')).filter(Boolean).join(' ').trim();
  return `!파티 ${[date, time, `"${title}"`, cap].filter(Boolean).join(' ')}${desc ? ' ' + desc : ''}`;
}

client.prependListener('messageCreate', (m) => {
  if (m.author?.bot || m.webhookId || !m.content || m.content.startsWith('!') || m._kurumaAsk) return;
  const chs = (process.env.PARTY_CHANNELS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const list = chs.length ? chs : [...new Set(db.parties.map((p) => p.channelId))];
  if (!list.includes(m.channelId)) return;
  const cmd = nlParty(m.content, (t) => !!findGame(t));
  if (cmd) { console.log('[party] 자연어 →', cmd); m.content = cmd; }
});

// ───────── PARTY_ASK: 다른 채널의 모집 문장 → 봇이 물어보고, 봇 메시지의 ✅ 누르면 모집 채널에 모집글 ─────────
{
  const pending = new Map();
  const envChs = () => (process.env.PARTY_CHANNELS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const partyChannels = () => (envChs().length ? envChs() : [...new Set(db.parties.map((p) => p.channelId))]);
  const mainParty = () => envChs()[0] || [...db.parties].reverse().find((p) => p.channelId)?.channelId;
  const preview = (cmd) => {
    const m = cmd.match(/^!파티\s+(?:(\S+)\s+)??(?:(\d{1,2}:\d{2})\s+)?"([^"]+)"(?:\s+(\d{1,2}))?/);
    if (!m) return cmd;
    return [m[1] && !/^\d{1,2}:\d{2}$/.test(m[1]) ? `📅 ${m[1]}` : '', m[2] ? `⏰ ${m[2]}` : '', `🎮 ${m[3]}`, m[4] ? `👥 ${m[4]}` : ''].filter(Boolean).join('  ');
  };
  client.on('messageCreate', async (m) => {
    if (m.author?.bot || m.webhookId || !m.content || m.content.startsWith('!') || m._kurumaAsk) return;
    if (partyChannels().includes(m.channelId)) return;
    const cmd = nlParty(m.content, (t) => !!findGame(t));
    if (!cmd) return;
    const ask = await m.reply({
      content: `🎪 모집글로 올릴까? / 募集を作成しますか？\n${preview(cmd)}\n-# ✅ 누르면 <#${mainParty()}> 에 올라감 (쓴 사람만 / 本人のみ)`,
      allowedMentions: { repliedUser: false },
    }).catch(() => null);
    if (!ask) return;
    pending.set(ask.id, { cmd, authorId: m.author.id, src: m });
    await ask.react('✅').catch(() => {});
    setTimeout(() => { if (pending.delete(ask.id)) ask.delete().catch(() => {}); }, 10 * 60e3);
  });
  client.on('messageReactionAdd', async (r, u) => {
    if (u.bot || r.emoji.name !== '✅') return;
    const p = pending.get(r.message.id);
    if (!p) return;
    if (p.authorId !== u.id) { r.users.remove(u.id).catch(() => {}); return; }
    pending.delete(r.message.id);
    try {
      const ch = await client.channels.fetch(mainParty());
      const proxy = Object.create(p.src, {
        content: { value: p.cmd, writable: true },
        channel: { value: ch }, channelId: { value: ch.id },
        delete: { value: async () => {} },
        reply: { value: (o) => ch.send(typeof o === 'string' ? o : { ...o, reply: undefined }) },
      });
      await handleCommand(proxy);
      await r.message.edit({ content: `✅ 모집글 올렸어 / 募集を作成しました → <#${ch.id}>` }).catch(() => {});
      await r.message.reactions.removeAll().catch(() => {});
      setTimeout(() => r.message.delete().catch(() => {}), 60e3);
      console.log('[party] 질문 → 모집글 생성:', p.cmd);
    } catch (e) { console.error('[party] 제안 생성 실패', e.message); }
  });
}

// ───────── STEAM_GAMES: data/steam-games.json (스팀 멀티게임 목록)을 GAME_DB에 추가 ─────────
{
  try {
    const list = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'data', 'steam-games.json'), 'utf8'));
    const tpl = GAME_DB[0] || {};
    const norm = (s) => String(s).toLowerCase().replace(/[™®©]/g, '').replace(/[\s\u3164:：\-–—_.,'’!?！？()（）\[\]&]+/g, '');
    const okAlias = (a) => a && (/[^\x00-\x7f]/.test(a) ? a.length >= 2 : a.length >= 3);
    let added = 0;
    for (const g of list) {
      const names = [g.name, ...(g.names || [])].map((s) => s.replace(/[™®©]/g, '').trim()).filter(Boolean);
      if (names.some((n) => findGame(n))) continue;   // 이미 있는 게임은 건너뜀
      const aliases = [...new Set(names.flatMap((n) => [n, n.toLowerCase(), n.replace(/\s+/g, ''), norm(n)]).filter(okAlias))];
      const url = `https://store.steampowered.com/app/${g.id}`;
      const e = {};
      for (const k of Object.keys(tpl)) {
        if (Array.isArray(tpl[k])) e[k] = aliases;
        else if (/url|link|store/i.test(k)) e[k] = url;
        else if (/img|image|thumb|header/i.test(k)) e[k] = null;
        else if (/name|title/i.test(k)) e[k] = names[0];
        else if (/app.?id|steam/i.test(k)) e[k] = typeof tpl[k] === 'number' ? +g.id : g.id;
      }
      if (!('name' in e)) e.name = names[0];
      if (!Object.values(e).some(Array.isArray)) e.aliases = aliases;
      GAME_DB.push(e);
      added++;
    }
    console.log(`[steam-games] ${added}개 추가 (전체 ${GAME_DB.length}개)`);
  } catch (err) { console.error('[steam-games] 목록 로드 실패', err.message); }
}

// ───────── GAME_SLANG: 게임 줄임말/별명 (기본 목록 + !게임별명 명령어) ─────────
{
  const SLANG = {
    'Counter-Strike 2': ['카스', '카스2', 'cs2', 'CS', 'カウンターストライク', 'カンスト2'],
    'Dota 2': ['도타', '도타2', 'ドータ', 'ドタ2'],
    "Tom Clancy's Rainbow Six Siege": ['레식', '레인보우식스', 'r6', 'r6s', 'シージ', 'R6S'],
    'Team Fortress 2': ['팀포', '팀포2', 'tf2', 'チーフォ', 'TF2'],
    'HELLDIVERS 2': ['헬다이버즈', '헬다', '헬다2', 'ヘルダイバー', 'ヘルダイ'],
    'Terraria': ['테라리아', 'テラリア'],
    "Garry's Mod": ['게리모드', 'gmod', 'Gmod', 'ゲーリーズモッド', 'Gモッド'],
    'Rust': ['러스트', 'ラスト'],
    "Baldur's Gate 3": ['발더스게이트', '발더스', '발게3', 'bg3', 'バルダーズゲート', 'バルゲ'],
    'ELDEN RING': ['엘든링', '엘든', 'エルデンリング', 'エルデン'],
    'ELDEN RING NIGHTREIGN': ['나이트레인', '엘든나이트레인', 'ナイトレイン'],
    'Stardew Valley': ['스타듀', '스듀', '스타듀밸리', 'スタデュー', 'スターデューバレー'],
    'Among Us': ['어몽어스', '어몽', 'アモアス', 'アモングアス'],
    'Phasmophobia': ['파스모', '파스모포비아', 'ファズモ', 'ファズモフォビア'],
    'Red Dead Redemption 2': ['레데리', '레데리2', 'rdr2', 'レッドデッド', 'レデリ'],
    'Warframe': ['워프레임', 'ウォーフレーム'],
    'PUBG: BATTLEGROUNDS': ['배그', '배틀그라운드', 'pubg', 'PUBG', 'パブジー', 'ドン勝'],
    'Apex Legends': ['에펙', '에이펙스', 'apex', 'エペ', 'エーペックス', 'APEX'],
    'Grand Theft Auto V Legacy': ['gta', 'gta5', 'GTA', 'GTA5', '지티에이', 'グラセフ'],
    'Grand Theft Auto V Enhanced': ['gta', 'gta5', 'GTA', 'GTA5', '지티에이', 'グラセフ'],
    'Lethal Company': ['리썰', '리썰컴퍼니', '리쎌', 'リーサル', 'リーサルカンパニー'],
    'Deep Rock Galactic': ['딥락', 'drg', 'DRG', 'ディープロック'],
    'It Takes Two': ['잇테투', '잇테이크투', 'イットテイクスツー'],
    'Split Fiction': ['스플릿픽션', '스플릿', 'スプリットフィクション'],
    'Valheim': ['발헤임', 'ヴァルヘイム'],
    "Don't Starve Together": ['돈스타브', '돈스타', '돈스', 'dst', 'DST', 'ドンスタ'],
    'Monster Hunter: World': ['몬헌', '몬헌월드', '몬월', 'mhw', 'MHW', 'モンハン', 'モンハンワールド', 'MHW'],
    'Monster Hunter Rise': ['몬헌라이즈', '라이즈', 'mhr', 'モンハンライズ', 'ライズ'],
    'Monster Hunter Wilds': ['몬헌와일즈', '와일즈', 'mhwilds', 'モンハンワイルズ', 'ワイルズ'],
    'Dead by Daylight': ['데바데', 'dbd', 'DBD', 'デドバ'],
    'Left 4 Dead 2': ['레포데', '레포데2', 'l4d2', 'L4D2', 'レフト4デッド', 'L4D'],
    'PAYDAY 2': ['페이데이', '페데2', 'ペイデイ'],
    'PAYDAY 3': ['페이데이3', 'ペイデイ3'],
    'Sea of Thieves': ['시오브', '씨오브', '씨오브시브즈', 'sot', 'シーオブシーブス', 'シーオブ'],
    'Raft': ['래프트', 'ラフト'],
    'The Forest': ['더포레스트', '포레스트', 'ザフォレスト'],
    'Sons Of The Forest': ['선즈', '선즈오브더포레스트', 'sotf', 'サンズオブザフォレスト', 'サンズ'],
    'Overcooked! 2': ['오버쿡', '오버쿡2', 'オーバークック', 'オバクク'],
    'Overcooked! All You Can Eat': ['오버쿡올유캔잇', 'オーバークック全部盛り'],
    'Fall Guys': ['폴가이즈', 'フォールガイズ', 'フォルガイ'],
    'Destiny 2': ['데스티니', '데스티니2', 'デスティニー', 'デスティニー2'],
    'Palworld': ['팰월드', '팰', 'パルワールド', 'パルワ'],
    'R.E.P.O.': ['레포', 'repo', 'リポ', 'レポ'],
    'PEAK': ['피크', 'ピーク'],
    'Chained Together': ['체인드', '체인드투게더', 'チェインドトゥギャザー'],
    'Content Warning': ['콘텐츠워닝', '컨텐츠워닝', 'コンテンツワーニング'],
    'Risk of Rain 2': ['로오레', '리스크오브레인', 'ror2', 'リスクオブレイン'],
    'Unturned': ['언턴드', 'アンターンド'],
    'Dying Light': ['다잉라이트', 'ダイイングライト'],
    'Path of Exile': ['포이', 'poe', 'PoE', 'パスオブエグザイル'],
    'Path of Exile 2': ['포이2', 'poe2', 'PoE2'],
    'Lost Ark': ['로아', '로스트아크', 'ロストアーク'],
    'Satisfactory': ['새티스', '새티스팩토리', 'サティスファクトリー'],
    'Factorio': ['팩토리오', 'ファクトリオ'],
    'Project Zomboid': ['좀보이드', '좀보', 'ゾンボイド'],
    '7 Days to Die': ['7dtd', '세븐데이즈', '7デイズ'],
    'Hunt: Showdown 1896': ['헌트', '헌트쇼다운', 'ハント'],
    'Marvel Rivals': ['마블라이벌즈', '마라', 'マーベルライバルズ', 'マベライ'],
    'NARAKA: BLADEPOINT': ['나라카', 'ナラカ'],
    'Ready or Not': ['레디오어낫', '레오낫', 'レディオアノット'],
    'Escape from Tarkov': ['타르코프', '탈콥', 'タルコフ'],
    'Abiotic Factor': ['어바이오틱', 'アバイオティック'],
    'Grounded': ['그라운디드', 'グラウンデッド'],
    'Grounded 2': ['그라운디드2', 'グラウンデッド2'],
    'Schedule I': ['스케줄원', '스케줄1', 'スケジュール1'],
    'ARK: Survival Evolved': ['아크', 'ark', 'ARK', 'アーク'],
    'ARK: Survival Ascended': ['아크어센디드', 'asa', 'アークアセンデッド'],
    'Conan Exiles': ['코난', '코난엑자일', 'コナン'],
    'Enshrouded': ['인슈라우디드', 'エンシュラウデッド'],
    'War Thunder': ['워썬더', '워선더', 'ウォーサンダー'],
    'Brawlhalla': ['브롤할라', 'ブロウルハラ'],
    'Pummel Party': ['퍼멜파티', 'パメルパーティー'],
    'Golf With Your Friends': ['골프위드', '골위프', 'ゴルフウィズユアフレンズ'],
    'Euro Truck Simulator 2': ['유로트럭', '유트시', 'ets2', 'ユーロトラック'],
    'Tabletop Simulator': ['테탑시', '테이블탑', 'tts', 'テーブルトップ'],
    'Rocket League': ['로켓리그', 'ロケットリーグ', 'ロケリ'],
    'Supermarket Together': ['슈퍼마켓투게더', 'スーパーマーケットトゥギャザー'],
    'Witch It': ['위치잇', 'ウィッチイット'],
    'Barotrauma': ['바로트라우마', 'バロトラウマ'],
    'Valorant': ['발로', '발로란트', 'ヴァロ'],
  };
  const path = require('path');
  const FILE = path.join(__dirname, 'data', 'game-aliases.json');
  let custom = {};
  try { custom = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  const arrKey = (g) => Object.keys(g).find((k) => Array.isArray(g[k]));
  const nameOf = (g) => g.name || g.title || Object.values(g).find((v) => typeof v === 'string') || '?';
  const addAlias = (g, a) => {
    const k = arrKey(g) || 'aliases'; if (!g[k]) g[k] = [];
    for (const v of [a, a.toLowerCase()]) if (!g[k].includes(v)) g[k].push(v);
  };
  const nz = (x) => String(x).toLowerCase().replace(/[™®©\s\u3164:：\-–—_.,'’!?！？()（）\[\]&]+/g, '');
  const find2 = (t) => findGame(t) || (() => { const q = nz(t); if (q.length < 3) return null;
    return GAME_DB.find((g) => (g[arrKey(g)] || []).some((a) => nz(a).includes(q))) || null; })();
  let n = 0;
  for (const [title, list] of Object.entries(SLANG)) {
    const g = findGame(title); if (!g) continue;
    for (const a of list) { const hit = findGame(a); if (!hit) { addAlias(g, a); n++; } }
  }
  for (const [a, title] of Object.entries(custom)) { const g = findGame(title); if (g) { addAlias(g, a); n++; } }
  console.log(`[game-slang] 별명 ${n}개 적용`);

  client.on('messageCreate', async (m) => {
    if (m.author?.bot || m.webhookId) return;
    const c = (m.content || '').trim();
    const cm = c.match(/^!(게임별명|ゲーム別名|gamealias)(?:\s+([\s\S]+))?$/i); if (!cm) return;
    const R = (t) => m.reply({ content: t, allowedMentions: { repliedUser: false } }).catch(() => {});
    const arg = (cm[2] || '').trim();
    const add = arg.match(/^(.+?)\s*=\s*(.+)$/);
    const del = arg.match(/^(삭제|削除|del)\s+(.+)$/i);
    if (add) {
      const a = add[1].trim().replace(/^["'“”]|["'“”]$/g, ''), title = add[2].trim().replace(/^["'“”]|["'“”]$/g, '');
      const g = find2(title);
      if (!g) return R(`❌ 목록에 없는 게임 / 見つかりません: ${title}`);
      const hit = findGame(a);
      if (hit && hit !== g) return R(`❌ 이미 다른 게임 별명임 / 別のゲームで使用中: ${a} → ${nameOf(hit)}`);
      addAlias(g, a); custom[a] = nameOf(g);
      fs.writeFileSync(FILE, JSON.stringify(custom, null, 1));
      return R(`✅ ${a} → **${nameOf(g)}**`);
    }
    if (del) {
      const a = del[2].trim(); if (!custom[a]) return R(`❌ 직접 등록한 별명만 삭제 가능 / 手動登録のみ削除可: ${a}`);
      const g = findGame(custom[a]); const k = g && arrKey(g);
      if (k) g[k] = g[k].filter((x) => x !== a && x !== a.toLowerCase());
      delete custom[a]; fs.writeFileSync(FILE, JSON.stringify(custom, null, 1));
      return R(`🗑️ 삭제 / 削除: ${a}`);
    }
    if (arg) { const g = find2(arg); return R(g ? `🎮 **${nameOf(g)}**\n-# ${(g[arrKey(g)] || []).join(', ')}` : `❌ 못 찾음 / 見つかりません: ${arg}`); }
    return R('🎮 **게임 별명 / ゲーム別名**\n`!게임별명 레식 = Rainbow Six Siege` 추가/追加\n`!게임별명 레식` 확인/確認\n`!게임별명 삭제 레식` 삭제/削除\n' +
      `-# 직접 등록 ${Object.keys(custom).length}개 / 手動登録`);
  });
}

// ───────── GAME_SLANG2: 줄임말 추가분 + 애매한 것 정리 ─────────
{
  const MORE = {
    'Project Zomboid': ['프좀', '프로젝트좀보이드', 'pz', 'PZ'],
    'PUBG: BATTLEGROUNDS': ['펍지', '배틀그라운드'],
    'Apex Legends': ['에이펙'],
    "Tom Clancy's Rainbow Six Siege": ['레식스', '시즈', 'R6'],
    'Grand Theft Auto V Legacy': ['지타', '지타5', 'gta온라인', 'GTAオンライン'],
    'Grand Theft Auto V Enhanced': ['지타', '지타5', 'gta온라인', 'GTAオンライン'],
    'Monster Hunter Wilds': ['몬와', '몬헌와', 'MHWs'],
    'Monster Hunter Rise': ['몬라', '몬헌라', '선브'],
    "Don't Starve Together": ['돈스투', '돈굶'],
    'Lethal Company': ['리컴'],
    'HELLDIVERS 2': ['ヘルダイバーズ'],
    "Baldur's Gate 3": ['バルダーズ', 'BG3'],
    'Stardew Valley': ['スタバレ'],
    'Valheim': ['발헤'],
    'The Forest': ['더포'],
    'Sons Of The Forest': ['포레스트2', '선포'],
    'Content Warning': ['콘워'],
    'Fall Guys': ['폴가'],
    "Garry's Mod": ['게모', '개리모드', '개모'],
    'Warframe': ['워프'],
    'Path of Exile': ['패스오브엑자일'],
    'Factorio': ['팩토'],
    'Schedule I': ['스케원'],
    'Pummel Party': ['퍼멜'],
    'Supermarket Together': ['슈마투'],
    'Marvel Rivals': ['마블라'],
    '7 Days to Die': ['7데이즈', '7dtd', 'セブンデイズ'],
    'Dead by Daylight': ['데드바이데이라이트', 'DbD'],
    'Dying Light': ['다라'],
    'Dying Light 2 Stay Human': ['다잉라이트2', '다라2', 'ダイイングライト2'],
    'Goose Goose Duck': ['구구덕', '거위게임', 'グースグースダック', 'ググダ'],
    'Human Fall Flat': ['휴폴플', '휴먼폴플랫', 'ヒューマンフォールフラット', 'ヒューマン'],
    'Ultimate Chicken Horse': ['얼치호', '얼티밋치킨호스', 'アルチキ'],
    'PICO PARK': ['피코파크', '피코', 'ピコパーク'],
    'PICO PARK 2': ['피코파크2', '피코2', 'ピコパーク2'],
    'Gang Beasts': ['갱비스트', 'ギャングビースト'],
    'Party Animals': ['파티애니멀즈', '파애', 'パーティーアニマルズ', 'パティアニ'],
    'Unrailed!': ['언레일드', 'アンレイルド'],
    'Street Fighter 6': ['스파6', '스파', 'スト6', 'SF6'],
    'TEKKEN 8': ['철권', '철권8', '鉄拳', '鉄拳8'],
    'Bloons TD 6': ['블룬스', '블룬', 'btd6', 'BTD6', 'ブルーンズ'],
    'Cuphead': ['컵헤드', 'カップヘッド'],
    'Portal 2': ['포탈2', '포탈', 'ポータル2'],
    'Borderlands 2': ['보더랜드2', '보랜2', 'ボダラン2'],
    'Borderlands 3': ['보더랜드3', '보랜3', 'ボダラン3'],
    'Diablo IV': ['디아4', '디아블로4', 'ディアブロ4', 'D4'],
    'Overwatch 2': ['오버워치', '옵치', 'オバウォ', 'OW2', 'ow2'],
    'THE FINALS': ['더파이널스', '파이널스', 'ファイナルズ'],
    'V Rising': ['브이라이징', 'ブイライジング'],
    'Core Keeper': ['코어키퍼', 'コアキーパー'],
    'Killing Floor 2': ['킬플', '킬플2', '킬링플로어', 'キリングフロア'],
    'Back 4 Blood': ['백포블', 'バック4ブラッド'],
    'World War Z': ['월드워z', 'wwz', 'WWZ'],
    'Warhammer: Vermintide 2': ['버민타이드', '버민', 'ヴァーミンタイド'],
    'Warhammer 40,000: Darktide': ['다크타이드', 'ダークタイド'],
    'Lethal League Blaze': ['리썰리그'],
    'Dead Island 2': ['데드아일랜드2', '데아2'],
    'Muck': ['머크'],
    'Phasmophobia': ['파스모포'],
  };
  const REMOVE = ['カンスト2', 'チーフォ', '발게3', '골위프', '로오레', 'オバクク', '페데2', 'フォルガイ'];
  const arrKey = (g) => Object.keys(g).find((k) => Array.isArray(g[k]));
  for (const g of GAME_DB) { const k = arrKey(g); if (k) g[k] = g[k].filter((a) => !REMOVE.includes(a)); }
  let n = 0;
  for (const [title, list] of Object.entries(MORE)) {
    const g = findGame(title); if (!g) continue;
    const k = arrKey(g) || 'aliases'; if (!g[k]) g[k] = [];
    for (const a of list) for (const v of [a, a.toLowerCase()]) if (!findGame(v) && !g[k].includes(v)) { g[k].push(v); n++; }
  }
  console.log(`[game-slang2] 별명 ${n}개 추가`);
}
require('./member-count')(client);
require('./welcome')(client); // WELCOME
require('./tsukkomi')(client); // TSUKKOMI: 자유채팅 가끔 츳코미
require('./fun')(client); // FUN: 환율·생일·멤버 수 돌파 축하
require('./gate')(client); // CARL_MOVE: 입장 인사·국적 리액션 롤 (칼봇에서 옮김)
require('./voice-status')(client); // VOICE_STATUS: 음성 채널 상태에 하는 게임 표시
// ASK_OFF: 주인 요청으로 GPT 질문 기능 끔 (GPT는 번역만). 다시 켜려면 아래 주석 해제
// require('./ask')(client);   // "야 쿠루마 ~" 질문
