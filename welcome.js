// welcome.js — 새 멤버가 들어오면 자유채팅에서 차봇·쿠루마봇이 한마디씩 (GuildMembers 인텐트 필요)
// 채널: .env WELCOME_CHANNEL / 없으면 자유・雑談. 대화는 입장할 때마다 순서대로
// WELCOME_REJOIN: 전에 있던 사람이 다시 들어오면 재입장용 대화 (본 적 있는 ID는 ~/.welcome-state.json에 저장)
const fs = require('fs');
const os = require('os');
const path = require('path');
const DEFAULT_CH = '1538870664688173066';
const KURUMA_ID = '1561590994468601979';   // 쿠루마봇・クルマボット (웹훅 이름·사진용)
const STATE = path.join(os.homedir(), '.welcome-state.json');
const NAT_ROLES = ['1538868310274342962', '1538874107872018452'];   // 한국인・韓国人, 일본인・日本人   // 저장소 밖 (자동 배포 안 막게)

// WELCOME_DUO: [차봇 한국어, 차봇 일본어, 쿠루마봇 한국어, 쿠루마봇 일본어]
const TALKS = [
  ['어서 오고... 한마디 하고 가', 'いらっしゃい…一言どうぞ', '너무 기대는 하지 마', 'あんまり期待はしないで'],
  ['왔네', '来たね', '...또 늘었네', '…また増えたな'],
  ['어서 오고... 한마디 하고 가', 'いらっしゃい…一言どうぞ', '말 걸면 번역은 해줌. 그 이상은 몰라', '話しかけたら翻訳はする。それ以上は知らん'],
  ['신병 받아라~', '新入り入りまーす', '...이병 하나 추가', '…新兵ひとり追加'],
  ['신병 들어왔다', '新兵が来たぞ', '자리는 알아서 잡아', '席は自分で探して'],
];
// 재입장: 차봇이 인사하다 끊고, 쿠루마봇이 알아봄 (반갑게)
const REJOIN = [
  ['어서 오... 어? 아는 얼굴인데', 'いらっしゃ…あれ？見覚えある', '다시 왔네. 반가워', 'また来たね。おかえり'],
  ['왔ㄴ... 아 너구나', '来たね…あ、君か', '오랜만이야', '久しぶり'],
  ['환영ㅎ... 잠깐, 본 적 있는데', 'ようこそ…待って、見たことある', '기억하고 있었음. 어서 와', '覚えてたよ。おかえり'],
  ['어서... 아 돌아왔구나', 'いらっ…あ、戻ってきたんだ', '자리 그대로 있음', '席そのままだよ'],
  ['처음 뵙... 아니구나', 'はじめまし…じゃないな', '다시 와줘서 고마움', '戻ってきてくれてありがとう'],
];

function load() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } }
function save(st) { try { fs.writeFileSync(STATE, JSON.stringify(st)); } catch (e) { console.error('[welcome] 상태 저장 실패', e.message); } }

module.exports = function (client) {
  // 켜질 때 지금 멤버를 전부 "본 적 있음"에 넣어둠 → 나갔다 다시 오면 재입장으로 인식
  client.once('clientReady', async () => {
    try {
      const st = load(); const seen = new Set(st.seen || []);
      for (const g of client.guilds.cache.values()) (await g.members.fetch()).forEach((mb) => { if (!mb.user.bot) seen.add(mb.id); });
      st.seen = [...seen]; save(st);
      console.log(`[welcome] 멤버 기록 ${seen.size}명`);
    } catch (e) { console.error('[welcome] 멤버 목록 실패', e.message); }
  });

  // WELCOME_ROLE: 역할 없으면 자유채팅이 안 보이므로, 들어오면 대기 목록에 넣고 국적 역할을 받은 순간 인사
  client.on('guildMemberAdd', (member) => {
    if (member.user.bot) return;
    const st = load(); const seen = new Set(st.seen || []);
    st.wait = { ...(st.wait || {}), [member.id]: seen.has(member.id) ? 'r' : 'n' };
    seen.add(member.id); st.seen = [...seen]; save(st);
    if (NAT_ROLES.some((r) => member.roles.cache.has(r))) greet(member);
  });
  client.on('guildMemberUpdate', (_old, member) => {
    if (member.user.bot || !NAT_ROLES.some((r) => member.roles.cache.has(r))) return;
    if (load().wait?.[member.id]) greet(member);
  });

  client.on('guildMemberRemove', (member) => {   // 역할 받기 전에 나가면 대기 목록에서 정리
    const st = load(); if (st.wait?.[member.id]) { delete st.wait[member.id]; save(st); }
  });

  async function greet(member) {
    try {
      const st = load(); const seen = new Set(st.seen || []);   // 역할이 연달아 붙어도 한 번만 (await 전에 대기 목록에서 뺌)
      const key = st.wait?.[member.id];
      if (!key) return;
      delete st.wait[member.id]; save(st);
      const ch = await client.channels.fetch(process.env.WELCOME_CHANNEL || DEFAULT_CH).catch(() => null);
      if (!ch) return;
      const rejoin = key === 'r';
      const list = rejoin ? REJOIN : TALKS;
      const n = (st[key] || 0) % list.length;
      const [ko, ja, kko, kja] = list[n];
      st[key] = (n + 1) % list.length; seen.add(member.id); st.seen = [...seen]; save(st);

      await ch.send({ content: `${member} ${ko}\n-# ${ja}`, allowedMentions: { users: [member.id] } });
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
      console.log(`[welcome] ${rejoin ? '재입장' : '신규'} 대화 ${n + 1} 보냄`);
    } catch (e) { console.error('[welcome] 전송 실패', e.message); }
  }
};
