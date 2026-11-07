// fullwidth-cmd.js — 일본어 입력기로 친 전각 느낌표 '！'(와 전각 숫자·기호)도 명령어로 인식 (FW_CMD)
// '！파티　１０／２４' → '!파티 10/24'. 명령어 이름은 봇 소스에서 자동으로 모아서, 그냥 '！すごい' 같은 말은 안 건드림(번역 그대로)
// index.js 맨 끝에서 등록 → prependListener라 다른 모든 기능보다 먼저 실행됨
const fs = require('fs');
const path = require('path');

function collectCommands() {
  const set = new Set();
  for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('.js'))) {
    let src = '';
    try { src = fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/["'`]!([^"'`\s]+)["'`]/g)) set.add(m[1].toLowerCase());
    for (const m of src.matchAll(/\^!\((?:\?:)?([^)]+)\)/g)) for (const n of m[1].split('|')) if (n && !/[\\[\]]/.test(n)) set.add(n.toLowerCase());
  }
  return set;
}

module.exports = function (client) {
  const cmds = collectCommands();
  console.log(`[fw-cmd] 명령어 ${cmds.size}개 인식`);
  client.prependListener('messageCreate', (m) => {
    const c = m.content;
    if (!c || m.author?.bot) return;
    const hit = c.match(/^[\s\u3000]*[!！﹗]/);   // 반각 ! 뒤에 전각 숫자·공백이 와도 같이 정리
    if (!hit) return;
    const norm = ('!' + c.slice(hit[0].length)).normalize('NFKC').replace(/\u3000/g, ' ');
    const name = norm.slice(1).split(/\s/)[0].toLowerCase();
    if (cmds.has(name)) m.content = norm;
  });
};
module.exports.collectCommands = collectCommands;
