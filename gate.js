// gate.js — 칼봇(Carl-bot)에서 옮겨온 입구 기능 (CARL_MOVE)
//  1) 입장 인사: 들어오면 #안뇽·ようこそ 에 인사 + 역할 채널 안내 (번역 양식: 한국어 기본 글씨, 일본어 작은 글씨)
//  2) 국적 리액션 롤: #역할·ロール 의 차봇 메시지에서 🇰🇷/🇯🇵 누르면 역할 붙이고, 빼면 역할 뗌
//     메시지는 주인이 `!역할메시지` 한 번 치면 차봇이 올림 (ID는 ~/.kuruma-gate.json에 저장)
// 채널: .env GATE_CHANNEL / ROLE_CHANNEL (없으면 이름에 '안뇽'·'ようこそ' / '역할'·'ロール' 들어간 채널 자동)
// 입장 인사 끄기: 주인이 `!입장인사 끄기` (`켜기`로 다시)
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE = path.join(os.homedir(), '.kuruma-gate.json');
let st = {};
try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
const save = () => { try { fs.writeFileSync(STATE, JSON.stringify(st)); } catch (e) { console.error('[gate] 저장 실패', e.message); } };

const ROLES = { '🇰🇷': '1538868310274342962', '🇯🇵': '1538874107872018452' };   // 한국인・韓国人, 일본인・日本人

function findCh(guild, envKey, re) {
  const id = process.env[envKey];
  if (id) return guild.channels.cache.get(id) || null;
  return guild.channels.cache.find((c) => c.isTextBased?.() && !c.isVoiceBased?.() && !c.isThread?.() && re.test(c.name)) || null;
}
const gateCh = (g) => findCh(g, 'GATE_CHANNEL', /안뇽|ようこそ/);
const roleCh = (g) => findCh(g, 'ROLE_CHANNEL', /역할|ロール/);

const ROLE_TEXT = [
  '🌏 **국적 역할 선택**',
  '🇰🇷 한국인이라면 눌러주세요!',
  '🇯🇵 일본인이라면 눌러주세요!',
  '-# 🌏 国籍ロール選択',
  '-# 🇰🇷 韓国人なら押してください！',
  '-# 🇯🇵 日本人なら押してください！',
].join('\n');

module.exports = function (client) {
  // 1) 입장 인사
  client.on('guildMemberAdd', async (member) => {
    try {
      if (member.user.bot || st.greetOff) return;
      const ch = gateCh(member.guild); if (!ch) return console.error('[gate] 인사 채널을 못 찾음');
      const rc = roleCh(member.guild);
      const where = rc ? `<#${rc.id}>` : '#역할·ロール';
      await ch.send({
        content: [
          `🎉 ${member} 어서와요!`,
          `🪪 ${where} 에서 국기를 눌러 역할을 받아주세요`,
          `-# 🎉 ようこそ！`,
          `-# 🪪 ${where} で国旗を押してロールをもらってね`,
        ].join('\n'),
        allowedMentions: { users: [member.id] },
      });
      console.log('[gate] 입장 인사');
    } catch (e) { console.error('[gate] 인사 실패', e.message); }
  });

  // 2) 리액션 롤
  async function onReact(reaction, user, add) {
    try {
      if (user.bot || !st.roleMsg) return;
      if (reaction.partial) await reaction.fetch().catch(() => null);
      if (reaction.message.id !== st.roleMsg) return;
      const role = ROLES[reaction.emoji.name];
      if (!role) return;
      const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return;
      if (add) await member.roles.add(role, '국적 역할 선택');
      else await member.roles.remove(role, '국적 역할 해제');
      console.log(`[gate] 역할 ${add ? '추가' : '해제'}`);
    } catch (e) { console.error('[gate] 역할 변경 실패 (차봇 역할이 국적 역할보다 위인지, 역할 관리 권한 있는지 확인)', e.message); }
  }
  client.on('messageReactionAdd', (r, u) => onReact(r, u, true));
  client.on('messageReactionRemove', (r, u) => onReact(r, u, false));

  // 주인 명령: !역할메시지 / !입장인사 켜기·끄기
  client.on('messageCreate', async (m) => {
    if (m.author?.bot || m.webhookId || !m.guild) return;
    const t = (m.content || '').trim();
    const owner = m.guild.ownerId === m.author.id;
    if (/^!(역할메시지|ロールメッセージ)$/.test(t)) {
      if (!owner) return;
      try {
        const ch = roleCh(m.guild) || m.channel;
        if (st.roleMsg && st.roleCh) {   // 다시 올리면 예전 차봇 역할 메시지는 지움
          const oc = m.guild.channels.cache.get(st.roleCh);
          await oc?.messages.delete(st.roleMsg).catch(() => {});
        }
        const msg = await ch.send({ content: ROLE_TEXT, allowedMentions: { parse: [] } });
        for (const e of Object.keys(ROLES)) await msg.react(e);
        st.roleMsg = msg.id; st.roleCh = ch.id; save();
        await m.reply({ content: `✅ 역할 메시지 올림 → ${msg.url}\n-# ロールメッセージを投稿 → ${msg.url}`, allowedMentions: { repliedUser: false } }).catch(() => {});
        console.log('[gate] 역할 메시지 올림');
      } catch (e) { console.error('[gate] 역할 메시지 실패', e.message); m.reply('❌ ' + e.message).catch(() => {}); }
    }
    const g = t.match(/^!(입장인사|入場挨拶)\s+(켜기|끄기|on|off|オン|オフ)$/i);
    if (g && owner) {
      st.greetOff = /끄기|off|オフ/i.test(g[2]); save();
      m.reply({ content: `✅ 입장 인사 ${st.greetOff ? '끔' : '켬'}\n-# 入場挨拶 ${st.greetOff ? 'オフ' : 'オン'}`, allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  });

  client.once('clientReady', async () => {
    // 역할 메시지 리액션이 재시작 뒤에도 잡히도록 미리 불러둠
    if (!st.roleMsg) return;
    for (const g of client.guilds.cache.values()) {
      const ch = g.channels.cache.get(st.roleCh) || roleCh(g); if (!ch) continue;
      await ch.messages.fetch(st.roleMsg).catch(() => null);
    }
  });
};
