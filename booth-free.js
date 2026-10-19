const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'booth-free.json');
const CHECK_MIN = 60;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM_RE = /https?:\/\/(?:[\w-]+\.)?booth\.pm\/(?:[a-z]{2}\/)?items\/(\d+)/gi;

const WATCH_FILE = path.join(__dirname, 'data', 'booth-watch.json');
const FIRST_POST = 5;

let state = { keywords: [], seen: {}, posted: [] };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));
const channels = () => (process.env.BOOTH_FREE_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean);

async function getItem(id) {
  const res = await fetch(`https://booth.pm/ja/items/${id}.json`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`item ${id} HTTP ${res.status}`);
  return res.json();
}
const isFree = (it) => /^¥\s*0(?!\d)/.test(String(it.price || '').trim())
  || (Array.isArray(it.variations) && it.variations.some((v) => v.price === 0));

async function searchIds(kw) {
  const url = `https://booth.pm/ja/search/${encodeURIComponent(kw)}?max_price=0&sort=new`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  const html = await res.text();
  const ids = [];
  for (const m of html.matchAll(/\/items\/(\d+)/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids.slice(0, 40);
}

function matches(it, terms) {
  const hay = [it.name, it.description, ...(it.tags || []).map((t) => (typeof t === 'string' ? t : t.name))].join(' ').toLowerCase();
  return terms.some((k) => k && hay.includes(String(k).toLowerCase()));
}

function targets() {
  const list = state.keywords.map((kw) => ({ key: kw, label: kw, queries: [kw], terms: [kw] }));
  let w = {};
  try { w = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')); } catch {}
  const byAv = new Map();
  for (const x of w.watches || []) {
    if (!x.avatarId) continue;
    const t = byAv.get(x.avatarId) || { aliases: new Set(), name: x.avatarName };
    for (const a of x.aliases || []) t.aliases.add(a);
    byAv.set(x.avatarId, t);
  }
  for (const [id, t] of byAv) {
    const av = (w.avatars || {})[id] || {};
    const nicks = av.nicks || [];
    list.push({
      key: 'av:' + id, label: nicks[0] || av.name || t.name || id,
      queries: [String(id), ...t.aliases],
      terms: [String(id), av.name, t.name, ...nicks, ...t.aliases].filter(Boolean),
    });
  }
  return list;
}

async function post(client, it, label) {
  const text = `🆓 **${it.name}**  [${label}]\n-# ${it.category?.name || it.category || ''} · ${it.shop?.name || ''}\n${it.url}`;
  for (const id of channels()) {
    const ch = await client.channels.fetch(id).catch(() => null);
    if (ch) await ch.send(text);
  }
}

async function checkTarget(client, t, firstN) {
  const seen = new Set(state.seen[t.key] || []);
  const posted = new Set(state.posted || []);
  const ids = [];
  for (const q of t.queries) {
    for (const id of await searchIds(q)) if (!ids.includes(id)) ids.push(id);
    await sleep(2000);
  }
  const fresh = ids.filter((id) => !seen.has(id));
  fresh.forEach((id) => seen.add(id));
  const picks = [];
  const order = firstN != null ? fresh : [...fresh].reverse();
  for (const id of order) {
    if (firstN != null && picks.length >= firstN) break;
    if (posted.has(id)) continue;
    try {
      await sleep(1500);
      const it = await getItem(id);
      if (it.is_adult || !isFree(it) || !matches(it, t.terms)) continue;
      picks.push(it);
    } catch (e) { console.error('[booth-free]', e.message); }
  }
  if (firstN != null) picks.reverse();
  for (const it of picks) {
    await post(client, it, t.label);
    posted.add(String(it.id));
  }
  state.seen[t.key] = [...seen].slice(-800);
  state.posted = [...posted].slice(-3000);
  save();
  return picks.length;
}

let running = false;
async function checkAll(client) {
  if (!channels().length || running) return;
  running = true;
  try {
    for (const t of targets()) {
      try {
        const n = await checkTarget(client, t, state.seen[t.key] ? null : FIRST_POST);
        console.log(`[booth-free] ${t.label}: 공지 ${n}개`);
      } catch (e) { console.error('[booth-free]', t.label, e.message); }
      await sleep(3000);
    }
  } finally { running = false; }
}

async function guard(m) {
  const ids = [...new Set([...(m._freeContent || '').matchAll(ITEM_RE)].map((x) => x[1]))];
  const bye = async (msg) => {
    const r = await m.reply({ content: msg, allowedMentions: { repliedUser: false } }).catch(() => null);
    await m.delete().catch(() => {});
    if (r) setTimeout(() => r.delete().catch(() => {}), 8000);
  };
  if (!ids.length) return bye('🆓 무료 BOOTH 링크만 올릴 수 있음 / 無料のBOOTHリンクのみ投稿できます');
  for (const id of ids) {
    try {
      const it = await getItem(id);
      if (!isFree(it)) return bye(`💰 유료 아이템이라 삭제됨 (${it.price}) / 有料アイテムのため削除しました`);
    } catch (e) { console.error('[booth-free] guard', e.message); }
  }
}

async function command(client, m, arg) {
  const R = (c) => m.reply({ content: c, allowedMentions: { repliedUser: false } });
  const add = arg.match(/^(추가|追加|add)\s+(.+)$/i);
  const del = arg.match(/^(삭제|削除|remove|del)\s+(.+)$/i);
  if (add) {
    const kw = add[2].trim();
    if (kw.length > 30) return R('❌ 30자 이내 / 30文字以内');
    if (!state.keywords.includes(kw)) state.keywords.push(kw);
    save();
    await R(`✅ 키워드 등록 / 登録: ${kw}\n-# 최신 무료 ${FIRST_POST}개 바로 공지, 이후 신작만 / 最新${FIRST_POST}件を投稿、以降は新着のみ`);
    checkAll(client).catch((e) => console.error('[booth-free]', e.message));
    return;
  }
  if (del) {
    const kw = del[2].trim();
    state.keywords = state.keywords.filter((k) => k !== kw);
    delete state.seen[kw];
    save();
    return R(`🗑️ 삭제 / 削除: ${kw}`);
  }
  if (/^(확인|確認|check)$/i.test(arg)) {
    await R('🔍 확인 중 / 確認中…');
    return checkAll(client);
  }
  const avs = targets().filter((t) => t.key.startsWith('av:')).map((t) => t.label);
  return R(`🆓 **무료 BOOTH 알림 대상 / 無料BOOTH通知対象**\n` +
    `🧸 booth-watch 아바타 (${avs.length}): ${avs.join(', ') || '(없음 / なし)'}\n` +
    `🔑 키워드 (${state.keywords.length}): ${state.keywords.join(', ') || '(없음 / なし)'}\n` +
    `-# 추가/追加: \`!무료부스 추가 Kipfel\` · 삭제/削除: \`!무료부스 삭제 Kipfel\` · 지금 확인/今すぐ確認: \`!무료부스 확인\``);
}

module.exports = function (client) {
  client.prependListener('messageCreate', (m) => {
    if (m.author?.bot || m.webhookId || !channels().includes(m.channelId)) return;
    m._freeContent = m.content;
    m.content = '';
  });
  client.on('messageCreate', (m) => {
    if (m.author?.bot || m.webhookId) return;
    const c = m._freeContent ?? m.content ?? '';
    const cm = c.match(/^!(무료부스|無料booth|無料ブース|freebooth)(?:\s+([\s\S]*))?$/i);
    if (cm) return void command(client, m, (cm[2] || '').trim()).catch((e) => console.error('[booth-free]', e));
    if (channels().includes(m.channelId) && !c.startsWith('!') && !m._kurumaAsk) guard(m).catch((e) => console.error('[booth-free]', e));
  });
  client.once('ready', () => {
    setTimeout(() => checkAll(client).catch(console.error), 30000);
    setInterval(() => checkAll(client).catch(console.error), CHECK_MIN * 60000);
    let last = '';
    fs.watchFile(WATCH_FILE, { interval: 15000 }, () => {
      const now = targets().map((t) => t.key).join('|');
      if (now === last) return;
      last = now;
      setTimeout(() => checkAll(client).catch(console.error), 5000);
    });
  });
};
