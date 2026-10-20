// log.js — 서버 로그 (칼봇 로그 대신, LOG_MOVE). 한국어, 종류별 색깔 임베드
// 남기는 것: 입장·퇴장, 메시지 삭제·수정, 역할·닉네임·타임아웃 변경, 음성 입장·퇴장·이동, 차단·차단 해제
// 로그 채널: 주인이 원하는 채널에서 `!로그채널` (끄기: `!로그채널 끄기`) → ~/.kuruma-log.json 에 저장
//            설정 전엔 .env LOG_CHANNEL 또는 이름에 '로그'/'log'/'ログ' 들어간 채널
// 봇·웹훅(번역) 메시지, 테스트 채널, 로그 채널 자체는 기록 안 함
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const STATE = path.join(os.homedir(), '.kuruma-log.json');
let st = {};
try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
const save = () => { try { fs.writeFileSync(STATE, JSON.stringify(st)); } catch (e) { console.error('[log] 저장 실패', e.message); } };

const C = { join: 0x57f287, leave: 0xed4245, del: 0xed4245, edit: 0xfee75c, role: 0x5865f2, nick: 0x5865f2, voice: 0x99aab5, ban: 0x992d22, timeout: 0xe67e22 };
const cut = (t, n = 1000) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const quote = (t) => cut(t, 1000).split('\n').map((l) => '> ' + (l || ' ')).join('\n');
const ago = (ms) => {
  const d = Math.floor((Date.now() - ms) / 86400e3);
  if (d < 1) { const h = Math.floor((Date.now() - ms) / 3600e3); return h < 1 ? '방금' : `${h}시간 전`; }
  if (d < 60) return `${d}일 전`;
  if (d < 730) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
};
const who = (u) => (u ? `<@${u.id}> · ${u.globalName || u.username}` : '알 수 없음');

module.exports = function (client) {
  function logChannel(guild) {
    if (st.off) return null;
    const id = st.channel || process.env.LOG_CHANNEL;
    if (id) return guild.channels.cache.get(id) || null;
    return guild.channels.cache.find((c) => c.isTextBased?.() && !c.isVoiceBased?.() && !c.isThread?.() && /로그|log|ログ/i.test(c.name)) || null;
  }
  const skipCh = (guild, chId) => chId === process.env.TR_TEST_CHANNEL || chId === logChannel(guild)?.id;

  async function send(guild, color, title, lines, user, extra = {}) {
    try {
      const ch = logChannel(guild); if (!ch) return;
      const e = new EmbedBuilder().setColor(color).setTitle(title).setDescription(lines.filter(Boolean).join('\n').slice(0, 4000)).setTimestamp(new Date());
      if (user) { e.setThumbnail(user.displayAvatarURL?.({ size: 64 }) || null); e.setFooter({ text: `ID ${user.id}` }); }
      if (extra.fields) e.addFields(extra.fields);
      await ch.send({ embeds: [e], allowedMentions: { parse: [] } });
    } catch (err) { console.error('[log] 전송 실패', err.message); }
  }

  // 입장·퇴장
  client.on('guildMemberAdd', (m) => {
    const days = (Date.now() - m.user.createdTimestamp) / 86400e3;
    send(m.guild, C.join, '📥 입장', [
      who(m.user) + (m.user.bot ? ' 🤖' : ''),
      `계정 만든 날: ${ago(m.user.createdTimestamp)}${days < 7 ? '  ⚠️ **새 계정**' : ''}`,
      `지금 멤버 수: ${m.guild.memberCount}명`,
    ], m.user);
  });
  client.on('guildMemberRemove', (m) => {
    const roles = m.roles?.cache?.filter((r) => r.id !== m.guild.id).map((r) => `<@&${r.id}>`) || [];
    send(m.guild, C.leave, '📤 퇴장', [
      who(m.user) + (m.user?.bot ? ' 🤖' : ''),
      m.joinedTimestamp ? `들어온 날: ${ago(m.joinedTimestamp)}` : '',
      roles.length ? `역할: ${roles.join(' ')}` : '',
      `지금 멤버 수: ${m.guild.memberCount}명`,
    ], m.user);
  });

  // 메시지 삭제·수정
  client.on('messageDelete', (m) => {
    if (!m.guild || m.partial || m.webhookId || m.author?.bot || skipCh(m.guild, m.channelId)) return;   // 봇 켜지기 전 메시지는 작성자·내용을 몰라서 건너뜀
    const files = [...(m.attachments?.values() || [])].map((a) => `📎 ${a.name}`);
    send(m.guild, C.del, '🗑️ 메시지 삭제', [
      `작성자: ${who(m.author)}`,
      `채널: <#${m.channelId}>`,
      '',
      m.content ? quote(m.content) : '',
      files.join('\n'),
    ], m.author);
  });
  client.on('messageUpdate', (o, n) => {
    if (!n.guild || n.webhookId || n.author?.bot || skipCh(n.guild, n.channelId)) return;
    if (o.partial || o.content == null || o.content === n.content) return;   // 링크 미리보기만 붙은 건 무시
    send(n.guild, C.edit, '✏️ 메시지 수정', [
      `작성자: ${who(n.author)}`,
      `채널: <#${n.channelId}> · [메시지로 가기](${n.url})`,
    ], n.author, { fields: [{ name: '수정 전', value: quote(o.content) || '-' }, { name: '수정 후', value: quote(n.content) || '-' }] });
  });

  // 역할·닉네임·타임아웃
  client.on('guildMemberUpdate', (o, n) => {
    if (o.partial) return;
    const added = n.roles.cache.filter((r) => !o.roles.cache.has(r.id)).map((r) => `<@&${r.id}>`);
    const removed = o.roles.cache.filter((r) => !n.roles.cache.has(r.id)).map((r) => `<@&${r.id}>`);
    if (added.length || removed.length)
      send(n.guild, C.role, '🎭 역할 변경', [who(n.user), added.length ? `➕ ${added.join(' ')}` : '', removed.length ? `➖ ${removed.join(' ')}` : ''], n.user);
    if (o.nickname !== n.nickname)
      send(n.guild, C.nick, '📝 닉네임 변경', [who(n.user), `${o.nickname || '(없음)'}  →  **${n.nickname || '(없음)'}**`], n.user);
    const ot = o.communicationDisabledUntilTimestamp || 0, nt = n.communicationDisabledUntilTimestamp || 0;
    if (ot !== nt)
      send(n.guild, C.timeout, nt > Date.now() ? '⏳ 타임아웃' : '✅ 타임아웃 해제', [who(n.user), nt > Date.now() ? `<t:${Math.floor(nt / 1000)}:R>까지` : ''], n.user);
  });

  // 음성
  client.on('voiceStateUpdate', (o, n) => {
    const m = n.member || o.member; if (!m || m.user.bot) return;
    if (o.channelId === n.channelId) return;   // 음소거·화면공유 같은 건 무시
    const g = n.guild || o.guild;
    if (!o.channelId) send(g, C.voice, '🔊 음성 입장', [`${who(m.user)}  →  <#${n.channelId}>`], null);
    else if (!n.channelId) send(g, C.voice, '🔇 음성 퇴장', [`${who(m.user)}  ←  <#${o.channelId}>`], null);
    else send(g, C.voice, '🔀 음성 이동', [`${who(m.user)}`, `<#${o.channelId}>  →  <#${n.channelId}>`], null);
  });

  // 차단
  client.on('guildBanAdd', (b) => send(b.guild, C.ban, '🔨 차단', [who(b.user), b.reason ? `사유: ${cut(b.reason, 300)}` : ''], b.user));
  client.on('guildBanRemove', (b) => send(b.guild, C.join, '🕊️ 차단 해제', [who(b.user)], b.user));

  // 주인 명령: !로그채널 (지금 채널로) / !로그채널 끄기
  client.on('messageCreate', (m) => {
    if (m.author?.bot || !m.guild || m.guild.ownerId !== m.author.id) return;
    const t = (m.content || '').trim();
    const mm = t.match(/^!(로그채널|ログチャンネル)(?:\s+(끄기|off|オフ))?$/i);
    if (!mm) return;
    if (mm[2]) { st.off = true; save(); return m.reply({ content: '🔕 로그 끔 (`!로그채널` 로 다시 켜기)', allowedMentions: { repliedUser: false } }).catch(() => {}); }
    st.channel = m.channelId; st.off = false; save();
    m.reply({ content: '✅ 이 채널에 로그 남김\n-# 이 채널은 주인·관리자만 보이게 해두는 걸 추천', allowedMentions: { repliedUser: false } }).catch(() => {});
  });

  client.once('clientReady', () => {
    for (const g of client.guilds.cache.values()) {
      const ch = logChannel(g);
      console.log(`[log] 로그 채널: ${ch ? ch.name : '없음 (!로그채널 로 지정)'}`);
    }
  });
};
