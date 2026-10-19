// fetch-games.js — 스팀 멀티/협동 게임 중 평가 좋은 것만 모아서 data/steam-games.json 생성
// 사용: node fetch-games.js   (몇 분 걸림, 봇 켜둔 채로 돌려도 됨)
const fs = require('fs');
const path = require('path');

const MIN_SCORE = 80;      // 긍정 평가 % 이상
const MIN_REVIEWS = 2000;  // 리뷰 수 이상
const MAX_PAGES = 25;      // 카테고리당 최대 페이지 (1페이지 = 100개)
const CATS = [1, 9];       // 스팀 카테고리: 멀티플레이, 협동
const LANGS = ['english', 'koreana', 'japanese'];
const OUT = path.join(__dirname, 'data', 'steam-games.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

async function page(cat, lang, start) {
  const url = `https://store.steampowered.com/search/results/?query&start=${start}&count=100&category1=998` +
    `&category3=${cat}&filter=topsellers&cc=jp&l=${lang}&infinite=1`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 429) { await sleep(30000); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const rows = [];
      for (const row of String(j.results_html || '').split(/<a\s/).slice(1)) {
        const id = (row.match(/data-ds-appid="(\d+)"/) || [])[1];
        if (!id) continue;
        const m = row.match(/(\d+)% of the ([\d,]+) user reviews/);
        rows.push({
          id,
          name: strip((row.match(/<span class="title">([\s\S]*?)<\/span>/) || [])[1] || ''),
          score: m ? +m[1] : 0,
          reviews: m ? +m[2].replace(/,/g, '') : 0,
        });
      }
      return rows;
    } catch (e) { console.error(`  재시도 ${i + 1}`, e.message); await sleep(5000); }
  }
  return [];
}

(async () => {
  const games = new Map();
  for (const lang of LANGS) {
    for (const cat of CATS) {
      for (let p = 0; p < MAX_PAGES; p++) {
        const rows = await page(cat, lang, p * 100);
        if (!rows.length) break;
        let good = 0;
        for (const r of rows) {
          if (lang === 'english') {
            if (r.score < MIN_SCORE || r.reviews < MIN_REVIEWS) continue;
            good++;
            if (!games.has(r.id)) games.set(r.id, { id: r.id, name: r.name, score: r.score, reviews: r.reviews, names: [] });
          } else if (games.has(r.id)) {
            const g = games.get(r.id);
            good++;
            if (r.name && r.name !== g.name && !g.names.includes(r.name)) g.names.push(r.name);
          }
        }
        console.log(`[${lang}] cat${cat} p${p + 1}: ${rows.length}개 중 ${good}개`);
        if (lang === 'english' && p >= 5 && good === 0) break;   // 뒤쪽은 다 비인기라 중단
        await sleep(1500);
      }
    }
  }
  const list = [...games.values()].sort((a, b) => b.reviews - a.reviews);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(list, null, 1));
  console.log(`✅ ${list.length}개 저장 → ${OUT}`);
  console.log('예시:', list.slice(0, 15).map((g) => g.name + (g.names.length ? ` (${g.names.join(' / ')})` : '')).join(', '));
})();
