// ask.js — "야 쿠루마봇 ~" / "クルマ、~" 로 시작하는 메시지에 GPT가 짧게 대답 (날씨는 Open-Meteo로 실시간 조회)
// 번역과 같은 OpenAI 크레딧/월 한도(LLM_BUDGET_YEN)를 같이 씀. 크레딧 소진 시 같이 꺼짐.
// .env (전부 선택): ASK_DAILY_LIMIT(1인 하루, 기본 20) / ASK_BUDGET_YEN(질문 기능 월 한도, 기본 100) / ASK_CHANNELS(쉼표, 비우면 전체)
const { llmShared: L } = require('./translate-rules');

// 한국어: 야 쿠루마봇(아/야) / 일본어: (ねえ|おい) クルマ(ボット)(さん|くん|ちゃん) — 뒤에 띄어쓰기·、·！ 등 필요 ("クルマで行く" 같은 '차' 뜻 오인 방지)
const TRIGGER_KO = /^\s*야\s*쿠루마\s*봇(?:아|야)?(?=$|[\s,.!?~…ㅋㅎ])[\s,.!?~…]*/;
const TRIGGER_JA = /^\s*(?:ねえ|ねぇ|おい)?[\s、,]*クルマ(?:ボット|bot)?(?:さん|くん|ちゃん)?(?=$|[\s、。,.!?！？~〜…ｗw])[\s、。,.!?！？~〜…]*/i;
const MAX_IN = 300;

const WMO = { 0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림', 45: '안개', 48: '안개', 51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비',
  56: '어는 이슬비', 57: '어는 이슬비', 61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '어는 비', 71: '약한 눈', 73: '눈', 75: '강한 눈',
  77: '싸락눈', 80: '소나기', 81: '소나기', 82: '강한 소나기', 85: '눈 소나기', 86: '강한 눈 소나기', 95: '뇌우', 96: '우박 뇌우', 99: '우박 뇌우' };

async function getJson(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 6000);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

async function getWeather({ city, days }) {
  const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&language=ko&name=${encodeURIComponent(String(city || '').slice(0, 60))}`);
  const p = g.results?.[0];
  if (!p) return { error: `"${city}" 위치를 못 찾음` };
  const n = Math.min(Math.max(+days || 2, 1), 7);
  const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto&forecast_days=${n}`
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  return {
    place: [p.name, p.admin1, p.country].filter(Boolean).join(', '),
    now: w.current && { time: w.current.time, temp: w.current.temperature_2m, feels: w.current.apparent_temperature, sky: WMO[w.current.weather_code] ?? w.current.weather_code, wind_kmh: w.current.wind_speed_10m, rain_mm: w.current.precipitation },
    daily: (w.daily?.time || []).map((d, i) => ({ date: d, sky: WMO[w.daily.weather_code[i]] ?? w.daily.weather_code[i], max: w.daily.temperature_2m_max[i], min: w.daily.temperature_2m_min[i], rain_chance: w.daily.precipitation_probability_max?.[i] })),
  };
}

const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Current weather and daily forecast for a city (real-time).',
    parameters: { type: 'object', properties: {
      city: { type: 'string', description: 'City name in English, e.g. "Tokyo", "Seoul", "Osaka", "Busan"' },
      days: { type: 'integer', description: 'Forecast days 1-7 (default 2)' },
    }, required: ['city'] },
  },
}];

function systemPrompt(isJa) {
  const now = new Date();
  const fmt = (tz) => now.toLocaleString('ko-KR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
  return [
    'You are "쿠루마봇 (クルマ)", a friendly bot in a small Korean-Japanese friends Discord server.',
    `Now: ${fmt('Asia/Seoul')} (KST = JST).`,
    'ALWAYS answer in BOTH languages: first Korean (casual 반말), then the same content in Japanese (casual タメ口). Format exactly:\n🇰🇷 <Korean answer>\n🇯🇵 <Japanese answer>\nEach part 1-3 short lines, Discord style, light emoji ok.',
    'For weather, ALWAYS call get_weather. If no place is given, use ' + (isJa ? 'Tokyo' : 'Seoul') + ' and say which city you used.',
    'You have no other real-time data (news, prices, scores, game patches). For those, say you are not sure / may be outdated instead of guessing.',
    'Never output @everyone/@here. No medical, legal or financial certainty; keep it casual and honest.',
  ].join('\n');
}

module.exports = function (client) {
  const daily = new Map();   // `${day}:${userId}` → 횟수 (재시작하면 초기화)
  const busy = new Set();
  const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  async function ask(question, isJa) {
    const messages = [{ role: 'system', content: systemPrompt(isJa) }, { role: 'user', content: question }];
    for (let round = 0; round < 3; round++) {
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 15000);
      let res, j;
      try {
        res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: L.LLM.model(), messages, tools: TOOLS, reasoning_effort: 'none', max_completion_tokens: 800 }),
          signal: ac.signal,
        });
        j = await res.json().catch(() => ({}));
      } finally { clearTimeout(timer); }
      L.charge(j.usage);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) L.disable('키 오류');
        else if (j.error?.code === 'insufficient_quota' || j.error?.type === 'insufficient_quota') L.disable('크레딧 소진');
        throw new Error(`OpenAI HTTP ${res.status} ${j.error?.message || ''}`.slice(0, 200));
      }
      const msg = j.choices?.[0]?.message;
      if (!msg) throw new Error('빈 응답');
      if (!msg.tool_calls?.length) return String(msg.content || '').trim();
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        let out;
        try { out = tc.function?.name === 'get_weather' ? await getWeather(JSON.parse(tc.function.arguments || '{}')) : { error: 'unknown tool' }; }
        catch (e) { out = { error: '날씨 조회 실패: ' + e.message }; }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
      }
    }
    throw new Error('도구 호출 반복 초과');
  }

  client.prependListener('messageCreate', (m) => {   // 맨 앞에서 실행됨 (index.js 맨 끝에서 등록)
    if (m.author?.bot || m.webhookId || !m.content || !m.guild) return;
    const content = m.content;
    const ko = content.match(TRIGGER_KO); const ja = ko ? null : content.match(TRIGGER_JA);
    const hit = ko || ja;
    if (!hit) return;
    const chs = (process.env.ASK_CHANNELS || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (chs.length && !chs.includes(m.channelId)) return;
    m._kurumaAsk = true;   // 다른 기능은 건너뛰고 번역만
    handle(m, content.slice(hit[0].length).trim(), !!ja).catch((e) => console.error('[ask]', e.message));
  });

  async function handle(m, q, ja) {
    const T = (k, j) => `${k}\n${j}`;
    const R = (content) => {
      const o = { content: content.slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } };
      return m.reply(o).catch((e) => { console.error('[ask] 답장 실패, 일반 메시지로', e.message); return m.channel.send(o).catch((e2) => console.error('[ask] 전송 실패 (채널 권한 확인)', e2.message)); });
    };
    if (!q) return R(T('응? 물어볼 거 있으면 같이 써줘 (예: `야 쿠루마봇 오늘 도쿄 날씨`)', 'ん？質問も一緒に書いてね（例: `クルマ、今日の東京の天気`）'));
    if (q.length > MAX_IN) return R(T(`너무 김. ${MAX_IN}자 이내로 써줘`, `長すぎ！${MAX_IN}文字以内でお願い`));

    const st = L.state();
    if (!process.env.OPENAI_API_KEY || st.mode === 'deepl') return R(T('지금은 대답 못 함 😢 (AI 꺼져 있음)', '今は答えられない 😢（AIオフ中）'));
    const askYen = (st.ask?.usd || 0) * L.LLM.yen();
    if (L.yen() >= L.LLM.budget() || askYen >= +(process.env.ASK_BUDGET_YEN || 100)) return R(T('이번 달 질문 한도 다 씀 😢 다음 달에 다시!', '今月の質問上限に達した 😢 また来月！'));
    const owner = m.guild.ownerId === m.author.id;
    const key = `${today()}:${m.author.id}`;
    const limit = +(process.env.ASK_DAILY_LIMIT || 20);
    if (!owner && (daily.get(key) || 0) >= limit) return R(T(`오늘 질문 ${limit}번 다 씀. 내일 다시!`, `今日の質問${limit}回使い切った。また明日！`));
    if (busy.has(m.author.id)) return;

    busy.add(m.author.id);
    daily.set(key, (daily.get(key) || 0) + 1);
    if (daily.size > 500) for (const k of daily.keys()) if (!k.startsWith(today())) daily.delete(k);
    m.channel.sendTyping().catch(() => {});
    try {
      const isJa = ja || (/[ぁ-んァ-ン]/.test(q) && !/[가-힣]/.test(q));
      const a = await ask(q, isJa);
      st.ask = st.ask || { usd: 0, calls: 0 }; st.ask.calls++; L.save();
      await R(a.replace(/@(everyone|here)/g, '@​$1') || T('음… 대답이 안 나옴', 'うーん…答えが出なかった'));
    } catch (e) {
      console.error('[ask]', e.message);
      daily.set(key, Math.max(0, (daily.get(key) || 1) - 1));
      await R(T('지금 대답 못 함, 잠시 후 다시 해줘 😢', '今答えられない、少ししてからもう一回 😢') + (owner ? `\n-# 이유: ${e.message.slice(0, 150)}` : ''));
    } finally { busy.delete(m.author.id); }
  }
};
