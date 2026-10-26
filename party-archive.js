// PARTY_ARCHIVE: 모집 채널 정리 — 끝난 모집글은 '지난 모집' 기록 메시지에 한 줄(날짜·게임·참가자)로 남기고 지움
//   지우는 건 차봇이 직접 쓴 글만: 마감된 모집글, 취소된 모집글, "10분 전이에요"/"하는 날" 알림. 사람 글은 건드리지 않음
//   30분마다 점검. 마감·알림 뒤 AFTER 지나야 지움 (바로 지우면 들어가려던 사람이 못 봄)
const fs = require('fs');
const STATE = __dirname + '/party-archive.json';
const AFTER = 3 * 3600e3;
const HEAD = '📜 **지난 모집 / 過去の募集**';
const JST = 9 * 3600e3;

let st = {};
try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
const save = () => { try { fs.writeFileSync(STATE, JSON.stringify(st)); } catch (e) { console.error('[party-archive] 저장 실패', e.message); } };

const mmdd = (ts) => { const d = new Date(ts + JST); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

// 📅 줄의 마지막 날짜(기간 모집이면 끝 날) + 시각(없으면 그날 끝) → 끝나는 시각. 날짜 없으면 null
function postEnd(c, created) {
  const line = (c.match(/^📅 (.*)$/m) || [])[1];
  if (!line) return null;
  const ds = [...line.matchAll(/(\d{1,2})\/(\d{1,2})/g)];
  if (!ds.length) return null;
  const [, mo, da] = ds[ds.length - 1];
  const tm = line.match(/(\d{1,2}):(\d{2})/);
  let y = new Date(created + JST).getUTCFullYear();
  const mk = (yy) => Date.UTC(yy, mo - 1, +da, tm ? +tm[1] : 23, tm ? +tm[2] : 59) - JST;
  let t = mk(y);
  if (t < created - 30 * 86400e3) t = mk(y + 1);   // 12월에 1월 모집
  return t;
}

// 메시지 하나를 보고 할 일 정함: { kind: 'closed'|'cancel'|'remind', at(기준 시각), line? }
function classify(m) {
  const c = m.content || '';
  let at = m.editedTimestamp || m.createdTimestamp;
  const isPost = /^@everyone\n🎮 \*\*/.test(c);
  const end = isPost && postEnd(c, m.createdTimestamp);   // 마감 표시 생기기 전 옛 모집글은 날짜로 판단
  if (c.includes('⏹️ 모집 마감') || (end && end < Date.now())) {
    if (end) at = Math.max(end, c.includes('⏹️ 모집 마감') ? at : 0);
    const title = (c.match(/🎮 \*\*(.+?)\*\*/) || [])[1];
    if (!title) return null;
    const when = c.match(/📅 [^\n]*?(\d{1,2}\/\d{1,2})/);
    let who = ((c.match(/^👥 (.*)$/m) || [])[1] || '').replace(/\s*\((\d+名|\d+\/\d+)\)\s*$/, '').trim();
    const n = who ? who.split(', ').length : 0;
    return { kind: 'closed', at, date: when ? when[1] : mmdd(at), line: `\`${when ? when[1] : mmdd(at)}\` ${title.split('ㅤ').join(' ')} — ${who || '-'}${n ? ` (${n})` : ''}` };
  }
  if (c.includes('❌ 모집이 취소됐어요')) return { kind: 'cancel', at };
  if (/^🎮 .*(10분 전이에요!|하는 날!)/.test(c)) return { kind: 'remind', at: m.createdTimestamp };
  return null;
}

async function sweep(client, getActive) {
  for (const chId of getActive().channels) {
    const ch = await client.channels.fetch(chId).catch(() => null);
    if (!ch?.messages) continue;
    const s = (st[chId] ||= { logIds: [] });
    const active = new Set(getActive().ids);
    // 최근 300개까지
    let msgs = [], before;
    for (let i = 0; i < 3; i++) {
      const b = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!b?.size) break;
      msgs.push(...b.values()); before = b.last().id;
      if (b.size < 100) break;
    }
    msgs = msgs.filter((m) => m.author?.id === client.user.id && !m.webhookId && !s.logIds.includes(m.id) && !active.has(m.id))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = [], del = [];
    for (const m of msgs) {
      const r = classify(m);
      if (!r || Date.now() - r.at < AFTER) continue;
      if (r.line) lines.push(r.line);
      del.push(m);
    }
    if (!del.length) continue;
    if (lines.length && !(await appendLog(ch, s, lines))) continue;   // 기록 못 남기면 지우지 않음
    for (const m of del) await m.delete().catch((e) => console.error('[party-archive] 삭제 실패', e.message));
    console.log(`[party-archive] ${ch.id} 기록 ${lines.length}줄, 삭제 ${del.length}개`);
  }
}

async function appendLog(ch, s, lines) {
  try {
    let last = s.logIds.length ? await ch.messages.fetch(s.logIds[s.logIds.length - 1]).catch(() => null) : null;
    for (const l of lines) {
      if (last && (last.content + '\n' + l).length <= 1900) { last = await last.edit({ content: last.content + '\n' + l, allowedMentions: { parse: [] } }); continue; }
      last = await ch.send({ content: `${HEAD}\n${l}`, allowedMentions: { parse: [] } });
      s.logIds.push(last.id);
      save();
    }
    save();
    return true;
  } catch (e) { console.error('[party-archive] 기록 실패', e.message); return false; }
}

module.exports = function (client, getActive) {
  let busy = false;
  const run = async () => {
    if (busy) return; busy = true;
    try { await sweep(client, getActive); } catch (e) { console.error('[party-archive]', e.message); }
    busy = false;
  };
  client.once('clientReady', () => { setTimeout(run, 60e3); setInterval(run, 30 * 60e3); });
};
module.exports.classify = classify;
