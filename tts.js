const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource,
  StreamType, AudioPlayerStatus, VoiceConnectionStatus, entersState, NoSubscriberBehavior,
} = require("@discordjs/voice");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

// 언어별 음성 (Edge TTS, 무료)
const VOICES = {
  ko: "ko-KR-SunHiNeural",   // 남성: ko-KR-InJoonNeural
  ja: "ja-JP-NanamiNeural",  // 남성: ja-JP-KeitaNeural
  en: "en-US-JennyNeural",
};

function detectVoice(text) {
  const hangul = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const ja = (text.match(/[\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
  if (hangul === 0 && ja === 0) return "en";
  return hangul > ja ? "ko" : "ja";
}

function cleanTextOrig(text) {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/<@!?&?\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

const states = new Map();
function getState(guildId) {
  if (!states.has(guildId)) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    const st = { player, queue: [], playing: false };
    player.on(AudioPlayerStatus.Idle, () => { st.playing = false; playNext(guildId); });
    player.on("error", (e) => { console.error("TTS 재생 오류:", e.message); st.playing = false; playNext(guildId); });
    states.set(guildId, st);
  }
  return states.get(guildId);
}

async function synth(text, voice) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-"));
  const r = await tts.toFile(dir, text, { pitch: "+20Hz", rate: "+5%" });
  return typeof r === "string" ? r : r.audioFilePath;
}

function toOggOpus(inputFile) {
  const ff = spawn("ffmpeg", [
    "-loglevel", "error", "-i", inputFile,
    "-f", "ogg", "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-b:a", "64k", "pipe:1",
  ]);
  ff.on("close", () => fs.rm(path.dirname(inputFile), { recursive: true, force: true }, () => {}));
  return ff.stdout;
}

async function playNext(guildId) {
  const st = states.get(guildId);
  if (!st || st.playing || st.queue.length === 0) return;
  const item = st.queue.shift();
  st.playing = true;
  try {
    const file = await synth(item.text, item.voice);
    const resource = createAudioResource(toOggOpus(file), { inputType: StreamType.OggOpus });
    st.player.play(resource);
  } catch (e) {
    console.error("TTS 합성 실패:", e.message);
    st.playing = false;
    playNext(guildId);
  }
}

async function ensureConnection(voiceChannel) {
  const guildId = voiceChannel.guild.id;
  let conn = getVoiceConnection(guildId);
  if (conn && conn.joinConfig.channelId !== voiceChannel.id) { conn.destroy(); conn = null; }
  if (!conn) {
    conn = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    conn.on("stateChange", (o, n) => console.log(`[voice] ${o.status} -> ${n.status}`));
    conn.on("error", (e) => console.error("[voice] error:", e.message));
    try {
      await entersState(conn, VoiceConnectionStatus.Ready, 30000);
    } catch (e) {
      console.error("[voice] Ready 실패, 현재 상태:", conn.state.status);
      if (conn.state.status !== VoiceConnectionStatus.Destroyed) conn.destroy();
      states.delete(guildId);
      throw e;
    }
    conn.on(VoiceConnectionStatus.Disconnected, () => { try { conn.destroy(); } catch {} states.delete(guildId); });
  }
  conn.subscribe(getState(guildId).player);
  return conn;
}

async function handleTtsMessage(message) {
  const vc = message.member?.voice?.channel;
  if (!vc) { await message.react("❓").catch(() => {}); return; }
  const text = cleanText(message.content || "");
  if (!text) return;
  await ensureConnection(vc);
  const st = getState(message.guild.id);
  st.queue.push({ text, voice: VOICES[detectVoice(text)] });
  playNext(message.guild.id);
}

function leaveVoice(guildId) {
  const conn = getVoiceConnection(guildId);
  if (conn) conn.destroy();
  states.delete(guildId);
}

// 음성 채널에 사람이 없으면 자동 퇴장
function setupVoiceCleanup(client) {
  client.on("voiceStateUpdate", (oldState) => {
    const ch = oldState.channel;
    if (!ch) return;
    const conn = getVoiceConnection(oldState.guild.id);
    if (!conn || conn.joinConfig.channelId !== ch.id) return;
    const humans = ch.members.filter((m) => !m.user.bot).size;
    if (humans === 0) leaveVoice(oldState.guild.id);
  });
}

module.exports = { handleTtsMessage, leaveVoice, setupVoiceCleanup };

// 단독 へ는 조사(e)가 아니라 감탄사(he)로 읽게
function fixReading(t) {
  if (typeof t !== 'string') return t;
  return t.replace(/(^|[^ぁ-んァ-ヶ一-龠々ーa-zA-Z0-9０-９ａ-ｚＡ-Ｚ])へ/g, '$1ヘ');
}
function cleanText(...args) { return fixReading(cleanTextOrig(...args)); }
