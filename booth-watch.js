// booth-watch.js — kuruma bot용 BOOTH 세일 감시 모듈
// 사용법: index.js에서  require('./booth-watch')(client);
// 필요: Node 18+ (전역 fetch), npm i cheerio

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { EmbedBuilder, Events } = require('discord.js');

// ───────────────────────── 설정 ─────────────────────────
const CONFIG = {
  intervalMin: Number(process.env.BOOTH_INTERVAL_MIN) || 120, // 체크 주기(분)
  pagesNew: 2,          // 신착순 몇 페이지까지 볼지
  pagesPopular: 2,      // 인기순 몇 페이지까지 볼지
  requestDelayMs: 3000, // 요청 사이 간격 (BOOTH 부담 줄이기)
  maxNotifyPerRun: 15,  // 한 번에 보내는 알림 상한 (채널별 아님, 전체)
  pruneDays: 30,        // 이 기간 동안 안 보인 상품은 기록 삭제
  sortNewParam: 'new',  // BOOTH 신착순 파라미터. 신착 정렬이 안 먹으면 여기만 수정
  dataFile: path.join(__dirname, 'data', 'booth-watch.json'),
  userAgent: 'Mozilla/5.0 (kuruma-bot booth-watch; personal use)',
  // 모든 알림을 보낼 채널. 비우면('') 등록한 채널로 보냄
  notifyChannelId: process.env.BOOTH_CHANNEL_ID || '1542851669987958866',
};

// 카테고리 → BOOTH browse 카테고리. titleFilter는 그 카테고리 결과를 상품명으로 한 번 더 거름
const CATEGORIES = {
  outfit:    { label: '의상',     browse: ['3D衣装'],
               aliases: ['의상', '옷', '의류', '코디', '衣装', '服', '洋服', '衣服', 'コーデ', '3d衣装', 'outfit', 'outfits', 'cloth', 'clothes', 'clothing', 'costume', 'wear'] },
  hair:      { label: '헤어',     browse: ['3D髪型', '3D衣装'], titleFilter: { '3D衣装': /髪|ヘア|hair|헤어/i },
               aliases: ['헤어', '머리', '머리카락', '헤어스타일', '가발', '髪', '髪型', 'ヘア', 'ヘアー', 'ヘアスタイル', 'かみ', 'ウィッグ', '3d髪型', 'hair', 'hairs', 'hairstyle', 'wig'] },
  accessory: { label: '액세서리', browse: ['3D装飾品'],
               aliases: ['액세서리', '악세', '악세사리', '악세서리', '엑세서리', '장신구', '소품', '装飾品', '装飾', 'アクセ', 'アクセサリー', 'アクセサリ', '小物', '3d装飾品', 'acc', 'accessory', 'accessories'] },
  texture:   { label: '텍스처',   browse: ['3Dテクスチャ'],
               aliases: ['텍스처', '텍스쳐', '텍스', '스킨', 'テクスチャ', 'テクスチャー', 'テクス', '3dテクスチャ', 'texture', 'textures', 'tex', 'skin'] },
  shoes:     { label: '신발',     browse: ['3D靴'],
               aliases: ['신발', '구두', '부츠', '靴', 'くつ', 'シューズ', 'ブーツ', '3d靴', 'shoe', 'shoes', 'boots'] },
  all:       { label: '전체',     browse: ['3Dモデル'],
               aliases: ['전체', '모두', '다', '全部', '全て', 'すべて', 'ぜんぶ', '3dモデル', 'all'] },
};

// 상품명에 세일 표기가 있는지
const SALE_RE = /セール|ｾｰﾙ|SALE|[%％]\s*OFF|割引|値下げ|세일|할인/i;

// ───────────────────────── 유틸 ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yen = (n) => `¥${Number(n).toLocaleString('ja-JP')}`;

function parsePrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = String(v).replace(/,/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// "ShopShop"처럼 두 번 붙은 텍스트 정리
function undouble(s) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  const h = s.length / 2;
  if (s.length % 2 === 0 && s.slice(0, h) === s.slice(h)) return s.slice(0, h);
  return s;
}

function findCategory(input) {
  if (!input) return null;
  const x = input.toLowerCase();
  for (const [key, c] of Object.entries(CATEGORIES)) {
    if (key === x || c.aliases.some((a) => a.toLowerCase() === x)) return key;
  }
  return null;
}

function extractItemId(input) {
  if (!input) return null;
  const m = String(input).match(/items\/(\d+)/) || String(input).match(/^(\d{4,})$/);
  return m ? m[1] : null;
}

// ───────────────────────── 저장소 ─────────────────────────
function emptyState() {
  return { watches: [], items: {}, detailItems: [], detail: {}, avatars: {}, nextId: 1 };
}

function load() {
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8')) };
  } catch {
    return emptyState();
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(CONFIG.dataFile), { recursive: true });
  const tmp = CONFIG.dataFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, CONFIG.dataFile);
}

// ───────────────────────── BOOTH 조회 ─────────────────────────
class RateLimited extends Error {}

async function http(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': CONFIG.userAgent, 'Accept-Language': 'ja,en;q=0.8' },
  });
  if (res.status === 429 || res.status === 403) throw new RateLimited(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

function listUrl(browseCat, q, mode, page) {
  const u = new URL(`https://booth.pm/ja/browse/${encodeURIComponent(browseCat)}`);
  if (q) u.searchParams.set('q', q);
  if (mode === 'new') u.searchParams.set('sort', CONFIG.sortNewParam);
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

// 검색 결과 HTML → [{id, name, price, shop, thumb}]
function parseList(html) {
  const $ = cheerio.load(html);
  const out = new Map();

  const readCard = ($card, id) => {
    const prev = out.get(id) || { id };
    const titleLink = $card
      .find(`a[href*="/items/${id}"]`)
      .filter((_, a) => $(a).text().trim() && !/^[¥￥]/.test($(a).text().trim()))
      .first();
    const name = $card.attr('data-product-name') || titleLink.text().trim() || prev.name;
    const priceAttr = parsePrice($card.attr('data-product-price'));
    const priceText = parsePrice(($card.text().match(/[¥￥]\s*[\d,]+/) || [])[0]);
    const shopLink = $card.find('a[href*=".booth.pm"]').first();
    const img = $card.find('img').filter((_, i) => !/badges/.test($(i).attr('src') || '')).first();
    const thumb = img.attr('data-original') || img.attr('data-src') || img.attr('src');
    out.set(id, {
      id,
      name: name ? name.replace(/\s+/g, ' ').trim() : prev.name,
      price: priceText ?? priceAttr ?? prev.price ?? null,
      shop: $card.attr('data-product-brand') || undouble(shopLink.text()) || prev.shop || '',
      thumb: thumb && /^https?:/.test(thumb) ? thumb : prev.thumb,
    });
  };

  // 1순위: data-product-id 속성이 있는 카드
  $('[data-product-id]').each((_, el) => {
    const id = String($(el).attr('data-product-id'));
    const $li = $(el).closest('li');
    readCard($li.length ? $li : $(el), id);
  });

  // 2순위: 상품 링크가 한 종류만 들어 있는 <li>
  if (out.size === 0) {
    $('li').each((_, li) => {
      const ids = new Set();
      $(li).find('a[href*="/items/"]').each((_, a) => {
        const m = ($(a).attr('href') || '').match(/\/items\/(\d+)/);
        if (m) ids.add(m[1]);
      });
      if (ids.size === 1) readCard($(li), [...ids][0]);
    });
  }

  return [...out.values()].filter((x) => x.name);
}

async function fetchList(browseCat, q, mode, page) {
  const res = await http(listUrl(browseCat, q, mode, page));
  return parseList(await res.text());
}

async function fetchItemJson(id) {
  const res = await http(`https://booth.pm/ja/items/${id}.json`);
  return res.json();
}

// 목록에서 썸네일을 못 얻었으면 상품 JSON에서 가져옴
async function ensureThumb(it) {
  if (it.thumb) return it.thumb;
  try {
    const j = await fetchItemJson(it.id);
    const img = j.images?.[0];
    it.thumb = img?.resized || img?.original || null;
  } catch { /* 썸네일 없이 진행 */ }
  await sleep(1000);
  return it.thumb;
}

const targetOf = (chId) => CONFIG.notifyChannelId || chId;

// ───────────────────────── 감시 로직 ─────────────────────────
let running = false;

// 링크 텍스트 안에서 깨지는 문자 정리
const safe = (t, n = 45) => {
  t = String(t || '')
    .replace(/\p{Extended_Pictographic}|[\u200d\ufe0f\u20e3]|[\u{1F1E6}-\u{1F1FF}]/gu, ' ') // 이모지 제거 (링크 깨짐 방지)
    .replace(/[\[［]/g, '【').replace(/[\]］]/g, '】')
    .replace(/[<>()`*_~|\\]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// 세일 알림 한 줄
function saleEntry({ item, rec, from, reason, tag }) {
  const to = item.price;
  const base = Math.max(rec.maxPrice ?? 0, from ?? 0);
  let price;
  if (reason === 'drop') {
    const pct = base > 0 ? Math.round((1 - to / base) * 100) : 0;
    price = `~~${yen(from)}~~ → **${yen(to)}**` + (pct > 0 ? ` (${pct}% OFF)` : '');
  } else {
    price = `**${to != null ? yen(to) : '가격?'}** · 🏷️ 세일 표기`;
  }
  return {
    line: `[${safe(item.name)}](https://booth.pm/ja/items/${item.id})\n　${price} · ${tag}${item.shop ? ` · ${safe(item.shop, 20)}` : ''}`,
    thumb: item.thumb,
  };
}

// 여러 줄 → 목록 임베드 (+ 같은 url 임베드로 썸네일 최대 4장 갤러리)
function buildListEmbeds({ title, color, entries, galleryUrl }) {
  const pages = [];
  let cur = [];
  let len = 0;
  for (const e of entries) {
    const l = `**${cur.length + 1}.** ${e.line}`;
    if (cur.length >= 10 || len + l.length > 3800) { pages.push(cur); cur = []; len = 0; }
    cur.push({ ...e, l: `**${cur.length + 1}.** ${e.line}` });
    len += l.length + 1;
  }
  if (cur.length) pages.push(cur);

  return pages.map((page, pi) => {
    const url = `${galleryUrl}#${Date.now()}-${pi}`; // 페이지마다 다른 url → 갤러리가 섞이지 않게
    const main = new EmbedBuilder()
      .setTitle(pages.length > 1 ? `${title} (${pi + 1}/${pages.length})` : title)
      .setURL(url)
      .setColor(color)
      .setDescription(page.map((x) => x.l).join('\n'));
    const thumbs = page.map((x) => x.thumb).filter(Boolean).slice(0, 4);
    if (thumbs[0]) main.setImage(thumbs[0]);
    return [main, ...thumbs.slice(1).map((t) => new EmbedBuilder().setURL(url).setImage(t))];
  });
}

// 알림에 쓸 아바타 이름: 별명 우선
const displayName = (state, w) => state.avatars?.[w.avatarId]?.nicks?.[0] || safe(w.avatarName, 30);

async function runCycle(client, { log = console.log } = {}) {
  if (running) return { skipped: true };
  running = true;
  const state = load();
  const now = Date.now();
  const outbox = new Map(); // channelId -> ({line,thumb} | EmbedBuilder)[]
  const texts = new Map();  // channelId -> string[]
  const summaries = new Map(); // channelId -> embed groups
  let sent = 0;
  let overflow = 0;
  const push = (map, ch, v) => (map.get(ch) || map.set(ch, []).get(ch)).push(v);
  const queue = (ch, embed) => {
    if (sent < CONFIG.maxNotifyPerRun) { push(outbox, ch, embed); sent++; } else overflow++;
  };

  try {
    // 1) 아바타 × 카테고리 감시
    for (const w of state.watches) {
      const cat = CATEGORIES[w.category];
      if (!cat) continue;
      const found = new Map();
      for (const q of [w.avatarId, ...(w.aliases || [])]) {
        for (const bc of cat.browse) {
          for (const mode of ['new', 'popular']) {
            const pages = mode === 'new' ? CONFIG.pagesNew : CONFIG.pagesPopular;
            for (let p = 1; p <= pages; p++) {
              let list;
              try {
                list = await fetchList(bc, q, mode, p);
              } catch (e) {
                if (e instanceof RateLimited) throw e;
                log(`[booth] 목록 실패 ${bc} ${q} ${mode} p${p}: ${e.message}`);
                break;
              } finally {
                await sleep(CONFIG.requestDelayMs);
              }
              const tf = cat.titleFilter?.[bc];
              for (const it of list) if (!tf || tf.test(it.name)) found.set(it.id, it);
              if (list.length < 20) break; // 마지막 페이지
            }
          }
        }
      }

      const firstRun = !w.initialized;
      const initialTagged = [];
      for (const it of found.values()) {
        const rec = (state.items[it.id] ||= { firstSeen: now, ch: {} });
        rec.name = it.name;
        rec.shop = it.shop;
        rec.thumb = it.thumb || rec.thumb;
        rec.lastSeen = now;
        if (it.price != null) rec.price = it.price;
        rec.av ||= {};
        if (!(rec.av[w.avatarId] ||= []).includes(w.category)) rec.av[w.avatarId].push(w.category);
        if (it.price != null) rec.maxPrice = Math.max(rec.maxPrice ?? it.price, it.price);

        const c = (rec.ch[targetOf(w.channelId)] ||= {});
        const last = c.last;
        const cur = it.price;
        const tagged = SALE_RE.test(it.name);

        if (last != null && cur != null && cur > last) delete c.notifiedPrice; // 세일 종료 → 다음 세일 다시 알림
        if (!tagged) c.tag = false;

        let reason = null;
        if (last != null && cur != null && cur < last && cur < (c.notifiedPrice ?? Infinity)) reason = 'drop';
        else if (tagged && !c.tag) reason = 'tag';

        if (reason) {
          if (tagged) c.tag = true;
          if (cur != null) c.notifiedPrice = cur;
          if (firstRun) initialTagged.push(it);
          else {
            if (!it.thumb && sent < CONFIG.maxNotifyPerRun) rec.thumb = await ensureThumb(it);
            queue(targetOf(w.channelId), saleEntry({
              item: it, rec, from: last, reason, tag: `${displayName(state, w)}·${cat.label}`,
            }));
          }
        }
        if (cur != null) c.last = cur;
      }

      if (firstRun) {
        w.initialized = true;
        const title = `📌 ${displayName(state, w)} · ${cat.label} 감시 시작 — 기준 가격 ${found.size}개 저장`;
        if (initialTagged.length) {
          const entries = initialTagged.slice(0, 10).map((it) => ({
            line: `[${safe(it.name)}](https://booth.pm/ja/items/${it.id})\n　**${it.price != null ? yen(it.price) : '가격?'}** · 🏷️ 세일 표기${it.shop ? ` · ${safe(it.shop, 20)}` : ''}`,
            thumb: it.thumb,
          }));
          const groups = buildListEmbeds({ title: `${title} · 세일 표기 ${initialTagged.length}개`, color: 0xffa94d, entries, galleryUrl: `https://booth.pm/ja/items/${w.avatarId}` });
          if (initialTagged.length > 10) groups[groups.length - 1][0].setFooter({ text: `…외 ${initialTagged.length - 10}개는 !부스 ${displayName(state, w)} 로 확인` });
          for (const g of groups) push(summaries, targetOf(w.channelId), g);
        } else {
          push(texts, targetOf(w.channelId), `**${title}** · 지금 세일 표기 상품 없음`);
        }
      }
    }

    // 2) 옵션별 가격 상세 감시
    for (const d of state.detailItems) {
      let j;
      try {
        j = await fetchItemJson(d.itemId);
      } catch (e) {
        if (e instanceof RateLimited) throw e;
        log(`[booth] 상세 실패 ${d.itemId}: ${e.message}`);
        continue;
      } finally {
        await sleep(CONFIG.requestDelayMs);
      }
      d.name = j.name || d.name;
      const key = `${d.itemId}:${d.channelId}`;
      const rec = (state.detail[key] ||= { vars: {} });
      const drops = [];
      for (const v of j.variations || []) {
        const price = parsePrice(v.price);
        if (price == null) continue;
        const pv = rec.vars[v.id];
        const max = Math.max(pv?.max ?? price, price);
        if (pv && price < pv.last) drops.push(`・${v.name || '기본'}: ~~${yen(pv.last)}~~ → **${yen(price)}**` +
          (max > 0 ? ` (${Math.round((1 - price / max) * 100)}% OFF)` : ''));
        rec.vars[v.id] = { name: v.name, last: price, max };
      }
      if (drops.length) {
        const e = new EmbedBuilder()
          .setTitle(`🔖 ${(j.name || d.itemId).slice(0, 240)}`)
          .setURL(`https://booth.pm/ja/items/${d.itemId}`)
          .setDescription(drops.join('\n').slice(0, 4000))
          .setColor(0xfc4d50)
          .setFooter({ text: `상세 감시 · ${j.shop?.name || ''}` });
        const thumb = j.images?.[0]?.resized || j.images?.[0]?.original;
        if (thumb) e.setThumbnail(thumb);
        queue(targetOf(d.channelId), e);
      }
    }

    // 3) 오래 안 보인 상품 정리
    const cutoff = now - CONFIG.pruneDays * 86400000;
    for (const [id, r] of Object.entries(state.items)) if ((r.lastSeen ?? 0) < cutoff) delete state.items[id];
  } catch (e) {
    log(`[booth] 사이클 중단: ${e.message}`);
  } finally {
    save(state);
    running = false;
  }

  // 전송
  const channels = new Set([...outbox.keys(), ...texts.keys(), ...summaries.keys()]);
  for (const chId of channels) {
    try {
      const ch = await client.channels.fetch(chId);
      for (const t of texts.get(chId) || []) await ch.send({ content: t.slice(0, 2000) });
      for (const g of summaries.get(chId) || []) await ch.send({ embeds: g });
      const all = outbox.get(chId) || [];
      const entries = all.filter((x) => !(x instanceof EmbedBuilder));
      const details = all.filter((x) => x instanceof EmbedBuilder);
      for (const group of buildListEmbeds({
        title: `🛒 BOOTH 세일 알림 · ${entries.length}건`, color: 0xfc4d50, entries, galleryUrl: 'https://booth.pm/ja',
      })) await ch.send({ embeds: group });
      for (let i = 0; i < details.length; i += 10) await ch.send({ embeds: details.slice(i, i + 10) });
    } catch (e) {
      log(`[booth] 전송 실패 ${chId}: ${e.message}`);
    }
  }
  if (overflow > 0 && outbox.size) {
    const first = await client.channels.fetch([...outbox.keys()][0]).catch(() => null);
    first?.send(`…알림이 많아서 ${overflow}건은 생략했어요. 다음 체크 때 이어서 보내지는 않으니 필요하면 \`!부스 체크\`로 다시 확인해 주세요.`);
  }
  return { sent, overflow };
}

// ───────────────────────── 명령어 ─────────────────────────
// 일본어 아바타명 → 한국어 별명 (자동 등록용. 틀린 건 !부스 별명으로 고치면 됨)
const KR_NICK = {
  'マヌカ': '마누카', '桔梗': '키쿄', 'セレスティア': '셀레스티아', '萌': '모에', '舞夜': '마이야', 'ルーシュカ': '루슈카',
  '森羅': '신라', '竜胆': '린도', 'シフォン': '시폰', 'ラスク': '라스크', 'カリン': '카린', '薄荷': '하카', 'ミルティナ': '밀티나',
  'キプフェル': '키프펠', '愛莉': '아이리', '瑞希': '미즈키', '真央': '마오', 'イヨ': '이요', '悠莉': '유리', 'ライム': '라임',
  'ソフィナ': '소피나', '京狐': '쿄코', 'しなの': '시나노', '杏里': '안리', 'リーファ': '리파', '衣織': '이오리', 'ここあ': '코코아',
  '透羽': '토와', 'チセ': '치세', 'ミント': '민트', 'シオ': '시오', 'メリノ': '메리노', 'ルルネ': '루루네', '撫子': '나데시코',
  'ハオラン': '하오란', 'ラシューシャ': '라슈샤', '水瀬': '미나세', 'マリエル': '마리엘', 'ルキア': '루키아', 'ミーシェ': '미셰',
};

// 상품명에서 아바타 이름 뽑기: 『マヌカ』「桔梗」 우선, 없으면 태그·수식어 제거 후 첫 단어
function avatarNicks(name) {
  let jp = (name.match(/[『「]([^』」]{1,12})[』」]/) || [])[1];
  if (!jp) {
    jp = name
      .replace(/【[^】]*】|\[[^\]]*\]|［[^］]*］|（[^）]*）|\([^)]*\)/g, ' ')
      .replace(/オリジナル\s*[3３]D\s*モデル|[3３]D\s*モデル|アバター|VRChat\S*|#\S+/gi, ' ')
      .trim().split(/[\s　/／｜|・,，]+/)[0];
  }
  jp = (jp || '').replace(/[!！?？*＊]/g, '').trim();
  if (!jp || jp.length > 12 || /^\d+$/.test(jp)) return [];
  return [KR_NICK[jp], jp].filter(Boolean);
}

const HELP = [
  '**🛒 쿠루마 BOOTH 세일 봇 사용법**',
  '',
  '**조회**',
  '`!부스 아바타` — 등록된 아바타 목록',
  '`!부스 <별명>` — 그 아바타의 지금 세일 목록  (예: `!부스 시오`)',
  '`!부스 <별명> <카테고리>` — 카테고리만  (예: `!부스 시오 의상`, `!부스 키프펠 헤어`)',
  '',
  '**등록**',
  '`!부스 등록 <아바타 번호> <별명> [카테고리...]` — 등록 (카테고리 생략 시 의상·헤어·액세서리)',
  '　예: `!부스 등록 8670449 유리` · `!부스 등록 8670449 유리 의상 헤어`',
  '`!부스 별명 <아바타 번호> <별명...>` — 별명 붙이기  (예: `!부스 별명 1234567 시오 Sio`)',
  '`!부스 인기등록 [개수]` — BOOTH 인기 아바타 상위 N개 한 번에 등록 (기본 20, 최대 50)',
  '`!부스 상품 <상품 URL>` — 특정 상품을 옵션별 가격까지 감시',
  '',
  '**관리**',
  '`!부스 목록` — 감시 목록 · `!부스 삭제 <번호>` · `!부스 상품삭제 <번호>`',
  '`!부스 테스트 <아바타 번호> <카테고리>` — 검색이 잘 되는지 확인',
  '`!부스 체크` — 지금 바로 체크',
  '',
  '**카테고리** (한국어·일본어·영어 다 됨)',
  ...Object.values(CATEGORIES).map((c) => `・${c.label}: ${c.aliases.filter((x) => !/^3d/i.test(x)).slice(1).join(', ')}`),
].join('\n');

const DEFAULT_CATS = ['outfit', 'hair', 'accessory']; // 카테고리를 안 적으면 이걸로 등록

const SUBS = {
  watch: ['등록', '추가', 'watch', 'add'],
  item: ['상품', '상품등록', 'item'],
  list: ['목록', '리스트', 'list'],
  remove: ['삭제', '해제', 'remove'],
  unitem: ['상품삭제', 'unitem'],
  test: ['테스트', 'test'],
  check: ['체크', '확인', 'check'],
  nick: ['별명', 'nick'],
  popular: ['인기등록', '인기', 'popular'],
  avatars: ['아바타', 'avatars'],
  help: ['도움말', '도움', '사용법', '명령어', 'help', '?'],
};
const subOf = (x) => Object.keys(SUBS).find((k) => SUBS[k].includes(String(x).toLowerCase())) || null;

const RESERVED = new Set(['booth', '부스', '아바타', '쿠루마']);

function nickIndex(state) {
  const map = new Map();
  for (const [id, a] of Object.entries(state.avatars || {})) for (const n of a.nicks || []) map.set(n.toLowerCase(), id);
  return map;
}

// !아바타
async function showAvatarList(message) {
  const state = load();
  const ids = new Set([...Object.keys(state.avatars || {}), ...state.watches.map((w) => w.avatarId)]);
  if (!ids.size) return message.channel.send('등록된 아바타가 없어요. `!부스 등록 <번호> <카테고리>`로 등록해 주세요.');
  const lines = [...ids].map((id, i) => {
    const a = state.avatars?.[id] || {};
    const name = a.name || state.watches.find((w) => w.avatarId === id)?.avatarName || id;
    const cats = state.watches.filter((w) => w.avatarId === id).map((w) => CATEGORIES[w.category]?.label).filter(Boolean);
    const nicks = a.nicks?.length ? a.nicks.map((n) => `\`!부스 ${n}\``).join(' ') : '_별명 없음_';
    return `**${i + 1}.** [${safe(name, 40)}](https://booth.pm/ja/items/${id}) · \`${id}\`\n　${nicks} · ${cats.length ? cats.join(', ') : '감시 없음'}`;
  });
  const e = new EmbedBuilder().setTitle(`👤 등록된 아바타 · ${ids.size}개`).setColor(0x5865f2).setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: '별명 설정: !부스 별명 <번호> <별명...>' });
  return message.channel.send({ embeds: [e] });
}

// !시오 [카테고리]
async function showAvatarSales(message, avatarId, catKey) {
  const state = load();
  const a = state.avatars?.[avatarId] || {};
  const name = a.nicks?.[0] || a.name || avatarId;
  const fresh = Date.now() - CONFIG.intervalMin * 60000 * 3;
  const list = Object.entries(state.items)
    .filter(([, r]) => r.av?.[avatarId] && (!catKey || r.av[avatarId].includes(catKey)) && (r.lastSeen ?? 0) >= fresh)
    .map(([id, r]) => {
      const pct = r.price != null && r.maxPrice > r.price ? Math.round((1 - r.price / r.maxPrice) * 100) : 0;
      return { id, r, pct, tagged: SALE_RE.test(r.name || '') };
    })
    .filter((x) => x.pct > 0 || x.tagged)
    .sort((x, y) => y.pct - x.pct || Number(y.tagged) - Number(x.tagged));

  const catLabel = catKey ? ` · ${CATEGORIES[catKey].label}` : '';
  if (!list.length) {
    const any = Object.values(state.items).some((r) => r.av?.[avatarId]);
    return message.channel.send(any
      ? `**${name}${catLabel}**: 지금 세일 중인 상품이 없어요.`
      : `**${name}**: 아직 수집된 데이터가 없어요. \`!부스 체크\`로 한 번 체크해 주세요.`);
  }
  const entries = list.map(({ id, r, pct, tagged }) => ({
    line: `[${safe(r.name)}](https://booth.pm/ja/items/${id})\n　` +
      (pct > 0 ? `~~${yen(r.maxPrice)}~~ → **${yen(r.price)}** (${pct}% OFF)` : `**${r.price != null ? yen(r.price) : '가격?'}**`) +
      (tagged ? ' · 🏷️' : '') + (r.shop ? ` · ${safe(r.shop, 20)}` : ''),
    thumb: r.thumb,
  }));
  const groups = buildListEmbeds({ title: `🏷️ ${name}${catLabel} · 세일 중 ${entries.length}건`, color: 0xfc4d50, entries, galleryUrl: `https://booth.pm/ja/items/${avatarId}` });
  for (const g of groups.slice(0, 3)) await message.channel.send({ embeds: g });
  if (groups.length > 3) await message.channel.send(`…외 ${entries.length - 30}건. 카테고리를 붙여서 좁혀 보세요 (예: \`!부스 ${name} 헤어\`)`);
}

async function handleCommand(client, message, args) {
  const first = args.shift() || '도움말';
  let sub = subOf(first);
  if (!sub) {
    const id = nickIndex(load()).get(first.toLowerCase());
    if (id) return showAvatarSales(message, id, args[0] ? findCategory(args[0]) : null);
    return message.channel.send(`'${first.slice(0, 30)}'은(는) 모르는 명령어나 별명이에요. \`!부스 아바타\`로 별명을 확인하거나 \`!쿠루마\`로 사용법을 봐 주세요.`);
  }
  const reply = (t) => message.reply({ content: t.slice(0, 2000), allowedMentions: { repliedUser: false }, failIfNotExists: false });

  if (sub === 'avatars') return showAvatarList(message);

  if (sub === 'watch') {
    const avatarId = extractItemId(args.shift());
    if (!avatarId) return reply('사용법: `!부스 등록 <아바타 번호> <별명> [카테고리...]`  (예: `!부스 등록 8670449 유리`, `!부스 등록 8670449 유리 의상 헤어`)');
    // 나머지 단어: 카테고리 → 카테고리 / +로 시작 → 추가 검색어 / 그 외 → 별명
    const cats = [];
    const extra = [];
    const nicks = [];
    for (const t of args) {
      const c = findCategory(t);
      if (c) { if (!cats.includes(c)) cats.push(c); }
      else if (t.startsWith('+') && t.length > 1) extra.push(t.slice(1));
      else nicks.push(t.replace(/^!/, ''));
    }
    if (!cats.length) cats.push(...DEFAULT_CATS);

    const state = load();
    const bad = nicks.filter((n) => RESERVED.has(n.toLowerCase()) || subOf(n));
    if (bad.length) return reply(`이 별명은 쓸 수 없어요: ${bad.join(', ')}`);
    const taken = nickIndex(state);
    const clash = nicks.filter((n) => taken.has(n.toLowerCase()) && taken.get(n.toLowerCase()) !== avatarId);
    if (clash.length) return reply(`다른 아바타가 이미 쓰는 별명이에요: ${clash.join(', ')}`);

    let avatarName = state.avatars[avatarId]?.name;
    if (!avatarName || avatarName === avatarId) {
      avatarName = avatarId;
      try { avatarName = (await fetchItemJson(avatarId)).name || avatarId; } catch { /* 이름만 못 가져온 경우 */ }
    }
    const av = (state.avatars[avatarId] ||= { name: avatarName, nicks: [] });
    av.name = avatarName;
    for (const n of nicks) if (!av.nicks.some((x) => x.toLowerCase() === n.toLowerCase())) av.nicks.push(n);

    const added = [];
    const skipped = [];
    for (const category of cats) {
      if (state.watches.some((w) => w.avatarId === avatarId && w.category === category)) { skipped.push(CATEGORIES[category].label); continue; }
      state.watches.push({
        id: state.nextId++, avatarId, avatarName, category, aliases: extra,
        channelId: message.channelId, guildId: message.guildId, addedBy: message.author.id,
        createdAt: Date.now(), initialized: false,
      });
      added.push(CATEGORIES[category].label);
    }
    save(state);
    const nickText = av.nicks.length ? av.nicks.map((n) => `\`!부스 ${n}\``).join(' ') : '_별명 없음 — `!부스 별명 ' + avatarId + ' <별명>`으로 추가_';
    return reply(`✅ **${avatarName}**\n` +
      `별명: ${nickText}\n` +
      (added.length ? `감시 추가: ${added.join(', ')}` : '') + (skipped.length ? `${added.length ? ' · ' : ''}이미 등록됨: ${skipped.join(', ')}` : '') +
      (extra.length ? `\n추가 검색어: ${extra.join(', ')}` : '') +
      (added.length ? `\n다음 체크 때 기준 가격을 저장하고, 그 뒤부터 가격이 내려가면 알려줘요. 바로 하려면 \`!부스 체크\`` : ''));
  }


  if (sub === 'item') {
    const itemId = extractItemId(args[0]);
    if (!itemId) return reply('사용법: `!부스 상품 <상품 URL>`');
    const state = load();
    if (state.detailItems.some((d) => d.itemId === itemId && d.channelId === message.channelId)) return reply('이미 등록돼 있어요.');
    let name = itemId;
    try { name = (await fetchItemJson(itemId)).name || itemId; } catch { /* ignore */ }
    state.detailItems.push({ id: state.nextId++, itemId, name, channelId: message.channelId, guildId: message.guildId });
    save(state);
    return reply(`✅ 상세 감시 등록: **${name}** (옵션별 가격)`);
  }

  if (sub === 'popular') {
    const n = Math.min(Math.max(Number(args[0]) || 20, 1), 50);
    await reply(`🔎 BOOTH 인기 아바타 상위 ${n}개를 가져오는 중…`);
    const found = new Map();
    for (let p = 1; found.size < n && p <= 3; p++) {
      const list = await fetchList('3Dキャラクター', '', 'popular', p);
      await sleep(CONFIG.requestDelayMs);
      for (const it of list) if (found.size < n) found.set(it.id, it);
      if (list.length < 20) break;
    }
    if (!found.size) return message.channel.send('인기 아바타 목록을 못 가져왔어요. `!부스 테스트`로 파싱이 되는지 먼저 확인해 주세요.');

    const state = load();
    const taken = nickIndex(state);
    const lines = [];
    let addedAvatars = 0;
    for (const it of found.values()) {
      const already = state.watches.some((w) => w.avatarId === it.id);
      const av = (state.avatars[it.id] ||= { name: it.name, nicks: [] });
      for (const nk of avatarNicks(it.name)) {
        const k = nk.toLowerCase();
        if (RESERVED.has(k) || subOf(nk) || findCategory(nk)) continue;
        if (taken.has(k) && taken.get(k) !== it.id) continue;
        if (!av.nicks.some((x) => x.toLowerCase() === k)) av.nicks.push(nk);
        taken.set(k, it.id);
      }
      if (!already) {
        for (const category of DEFAULT_CATS) {
          state.watches.push({
            id: state.nextId++, avatarId: it.id, avatarName: it.name, category, aliases: [],
            channelId: message.channelId, guildId: message.guildId, addedBy: message.author.id,
            createdAt: Date.now(), initialized: false,
          });
        }
        addedAvatars++;
      }
      lines.push(`[${safe(it.name, 38)}](https://booth.pm/ja/items/${it.id})${already ? ' _(이미 등록)_' : ''}\n　` +
        (av.nicks.length ? av.nicks.map((x) => `\`!부스 ${x}\``).join(' ') : `_별명 없음 → \`!부스 별명 ${it.id} <별명>\`_`));
    }
    save(state);
    const groups = buildListEmbeds({
      title: `✅ 인기 아바타 ${found.size}개 (새로 등록 ${addedAvatars}개 · 의상/헤어/액세서리)`,
      color: 0x57f287, entries: lines.map((line) => ({ line })), galleryUrl: 'https://booth.pm/ja/browse/3D%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC',
    });
    for (const g of groups) await message.channel.send({ embeds: g });
    const mins = Math.ceil((state.watches.length * 5.3 * CONFIG.requestDelayMs) / 60000);
    return message.channel.send(`별명이 틀리거나 비어 있으면 \`!부스 별명 <번호> <별명>\`으로 고쳐 주세요.\n첫 체크(기준 가격 저장)는 다음 정기 체크 때 자동으로 돌아요. 전체 감시 ${state.watches.length}개 기준 한 번에 약 ${mins}분 걸려요.`);
  }

  if (sub === 'nick') {
    const avatarId = extractItemId(args.shift());
    const nicks = args.map((n) => n.replace(/^!/, '')).filter(Boolean);
    if (!avatarId || !nicks.length) return reply('사용법: `!부스 별명 <아바타 번호> <별명...>` (예: `!부스 별명 1234567 시오 Sio`)');
    const bad = nicks.filter((n) => RESERVED.has(n.toLowerCase()) || findCategory(n) || subOf(n));
    if (bad.length) return reply(`이 별명은 쓸 수 없어요: ${bad.join(', ')}`);
    const state = load();
    const taken = nickIndex(state);
    const clash = nicks.filter((n) => taken.has(n.toLowerCase()) && taken.get(n.toLowerCase()) !== avatarId);
    if (clash.length) return reply(`다른 아바타가 이미 쓰는 별명이에요: ${clash.join(', ')}`);
    let a = state.avatars[avatarId];
    if (!a) {
      let name = state.watches.find((w) => w.avatarId === avatarId)?.avatarName || avatarId;
      if (name === avatarId) { try { name = (await fetchItemJson(avatarId)).name || avatarId; } catch { /* ignore */ } }
      a = state.avatars[avatarId] = { name, nicks: [] };
    }
    a.nicks = nicks;
    save(state);
    return reply(`✅ **${a.name}** 별명: ${nicks.map((n) => `\`!부스 ${n}\``).join(' ')}`);
  }

  if (sub === 'list') {
    const state = load();
    const ws = state.watches.filter((w) => w.guildId === message.guildId);
    const ds = state.detailItems.filter((d) => d.guildId === message.guildId);
    if (!ws.length && !ds.length) return reply('등록된 감시가 없어요. `!쿠루마`');
    const lines = [];
    if (ws.length) {
      lines.push('**아바타 감시**');
      ws.forEach((w, i) => lines.push(`${i + 1}. ${w.avatarName} (${w.avatarId}) · ${CATEGORIES[w.category]?.label} · <#${w.channelId}>` +
        (w.aliases?.length ? ` · 추가 검색어: ${w.aliases.join(', ')}` : '')));
    }
    if (ds.length) {
      lines.push('**상세 감시**');
      ds.forEach((d, i) => lines.push(`${i + 1}. ${d.name} · <#${d.channelId}>`));
    }
    return reply(lines.join('\n'));
  }

  if (sub === 'remove' || sub === 'unitem') {
    const n = Number(args[0]);
    const state = load();
    const key = sub === 'remove' ? 'watches' : 'detailItems';
    const mine = state[key].filter((x) => x.guildId === message.guildId);
    const target = mine[n - 1];
    if (!target) return reply('번호를 확인해 주세요. `!부스 목록`');
    state[key] = state[key].filter((x) => x !== target);
    if (key === 'detailItems') delete state.detail[`${target.itemId}:${target.channelId}`];
    save(state);
    return reply(`🗑️ 삭제했어요: ${target.avatarName || target.name}`);
  }

  if (sub === 'test') {
    const avatarId = extractItemId(args[0]);
    const category = findCategory(args[1]);
    if (!avatarId || !category) return reply('사용법: `!부스 테스트 <아바타 번호> <카테고리>`');
    const cat = CATEGORIES[category];
    const lines = [];
    const samples = [];
    for (const bc of cat.browse) {
      for (const mode of ['new', 'popular']) {
        const label = `${bc} / ${mode === 'new' ? '신착순' : '인기순'}`;
        try {
          const list = await fetchList(bc, avatarId, mode, 1);
          const tf = cat.titleFilter?.[bc];
          const kept = tf ? list.filter((x) => tf.test(x.name)) : list;
          const thumbs = kept.filter((x) => x.thumb).length;
          lines.push(`**${label}**: ${list.length}개 파싱` + (tf ? ` → 필터 후 ${kept.length}개` : '') +
            ` · 목록 썸네일 ${thumbs}/${kept.length}`);
          kept.slice(0, 4).forEach((x) => samples.push({ ...x, label }));
        } catch (e) {
          lines.push(`**${label}**: 실패 (${e.message})`);
        }
        await sleep(1500);
      }
    }
    for (const x of samples.slice(0, 4)) await ensureThumb(x);
    const entries = samples.map((x) => ({
      line: `[${safe(x.name)}](https://booth.pm/ja/items/${x.id})\n　**${x.price != null ? yen(x.price) : '가격?'}**` +
        `${SALE_RE.test(x.name) ? ' · 🏷️ 세일 표기' : ''} · ${x.label}${x.shop ? ` · ${safe(x.shop, 20)}` : ''}`,
      thumb: x.thumb,
    }));
    const groups = buildListEmbeds({ title: `🔎 테스트 결과 · 샘플 ${entries.length}개`, color: 0x5865f2, entries, galleryUrl: 'https://booth.pm/ja' });
    await message.channel.send({ content: lines.join('\n').slice(0, 2000) || '결과 없음' });
    for (const g of groups) await message.channel.send({ embeds: g });
    return;
  }

  if (sub === 'check') {
    if (running) return reply('지금 체크 중이에요. 잠시만요.');
    await reply('🔎 체크 시작… (감시 수에 따라 몇 분 걸릴 수 있어요)');
    const r = await runCycle(client);
    return message.channel.send(r.skipped ? '다른 체크가 진행 중이었어요.' : `✅ 체크 완료 · 알림 ${r.sent}건`);
  }

  return reply(HELP);
}

// ───────────────────────── 진입점 ─────────────────────────
module.exports = function initBoothWatch(client) {
  if (typeof fetch !== 'function') {
    console.error('[booth] 전역 fetch가 없습니다. Node 18 이상이 필요해요.');
    return;
  }

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    const text = message.content.trim();
    if (!text.startsWith('!')) return;
    try {
      if (/^!쿠루마$/.test(text)) return await message.channel.send(HELP.slice(0, 2000));
      if (/^!아바타$/.test(text)) return await showAvatarList(message);
      const q = text.match(/^!(\S+)(?:\s+(\S+))?$/);
      if (q && !/^(booth|부스|쿠루마|아바타)$/i.test(q[1])) {
        const id = nickIndex(load()).get(q[1].toLowerCase());
        if (id) return await showAvatarSales(message, id, q[2] ? findCategory(q[2]) : null);
      }
    } catch (e) {
      console.error('[booth] 조회 오류', e);
      return;
    }
    const m = text.match(/^!(booth|부스)(?:\s+([\s\S]*))?$/i);
    if (!m) return;
    const args = (m[2] || '').split(/\s+/).filter(Boolean);
    try {
      await handleCommand(client, message, args);
    } catch (e) {
      console.error('[booth] 명령 오류', e);
      message.channel.send('오류가 났어요. 로그를 확인해 주세요.').catch(() => {});
    }
  });

  const start = () => {
    setTimeout(() => runCycle(client), 60 * 1000); // 재시작 1분 뒤 첫 체크
    setInterval(() => runCycle(client), CONFIG.intervalMin * 60 * 1000);
    console.log(`[booth] 감시 시작 (주기 ${CONFIG.intervalMin}분)`);
  };
  if (client.isReady()) start();
  else client.once(Events.ClientReady, start);
};

module.exports._internals = { parseList, parsePrice, findCategory, extractItemId, undouble, SALE_RE, runCycle, CONFIG };
