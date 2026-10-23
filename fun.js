// fun.js — 환율 츳코미(FUN_RATE) · 생일 축하(FUN_BDAY) · 멤버 수 돌파 축하(FUN_MILESTONE)
// 환율·생일 등록은 모든 채널, 생일·돌파 축하 글은 자유채팅(.env FUN_CHANNEL / 없으면 자유・雑談)
// 상태(생일 목록 등)는 저장소 밖 ~/.kuruma-fun.json (자동 배포 안 막게). 생일은 월-일만 저장, 연도는 버림
const fs = require('fs');
const os = require('os');
const path = require('path');
const { kurumaSay, bi, isJa, FREE_CH } = require('./kuruma-say');

const STATE = path.join(os.homedir(), '.kuruma-fun.json');
let st = {};
try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
st.birthdays = st.birthdays || {};
const save = () => { try { fs.writeFileSync(STATE, JSON.stringify(st)); } catch (e) { console.error('[fun] 저장 실패', e.message); } };

const jst = () => new Date(Date.now() + 9 * 3600e3);
const todayKey = () => jst().toISOString().slice(0, 10);
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function todayMD() {
  const d = jst(); const md = d.toISOString().slice(5, 10);
  return [md, ...(md === '02-28' && !isLeap(d.getUTCFullYear()) ? ['02-29'] : [])];   // 윤년 아니면 2/29생은 2/28에
}
const isBirthdayToday = (uid) => todayMD().includes(st.birthdays[uid]);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const freeCh = () => process.env.FUN_CHANNEL || FREE_CH;

// ───────── 날짜 읽기: 3/5, 03-05, 3.5, 0305, 3월 5일, 3月5日, 2002-03-05, 2002年3月5日, 20020305, 020305, March 5, 5 Mar ─────────
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAYS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function mdOk(m, d) { m = +m; d = +d; return m >= 1 && m <= 12 && d >= 1 && d <= DAYS[m] ? `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; }
function parseDate(t) {
  t = String(t).normalize('NFKC');
  let m;
  if ((m = t.match(/(?:\d{2,4}\s*(?:년|年)\s*)?(\d{1,2})\s*(?:월|月)\s*(\d{1,2})\s*(?:일|日)?/))) return mdOk(m[1], m[2]);
  if ((m = t.match(/(?<!\d)(?:\d{4}|\d{2})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/))) return mdOk(m[1], m[2]);
  if ((m = t.match(/(?<!\d)(\d{1,2})\s*[./-]\s*(\d{1,2})(?![\d./-])/))) return mdOk(m[1], m[2]);
  if ((m = t.match(/(?<!\d)(?:\d{4}|\d{2})?(\d{2})(\d{2})(?!\d)/)) && /(?<!\d)(\d{4}|\d{6}|\d{8})(?!\d)/.test(t)) return mdOk(m[1], m[2]);
  if ((m = t.match(/\b([a-z]{3})[a-z]*\.?\s*(\d{1,2})\b/i)) && MONTHS[m[1].toLowerCase()]) return mdOk(MONTHS[m[1].toLowerCase()], m[2]);
  if ((m = t.match(/\b(\d{1,2})\s*([a-z]{3})[a-z]*\b/i)) && MONTHS[m[2].toLowerCase()]) return mdOk(MONTHS[m[2].toLowerCase()], m[1]);
  return null;
}
const mdKo = (md) => `${+md.slice(0, 2)}월 ${+md.slice(3)}일`;
const mdJa = (md) => `${+md.slice(0, 2)}月${+md.slice(3)}日`;

// ───────── FUN_RATE: 환율 ─────────
let rateCache = null;
async function getRate() {
  if (rateCache && Date.now() - rateCache.at < 30 * 60e3) return rateCache;
  const get = async (url) => {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 6000);
    try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(tm); }
  };
  try {   // ECB 기준 (평일 하루 한 번 갱신) — 최근 며칠치로 전날 대비도 계산
    const from = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
    const j = await get(`https://api.frankfurter.app/${from}..?from=JPY&to=KRW`);
    const days = Object.keys(j.rates || {}).sort();
    const cur = j.rates[days.at(-1)].KRW, prev = days.length > 1 ? j.rates[days.at(-2)].KRW : null;
    rateCache = { at: Date.now(), krw: cur, prev, date: days.at(-1) };
  } catch (e) {
    const j = await get('https://open.er-api.com/v6/latest/JPY');
    rateCache = { at: Date.now(), krw: j.rates.KRW, prev: null, date: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) };
  }
  return rateCache;
}
const RATE_WORD = /환율|엔화|엔저|엔고|원화\s*(가치|약세|강세)|円安|円高|為替|ウォン(高|安)/;
const ASK_WORD = /얼마|몇\s*(원|엔)|환산|원으로|엔으로|いくら|何円|何ウォン|円で|ウォンで/;
const AMOUNT = /(\d[\d,]*(?:\.\d+)?)\s*(만|万|천|千)?\s*(엔|円|¥|원|ウォン|₩)/;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

async function handleRate(client, m, text, conv) {
  const r = await getRate();
  const ja = isJa(text);
  const d = `${+r.date.slice(5, 7)}/${+r.date.slice(8)}`;
  if (conv) {
    const mul = { 만: 1e4, 万: 1e4, 천: 1e3, 千: 1e3 }[conv[2]] || 1;
    const n = parseFloat(conv[1].replace(/,/g, '')) * mul;
    const yen = /엔|円|¥/.test(conv[3]);
    const out = yen ? n * r.krw : n / r.krw;
    const ko = yen ? `💴 ${fmt(n)}엔 ≈ ${fmt(out)}원` : `💴 ${fmt(n)}원 ≈ ${fmt(out)}엔`;
    const jp = yen ? `💴 ${fmt(n)}円 ≈ ${fmt(out)}ウォン` : `💴 ${fmt(n)}ウォン ≈ ${fmt(out)}円`;
    return kurumaSay(client, m.channel, bi(`${ko} (${d} 기준)`, `${jp}（${d}時点）`, ja));
  }
  const now = (r.krw * 100).toFixed(1);
  let koP = `${d} 기준`, jpP = `${d}時点`, tail = null;
  if (r.prev) {
    const diff = (r.krw - r.prev) * 100;
    const a = Math.abs(diff) < 0.05 ? '→' : diff > 0 ? '▲' : '▼';
    koP = `전날보다 ${a}${Math.abs(diff).toFixed(1)} · ${koP}`; jpP = `前日比 ${a}${Math.abs(diff).toFixed(1)}・${jpP}`;
    tail = diff > 0.05 ? ['엔화 올랐네. 일본 사는 사람 웃는 중', '円高だね。日本住みの人ニッコリ'] : diff < -0.05 ? ['엔화 또 떨어짐. 일본 여행 갈 타이밍?', 'また円安。日本旅行のチャンス？'] : null;
  }
  const ko = `💴 지금 100엔 = ${now}원 (${koP})` + (tail ? `\n${tail[0]}` : '');
  const jp = `💴 今 100円 = ${now}ウォン（${jpP}）` + (tail ? `\n${tail[1]}` : '');
  return kurumaSay(client, m.channel, bi(ko, jp, ja));
}

// ───────── FUN_BDAY: 생일 ─────────
// 명령: !생일 3/5 · !생일 (내 생일 보기) · !생일 삭제 · !생일 목록 · (주인) !생일 @사람 3/5
// 말로도: "내 생일 3월 5일이야", "私の誕生日は3月5日", "제 생일은 0305" 처럼 자기 생일 + 날짜
const BDAY_CMD = /^!(생일|誕生日|birthday|bday)(?:\s+([\s\S]*))?$/i;
const BDAY_TALK = /(?<![가-힣])(내|제|나의?|난|저의?)\s*생일|(私|俺|僕|ぼく|うち|わたし|自分)(の)?\s*誕生日|my\s*birthday/i;
const BDAY_KURUMA = [
  ['나이 하나 더 먹었네. 축하함', '一つ歳とったね。おめでと'],
  ['오늘은 츳코미 쉬어줌. 오늘만', '今日はツッコミ休んであげる。今日だけ'],
  ['케이크는 VR에서 먹어. 살 안 찜', 'ケーキはVRで食べな。太らないから'],
  ['축하함. 이건 진심임', 'おめでと。これは本気'],
  ['오늘 하루는 주인공 해', '今日一日は主役でいいよ'],
];

async function handleBday(m, arg, talk) {
  const ja = isJa(m.content);
  const R = (ko, jp, react) => (react ? m.react(react).catch(() => {}) : null, m.reply({ content: bi(ko, jp, ja), allowedMentions: { repliedUser: false } }).catch(() => {}));
  const isOwner = m.guild?.ownerId === m.author.id;
  const target = isOwner && m.mentions.users.first() && !talk ? m.mentions.users.first() : m.author;
  const a = (arg || '').replace(/<@!?\d+>/g, '').trim();
  if (!talk && /^(테스트|テスト|test)$/i.test(a)) {   // BDAY_TEST: 주인이 테스트 채널에서 생일 축하 모양 미리보기
    if (!isOwner) return;
    const ch = (process.env.TR_TEST_CHANNEL && await m.client.channels.fetch(process.env.TR_TEST_CHANNEL).catch(() => null)) || m.channel;
    await bdayAnnounce(m.client, ch, [m.author.id], true);
    if (ch.id !== m.channelId) m.react('✅').catch(() => {});
    return;
  }
  // BDAY_DEL: 목록 번호로 지우기 (부계정 정리용). 다가오는 순서 그대로 번호를 매김
  const sortedRows = () => { const now = jst().toISOString().slice(5, 10); return Object.entries(st.birthdays).sort(([, x], [, y]) => ((x < now) - (y < now)) || x.localeCompare(y)); };
  const dm = !talk && a.match(/^(삭제|지우기|취소|削除|消す|delete|remove)(?:\s+(.+))?$/i);
  if (dm) {
    let id = target.id;
    const key = (dm[2] || '').trim();
    if (key) {
      if (!isOwner) return R('다른 사람 생일은 서버 주인만 지울 수 있음. 내 것은 `!생일 삭제`', '他の人の誕生日はサーバー主のみ削除できます。自分のは `!誕生日 削除`');
      const rows = sortedRows();
      if (/^\d{1,3}$/.test(key)) id = rows[+key - 1]?.[0];
      else if (/^\d{15,21}$/.test(key)) id = key;
      else {
        id = null;
        for (const [uid] of rows) {
          const mb = await m.guild.members.fetch(uid).catch(() => null);
          if (mb && [mb.displayName, mb.user.username, mb.user.globalName].some((n) => n && n.toLowerCase() === key.toLowerCase())) { id = uid; break; }
        }
      }
    }
    if (!id || !st.birthdays[id]) return R('그 생일은 등록돼 있지 않음 (`!생일 목록`에서 번호 확인)', 'その誕生日は登録されていません（`!誕生日 一覧`で番号を確認）');
    const md = st.birthdays[id];
    delete st.birthdays[id]; save();
    const mb = id === m.author.id ? null : await m.guild.members.fetch(id).catch(() => null);
    const who = id === m.author.id ? '' : `${mb?.displayName || '나간 사람'} `;
    return R(`🗑️ ${who}생일(${mdKo(md)}) 삭제함`, `🗑️ ${mb ? mb.displayName + 'の' : ''}誕生日（${mdJa(md)}）を削除したよ`);
  }
  if (!talk && /^(목록|리스트|一覧|リスト|list)$/i.test(a)) {
    const rows = sortedRows().slice(0, 25);
    if (!rows.length) return R('등록된 생일 없음', '登録された誕生日はないよ');
    const lines = await Promise.all(rows.map(async ([id, md], i) => {
      const mb = await m.guild.members.fetch(id).catch(() => null);
      return `${i + 1}. ${mdKo(md)} · ${mb ? mb.displayName : '(나간 사람)'}`;
    }));
    return m.reply({ content: `🎂 **다가오는 생일 / 誕生日**\n${lines.join('\n')}\n-# 지우기: \`!생일 삭제\` (내 것) · 주인: \`!생일 삭제 번호\` / \`!생일 삭제 @사람\``, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  }
  if (!talk && !a) {
    const md = st.birthdays[target.id];
    return md ? R(`🎂 등록된 생일: ${mdKo(md)}`, `🎂 登録された誕生日: ${mdJa(md)}`)
      : R('생일 등록: `!생일 3/5` 또는 `!생일 3월 5일`', '誕生日の登録: `!誕生日 3/5` か `!誕生日 3月5日`');
  }
  const md = parseDate(a);
  if (!md) return talk ? null : R('날짜를 못 읽었음. 예: `!생일 3/5`, `!생일 3월 5일`, `!생일 0305`', '日付が読めなかった。例: `!誕生日 3/5`、`!誕生日 3月5日`、`!誕生日 0305`');
  st.birthdays[target.id] = md; save();
  console.log('[fun] 생일 등록');
  return R(`🎂 ${target.id === m.author.id ? '' : target.username + ' '}생일 ${mdKo(md)}로 등록함${talk ? ' (아니면 `!생일 삭제`)' : ''}`,
    `🎂 ${target.id === m.author.id ? '' : target.username + 'の'}誕生日を${mdJa(md)}で登録したよ${talk ? '（違ったら `!誕生日 削除`）' : ''}`, '🎂');
}

async function bdayCheck(client) {
  const d = jst();
  if (d.getUTCHours() < 9 || st.bdayDone === todayKey()) return;   // 매일 아침 9시(JST) 이후 한 번
  st.bdayDone = todayKey(); save();
  const ids = Object.keys(st.birthdays).filter(isBirthdayToday);
  if (!ids.length) return;
  const ch = await client.channels.fetch(freeCh()).catch(() => null); if (!ch) return;
  const here = [];
  for (const id of ids) if (await ch.guild.members.fetch(id).catch(() => null)) here.push(id);
  if (!here.length) return;
  await bdayAnnounce(client, ch, here, false);
  console.log(`[fun] 생일 축하 ${here.length}명`);
}
async function bdayAnnounce(client, ch, ids, test) {   // 생일 당일 아침 글 (test면 멘션 알림 없이 [테스트] 표시)
  const who = ids.map((id) => `<@${id}>`).join(' ');
  await ch.send({ content: `${test ? '-# [테스트] 생일 당일 아침 9시에 자유채팅에 나가는 모양\n' : ''}🎂 ${who} 생일 축하해! 🎉\n-# 🎂 誕生日おめでとう！🎉`, allowedMentions: test ? { parse: [] } : { users: ids } });
  await new Promise((r) => setTimeout(r, 2500));
  const [ko, jp] = pick(BDAY_KURUMA);
  await kurumaSay(client, ch, bi(ko, jp));
}

// ───────── FUN_MILESTONE: 멤버 수 돌파 ─────────
const isMilestone = (n) => (n < 100 ? n % 10 === 0 : n % 50 === 0);
const MILE_KURUMA = [
  ['생각보다 많네', '思ったより多いな'], ['번역할 게 또 늘었네...', '翻訳するものがまた増えた…'],
  ['이 정도면 서버 맞음', 'ここまで来たら立派なサーバー'], ['다들 어디서 이렇게 옴', 'みんなどこから来るの'],
  ['다음 목표는 서버 이름 외우기', '次の目標はみんなの名前を覚えること'],
];

module.exports = function (client) {
  const rateCd = new Map();
  // 다른 기능(츳코미)이 같은 글에 또 말하지 않게 먼저 표시
  client.prependListener('messageCreate', (m) => {
    if (m.author?.bot || m.webhookId || !m.guild || !m.content) return;
    const text = m.content.trim();
    const cmd = text.match(BDAY_CMD);
    if (cmd) { m._funHandled = true; handleBday(m, cmd[2], false).catch((e) => console.error('[fun] 생일', e.message)); return; }
    if (text.startsWith('!') || text.length > 200) return;
    if (BDAY_TALK.test(text) && !/[?？]\s*$/.test(text) && parseDate(text)) {
      m._funHandled = true; handleBday(m, text, true).catch((e) => console.error('[fun] 생일', e.message)); return;
    }
    const clean = text.replace(/https?:\/\/\S+|<a?:\w+:\d+>|<[@#][!&]?\d+>/g, ' ');
    const conv = ASK_WORD.test(clean) ? clean.match(AMOUNT) : null;
    if (conv || RATE_WORD.test(clean)) {
      const key = conv ? 'u' + m.author.id : 'c' + m.channelId;   // 환산 질문은 사람당 15초, 환율 얘기는 채널당 10분
      const cd = conv ? 15e3 : 10 * 60e3;
      if (Date.now() - (rateCd.get(key) || 0) < cd) return;
      rateCd.set(key, Date.now());
      m._funHandled = true;
      setTimeout(() => handleRate(client, m, text, conv).catch((e) => console.error('[fun] 환율', e.message)), 1500);
    }
  });

  client.on('guildMemberAdd', async (member) => {
    try {
      const n = member.guild.memberCount;
      if (!isMilestone(n) || n <= (st.milestone || 0)) return;
      st.milestone = n; save();
      const ch = await client.channels.fetch(freeCh()).catch(() => null); if (!ch) return;
      await new Promise((r) => setTimeout(r, 4000));
      await ch.send({ content: `🎉 멤버 ${n}명 돌파!\n-# 🎉 メンバー${n}人突破！`, allowedMentions: { parse: [] } });
      await new Promise((r) => setTimeout(r, 2500));
      const [ko, jp] = pick(MILE_KURUMA);
      await kurumaSay(client, ch, bi(ko, jp));
      console.log(`[fun] 멤버 ${n}명 돌파 축하`);
    } catch (e) { console.error('[fun] 돌파', e.message); }
  });

  client.once('clientReady', () => {
    // 처음 켤 때는 지금까지 지난 돌파는 축하 안 함
    if (st.milestone == null) {
      let n = 0; for (const g of client.guilds.cache.values()) n = Math.max(n, g.memberCount);
      let k = n; while (k > 0 && !isMilestone(k)) k--;
      st.milestone = k; save();
    }
    setTimeout(() => bdayCheck(client).catch((e) => console.error('[fun] 생일', e.message)), 20e3);
    setInterval(() => bdayCheck(client).catch((e) => console.error('[fun] 생일', e.message)), 10 * 60e3);
  });
};
module.exports.isBirthdayToday = isBirthdayToday;
module.exports._bdayCheck = bdayCheck;   // 테스트용
module.exports.parseDate = parseDate;
