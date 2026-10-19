// welcome.js — 새 멤버가 들어오면 자유채팅에서 차봇·쿠루마봇이 한마디씩 (GuildMembers 인텐트 필요)
// 채널: .env WELCOME_CHANNEL / 없으면 자유・雑談. 대화는 입장할 때마다 1→2→3 순서
const fs = require('fs');
const os = require('os');
const path = require('path');
const DEFAULT_CH = '1538870664688173066';
const KURUMA_ID = '1561590994468601979';   // 쿠루마봇・クルマボット (웹훅 이름·사진용)
const STATE = path.join(os.homedir(), '.welcome-state.json');   // 저장소 밖 (자동 배포 안 막게)

// WELCOME_DUO: [차봇 한국어, 차봇 일본어, 쿠루마봇 한국어, 쿠루마봇 일본어]
const TALKS = [
  ['어서 오고... 한마디 하고 가', 'いらっしゃい…一言どうぞ', '너무 기대는 하지 마', 'あんまり期待はしないで'],
  ['왔네', '来たね', '...또 늘었네', '…また増えたな'],
  ['어서 오고... 한마디 하고 가', 'いらっしゃい…一言どうぞ', '말 걸면 번역은 해줌. 그 이상은 몰라', '話しかけたら翻訳はする。それ以上は知らん'],
];

module.exports = function (client) {
  client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    try {
      const ch = await client.channels.fetch(process.env.WELCOME_CHANNEL || DEFAULT_CH).catch(() => null);
      if (!ch) return;
      let n = 0;
      try { n = JSON.parse(fs.readFileSync(STATE, 'utf8')).n || 0; } catch {}
      const [ko, ja, kko, kja] = TALKS[n % TALKS.length];
      fs.writeFileSync(STATE, JSON.stringify({ n: (n + 1) % TALKS.length }));

      await ch.send({ content: `${member} ${ko}\n-# ${member} ${ja}`, allowedMentions: { users: [member.id] } });
      await new Promise((r) => setTimeout(r, 2000));
      const hooks = await ch.fetchWebhooks();
      const hook = hooks.find((h) => h.owner?.id === client.user.id) || await ch.createWebhook({ name: 'translator' });
      const kuruma = await client.users.fetch(KURUMA_ID).catch(() => null);
      await hook.send({
        content: `${kko}\n-# ${kja}`,
        username: kuruma?.username || '쿠루마봇・クルマボット',
        avatarURL: kuruma?.displayAvatarURL(),
        allowedMentions: { parse: [] },
      });
      console.log(`[welcome] 대화 ${n % TALKS.length + 1} 보냄`);
    } catch (e) { console.error('[welcome] 전송 실패', e.message); }
  });
};
