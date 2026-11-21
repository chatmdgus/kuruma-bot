#!/usr/bin/env bash
# install-music.sh — music.js(유튜브 노래 재생)에 필요한 yt-dlp + deno를 ~/bin에 설치 (root 필요 없음, 한 번만)
# yt-dlp는 유튜브 해독에 JS 런타임이 필요하고(Node는 22+만 지원, 서버는 20), 그래서 deno를 같이 받음
# 다시 실행하면 최신으로 덮어씀. 설치 후: pm2 restart translate-bot
set -euo pipefail
BIN="$HOME/bin"; mkdir -p "$BIN"
case "$(uname -m)" in
  x86_64) YT=yt-dlp_linux; DN=deno-x86_64-unknown-linux-gnu.zip ;;
  aarch64) YT=yt-dlp_linux_aarch64; DN=deno-aarch64-unknown-linux-gnu.zip ;;
  *) echo "지원 안 하는 CPU: $(uname -m)"; exit 1 ;;
esac

echo "== yt-dlp"
curl -fL --retry 3 -o "$BIN/yt-dlp.new" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YT"
chmod +x "$BIN/yt-dlp.new" && mv "$BIN/yt-dlp.new" "$BIN/yt-dlp"
"$BIN/yt-dlp" --version

echo "== deno"
TMP="$(mktemp -d)"
curl -fL --retry 3 -o "$TMP/deno.zip" "https://github.com/denoland/deno/releases/latest/download/$DN"
if command -v unzip >/dev/null; then unzip -o -q "$TMP/deno.zip" -d "$TMP"; else python3 -m zipfile -e "$TMP/deno.zip" "$TMP"; fi
chmod +x "$TMP/deno" && mv "$TMP/deno" "$BIN/deno"
rm -rf "$TMP"
"$BIN/deno" --version | head -1

set +e +o pipefail
echo "== 확인 (검색 1번 + 음원 앞부분만 받아보기)"
"$BIN/yt-dlp" --ignore-config --no-warnings --js-runtimes "deno:$BIN/deno" --flat-playlist -O '%(title)s' 'ytsearch1:lofi hip hop' || echo "!! 검색 실패 — 위 에러 확인"
"$BIN/yt-dlp" --ignore-config --no-warnings --js-runtimes "deno:$BIN/deno" -q -f 'bestaudio[acodec=opus]/bestaudio/best' -o - 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' 2>/tmp/ytdlp-test.err | head -c 300000 | wc -c \
  | awk '{ if ($1 > 100000) print "OK 음원 받기 됨 (" $1 " bytes)"; else print "!! 음원 받기 실패 — /tmp/ytdlp-test.err 확인 (봇 판정이면 쿠키 필요)" }'
free -m | head -2
