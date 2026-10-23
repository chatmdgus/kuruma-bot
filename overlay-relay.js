// overlay-relay.js — 데스크톱 오버레이 앱(chatmdgus/kuruma-overlay)용 WebSocket 중계 (OVERLAY)
// 게이트웨이 연결은 차봇 하나뿐. 이 모듈은 채팅·미디어·음성 멤버를 오버레이로 보내고, 오버레이에서 쓴 글을 웹훅으로 올림
// .env OVERLAY_PORT 없으면 꺼짐. 127.0.0.1 에만 열림 (나중에 Cloudflare Tunnel로 노출)
// env: OVERLAY_PORT, OVERLAY_GUILD_ID, OVERLAY_CHANNELS(텍스트, all이면 서버의 모든 텍스트 채널), OVERLAY_VOICE_CHANNELS(음성), OVERLAY_TOKENS(`유저ID:비밀값`,…)
// 메시지 내용은 로그·저장 안 함. 로그는 유저 ID + 접속/종료만
// 로그인: 앱이 디스코드 OAuth2(identify)로 받은 code를 보내면 서버가 확인하고 세션 키를 발급 (OVERLAY_CLIENT_SECRET 있을 때)
//   세션 키는 해시만 ~/.kuruma-overlay-sessions.json 에 저장, 90일 동안 안 쓰면 만료. OVERLAY_TOKENS(임시 방식)도 같이 받음
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits, ChannelType } = require('discord.js');

const HOOK_NAME = 'kuruma-overlay';
const AUTH_TIMEOUT = 10e3;
const IDLE_TIMEOUT = 90e3;   // 클라이언트가 30초마다 ping 보냄
const SEND_GAP = 1000;       // 1인 1초 1개
const MAX_LEN = 2000;
const HISTORY = 20;
const HISTORY_CHANNELS = 5;   // 처음 접속 때 지난 글을 불러올 채널 수 (최근 글이 있는 순)

const SESSION_FILE = path.join(os.homedir(), '.kuruma-overlay-sessions.json');
const SESSION_DAYS = 90;
const DEFAULT_REDIRECT = 'http://127.0.0.1:53134/callback';
const DISCORD_API = 'https://discord.com/api/v10';

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
  // 서버 스티커: PNG·APNG·GIF 는 그림으로 (Lottie(json)는 그릴 수 없어서 이름만 → stickerNames)
  for (const st of message.stickers?.values?.() || []) {
    const ext = { 1: 'png', 2: 'png', 4: 'gif' }[st.format];
    if (!ext) continue;
    const host = ext === 'gif' ? 'https://media.discordapp.net' : 'https://cdn.discordapp.com';
    add(ext === 'gif' ? 'gif' : 'image', { url: `${host}/stickers/${st.id}.${ext}?size=320`, width: 160, height: 160 }, { sticker: true });
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
    stickers: [...(message.stickers?.values?.() || [])].map((st) => st.name),
    ts: message.createdTimestamp,
  };
}

// 화면 공유 중인 사람을 맨 위에, 나머지는 디스코드 음성 채널 목록처럼 표시 이름 순
const nameOrder = new Intl.Collator(['ko', 'ja', 'en'], { sensitivity: 'base', numeric: true });

function toVoiceDto(channel) {
  return {
    channelId: channel.id,
    channelName: channel.name ?? null,
    members: [...(channel.members?.values?.() || [])].sort((a, b) => (!!b.voice?.streaming - !!a.voice?.streaming) || nameOrder.compare(a.displayName || '', b.displayName || '')).map((m) => ({
      id: m.id,
      name: m.displayName,
      avatar: m.displayAvatarURL?.({ extension: 'png', size: 64 }) ?? null,
      color: roleColor(m),
      selfMute: !!m.voice?.selfMute,
      selfDeaf: !!m.voice?.selfDeaf,
      serverMute: !!m.voice?.serverMute,
      serverDeaf: !!m.voice?.serverDeaf,
      streaming: !!m.voice?.streaming,
      video: !!m.voice?.selfVideo,
    })),
  };
}

// ── 세션 키 저장소 ──
function createSessionStore(file = SESSION_FILE, now = () => Date.now()) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 처음 */ }
  const save = () => {
    try { fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 }); } catch (e) { console.error('[overlay] 세션 저장 실패', e.message); }
  };
  const key = (token) => sha(token).toString('hex');
  const ttl = SESSION_DAYS * 864e5;
  return {
    create(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      data[key(token)] = { userId, exp: now() + ttl };
      save();
      return token;
    },
    // 쓸 때마다 만료일을 90일 뒤로 미룸
    use(token) {
      if (typeof token !== 'string' || token.length < 20) return null;
      const k = key(token);
      const s = data[k];
      if (!s) return null;
      if (s.exp < now()) { delete data[k]; save(); return null; }
      s.exp = now() + ttl;
      save();
      return s.userId;
    },
    revoke(token) { if (typeof token === 'string' && delete data[key(token)]) save(); },
    revokeUser(userId) { let n = 0; for (const [k, s] of Object.entries(data)) if (s.userId === userId) { delete data[k]; n++; } if (n) save(); return n; },
    prune() { let n = 0; for (const [k, s] of Object.entries(data)) if (s.exp < now()) { delete data[k]; n++; } if (n) save(); },
  };
}

// ── 디스코드 OAuth2: code → 사용자 ID (access token은 바로 폐기) ──
async function exchangeCode({ clientId, clientSecret, redirectUri, code, fetchImpl = fetch }) {
  const form = (o) => new URLSearchParams(o).toString();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const res = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: 'POST', headers, signal: AbortSignal.timeout(10e3),
    body: form({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw Object.assign(new Error(`token ${res.status}`), { code: 'oauth_failed' });
  const tok = await res.json();
  const me = await fetchImpl(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10e3) });
  if (!me.ok) throw Object.assign(new Error(`me ${me.status}`), { code: 'oauth_failed' });
  const user = await me.json();
  // 사용자 ID만 필요하므로 디스코드 토큰은 저장하지 않고 바로 폐기
  fetchImpl(`${DISCORD_API}/oauth2/token/revoke`, {
    method: 'POST', headers, signal: AbortSignal.timeout(10e3),
    body: form({ client_id: clientId, client_secret: clientSecret, token: tok.access_token, token_type_hint: 'access_token' }),
  }).catch(() => {});
  if (!/^\d{5,25}$/.test(String(user.id || ''))) throw Object.assign(new Error('bad user'), { code: 'oauth_failed' });
  return String(user.id);
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
  const allText = textIds.has('all');   // OVERLAY_CHANNELS=all → 서버의 모든 텍스트 채널 (권한은 사람마다 확인)
  const textOk = (id) => !!id && (allText || textIds.has(id));
  const voiceIds = new Set(parseIds(process.env.OVERLAY_VOICE_CHANNELS));
  const allVoice = voiceIds.has('all');   // OVERLAY_VOICE_CHANNELS=all → 서버의 모든 음성 채널 허용
  const voiceOk = (id) => !!id && (allVoice || voiceIds.has(id));
  const tokens = parseTokens(process.env.OVERLAY_TOKENS);
  const sessions = createSessionStore();
  sessions.prune();
  const clientSecret = process.env.OVERLAY_CLIENT_SECRET || '';
  const redirectUri = process.env.OVERLAY_REDIRECT_URI || DEFAULT_REDIRECT;
  const clientId = () => process.env.OVERLAY_CLIENT_ID || client.application?.id || client.user?.id;
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

  // 오버레이에서 볼 수 있는 텍스트 채널 ID (all이면 채널 목록 순서대로)
  const textChannelIds = (g) => (allText
    ? [...g.channels.cache.values()].filter((ch) => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
      .sort((a, b) => (a.parent?.position ?? -1) - (b.parent?.position ?? -1) || a.position - b.position).map((ch) => ch.id)
    : [...textIds]);

  function visible(g, mb) {
    const list = [];
    for (const id of textChannelIds(g)) { const ch = g.channels.cache.get(id); if (ch?.isTextBased?.() && can(ch, mb, PermissionFlagsBits.ViewChannel)) list.push({ id, name: ch.name, type: 'text' }); }
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
    const userId = findUserByToken(tokens, msg.token) || sessions.use(msg.token);
    if (userId) ws._session = msg.token;
    return finishAuth(ws, userId, 'auth_failed');
  }

  // 앱이 디스코드 로그인에서 받은 code → 서버 멤버면 세션 키 발급
  async function onOAuth(ws, msg) {
    if (!clientSecret) { err(ws, 'oauth_disabled', '서버에 디스코드 로그인이 설정되지 않음'); return ws.close(4002, 'oauth_disabled'); }
    if (msg.redirectUri !== redirectUri || typeof msg.code !== 'string' || msg.code.length > 200) {
      err(ws, 'oauth_failed', '로그인 정보가 올바르지 않음');
      return ws.close(4001, 'oauth_failed');
    }
    let userId = null;
    try {
      userId = await exchangeCode({ clientId: clientId(), clientSecret, redirectUri, code: msg.code });
    } catch (e) {
      console.error('[overlay] 로그인 확인 실패', e.message);
      err(ws, 'oauth_failed', '디스코드 로그인 확인 실패');
      return ws.close(4001, 'oauth_failed');
    }
    const g = guild();
    const mb = g ? await member(g, userId) : null;
    if (!mb) { err(ws, 'not_member', '서버 멤버가 아님'); return ws.close(4003, 'not_member'); }
    const token = sessions.create(userId);
    ws._session = token;
    out(ws, { type: 'session', token, days: SESSION_DAYS });
    return finishAuth(ws, userId, 'auth_failed');
  }

  async function finishAuth(ws, userId, failCode) {
    const g = guild();
    const mb = userId && g ? await member(g, userId) : null;
    if (!mb) { err(ws, failCode, '인증 실패'); return ws.close(4001, failCode); }
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
    const wantText = Array.isArray(msg.channelIds) && msg.channelIds.length ? msg.channelIds : textChannelIds(g);   // 지정 안 하면 볼 수 있는 채널 전부
    ws._text = new Set(pick(wantText, { has: textOk }, 'text'));
    ws._voice = new Set(pick(msg.voiceChannelIds, { has: voiceOk }, 'voice'));
    // voiceFollow: 본인이 들어가 있는 음성 채널을 자동으로 따라감
    ws._follow = msg.voiceFollow === true || (msg.voiceFollow !== false && !ws._voice.size);
    ws._followCh = null;
    // 지난 글은 최근에 글이 올라온 채널 몇 개만 (채널이 많으면 접속할 때마다 요청이 너무 많아짐)
    const recent = new Set([...ws._text].sort((a, b) => {
      const la = BigInt(g.channels.cache.get(a)?.lastMessageId || 0), lb = BigInt(g.channels.cache.get(b)?.lastMessageId || 0);
      return la < lb ? 1 : la > lb ? -1 : 0;
    }).slice(0, HISTORY_CHANNELS));
    for (const id of ws._text) {
      const ch = g.channels.cache.get(id);
      let messages = [];
      if (recent.has(id) && can(ch, mb, PermissionFlagsBits.ReadMessageHistory)) {
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
    out(ws, ok ? { type: 'voice', follow: true, ...toVoiceDto(ch) } : { type: 'voice', follow: true, channelId: null, channelName: null, members: [] });
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
    wss.on('listening', () => console.log(`[overlay] 127.0.0.1:${port} 대기 (텍스트 ${allText ? '전체' : textIds.size}, 음성 ${allVoice ? '전체' : voiceIds.size}, 토큰 ${tokens.length}, 디스코드 로그인 ${clientSecret ? '켜짐' : '꺼짐'})`));
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
        if (!ws._userId) {   // 인증 전엔 로그인 관련 말고는 안 받고 안 보냄
          if (msg.type === 'oauth_info') {   // 공개 정보: 로그인 화면 주소를 만들 때 필요
            return out(ws, { type: 'oauth_info', enabled: !!clientSecret, clientId: clientId(), redirectUri, scope: 'identify' });
          }
          if (!['auth', 'oauth'].includes(msg.type) || ws._authing) return;
          ws._authing = true;
          const run = msg.type === 'oauth' ? onOAuth : onAuth;
          return void run(ws, msg).catch((e) => { console.error('[overlay] 인증 오류', e.message); ws.close(4001, 'auth_failed'); });
        }
        if (msg.type === 'logout') { sessions.revoke(ws._session); return ws.close(1000, 'logout'); }
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
    const bad = allText ? [...ruleIds] : [...textIds].filter((id) => ruleIds.has(id));
    if (bad.length) console.log('[overlay] 규칙 채널은 보기만 됨 (보내기 막음):', bad.join(','));
  }

  const toText = (channelId, obj) => { for (const ws of sockets) if (ws._userId && ws._text?.has(channelId)) out(ws, obj); };

  // 다른 모듈(booth-free, 파티 자연어)이 m.content를 바꾸기 전에 원문으로 만들어 둠
  client.prependListener('messageCreate', (m) => {
    if (!sockets.size || !textOk(m.channelId)) return;
    if (m.guildId !== guild()?.id) return;
    toText(m.channelId, { type: 'message', ...toMessageDto(m) });
  });
  client.on('messageDelete', (m) => { if (sockets.size && textOk(m.channelId)) toText(m.channelId, { type: 'message_delete', id: m.id, channelId: m.channelId }); });
  client.on('messageDeleteBulk', (list, ch) => { if (sockets.size && textOk(ch?.id)) for (const id of list.keys()) toText(ch.id, { type: 'message_delete', id, channelId: ch.id }); });
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
  client.on('guildMemberRemove', (mb) => {
    if (mb.guild?.id !== guild()?.id) return;
    sessions.revokeUser(mb.id);
    for (const ws of sockets) if (ws._userId === mb.id) ws.close(4003, 'not_member');
  });
  client.on('webhooksUpdate', (ch) => hooks.delete(ch.id));

  if (client.isReady()) start(); else client.once('clientReady', start);
}

module.exports = relay;
Object.assign(module.exports, { parseIds, parseTokens, findUserByToken, toMediaList, toMessageDto, toVoiceDto, createSessionStore, exchangeCode });
