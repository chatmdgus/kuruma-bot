// voice-status.js — 음성 채널에 있는 사람들이 하는 게임을 채널 상태에 "🎮 게임명"으로 자동 표시 (VOICE_STATUS)
// 필요: 개발자 포털 Presence Intent 켜기 + .env PRESENCE_INTENT=1, 차봇 역할에 "음성 채널 상태 설정"(+ 안 되면 "채널 관리") 권한
// 사람이 직접 단 상태는 덮어쓰지 않음 (채널이 빌 때까지). 디스코드 문서에 없는 API라 바뀌면 조용히 멈춤
const { ActivityType } = require('discord.js');

module.exports = function (client) {
  if (process.env.PRESENCE_INTENT !== '1') { console.log('[voice-status] 꺼짐 (PRESENCE_INTENT=1 필요)'); return; }
  const mine = new Map();     // 채널 → 차봇이 단 상태 글
  const manual = new Set();   // 사람이 직접 상태를 단 채널
  const timers = new Map();
  let failed = 0;

  function games(ch) {
    const count = new Map();
    for (const mb of ch.members.values()) {
      if (mb.user.bot) continue;
      for (const a of mb.presence?.activities || []) {
        if (a.type !== ActivityType.Playing || !a.name) continue;
        count.set(a.name, (count.get(a.name) || 0) + 1);
      }
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }

  async function update(ch) {
    if (!ch?.isVoiceBased?.() || failed >= 5) return;
    const humans = ch.members.filter((m) => !m.user.bot).size;
    if (!humans) { mine.delete(ch.id); manual.delete(ch.id); return; }   // 비면 디스코드가 상태를 지움
    if (manual.has(ch.id)) return;
    const g = games(ch);
    const text = g.length ? ('🎮 ' + g.slice(0, 2).join(' · ')).slice(0, 100) : '';
    if (text === (mine.get(ch.id) || '')) return;
    if (!text && !mine.has(ch.id)) return;
    try {
      mine.set(ch.id, text);
      await client.rest.put(`/channels/${ch.id}/voice-status`, { body: { status: text } });
      failed = 0;
    } catch (e) {
      failed++;
      console.error('[voice-status] 상태 설정 실패 (권한 확인)', e.message);
    }
  }
  function later(ch) {
    if (!ch) return;
    clearTimeout(timers.get(ch.id));
    timers.set(ch.id, setTimeout(() => { timers.delete(ch.id); update(ch).catch(() => {}); }, 5000));
  }

  client.on('voiceStateUpdate', (o, n) => { later(o.channel); later(n.channel); });
  client.on('presenceUpdate', (_o, p) => later(p?.member?.voice?.channel));
  // 누가 상태를 직접 바꾸면 그 채널은 손대지 않음
  client.on('raw', (pkt) => {
    if (pkt.t !== 'VOICE_CHANNEL_STATUS_UPDATE') return;
    const { id, status } = pkt.d || {};
    if ((status || '') !== (mine.get(id) || '')) { manual.add(id); mine.delete(id); }
  });
};
