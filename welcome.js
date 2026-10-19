// welcome.js — 새 멤버가 들어오면 자유채팅에 소개 메시지 (GuildMembers 인텐트 필요)
// 채널: .env WELCOME_CHANNEL / 없으면 자유・雑談
const DEFAULT_CH = '1538870664688173066';

module.exports = function (client) {
  client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    const ch = await client.channels.fetch(process.env.WELCOME_CHANNEL || DEFAULT_CH).catch(() => null);
    if (!ch) return;
    const text = `${member} 어서 오고... 한마디 하고 가\n-# ${member} いらっしゃい…一言どうぞ`; // WELCOME_B
    ch.send({ content: text, allowedMentions: { users: [member.id] } })
      .then(() => console.log('[welcome] 소개 보냄'))
      .catch((e) => console.error('[welcome] 전송 실패', e.message));
  });
};
