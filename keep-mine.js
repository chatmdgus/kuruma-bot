const { Message, MessageManager } = require('discord.js');

const ids = () => [process.env.KEEP_USER_IDS, process.env.BOOTH_FREE_EXEMPT]
  .join(',').split(',').map((x) => x.trim()).filter(Boolean);
const isKept = (m) => !!m?.author && !m.author.bot && !String(m.content || '').trim().startsWith('!') &&
  (m.guild?.ownerId === m.author.id || ids().includes(m.author.id));

const origMsgDelete = Message.prototype.delete;
Message.prototype.delete = function (...args) {
  if (isKept(this)) { console.log('[keep-mine] 삭제 건너뜀', this.id); return Promise.resolve(this); }
  return origMsgDelete.apply(this, args);
};

const origMgrDelete = MessageManager.prototype.delete;
MessageManager.prototype.delete = function (message, ...args) {
  const m = typeof message === 'string' ? this.cache.get(message) : message;
  if (isKept(m)) { console.log('[keep-mine] 삭제 건너뜀', m.id); return Promise.resolve(); }
  return origMgrDelete.call(this, message, ...args);
};

console.log('[keep-mine] 적용됨');
