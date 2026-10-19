// member-count.js — "Members: 21" 같은 음성채널 이름의 숫자를 서버 인원수로 자동 갱신
// 채널: .env MEMBER_COUNT_CHANNELS (쉼표 구분) / 없으면 이름이 "Members: 숫자" 형태인 채널 자동 탐색
const INTERVAL_MIN = 10;   // 디코 제한: 채널 이름 변경은 10분에 2번까지
const NAME_RE = /(members|member|멤버|인원|メンバー)\s*[:：]?\s*[\d,]+/i;

module.exports = function (client) {
  let last = {};   // 채널별 마지막 변경 시각

  async function update(force = false) {
    const fixed = (process.env.MEMBER_COUNT_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const g0 of client.guilds.cache.values()) {
      let count;
      try {
        const g = await client.guilds.fetch({ guild: g0.id, withCounts: true, force: true });
        count = g.approximateMemberCount ?? g.memberCount;
      } catch (e) { console.error('[member-count] 인원 조회 실패', e.message); continue; }
      const chs = g0.channels.cache.filter((c) => (fixed.length ? fixed.includes(c.id) : NAME_RE.test(c.name)));
      for (const ch of chs.values()) {
        const name = NAME_RE.test(ch.name) ? ch.name.replace(/[\d,]+/, String(count)) : `Members: ${count}`;
        if (name === ch.name) continue;
        if (!force && Date.now() - (last[ch.id] || 0) < 5 * 60e3) continue;
        try {
          await ch.setName(name, 'member count');
          last[ch.id] = Date.now();
          console.log(`[member-count] ${ch.name} → ${name}`);
        } catch (e) { console.error(`[member-count] ${ch.name} 이름 변경 실패 (채널 관리 권한 확인)`, e.message); }
      }
    }
  }

  client.once('clientReady', () => {
    setTimeout(() => update().catch(console.error), 15000);
    setInterval(() => update().catch(console.error), INTERVAL_MIN * 60e3);
  });
  client.on('messageCreate', (m) => {
    if (m.author?.bot) return;
    if (/^!(멤버수|メンバー数|members)$/i.test((m.content || '').trim())) {
      update(true).then(() => m.react('✅').catch(() => {})).catch(console.error);
    }
  });
};
// WARNFIX: ready -> clientReady
