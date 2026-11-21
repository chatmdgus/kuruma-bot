// music.js — 음성 채널에서 유튜브 노래 재생 (MUSIC)
// 필요: 서버 ~/bin/yt-dlp + ~/bin/deno (scripts/install-music.sh 한 번 실행). ffmpeg·@discordjs/voice는 TTS 것 그대로 씀
// 음성 연결은 tts.js와 같이 씀: TTS 읽는 동안 노래는 잠깐 멈췄다가 TTS 끝나면 이어서 재생
// .env(선택): YTDLP_PATH, DENO_PATH, YTDLP_COOKIES(유튜브가 서버를 봇으로 막을 때 쿠키 파일 경로), MUSIC_VOLUME(기본 0.35),
//            MUSIC_MAX_QUEUE(기본 100), MUSIC_MAX_SEC(한 곡 최대 길이, 기본 3시간), MUSIC_PLAYLIST_MAX(기본 50)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const {
  createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, NoSubscriberBehavior, getVoiceConnection,
} = require('@discordjs/voice');
const tts = require('./tts');
const { bi } = require('./kuruma-say');

const BIN = path.join(os.homedir(), 'bin');
const YTDLP = process.env.YTDLP_PATH || path.join(BIN, 'yt-dlp');
const DENO = process.env.DENO_PATH || path.join(BIN, 'deno');
const COOKIES = process.env.YTDLP_COOKIES || '';
const VOLUME = Number(process.env.MUSIC_VOLUME || 0.35);
const MAX_QUEUE = Number(process.env.MUSIC_MAX_QUEUE || 100);
const MAX_SEC = Number(process.env.MUSIC_MAX_SEC || 3 * 3600);
const PLAYLIST_MAX = Number(process.env.MUSIC_PLAYLIST_MAX || 50);

const CMD = {
  play: ['!재생', '!再生', '!play', '!p'],
  skip: ['!스킵', '!スキップ', '!skip'],
  stop: ['!정지', '!停止', '!stop'],
  queue: ['!큐', '!대기열', '!キュー', '!queue'],
  pause: ['!일시정지', '!一時停止', '!pause'],
  resume: ['!재개', '!再開', '!resume'],
  np: ['!지금곡', '!今の曲', '!np'],
  shuffle: ['!셔플', '!シャッフル', '!shuffle'],
};
const CMD_OF = new Map(Object.entries(CMD).flatMap(([k, v]) => v.map((c) => [c, k])));

// ───────── yt-dlp ─────────
function baseArgs() {
  const a = ['--ignore-config', '--no-warnings'];
  if (fs.existsSync(DENO)) a.push('--js-runtimes', `deno:${DENO}`);
  if (COOKIES && fs.existsSync(COOKIES)) a.push('--cookies', COOKIES);
  return a;
}
const hasYtdlp = () => { try { fs.accessSync(YTDLP, fs.constants.X_OK); return true; } catch { return false; } };

function run(args, timeout = 40e3) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, [...baseArgs(), ...args], { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) { err.stderr = String(errOut || ''); return reject(err); }
      resolve(String(out));
    });
  });
}

// MUSIC_YT_ONLY: 링크는 유튜브·유튜브 뮤직만 (다른 주소로 서버가 접속하지 않게)
function isYoutubeUrl(u) {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) && /^((www|m|music)\.)?youtube\.com$|^youtu\.be$/i.test(url.hostname);
  } catch { return false; }
}

function isPlaylistUrl(u) {
  try {
    const url = new URL(u);
    return url.searchParams.has('list') && (!url.searchParams.has('v') || url.pathname.startsWith('/playlist'));
  } catch { return false; }
}

// 검색어/링크 → [{ title, url, duration }]
async function resolveTracks(q) {
  const isUrl = /^https?:\/\//i.test(q);
  const target = isUrl ? q : `ytsearch1:${q}`;
  const args = ['--flat-playlist', '-O', '%(.{id,title,duration,webpage_url,url,ie_key,extractor_key})j'];
  if (isUrl && isPlaylistUrl(q)) args.push('--playlist-end', String(PLAYLIST_MAX));
  else if (isUrl) args.push('--no-playlist');
  const out = await run([...args, target]);
  const list = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const yt = /youtube/i.test(j.ie_key || j.extractor_key || '') || (/^[\w-]{11}$/.test(j.id || '') && !j.webpage_url);
    const url = yt && j.id ? `https://www.youtube.com/watch?v=${j.id}` : (j.webpage_url || j.url);
    if (!url) continue;
    list.push({ title: j.title || url, url, duration: Number(j.duration) || 0 });
  }
  return list;
}

function errHint(text) {
  const t = String(text || '');
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(t)) return bi('유튜브가 서버를 봇으로 막음 (쿠키 설정 필요)', 'YouTubeにボット判定された（Cookie設定が必要）');
  if (/age|inappropriate/i.test(t) && /sign in/i.test(t)) return bi('연령 제한 영상이라 못 틈', '年齢制限の動画なので再生できない');
  if (/Private video|Video unavailable|not available|removed/i.test(t)) return bi('재생할 수 없는 영상', '再生できない動画');
  if (/timed out|ETIMEDOUT|killed/i.test(t)) return bi('유튜브 응답이 너무 느림', 'YouTubeの応答が遅すぎる');
  const line = t.split('\n').find((l) => /ERROR/.test(l)) || t.split('\n').find(Boolean) || '';
  return bi('재생 실패', '再生失敗') + (line ? `\n-# \`${line.replace(/`/g, "'").slice(0, 150)}\`` : '');
}

function startStream(url) {
  const y = spawn(YTDLP, [...baseArgs(), '-q', '--no-progress', '--no-playlist', '-f', 'bestaudio[acodec=opus]/bestaudio/best', '-o', '-', url]);
  const f = spawn('ffmpeg', [
    '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-af', `volume=${VOLUME}`,
    '-f', 'ogg', '-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-b:a', '96k', 'pipe:1',
  ]);
  let err = '', onData = null;
  y.stdout.once('data', () => onData?.());
  y.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
  f.stderr.on('data', () => {});
  y.stdout.on('error', () => {});
  f.stdin.on('error', () => {});
  f.stdout.on('error', () => {});
  y.on('error', (e) => { err += `\n${e.message}`; f.stdin.end(); });
  f.on('error', (e) => { err += `\nffmpeg: ${e.message}`; });
  y.stdout.pipe(f.stdin);
  return {
    stream: f.stdout,
    err: () => err,
    onData(fn) { onData = fn; },
    kill() { for (const p of [y, f]) if (p.exitCode === null && !p.killed) { try { p.kill('SIGKILL'); } catch {} } },
  };
}

// ───────── 상태 ─────────
const states = new Map();
const fmt = (s) => {
  s = Math.round(s || 0); if (!s) return 'LIVE';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
const label = (t) => `**${t.title.replace(/([*_`~|])/g, '\\$1').slice(0, 90)}** (${fmt(t.duration)})`;

function getState(guildId) {
  if (states.has(guildId)) return states.get(guildId);
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  const st = { player, queue: [], current: null, proc: null, text: null, fails: 0 };
  player.on(AudioPlayerStatus.Idle, (old) => {
    const played = old?.resource?.playbackDuration || 0;
    const t = st.current;
    const proc = st.proc;
    st.current = null; st.proc = null;
    if (proc) proc.kill();
    if (states.get(guildId) !== st) return;   // !정지 / 퇴장으로 정리된 상태
    if (t && !t.skipped && played < 2000) {
      st.fails++;
      say(st, `⚠️ ${label(t)}\n${errHint(proc?.err())}`);
      console.error('[music] 재생 실패', t.url, (proc?.err() || '').split('\n').filter(Boolean).slice(-2).join(' | '));
      if (st.fails >= 3) { st.queue = []; say(st, bi('연속 3곡 실패해서 대기열 비움', '3曲連続で失敗したのでキューを空にした')); return; }
    } else st.fails = 0;
    playNext(guildId);
  });
  player.on('error', (e) => console.error('[music] 플레이어 오류:', e.message));
  states.set(guildId, st);
  return st;
}

function say(st, content) {
  st.text?.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
}

function attach(guildId) {
  const st = states.get(guildId);
  const conn = getVoiceConnection(guildId);
  if (st?.current && conn && !tts.isPlaying(guildId)) conn.subscribe(st.player);
}

function playNext(guildId, announce = true) {
  const st = states.get(guildId);
  if (!st || st.current) return;
  const t = st.queue.shift();
  if (!t) return;
  st.current = t;
  st.proc = startStream(t.url);
  st.player.play(createAudioResource(st.proc.stream, { inputType: StreamType.OggOpus, metadata: t }));
  attach(guildId);
  if (announce) st.proc.onData(() => say(st, `🎵 ${label(t)}\n-# ${t.by}`));   // 실제로 음원이 나오기 시작하면 알림
}

function clear(guildId) {
  const st = states.get(guildId);
  if (!st) return;
  states.delete(guildId);
  st.queue = [];
  if (st.current) st.current.skipped = true;
  st.proc?.kill();
  st.player.stop(true);
}

// tts.js 쪽에서 부르는 연결 고리
tts.hooks.busyIn = (guildId) => (states.get(guildId)?.current ? getVoiceConnection(guildId)?.joinConfig.channelId : null);
tts.hooks.onIdle = (guildId) => attach(guildId);
tts.hooks.onLeave = (guildId) => clear(guildId);

// ───────── 명령어 ─────────
async function handle(m, kind, arg) {
  const g = m.guild.id;
  const vc = m.member?.voice?.channel;
  const st = states.get(g);
  const busy = tts.hooks.busyIn(g);
  const sameVc = () => vc && (!busy || busy === vc.id);

  if (kind === 'play') {
    if (!arg) return m.reply(bi('사용법: `!재생 노래 제목` 또는 `!재생 유튜브 링크`', '使い方: `!再生 曲名` か `!再生 YouTubeリンク`'));
    if (!vc) return m.reply(bi('음성 채널에 먼저 들어가 줘', '先にボイスチャンネルに入って'));
    if (busy && busy !== vc.id) return m.reply(bi(`지금 <#${busy}>에서 틀고 있음`, `今 <#${busy}> で再生中`));
    if (!hasYtdlp()) return m.reply(bi('서버에 yt-dlp가 없음 (설치 필요)', 'サーバーにyt-dlpがない（要インストール）'));
    const q = arg.replace(/^<(https?:\/\/[^>]+)>$/, '$1');
    if (/^https?:\/\//i.test(q) && !isYoutubeUrl(q)) return m.reply(bi('유튜브·유튜브 뮤직 링크만 됨 (아니면 제목으로 검색)', 'YouTube・YouTube Musicのリンクだけ（それ以外は曲名で検索）'));
    const looking = m.react('🔍').catch(() => null);
    let tracks;
    try { tracks = await resolveTracks(q); } catch (e) {
      console.error('[music] 검색 실패', q, (e.stderr || e.message).split('\n').filter(Boolean).slice(-2).join(' | '));
      return m.reply(errHint(e.stderr || e.message));
    } finally { looking.then((r) => r?.users.remove(m.client.user.id)).catch(() => {}); }
    const tooLong = tracks.filter((t) => t.duration > MAX_SEC).length;
    tracks = tracks.filter((t) => t.duration <= MAX_SEC);
    if (!tracks.length) return m.reply(tooLong ? bi('너무 긴 영상이라 못 넣음', '長すぎる動画なので追加できない') : bi('못 찾음', '見つからなかった'));
    if (!m.member.voice.channel) return;
    try { await tts.ensureConnection(m.member.voice.channel, { subscribe: false }); } catch (e) {   // 음성 접속 실패도 답장
      console.error('[music] 음성 접속 실패', e.message);
      return m.reply(bi('음성 채널 접속 실패, 잠시 후 다시 해줘', 'ボイスチャンネルに接続できなかった。少ししてからもう一度'));
    }
    const s = getState(g);
    s.text = m.channel;
    const room = MAX_QUEUE - s.queue.length;
    if (room <= 0) return m.reply(bi(`대기열이 꽉 참 (${MAX_QUEUE}곡)`, `キューがいっぱい（${MAX_QUEUE}曲）`));
    const by = m.member.displayName;
    tracks = tracks.slice(0, room).map((t) => ({ ...t, by }));
    s.queue.push(...tracks);
    const wasIdle = !s.current;
    if (wasIdle) playNext(g, false);
    const head = wasIdle ? `🎵 ${label(tracks[0])}` : `➕ ${label(tracks[0])} — ${bi(`대기 ${s.queue.length - tracks.length + 1}번`, `${s.queue.length - tracks.length + 1}番目`).replace('\n', ' ')}`;
    const more = tracks.length > 1 ? `\n${bi(`외 ${tracks.length - 1}곡 추가`, `ほか${tracks.length - 1}曲追加`)}` : '';
    return m.reply({ content: head + more + (tooLong ? `\n-# ${tooLong}곡은 너무 길어서 뺌 / ${tooLong}曲は長すぎて除外` : ''), allowedMentions: { parse: [] } });
  }

  if (!st?.current && !st?.queue.length) return m.reply(bi('지금 트는 노래 없음', '今は何も再生してない'));
  if (kind !== 'queue' && kind !== 'np' && !sameVc()) return m.reply(bi('같은 음성 채널에 있어야 함', '同じボイスチャンネルにいる必要がある'));

  if (kind === 'skip') {
    if (st.current) st.current.skipped = true;
    st.player.stop(true);
    return m.react('⏭️').catch(() => {});
  }
  if (kind === 'stop') {
    clear(g);
    return m.react('⏹️').catch(() => {});
  }
  if (kind === 'pause') { st.player.pause(); return m.react('⏸️').catch(() => {}); }
  if (kind === 'resume') { st.player.unpause(); attach(g); return m.react('▶️').catch(() => {}); }
  if (kind === 'shuffle') {
    for (let i = st.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [st.queue[i], st.queue[j]] = [st.queue[j], st.queue[i]]; }
    return m.react('🔀').catch(() => {});
  }
  if (kind === 'np') {
    const t = st.current;
    if (!t) return m.reply(bi('지금 트는 노래 없음', '今は何も再生してない'));
    const pos = st.player.state.resource?.playbackDuration / 1000 || 0;
    return m.reply({ content: `🎵 ${label(t)}\n${fmt(pos)} / ${fmt(t.duration)} · ${t.by}\n<${t.url}>`, allowedMentions: { parse: [] } });
  }
  if (kind === 'queue') {
    const lines = [];
    if (st.current) lines.push(`🎵 ${label(st.current)}`);
    st.queue.slice(0, 10).forEach((t, i) => lines.push(`${i + 1}. ${label(t)}`));
    if (st.queue.length > 10) lines.push(`-# … +${st.queue.length - 10}`);
    const total = st.queue.reduce((a, t) => a + (t.duration || 0), 0);
    if (st.queue.length) lines.push(`-# 대기 ${st.queue.length}곡 · ${fmt(total)} / 待ち${st.queue.length}曲`);
    return m.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
  }
}

function updateYtdlp() {
  if (!hasYtdlp()) return;
  execFile(YTDLP, ['-U'], { timeout: 120e3 }, (err, out) => {
    const msg = String(out || err?.message || '').split('\n').filter(Boolean).pop();
    if (msg) console.log('[music] yt-dlp 업데이트:', msg);
  });
}

module.exports = function (client) {
  console.log(`[music] ${hasYtdlp() ? 'yt-dlp 있음' : 'yt-dlp 없음 (scripts/install-music.sh 필요)'}, deno ${fs.existsSync(DENO) ? '있음' : '없음'}`);
  client.on('messageCreate', (m) => {
    if (m.author?.bot || m.webhookId || !m.guild || !m.content?.startsWith('!')) return;
    const [c, ...rest] = m.content.trim().split(/\s+/);
    const kind = CMD_OF.get(c.toLowerCase());
    if (!kind) return;
    handle(m, kind, rest.join(' ').trim()).catch((e) => console.error('[music]', kind, e.message));
  });
  setTimeout(updateYtdlp, 60e3);
  setInterval(updateYtdlp, 24 * 3600e3);
};
module.exports._test = { resolveTracks, isPlaylistUrl, isYoutubeUrl, errHint, fmt, states, getState, playNext, clear };
