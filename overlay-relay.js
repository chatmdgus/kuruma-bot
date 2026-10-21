// overlay-relay.js — 데스크톱 오버레이 앱(chatmdgus/kuruma-overlay)용 WebSocket 중계 (OVERLAY)
// 게이트웨이 연결은 차봇 하나뿐. 이 모듈은 채팅·미디어·음성 멤버를 오버레이로 보내고, 오버레이에서 쓴 글을 웹훅으로 올림
// .env OVERLAY_PORT 없으면 꺼짐. 127.0.0.1 에만 열림 (나중에 Cloudflare Tunnel로 노출)
// env: OVERLAY_PORT, OVERLAY_GUILD_ID, OVERLAY_CHANNELS(텍스트), OVERLAY_VOICE_CHANNELS(음성), OVERLAY_TOKENS(`유저ID:비밀값`,…)
// 메시지 내용은 로그·저장 안 함. 로그는 유저 ID + 접속/종료만
// TODO(OVERLAY_OAUTH): OVERLAY_TOKENS는 마일스톤1 임시 인증. Discord OAuth2 로그인 → 세션 토큰 발급으로 바꿀 것
const crypto = require('crypto');
const { PermissionFlagsBits } = require('discord.js');

const HOOK_NAME = 'kuruma-overlay';
const AUTH_TIMEOUT = 10e3;
const IDLE_TIMEOUT = 90e3;   // 클라이언트가 30초마다 ping 보냄
const SEND_GAP = 1000;       // 1인 1초 1개
const MAX_LEN = 2000;
const HISTORY = 20;

const parseIds = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// `유저ID:비밀값,유저ID:비밀값` → [{ userId, secret }]
function parseTokens(s) {
  return parseIds(s).map((p) => {
    const i = p.indexOf(':');
    if (i <= 0) return null;
    const userId = p.slice(0, i).trim();
    const secret = p.slice(i + 1).trim();
    return /^\d{5,25}$/.test(userId) && secret ? { userId, secret } : null;
  }).filter(Boolean);
}
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest();
function findUserByToken(tokens, token) {
  if (typeof token !== 'string' || !token) return null;
  const h = sha(token);
  let hit = null;
  for (const t of tokens) if (crypto.timingSafeEqual(h, sha(t.secret)) && !hit) hit = t.userId;   // 끝까지 다 비교
  return hit;
}

// 첨부 + 임베드 → [{ kind: image|gif|video, url, width, height, size }]
function toMediaList(message) {
  const out = [];
  const seen = new Set();
  const add = (kind, o, extra) => {
    const url = o?.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ kind, url, width: o.width ?? null, height: o.height ?? null, size: o.size ?? null, ...extra });
  };
  for (const a of message.attachments?.values?.() || []) {
    const ct = (a.contentType || '').toLowerCase();
    const name = (a.name || '').toLowerCase();
    if (ct === 'image/gif' || name.endsWith('.gif')) add('gif', a);
    else if (ct.startsWith('image/') || /\.(png|jpe?g|webp|avif)$/.test(name)) add('image', a);
    else if (ct.startsWith('video/') || /\.(mp4|webm|mov)$/.test(name)) add('video', a);
  }
  for (const e of message.embeds || []) {
    const type = e.data?.type;
    if (type === 'gifv' && e.video?.url) { add('video', { ...e.video, url: e.video.proxyURL || e.video.url }, { gifv: true }); continue; }   // Tenor 등
    if (e.video?.proxyURL) { add('video', { ...e.video, url: e.video.proxyURL }); continue; }   // 직접 영상 파일 (유튜브는 proxyURL 없음 → 썸네일)
    if (e.image?.url) add('image', e.image);
    else if (e.thumbnail?.url) add('image', e.thumbnail);
  }
  return out;
}

const roleColor = (mb) => { const c = mb?.displayHexColor; return c && c !== '#000000' ? c : null; };

// 웹훅 글(번역, 오버레이에서 보낸 글)은 member가 없음 → 같은 표시 이름의 멤버를 찾아 역할 색을 씀
function webhookMember(message) {
  if (!message.webhookId || !message.guild) return null;
  const name = message.author?.username;
  if (!name) return null;
  let hit = null;
  for (const m of message.guild.members.cache.values()) {
    if (m.displayName === name) { if (hit) return null; hit = m; }   // 같은 이름이 둘 이상이면 모름
  }
  return hit;
}

function toMessageDto(message) {
  const mb = message.member;
  const au = message.author;
  const color = roleColor(mb || webhookMember(message));
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: au?.id,
      name: mb?.displayName || au?.globalName || au?.username || '',   // 웹훅이면 웹훅 이름
      avatar: (mb ?? au)?.displayAvatarURL?.({ extension: 'png', size: 64 }) ?? null,
      ...(color ? { color } : {}),
    },
    content: message.cleanContent ?? message.content ?? '',
    media: toMediaList(message),
    ts: message.createdTimestamp,
  };
}

function toVoiceDto(channel) {
  return {
    channelId: channel.id,
    members: [...(channel.members?.values?.() || [])].map((m) => ({
      id: m.id,
      name: m.displayName,
      avatar: m.displayAvatarURL?.({ extension: 'png', size: 64 }) ?? null,
      color: roleColor(m),
      selfMute: !!m.voice?.selfMute,
      selfDeaf: !!m.voice?.selfDeaf,
      serverMute: !!m.voice?.serverMute,
      serverDeaf: !!m.voice?.serverDeaf,
      streaming: !!m.voice?.streaming,
    })),
  };
}

function relay(client) {
  if (!process.env.OVERLAY_PORT) { console.log('[overlay] 꺼짐 (OVERLAY_PORT 없음)'); return; }
  let WebSocketServer;
  try { ({ WebSocketServer } = require('ws')); } catch {
    console.log('[overlay] 꺼짐 (ws 패키지 없음 → 서버에서 npm install 한 번)');
    return;
  }
  const port = Number(process.env.OVERLAY_PORT);
  const textIds = new Set(parseIds(process.env.OVERLAY_CHANNELS));
  const voiceIds = new Set(parseIds(process.env.OVERLAY_VOICE_CHANNELS));
  const allVoice = voiceIds.has('all');   // OVERLAY_VOICE_CHANNELS=all → 서버의 모든 음성 채널 허용
  const voiceOk = (id) => !!id && (allVoice || voiceIds.has(id));
  const tokens = parseTokens(process.env.OVERLAY_TOKENS);
  // 다른 모듈의 삭제 규칙 채널: 웹훅 글은 그 규칙을 안 거치니 오버레이에서 보내기 막음 (보기는 됨)
  const ruleIds = new Set(parseIds([process.env.BOOTH_FREE_CHANNELS, process.env.BOOTH_ONLY_CHANNELS, process.env.CLIP_ONLY_CHANNELS].join(',')));
  const sockets = new Set();
  const lastSend = new Map();
  const hooks = new Map();

  const guild = () => client.guilds.cache.get(process.env.OVERLAY_GUILD_ID) || (process.env.OVERLAY_GUILD_ID ? null : client.guilds.cache.first());
  const out = (ws, obj) => { if (ws.readyState === 1 && ws.bufferedAmount < 1e6) ws.send(JSON.stringify(obj)); };
  const err = (ws, code, message) => out(ws, { type: 'error', code, message });
  const member = async (g, id) => g.members.cache.get(id) || g.members.fetch(id).catch(() => null);
  const can = (ch, mb, perm) => !!ch && !!mb && !!ch.permissionsFor(mb)?.has(perm);

  function visible(g, mb) {
    const list = [];
    for (const id of textIds) { const ch = g.channels.cache.get(id); if (ch?.isTextBased?.() && can(ch, mb, PermissionFlagsBits.ViewChannel)) list.push({ id, name: ch.name, type: 'text' }); }
    for (const id of allVoice ? [] : voiceIds) { const ch = g.channels.cache.get(id); if (ch?.isVoiceBased?.() && can(ch, mb, PermissionFlagsBits.ViewChannel)) list.push({ id, name: ch.name, type: 'voice' }); }
    return list;
  }

  async function getHook(ch) {
    const base = ch.isThread?.() ? ch.parent : ch;
    if (hooks.has(base.id)) return hooks.get(base.id);
    const list = await base.fetchWebhooks();
    const h = list.find((x) => x.owner?.id === client.user.id && x.name === HOOK_NAME) || await base.createWebhook({ name: HOOK_NAME });
    hooks.set(base.id, h);
    return h;
  }

  async function onAuth(ws, msg) {
    const userId = findUserByToken(tokens, msg.token);
    const g = guild();
    const mb = userId && g ? await member(g, userId) : null;
    if (!mb) { err(ws, 'auth_failed', '인증 실패'); return ws.close(4001, 'auth_failed'); }
    clearTimeout(ws._authTimer);
    ws._userId = userId;
    console.log('[overlay] 인증', userId);
    out(ws, {
      type: 'ready',
      user: { id: mb.id, name: mb.displayName, avatar: mb.displayAvatarURL({ extension: 'png', size: 64 }) },
      guilds: [{ id: g.id, name: g.name, channels: visible(g, mb) }],
    });
  }

  async function onSubscribe(ws, msg) {
    const g = guild();
    if (!g || (msg.guildId && String(msg.guildId) !== g.id)) return err(ws, 'bad_guild', '서버가 다름');
    const mb = await member(g, ws._userId);
    if (!mb) return ws.close(4003, 'not_member');
    const pick = (ids, set, kind) => (Array.isArray(ids) ? ids : []).map(String).filter((id) => {
      const ch = set.has(id) && g.channels.cache.get(id);
      return ch && (kind === 'voice' ? ch.isVoiceBased?.() : ch.isTextBased?.()) && can(ch, mb, PermissionFlagsBits.ViewChannel);
    });
    ws._text = new Set(pick(msg.channelIds, textIds, 'text'));
    ws._voice = new Set(pick(msg.voiceChannelIds, { has: voiceOk }, 'voice'));
    // voiceFollow: 본인이 들어가 있는 음성 채널을 자동으로 따라감
    ws._follow = msg.voiceFollow === true || (msg.voiceFollow !== false && !ws._voice.size);
    ws._followCh = null;
    for (const id of ws._text) {
      const ch = g.channels.cache.get(id);
      let messages = [];
      if (can(ch, mb, PermissionFlagsBits.ReadMessageHistory)) {
        const got = await ch.messages.fetch({ limit: HISTORY }).catch(() => null);
        messages = got ? [...got.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(toMessageDto) : [];
      }
      out(ws, { type: 'history', channelId: id, messages });
    }
    for (const id of ws._voice) out(ws, { type: 'voice', ...toVoiceDto(g.channels.cache.get(id)) });
    if (ws._follow) await followUpdate(ws, g, mb);
  }

  // 따라가기 모드: 본인 음성 채널이 바뀌었거나 그 채널 인원이 바뀌면 전체 목록을 보냄. 채널에 없으면 빈 목록
  async function followUpdate(ws, g, mb) {
    const id = g.voiceStates.cache.get(ws._userId)?.channelId || null;
    const ch = id && g.channels.cache.get(id);
    const ok = ch && voiceOk(id) && can(ch, mb || await member(g, ws._userId), PermissionFlagsBits.ViewChannel);
    ws._followCh = ok ? id : null;
    out(ws, ok ? { type: 'voice', follow: true, ...toVoiceDto(ch) } : { type: 'voice', follow: true, channelId: null, members: [] });
  }

  async function onSend(ws, msg) {
    const nonce = msg.nonce ?? null;
    const fail = (error) => out(ws, { type: 'sent', nonce, ok: false, error });
    const channelId = String(msg.channelId || '');
    const content = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (!content) return fail('empty');
    if (content.length > MAX_LEN) return fail('too_long');
    if (!ws._text?.has(channelId)) return fail('not_subscribed');
    if (ruleIds.has(channelId)) return fail('channel_rule');
    const now = Date.now();
    if (now - (lastSend.get(ws._userId) || 0) < SEND_GAP) return fail('rate_limited');
    lastSend.set(ws._userId, now);
    const g = guild();
    const ch = g?.channels.cache.get(channelId);
    const mb = g && await member(g, ws._userId);
    if (!mb) return fail('not_member');
    if (mb.isCommunicationDisabled?.() || !can(ch, mb, PermissionFlagsBits.SendMessages)) return fail('no_permission');
    try {
      const h = await getHook(ch);
      await h.send({
        content,
        username: mb.displayName.slice(0, 80),
        avatarURL: mb.displayAvatarURL({ extension: 'png', size: 128 }),
        allowedMentions: { parse: [] },
        ...(ch.isThread?.() ? { threadId: ch.id } : {}),
      });
      out(ws, { type: 'sent', nonce, ok: true });
    } catch (e) {
      hooks.delete(ch.isThread?.() ? ch.parentId : ch.id);   // 웹훅 지워졌으면 다음에 다시 만듦
      console.error('[overlay] 보내기 실패', ws._userId, e.code || e.message);
      fail('send_failed');
    }
  }

  function start() {
    const wss = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 16 * 1024 });
    wss.on('error', (e) => console.error('[overlay] 서버 오류', e.message));
    wss.on('listening', () => console.log(`[overlay] 127.0.0.1:${port} 대기 (텍스트 ${textIds.size}, 음성 ${allVoice ? '전체' : voiceIds.size}, 토큰 ${tokens.length})`));
    wss.on('connection', (ws) => {
      if (sockets.size >= 50) return ws.close(1013, 'busy');
      sockets.add(ws);
      ws._seen = Date.now();
      ws._authTimer = setTimeout(() => { if (!ws._userId) ws.close(4000, 'auth_timeout'); }, AUTH_TIMEOUT);
      ws.on('message', (raw) => {
        ws._seen = Date.now();
        let msg;
        try { msg = JSON.parse(raw); } catch { msg = null; }
        if (!msg || typeof msg.type !== 'string') return ws._userId ? err(ws, 'bad_json', 'JSON 아님') : undefined;
        if (!ws._userId) {   // 인증 전엔 auth 말고 아무것도 안 받고 안 보냄
          if (msg.type !== 'auth' || ws._authing) return;
          ws._authing = true;
          return void onAuth(ws, msg).catch((e) => { console.error('[overlay] 인증 오류', e.message); ws.close(4001, 'auth_failed'); });
        }
        if (msg.type === 'ping') return out(ws, { type: 'pong' });
        const h = { subscribe: onSubscribe, send: onSend }[msg.type];
        if (h) h(ws, msg).catch((e) => { console.error('[overlay]', msg.type, '오류', ws._userId, e.message); err(ws, 'internal', '서버 오류'); });
      });
      ws.on('close', () => {
        clearTimeout(ws._authTimer);
        sockets.delete(ws);
        if (ws._userId) console.log('[overlay] 종료', ws._userId);
      });
      ws.on('error', () => {});
    });
    setInterval(() => { for (const ws of sockets) if (Date.now() - ws._seen > IDLE_TIMEOUT) ws.terminate(); }, 30e3).unref();
    const bad = [...textIds].filter((id) => ruleIds.has(id));
    if (bad.length) console.log('[overlay] 규칙 채널은 보기만 됨 (보내기 막음):', bad.join(','));
  }

  const toText = (channelId, obj) => { for (const ws of sockets) if (ws._userId && ws._text?.has(channelId)) out(ws, obj); };

  // 다른 모듈(booth-free, 파티 자연어)이 m.content를 바꾸기 전에 원문으로 만들어 둠
  client.prependListener('messageCreate', (m) => {
    if (!sockets.size || !textIds.has(m.channelId)) return;
    if (m.guildId !== guild()?.id) return;
    toText(m.channelId, { type: 'message', ...toMessageDto(m) });
  });
  client.on('messageDelete', (m) => { if (sockets.size && textIds.has(m.channelId)) toText(m.channelId, { type: 'message_delete', id: m.id, channelId: m.channelId }); });
  client.on('messageDeleteBulk', (list, ch) => { if (sockets.size && textIds.has(ch?.id)) for (const id of list.keys()) toText(ch.id, { type: 'message_delete', id, channelId: ch.id }); });
  client.on('voiceStateUpdate', (o, n) => {
    if (!sockets.size) return;
    const g = n.guild || o.guild;
    if (g.id === guild()?.id) {
      for (const ws of sockets) {
        if (!ws._userId || !ws._follow) continue;
        if (n.id === ws._userId || [o.channelId, n.channelId].includes(ws._followCh)) followUpdate(ws, g).catch((e) => console.error('[overlay] 음성 따라가기 오류', e.message));
      }
    }
    for (const id of new Set([o.channelId, n.channelId])) {
      if (!voiceOk(id)) continue;
      const ch = (n.guild || o.guild).channels.cache.get(id);
      if (!ch) continue;
      const dto = { type: 'voice', ...toVoiceDto(ch) };
      for (const ws of sockets) if (ws._userId && ws._voice?.has(id)) out(ws, dto);
    }
  });
  // 서버 나가면 연결 끊기
  client.on('guildMemberRemove', (mb) => { for (const ws of sockets) if (ws._userId === mb.id) ws.close(4003, 'not_member'); });
  client.on('webhooksUpdate', (ch) => hooks.delete(ch.id));

  if (client.isReady()) start(); else client.once('clientReady', start);
}

module.exports = relay;
Object.assign(module.exports, { parseIds, parseTokens, findUserByToken, toMediaList, toMessageDto, toVoiceDto });
