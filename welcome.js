// welcome.js — 새 멤버가 들어오면 자유채팅에 소개 메시지 (GuildMembers 인텐트 필요)
// 채널: .env WELCOME_CHANNEL / 없으면 자유・雑談
const DEFAULT_CH = '1538870664688173066';
const ROLE_CH = '1539959375483904150';   // 🪪 역할・ロール
const HELLO_CH = '1539963147677597746';  // 🙌 안뇽・ようこそ

module.exports = function (client) {
  client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    const ch = await client.channels.fetch(process.env.WELCOME_CHANNEL || DEFAULT_CH).catch(() => null);
    if (!ch) return;
    const text = [
      `👋 ${member} 어서 와! 쿠루마 서버에 온 걸 환영해 🎉`,
      `한국어로 쓰면 일본어로, 일본어로 쓰면 한국어로 자동 번역돼. <#${ROLE_CH}> 에서 역할 고르고 <#${HELLO_CH}> 에서 인사해줘!`,
      `-# 👋 ${member} いらっしゃい！くるまサーバーへようこそ 🎉`,
      `-# 韓国語で書くと日本語に、日本語で書くと韓国語に自動翻訳されるよ。<#${ROLE_CH}> でロールを選んで、<#${HELLO_CH}> で挨拶してね！`,
    ].join('\n');
    ch.send({ content: text, allowedMentions: { users: [member.id] } })
      .then(() => console.log('[welcome] 소개 보냄'))
      .catch((e) => console.error('[welcome] 전송 실패', e.message));
  });
};
