const fs = require('fs');
const path = require('path');

const GAMES = [
  { id: 2246340, tags: ['coop', 'multi'] },              // Monster Hunter Wilds
  { id: 582010,  tags: ['coop', 'multi'] },              // Monster Hunter: World
  { id: 3241660, tags: ['coop', 'horror', 'multi'] },    // R.E.P.O.
  { id: 3527290, tags: ['coop', 'survival', 'multi'] },  // PEAK
  { id: 381210,  tags: ['horror', 'survival', 'multi'] } // Dead by Daylight
];
const TAG_LABEL = { coop: '협동', survival: '생존', horror: '공포', multi: '멀티' };
const STATE_FILE = path.join(__dirname, 'steam-state.json');
const CHECK_HOUR_JST = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }

function clean(s, n = 100) {
  if (!s) return '';
  s = s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function fetchApp(id, cc, lang) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${id}&cc=${cc}&l=${lang}&filters=basic,price_overview`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const e = j[id];
  return e && e.success ? e.data : null;
}

function priceText(d) {
  const p = d && d.price_overview;
  if (!p) return null;
  return p.discount_percent > 0 ? `${p.initial_formatted} → ${p.final_formatted}` : p.final_formatted;
}

async function announce(client, chIds, g, name, pct, jp, kr) {
  const tags = g.tags.map((t) => TAG_LABEL[t]).join('·');
  const prices = [priceText(jp), priceText(kr)].filter(Boolean).join('\n');
  const lines = [`🔥 **${name}** ${pct}% 세일 / セール中! [${tags}]`];
  if (prices) lines.push(prices);
  lines.push(`🔗 https://store.steampowered.com/app/${g.id}`);
  for (const id of chIds) {
    const ch = await client.channels.fetch(id);
    await ch.send(lines.join('\n\n'));
  }
}

async function check(client) {
  const chIds = (process.env.STEAM_SALE_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!chIds.length) return console.log('[steam] STEAM_SALE_CHANNELS 없음');
  const state = loadState();
  let sale = 0;
  for (const g of GAMES) {
    try {
      const jp = await fetchApp(g.id, 'jp', 'japanese'); await sleep(1500);
      const kr = await fetchApp(g.id, 'kr', 'koreana'); await sleep(1500);
      if (!jp && !kr) throw new Error('응답 없음');
      const name = (kr && kr.name) || (jp && jp.name) || String(g.id);
      const pj = jp && jp.price_overview ? jp.price_overview.discount_percent : 0;
      const pk = kr && kr.price_overview ? kr.price_overview.discount_percent : 0;
      const pct = Math.max(pj, pk);
      console.log(`[steam] ${g.id} ${name} ${pct}%`);
      if (pct > 0) sale++;
      if (pct > (state[g.id] || 0)) await announce(client, chIds, g, name, pct, jp, kr);
      state[g.id] = pct;
      saveState(state);
    } catch (e) { console.error('[steam]', g.id, e.message); }
  }
  console.log(`[steam] 체크 완료: ${GAMES.length}개 중 ${sale}개 세일`);
}

function msUntil(h) {
  const now = Date.now();
  const j = new Date(now + 9 * 3600e3);
  let d = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), h - 9, 0, 0) - now;
  if (d <= 60000) d += 86400e3;
  return d;
}

module.exports = function (client) {
  client.once('clientReady', () => {
    setTimeout(() => check(client).catch(console.error), 15000);
    const loop = () => setTimeout(async () => { await check(client).catch(console.error); loop(); }, msUntil(CHECK_HOUR_JST));
    loop();
  });
};
// WARNFIX: ready -> clientReady
