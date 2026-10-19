const X = (s) => `<x>${s}</x>`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ───────── 수동 단어장: 오역 보이면 여기 추가 [한국어, 일본어] ─────────
const fs = require('fs');
const path = require('path');
const TERMS_FILE = path.join(__dirname, 'terms.json');
const TERM_PAIRS = [];
let TERMS = [];
function loadTerms() {
  try { TERMS = JSON.parse(fs.readFileSync(TERMS_FILE, 'utf8')); }
  catch { TERMS = [{ from: '섹시상', to: 'セクシーさん' }, { from: 'セクシーさん', to: '섹시상' }]; saveTerms(); }
}
function saveTerms() { fs.writeFileSync(TERMS_FILE, JSON.stringify(TERMS, null, 1)); }
function upsertTerm(from, to, by) {
  TERMS = TERMS.filter((t) => t.from !== from);
  TERMS.push({ from, to, by });
}
loadTerms();
const KO_ONLY = [
  // GREET 인사 (존댓말 먼저)
  [/좋은\s*아침(이에요|이예요|입니다|이에용|이에여|요)/g, 'おはようございます'],
  [/좋은\s*아침|굿\s*모닝|굿모닝/g, 'おはよう'],
  [/안녕히\s*주무세요|안녕히\s*주무십시오/g, 'おやすみなさい'],
  [/잘\s*자요|잘\s*자세요/g, 'おやすみなさい'],
  [/(?<![가-힣])잘\s*자(?![가-힣])|굿\s*나잇|굿나잇|굿밤/g, 'おやすみ'],
  [/수고\s*하셨습니다|수고\s*하셨어요|수고\s*많으셨습니다|고생\s*하셨습니다|고생\s*하셨어요/g, 'お疲れ様です'],
  [/(수고|고생)\s*(했어요|했습니다|하셨어요|하셨습니다|많으셨어요|많으셨습니다)/g, 'お疲れ様です'],
  [/수고\s*했어|수고\s*했다|고생\s*했어|수고링|수고요/g, 'お疲れ'],
  [/잘\s*먹겠습니다/g, 'いただきます'], [/잘\s*먹었습니다/g, 'ごちそうさまでした'],
  [/다녀오겠습니다/g, 'いってきます'], [/다녀왔습니다/g, 'ただいま'],
  [/오랜만이에요|오랜만입니다/g, 'お久しぶりです'], [/오랜만(이야|이다)?(?![가-힣])/g, '久しぶり'],
  [/레포(?!트)/g, 'REPO'],
  [/몬헌/g, 'モンハン'], [/데바데/g, 'DbD'], [/배그/g, 'PUBG'], [/에펙/g, 'APEX'],
  [/롤(?=\s|$|[을를이가은는도만하])/g, 'LoL'],
  [/노잼/g, 'つまらん'], [/꿀잼/g, 'めっちゃ面白い'], [/개꿀/g, '最高'],
  [/멘붕/g, 'パニック'], [/존맛(탱)?/g, 'めっちゃうまい'], [/레알/g, 'マジ'],
  [/(?<=^|\s)헐(?=\s|$|[ㅋ~!?.])/g, 'えっ'],
];
const JA_ONLY = [
  [/おはようございます|おはようございまーす/g, '좋은 아침이에요'],
  [/おはよう|おは(?![ぁ-ん])|おっは/g, '좋은 아침'],
  [/おやすみなさい/g, '안녕히 주무세요'], [/おやすみ|おやすー/g, '잘 자'],
  [/お疲れ様です|お疲れさまです|お疲れ様でした|お疲れさまでした/g, '수고하셨습니다'],
  [/お疲れ(様|さま)?|おつかれ/g, '수고했어'],
  [/いってきます|行ってきます/g, '다녀올게'], [/ただいま/g, '다녀왔어'],
  [/お久しぶりです/g, '오랜만이에요'], [/久しぶり|ひさしぶり/g, '오랜만이야'],
  [/大草原/g, 'ㅋㅋㅋㅋㅋ'],
  [/(?<![一-龠])草生え[るたてまし]*/g, 'ㅋㅋㅋ'],
  [/(?<![一-龠])草(?=\s|$|[wｗ!！?？。])/g, 'ㅋㅋㅋ'],
  [/[（(]笑[)）]/g, 'ㅋㅋ'],
  [/ワロタ|ワロス/g, 'ㅋㅋㅋ'],
  [/それな/g, 'ㅇㅈ'],
  [/(?<=^|\s)(りょ|りょうかい|りょーかい)(?=\s|$|[!！~～])/g, 'ㅇㅋ'],
  [/(?<=^|\s)(おつ|乙)(?=\s|$|[!！~～ー])/g, '수고'],
  [/ぴえん/g, 'ㅠㅠ'],
  [/エモい/g, '감성 터짐'],
];
const CHOSEONG = {
  'ㅇㅇ': 'うんうん', 'ㅇㅋ': 'OK', 'ㄴㄴ': 'いやいや', 'ㄱㄱ': '行こ',
  'ㄱㅅ': 'ありがと', 'ㄳ': 'ありがと', 'ㅈㅅ': 'ごめん', 'ㅊㅋ': 'おめでと',
  'ㅅㄱ': 'おつ', 'ㄹㅇ': 'マジ', 'ㅇㅈ': 'それな', 'ㄷㄷ': 'ガクブル',
  'ㅎㄷㄷ': 'ガクブル', 'ㅂㅂ': 'バイバイ', 'ㅎㅇ': 'やほ', 'ㄱㅇㅇ': 'かわいい',
  'ㅁㅊ': 'やば', 'ㅇㄷ': 'どこ', 'ㅈㄱㄴ': 'タイトル通り',
};
const KO_HONORIFIC = { '상': 'さん', '씨': 'さん', '님': 'さん', '짱': 'ちゃん', '쿤': 'くん', '사마': 'さま' };
const JA_HONORIFIC = { 'さん': '상', 'ちゃん': '짱', 'くん': '쿤', '君': '쿤', 'さま': '사마', '様': '사마' };

let namePairs = [];
const NAMES_FILE = require('path').join(__dirname, 'names.json');
let EXTRA_NAMES = [];
try { EXTRA_NAMES = JSON.parse(require('fs').readFileSync(NAMES_FILE, 'utf8')); } catch {}
let baseNames = [];
function setNames(pairs) {
  if (pairs) baseNames = pairs;
  namePairs = [...EXTRA_NAMES.map(([ko, ja]) => [ko, [ja]]), ...baseNames].sort((x, y) => y[0].length - x[0].length);
}
async function handleNameCommand(m, arg) {
  const R = (c) => m.reply({ content: c, allowedMentions: { repliedUser: false } });
  const save = () => { require('fs').writeFileSync(NAMES_FILE, JSON.stringify(EXTRA_NAMES, null, 1)); setNames(); };
  const del = arg.match(/^(삭제|削除|del|remove)\s+(.+)$/i);
  if (!arg || /^(목록|一覧|list)$/i.test(arg)) {
    const list = EXTRA_NAMES.map(([k, j]) => `${k} ↔ ${j}`).join('\n') || '(없음 / なし)';
    return R(`👤 **이름 사전 / 名前辞書** (${EXTRA_NAMES.length})\n${list}\n-# 추가/追加: \`!이름 느그리 = ヌグリ\` · 삭제/削除: \`!이름 삭제 느그리\`\n-# 상/짱/쿤/님 ↔ さん/ちゃん/くん 자동 처리`);
  }
  if (del) {
    const w = unquote(del[2]), n = EXTRA_NAMES.length;
    EXTRA_NAMES = EXTRA_NAMES.filter(([k, j]) => k !== w && j !== w);
    save();
    return R(n !== EXTRA_NAMES.length ? `🗑️ 삭제 / 削除: ${w}` : `❓ 없음 / 見つかりません: ${w}`);
  }
  const add = arg.match(/^(.+?)\s*=\s*(.+)$/);
  if (!add) return R('형식 / 形式: `!이름 느그리 = ヌグリ`');
  let [, a, b] = add; a = unquote(a); b = unquote(b);
  if (!/[가-힣]/.test(a) && /[가-힣]/.test(b)) [a, b] = [b, a];
  if (!/[가-힣]/.test(a) || /[가-힣]/.test(b)) return R('❌ 한국어 = 일본어 순서로 / 韓国語 = 日本語');
  EXTRA_NAMES = EXTRA_NAMES.filter(([k]) => k !== a);
  EXTRA_NAMES.push([a, b]);
  save();
  return R(`✅ 이름 등록 / 登録: ${a} ↔ ${b}\n-# ${a}상 ↔ ${b}さん 도 자동 / も自動`);
}

const JONG_K = 24, JONG_H = 27;
function splitLaughJong(s) {
  return s.replace(/([가-힣])(?=[ㅋㅎ]|\s*[ㅋㅎ]|$|\s)/g, (ch, _a, off, str) => {
    const c = ch.charCodeAt(0) - 0xac00;
    const jong = c % 28;
    if (jong !== JONG_K && jong !== JONG_H) return ch;
    if ('엌녘읔킄'.includes(ch)) return ch;
    if (jong === JONG_H && !/^\s*ㅎ/.test(str.slice(off + 1))) return ch;
    return String.fromCharCode(0xac00 + c - jong) + (jong === JONG_K ? 'ㅋ' : 'ㅎ');
  });
}

function preKO(s) {
  s = splitLaughJong(s);
  s = s.replace(/([가-힣])[ㅏㅑㅓㅕㅗㅛㅡㅣㅐㅔ]+/g, '$1～');
  s = s.replace(/[ㅠㅜ]{2,}/g, () => X('😭'));
  for (const [ko, jas] of namePairs)
    for (const [h, jh] of Object.entries(KO_HONORIFIC))
      s = s.replace(new RegExp(esc(ko + h), 'g'), X(jas[0] + jh));
  s = s.replace(/ㅋ(?:\s*ㅋ)*/g, (m) => X('w'.repeat(Math.min(m.replace(/\s/g, '').length, 8))));
  s = s.replace(/ㅎ{2,}/g, () => X('ふふ'));
  const keys = Object.keys(CHOSEONG).sort((a, b) => b.length - a.length);
  s = s.replace(new RegExp(`(^|[\\s!?.~～])(${keys.map(esc).join('|')})+(?=$|[\\s!?.~～<])`, 'g'),
    (m, pre, k) => pre + X(CHOSEONG[k]));
  for (const [re, ja] of KO_ONLY) s = s.replace(re, () => X(ja));
  return s;
}

function preJA(s) {
  s = s.replace(/[wｗ]{2,}/g, (m) => X('ㅋ'.repeat(Math.min(m.length + 1, 8))));
  s = s.replace(/([ぁ-んァ-ヶ一-龠ー!！?？])[wｗ](?=$|\s)/g, '$1' + X('ㅋㅋ'));
  for (const [ko, jas] of namePairs)
    for (const ja of jas)
      for (const [h, kh] of Object.entries(JA_HONORIFIC))
        s = s.replace(new RegExp(esc(ja + h), 'g'), X(ko + kh));
  for (const [re, ko] of JA_ONLY) s = s.replace(re, () => X(ko));
  return s;
}

function mapOutside(s, fn) {
  return s.split(/(<x>[\s\S]*?<\/x>)/).map((p) => (p.startsWith('<x>') ? p : fn(p))).join('');
}
function applyTerms(s) {
  const list = [...TERMS].sort((a, b) => b.from.length - a.from.length);
  for (const { from, to } of list) s = mapOutside(s, (p) => p.split(from).join(X(to)));
  return s;
}
function protectPlainNames(s, target) {
  const map = [];
  for (const [ko, jas] of namePairs) {
    if (target === 'JA') map.push([ko, jas[0]]);
    else for (const ja of jas) map.push([ja, ko]);
  }
  map.sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of map) s = mapOutside(s, (p) => p.split(from).join(X(to)));
  return s;
}
const onlyProtected = (s) => s.replace(/<x>[\s\S]*?<\/x>/g, '').replace(/[\s!?.~～〜ー！？。、]/g, '') === '';
const stripTags = (s) => s.replace(/<\/?x>/g, '');
const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const history = new Map();
const contextFor = new Map();
const authorFor = new Map();
const PRONOUN_FILE = path.join(__dirname, 'pronouns.json');
let PRONOUNS = {};
try { PRONOUNS = JSON.parse(fs.readFileSync(PRONOUN_FILE, 'utf8')); } catch {}
function applyPronoun(out, target, src) {
  let p = PRONOUNS[authorFor.get(src)] ?? (process.env.DEFAULT_PRONOUN || '私');
  if (p === 'keep') p = null;
  if (target !== 'JA' || !p) return out;
  return out.replace(/(僕|俺|ボク|オレ)(ら|たち|達)/g, p + 'たち').replace(/僕|俺|ボク|オレ/g, p);
}
async function handlePronounCommand(m, arg) {
  const R = (content) => m.reply({ content, allowedMentions: { repliedUser: false } });
  if (!arg) return R('기본 私 / デフォルト私 · 변경: `!일인칭 俺` · 그대로: `!일인칭 그대로` · 기본값: `!일인칭 해제`');
  if (/^(그대로|원래|そのまま|keep)$/i.test(arg)) {
    PRONOUNS[m.author.id] = 'keep';
    fs.writeFileSync(PRONOUN_FILE, JSON.stringify(PRONOUNS, null, 1));
    return R('✅ 1인칭 그대로 / 一人称そのまま');
  }
  if (/^(해제|解除|off|reset)$/i.test(arg)) {
    delete PRONOUNS[m.author.id];
    fs.writeFileSync(PRONOUN_FILE, JSON.stringify(PRONOUNS, null, 1));
    return R('🗑️ 기본값(私)으로 / デフォルト(私)に戻しました');
  }
  if (arg.length > 6) return R('❌ 6자 이내 / 6文字以内');
  PRONOUNS[m.author.id] = arg;
  fs.writeFileSync(PRONOUN_FILE, JSON.stringify(PRONOUNS, null, 1));
  return R(`✅ 내 1인칭 / 一人称: ${arg}`);
}
let detectFn = null;

let clientRef = null;
async function weeklyReport(reset = true) {   // LLM_WEEKLY
  const ch = process.env.TR_TEST_CHANNEL; if (!ch || !clientRef) return;
  const c = await clientRef.channels.fetch(ch).catch(() => null); if (!c) return;
  const st = llmState(); const wk = st.wk || { usd: 0, calls: 0, fallback: 0 };
  const credit = +(process.env.LLM_CREDIT_USD || 5);
  const left = Math.max(0, credit - (st.total || 0));
  let dl = '';
  try {
    const r = await fetch('https://api-free.deepl.com/v2/usage', { headers: { Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}` } });
    const u = await r.json(); dl = `${u.character_count.toLocaleString()} / ${u.character_limit.toLocaleString()}자 (${Math.round(u.character_count / u.character_limit * 100)}%)`;
  } catch { dl = '조회 실패'; }
  const now = !process.env.OPENAI_API_KEY ? 'DeepL (키 없음)' : st.mode === 'deepl' ? `DeepL 고정${st.reason ? ' (' + st.reason + ')' : ''}` : llmYen() >= LLM.budget() ? 'DeepL (이번 달 한도)' : `GPT (${LLM.model()})`;
  await c.send({ content: [
    '📊 **번역 주간 리포트**',
    `지금: ${now}`,
    `이번 주: GPT ${wk.calls}회 · 약 ${(wk.usd * LLM.yen()).toFixed(1)}엔 · DeepL 대체 ${wk.fallback}회`,
    `이번 달(${st.month}): 약 ${llmYen().toFixed(1)}엔 / ${LLM.budget()}엔` + (st.ask ? ` (이 중 "야 쿠루마" ${st.ask.calls}회 · 약 ${(st.ask.usd * LLM.yen()).toFixed(1)}엔)` : ''),
    `OpenAI 남은 크레딧(추정): 약 $${left.toFixed(2)} / $${credit}` + (wk.usd > 0 ? ` · 이 속도면 ${left / wk.usd > 104 ? '2년 이상' : '약 ' + Math.round(left / wk.usd) + '주'}` : ''),
    `DeepL 이번 주기: ${dl}`,
    '-# 추정치라 실제 잔액은 OpenAI Billing에서 확인',
  ].join('\n') }).catch(() => {});
  if (reset) { st.wk = { usd: 0, calls: 0, fallback: 0 }; saveLlm(); }
}
function scheduleWeekly() {
  const J = new Date(Date.now() + 9 * 3600e3);
  const next = new Date(Date.UTC(J.getUTCFullYear(), J.getUTCMonth(), J.getUTCDate(), 1, 0, 0));   // 10:00 JST = 01:00 UTC
  let add = (8 - J.getUTCDay()) % 7; if (add === 0 && J.getUTCHours() >= 10) add = 7;
  const wait = next.getTime() + add * 86400e3 - Date.now();
  setTimeout(async () => { await weeklyReport().catch((e) => console.error('[llm] 리포트', e.message)); scheduleWeekly(); }, Math.max(60e3, wait));
}
function attach(client, pairs, detect) {
  clientRef = client;
  client.once('clientReady', scheduleWeekly);
  setNames(pairs);
  detectFn = detect || null;
  client.prependListener('messageCreate', (m) => {
    if (m.author?.bot || m.webhookId || !m.content) return;
    const h = history.get(m.channelId) || [];
    contextFor.set(m.content, h.slice(-3).join('\n'));
    authorFor.set(m.content, m.author.id);
    if (authorFor.size > 300) authorFor.delete(authorFor.keys().next().value);
    if (contextFor.size > 300) contextFor.delete(contextFor.keys().next().value);
    h.push(m.content.slice(0, 200));
    if (h.length > 5) h.shift();
    history.set(m.channelId, h);
  });
  client.on('messageCreate', (m) => {
    if (m.author?.bot || m.webhookId) return;
    const mm = (m.content || '').match(/^!(단어|用語|word)(?:\s+([\s\S]*))?$/i);
    if (mm) handleTermCommand(m, (mm[2] || '').trim()).catch((e) => console.error('[tr] 단어장', e));
    const nm = (m.content || '').match(/^!(이름|名前|name)(?:\s+([\s\S]*))?$/i);
    if (nm) handleNameCommand(m, (nm[2] || '').trim()).catch((e) => console.error('[tr] 이름', e));
    const pm = (m.content || '').match(/^!(일인칭|一人称)(?:\s+(.*))?$/);
    if (pm) handlePronounCommand(m, (pm[2] || '').trim()).catch((e) => console.error('[tr] 일인칭', e));
    const cm = (m.content || '').match(/^!(비교|比較)\s+([\s\S]+)$/);
    if (cm && (m.channelId === process.env.TR_TEST_CHANNEL || m.guild?.ownerId === m.author.id)) (async () => {
      const src = cm[2].trim(); const tgt = /[가-힣ㄱ-ㅎ]/.test(src) ? 'JA' : 'KO';
      const g = await llmTranslate(src, tgt).catch((e) => '(실패: ' + e.message + ')');
      const d = await translate(src, tgt, true).catch((e) => '(실패: ' + e.message + ')');
      await m.reply({ content: `🤖 GPT: ${g || '(사용 안 함: 한도/모드/길이)'}\n📘 DeepL: ${d}`, allowedMentions: { repliedUser: false } });
    })().catch((e) => console.error('[llm] 비교', e));
    if (/^!(번역리포트|翻訳レポート)$/.test((m.content || '').trim()) && (m.channelId === process.env.TR_TEST_CHANNEL || m.guild?.ownerId === m.author.id))
      weeklyReport(false).catch((e) => console.error('[llm] 리포트', e.message));
    const lm = (m.content || '').match(/^!(번역상태|翻訳ステータス)(?:\s+(.*))?$/);
    if (lm) handleLlmCommand(m, (lm[2] || '').trim()).catch((e) => console.error('[llm] 상태', e));
  });
  console.log('[tr] translate-rules 적용됨');
}

const HAS_KO = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
const unquote = (x) => String(x).trim().replace(/^["“”「『]+|["“”」』]+$/g, '').trim();
async function handleTermCommand(m, arg) {
  const by = m.member?.displayName || m.author.username;
  const del = arg.match(/^(삭제|削除|del|remove)\s+(.+)$/i);
  const R = (content) => m.reply({ content, allowedMentions: { repliedUser: false } });
  if (!arg || /^(목록|一覧|list)$/i.test(arg)) {
    const seen = new Set(), lines = [];
    for (const t of TERMS) {
      const back = TERMS.find((u) => u.from === t.to && u.to === t.from);
      const key = back ? [t.from, t.to].sort().join('|') : t.from + '>' + t.to;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(back ? `${t.from} ↔ ${t.to}` : `${t.from} → ${t.to}`);
    }
    let body = lines.length ? lines.join('\n') : '(없음 / なし)';
    if (body.length > 1700) body = body.slice(0, 1700) + '\n…';
    return R('📖 **단어장 / 用語集** (' + lines.length + ')\n' + body +
      '\n-# 추가/追加: `!단어 섹시상 = セクシーさん` (양방향) · `!단어 레포 > REPO` (한쪽만)\n-# 삭제/削除: `!단어 삭제 섹시상`');
  }
  if (del) {
    const w = unquote(del[2]), before = TERMS.length;
    const pair = TERMS.find((t) => t.from === w);
    TERMS = TERMS.filter((t) => t.from !== w && !(pair && t.from === pair.to && t.to === w));
    saveTerms();
    return R(before !== TERMS.length ? `🗑️ 삭제 / 削除: ${w}` : `❓ 없음 / 見つかりません: ${w}`);
  }
  const add = arg.match(/^(.+?)\s*(=|>)\s*(.+)$/);
  if (!add) return R('형식 / 形式: `!단어 섹시상 = セクシーさん` · `!단어 레포 > REPO`');
  let [, a, op, b] = add;
  a = unquote(a); b = unquote(b);
  if (!a || a.length > 40 || b.length > 40) return R('❌ 40자 이내 / 40文字以内');
  if (op === '=') {
    if (!HAS_KO.test(a) && HAS_KO.test(b)) [a, b] = [b, a];
    upsertTerm(a, b, by); upsertTerm(b, a, by);
  } else upsertTerm(a, b, by);
  saveTerms();
  return R(`✅ 등록 / 登録: ${a} ${op === '=' ? '↔' : '→'} ${b}`);
}

function politeOf(text, target) {
  const polite = target === 'JA'
    ? /(요|니다|니까|세요|십시오|죠)(?=[\s!?.~～ㅋㅎㅠㅜ^]|$)/.test(text)
    : /(です|ます|でした|ました|ません|ください)/.test(text);
  return polite ? 'prefer_more' : 'prefer_less';
}

function srcLang(text, target) {
  if (target === 'JA' && /[가-힣]/.test(text)) return { source_lang: 'KO' };
  if (target === 'KO' && /[ぁ-んァ-ヶ一-龠]/.test(text)) return { source_lang: 'JA' };
  return {};
}


// ───────── LLM_TRANSLATE: GPT 번역 (월 예산 넘거나 실패하면 DeepL) ─────────
const LLM_FILE = path.join(__dirname, 'llm-usage.json');
const LLM = {
  model: () => process.env.OPENAI_MODEL || 'gpt-6-luna',
  priceIn: () => +(process.env.LLM_PRICE_IN || 0.10),    // $ / 1M 입력 토큰
  priceOut: () => +(process.env.LLM_PRICE_OUT || 0.50),  // $ / 1M 출력 토큰
  yen: () => +(process.env.LLM_USDJPY || 165),           // 세금·수수료 포함 넉넉하게
  budget: () => +(process.env.LLM_BUDGET_YEN || 500),
  maxLen: 200,                                           // 이보다 긴 글은 DeepL
  timeout: 8000,
};
const monthKey = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
let llmUse = { month: monthKey(), usd: 0, calls: 0, fallback: 0, mode: 'auto' };
try { llmUse = { ...llmUse, ...JSON.parse(fs.readFileSync(LLM_FILE, 'utf8')) }; } catch {}
function llmState() {
  if (llmUse.month !== monthKey()) llmUse = { month: monthKey(), usd: 0, calls: 0, fallback: 0, mode: llmUse.mode || 'auto', reason: llmUse.reason || '', total: llmUse.total || 0, wk: llmUse.wk || { usd: 0, calls: 0, fallback: 0 } };
  return llmUse;
}
const saveLlm = () => { try { fs.writeFileSync(LLM_FILE, JSON.stringify(llmUse)); } catch {} };
const llmYen = () => llmState().usd * LLM.yen();

function llmGlossary(text, target) {
  const lines = [];
  for (const { from, to } of TERMS) if (text.includes(from)) lines.push(`${from} → ${to}`);
  for (const [ko, jas] of namePairs) {
    if (target === 'JA' && text.includes(ko)) lines.push(`${ko} → ${jas[0]} (name)`);
    if (target === 'KO') for (const ja of jas) if (text.includes(ja)) lines.push(`${ja} → ${ko} (name)`);
  }
  return [...new Set(lines)].slice(0, 30);
}

async function llmTranslate(text, target) {
  const st = llmState();
  if (!process.env.OPENAI_API_KEY || st.mode === 'deepl' || text.length > LLM.maxLen) return null;
  if (llmYen() >= LLM.budget()) return null;
  const toJA = target === 'JA';
  let pron = PRONOUNS[authorFor.get(text)] ?? (process.env.DEFAULT_PRONOUN || '私');
  if (pron === 'keep') pron = null;
  const gloss = llmGlossary(text, target);
  const ctx = contextFor.get(text);
  const sys = [
    `You translate casual Discord chat between Korean and Japanese friends into natural ${toJA ? 'Japanese' : 'Korean'}.`,
    'Rules:',
    toJA ? '- Keep the speaker\'s register: 반말 → タメ口, 존댓말(요/니다) → です・ます. Sound like a real young person chatting, not a textbook.'
         : '- Keep the speaker\'s register: タメ口 → 반말, です・ます → 존댓말(요). Sound like a real young Korean chatting, not a textbook.',
    toJA ? '- ㅋㅋ → w (more ㅋ = more w), ㅎㅎ → ふふ, ㅠㅠ/ㅜㅜ → 😭. Interpret Korean slang, abbreviations and 초성 by meaning.'
         : '- w/ｗ/草 → ㅋㅋ, (笑) → ㅋㅋ, ぴえん → ㅠㅠ. Interpret Japanese net slang by meaning.',
    '- Honorifics on names: 상/씨/님 ↔ さん, 짱 ↔ ちゃん, 쿤 ↔ くん.',
    toJA && pron ? `- The speaker refers to themself as 「${pron}」. Use 「${pron}」 for first person (not 僕/俺 unless that is it).` : '',
    '- Keep emojis, URLs, @mentions, <...> tags, game titles and English words as they are.',
    gloss.length ? '- Glossary (must use):\n' + gloss.map((g) => '  ' + g).join('\n') : '',
    '- Previous messages are context only. Translate ONLY the message. Output only the translation, no quotes or notes.',
  ].filter(Boolean).join('\n');
  const user = (ctx ? `[previous messages]\n${ctx}\n\n` : '') + `[message]\n${text}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM.timeout);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM.model(), messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max_completion_tokens: 600 }),
      signal: ac.signal,
    });
    const j = await res.json().catch(() => ({}));
    st.wk = st.wk || { usd: 0, calls: 0, fallback: 0 };
    if (j.usage) {
      const c = ((j.usage.prompt_tokens || 0) * LLM.priceIn() + (j.usage.completion_tokens || 0) * LLM.priceOut()) / 1e6;
      st.usd += c; st.total = (st.total || 0) + c; st.wk.usd += c;
    }
    if (!res.ok) {   // LLM_QUOTA_SWITCH
      if (res.status === 401 || res.status === 403 || j.error?.code === 'insufficient_quota' || j.error?.type === 'insufficient_quota') {
        st.mode = 'deepl'; st.reason = res.status === 401 || res.status === 403 ? '키 오류' : '크레딧 소진';
        console.log(`[llm] ${st.reason} → 이제부터 DeepL만 사용`);
      }
      throw new Error(`OpenAI HTTP ${res.status} ${j.error?.message || ''}`.slice(0, 200));
    }
    let out = String(j.choices?.[0]?.message?.content || '').trim().replace(/^\[?message\]?\s*/i, '').replace(/^["「『](.*)["」』]$/s, '$1').trim();
    if (!out) throw new Error('빈 응답');
    if (toJA && /[가-힣]{2,}/.test(out.replace(/<[^>]+>/g, ''))) throw new Error('한국어가 남음');
    if (!toJA && /[ぁ-ん]{2,}/.test(out)) throw new Error('일본어가 남음');
    st.calls++; st.wk.calls++;
    return toJA && pron ? out.replace(/(僕|俺|ボク|オレ)(ら|たち|達)/g, pron + 'たち').replace(/僕|俺|ボク|オレ/g, pron) : out;
  } catch (e) {
    st.fallback++; if (st.wk) st.wk.fallback++;
    throw e;
  } finally { clearTimeout(timer); saveLlm(); }
}

async function handleLlmCommand(m, arg) {
  const R = (content) => m.reply({ content, allowedMentions: { repliedUser: false } });
  const st = llmState();
  if (/^(gpt|auto|deepl)$/i.test(arg)) {
    if (m.guild?.ownerId !== m.author.id) return R('❌ 서버 주인만 / サーバー主のみ');
    st.mode = /deepl/i.test(arg) ? 'deepl' : 'auto'; st.reason = st.mode === 'deepl' ? '수동' : ''; saveLlm();
    return R(`✅ 번역 모드 / 翻訳モード: ${st.mode === 'deepl' ? 'DeepL 고정' : 'GPT (한도 넘으면 DeepL)'}`);
  }
  const over = llmYen() >= LLM.budget();
  const now = !process.env.OPENAI_API_KEY ? 'DeepL (OpenAI 키 없음)' : st.mode === 'deepl' ? `DeepL (고정${st.reason ? ': ' + st.reason : ''})` : over ? 'DeepL (이번 달 한도 도달)' : `GPT (${LLM.model()})`;
  return R(`🌐 **번역 상태 / 翻訳ステータス** (${st.month})\n` +
    `지금 / 現在: ${now}\n` +
    `이번 달 / 今月: 약 ${llmYen().toFixed(1)}엔 / ${LLM.budget()}엔 · GPT ${st.calls}회 · DeepL 대체 ${st.fallback}회\n` +
    `-# 서버 주인: \`!번역상태 deepl\` (DeepL 고정) · \`!번역상태 gpt\` (다시 GPT)`);
}

const TR_LOG_FILE = path.join(__dirname, 'tr-log.jsonl');
async function logCompare(text, target, gpt) {
  const ch = process.env.TR_TEST_CHANNEL;
  if (process.env.TR_LOG !== '1' && !ch) return;
  try {
    const deepl = await translate(text, target, true);
    // CMP_NORM: 마침표/띄어쓰기/문장부호만 다르면 같은 번역으로 본다
    const norm = (x) => String(x).normalize('NFKC').replace(/[\s\p{P}~ー\p{Extended_Pictographic}\u200d\ufe0f]/gu, ''); // CMP_NORM2: ~, ー, 이모지 차이도 무시
    if (!deepl || norm(deepl) === norm(gpt)) return;
    if (ch && clientRef) {
      const c = await clientRef.channels.fetch(ch).catch(() => null);
      if (c) c.send({ content: `> ${text.slice(0, 300)}
🤖 GPT: ${gpt}
📘 DeepL: ${deepl}`.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
    }
    if (process.env.TR_LOG !== '1') return;
    const now = Date.now();
    let lines = [];
    try { lines = fs.readFileSync(TR_LOG_FILE, 'utf8').split('\n').filter(Boolean); } catch {}
    lines = lines.filter((l) => { try { return now - JSON.parse(l).t < 14 * 86400e3; } catch { return false; } });
    lines.push(JSON.stringify({ t: now, to: target, src: text, gpt, deepl }));
    fs.writeFileSync(TR_LOG_FILE, lines.slice(-1500).join('\n') + '\n');
  } catch (e) { console.error('[tr-log]', e.message); }
}

async function translate(text, target, _deeplOnly) {
  if (!target && detectFn) target = detectFn(text);
  target = String(target || '').toUpperCase().startsWith('JA') ? 'JA' : 'KO';
  let s = mapOutside(text, escXml);
  s = applyTerms(s);
  s = mapOutside(s, (p) => (target === 'JA' ? preKO(p) : preJA(p)));
  s = protectPlainNames(s, target).replace(/<\/x><x>/g, '');
  if (onlyProtected(s)) return unescXml(stripTags(s));
  const viaLlm = _deeplOnly ? null : await llmTranslate(text, target).catch((e) => { console.error('[llm] DeepL로 대체:', e.message); return null; });
  if (viaLlm) { logCompare(text, target, viaLlm); return viaLlm; }

  const body = { text: [s], target_lang: target, ...srcLang(text, target), tag_handling: 'xml', ignore_tags: ['x'], formality: politeOf(text, target) };
  const ctx = contextFor.get(text);
  if (ctx) body.context = ctx;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
    const j = await res.json();
    return applyPronoun(unescXml(stripTags(j.translations[0].text)).trim(), target, text);
  } finally { clearTimeout(timer); }
}

const llmShared = {   // LLM_SHARED: ask.js 가 번역과 같은 OpenAI 크레딧·월 한도를 같이 씀
  LLM, state: llmState, save: saveLlm, yen: llmYen,
  charge(usage) {
    const st = llmState(); if (!usage) return 0;
    const c = ((usage.prompt_tokens || 0) * LLM.priceIn() + (usage.completion_tokens || 0) * LLM.priceOut()) / 1e6;
    st.wk = st.wk || { usd: 0, calls: 0, fallback: 0 }; st.ask = st.ask || { usd: 0, calls: 0 };
    st.usd += c; st.total = (st.total || 0) + c; st.wk.usd += c; st.ask.usd += c;
    saveLlm(); return c;
  },
  disable(reason) { const st = llmState(); st.mode = 'deepl'; st.reason = reason; saveLlm(); console.log(`[llm] ${reason} → 이제부터 DeepL만 사용`); },
};
module.exports = { attach, translate, TERM_PAIRS, llmShared, postFix: (out, target, src) => (typeof applyPronoun === 'function' ? applyPronoun(out, target, src) : out) };
// WARNFIX: ready -> clientReady
