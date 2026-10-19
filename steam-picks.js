const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'steam-picks.json');
const HOUR_JST = 10, MIN_JST = 5;
const PICKS = 5;
const MIN_DISCOUNT = 20;
const MIN_SCORE = 85;
const MIN_REVIEWS = 3000;
const COOLDOWN_DAYS = 30;
const TAGS = [3843, 1685];
const SKIP = ['2246340', '582010', '3241660', '3527290', '381210'];
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

function load() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { posted: {} }; } }
const save = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s));

async function search(tag) {
  const url = `https://store.steampowered.com/search/results/?query&start=0&count=100&specials=1&category1=998` +
    `&tags=${tag}&filter=topsellers&cc=jp&l=english&infinite=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('search HTTP ' + res.status);
  const j = await res.json();
  const out = [];
  for (const row of String(j.results_html || '').split(/<a\s/).slice(1)) {
    const id = (row.match(/data-ds-appid="(\d+)"/) || [])[1];
    if (!id) continue;
    const rv = row.match(/(\d+)% of the ([\d,]+) user reviews/);
    out.push({
      id,
      name: strip((row.match(/<span class="title">([\s\S]*?)<\/span>/) || [])[1] || ''),
      pct: +((row.match(/discount_pct[^>]*>\s*-?(\d+)%/) || [])[1] || 0),
      orig: strip((row.match(/discount_original_price[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''),
      fin: strip((row.match(/discount_final_price[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''),
      score: rv ? +rv[1] : 0,
      reviews: rv ? +rv[2].replace(/,/g, '') : 0,
    });
  }
  return out;
}

async function krPrice(id) {
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=kr&filters=price_overview`);
    const p = (await res.json())[id]?.data?.price_overview;
    if (p) return p.discount_percent > 0 ? `${p.initial_formatted} → ${p.final_formatted}` : p.final_formatted;
  } catch {}
  return null;
}

async function run(client) {
  const chIds = (process.env.STEAM_SALE_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!chIds.length) return;
  const state = load();
  const now = Date.now();
  for (const [id, t] of Object.entries(state.posted)) if (now - t > COOLDOWN_DAYS * 86400e3) delete state.posted[id];

  const seen = new Map();
  for (const tag of TAGS) {
    try { for (const g of await search(tag)) if (!seen.has(g.id)) seen.set(g.id, g); }
    catch (e) { console.error('[picks]', e.message); }
    await sleep(2000);
  }
  const picks = [...seen.values()]
    .filter((g) => g.pct >= MIN_DISCOUNT && g.score >= MIN_SCORE && g.reviews >= MIN_REVIEWS && !SKIP.includes(g.id) && !state.posted[g.id])
    .slice(0, PICKS);
  console.log(`[picks] 후보 ${seen.size}개 → 추천 ${picks.length}개`);
  if (!picks.length) return;

  const chs = [];
  for (const id of chIds) { const ch = await client.channels.fetch(id).catch(() => null); if (ch) chs.push(ch); }
  for (const ch of chs) await ch.send('🎮 **오늘의 멀티게임 추천 / 今日のおすすめマルチゲーム**').catch(() => {});
  for (const g of picks) {
    const kr = await krPrice(g.id);
    const text = [
      `🔥 **${g.name}** ${g.pct}% 세일 / セール中!`,
      [g.orig ? `${g.orig} → ${g.fin}` : g.fin, kr].filter(Boolean).join('\n'),
      `⭐ ${g.score}% (${g.reviews.toLocaleString()})`,
      `🔗 https://store.steampowered.com/app/${g.id}`,
    ].join('\n\n');
    for (const ch of chs) await ch.send(text).catch((e) => console.error('[picks] send', e.message));
    state.posted[g.id] = now;
    save(state);
    await sleep(1500);
  }
}

function msUntil(h, m) {
  const now = Date.now();
  const j = new Date(now + 9 * 3600e3);
  let d = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), h - 9, m, 0) - now;
  if (d <= 60000) d += 86400e3;
  return d;
}

module.exports = function (client) {
  client.once('ready', () => {
    const loop = () => setTimeout(async () => { await run(client).catch(console.error); loop(); }, msUntil(HOUR_JST, MIN_JST));
    loop();
  });
  client.on('messageCreate', (m) => {
    if (m.author?.bot) return;
    if (/^!(추천|おすすめ|picks)$/i.test((m.content || '').trim())) run(client).catch(console.error);
  });
};
