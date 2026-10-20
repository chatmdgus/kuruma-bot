// kuruma-say.js — 쿠루마봇(웹훅) 이름으로 말하기 공용 함수. 스레드도 지원, 웹훅 못 쓰면 차봇으로 그냥 보냄
const KURUMA_ID = '1561590994468601979';   // 쿠루마봇・クルマボット (이름·사진만 빌림)
const FREE_CH = '1538870664688173066';     // 자유・雑談
const hooks = new Map();

const isJa = (t) => /[ぁ-んァ-ヶ]/.test(t || '') && !/[가-힣]/.test(t || '');
const small = (t) => String(t).split('\n').map((l) => (l.trim() ? `-# ${l}` : l)).join('\n');
// 말한 사람 언어가 기본 글씨, 다른 언어는 작은 글씨
const bi = (ko, ja, jaFirst = false) => (!ja ? ko : jaFirst ? `${ja}\n${small(ko)}` : `${ko}\n${small(ja)}`);

async function getHook(client, channel) {
  const base = channel.isThread?.() ? channel.parent : channel;
  if (!base?.fetchWebhooks) return null;
  if (hooks.has(base.id)) return hooks.get(base.id);
  const list = await base.fetchWebhooks();
  const h = list.find((x) => x.owner?.id === client.user.id) || await base.createWebhook({ name: 'translator' });
  hooks.set(base.id, h);
  return h;
}

async function kurumaSay(client, channel, content) {
  try {
    const h = await getHook(client, channel);
    if (!h) throw new Error('웹훅 없음');
    const k = await client.users.fetch(KURUMA_ID).catch(() => null);
    return await h.send({
      content,
      username: k?.username || '쿠루마봇・クルマボット',
      avatarURL: k?.displayAvatarURL(),
      allowedMentions: { parse: [] },
      ...(channel.isThread?.() ? { threadId: channel.id } : {}),
    });
  } catch (e) {
    console.error('[kuruma-say] 웹훅 실패, 차봇으로 보냄', e.message);
    return channel.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
  }
}

module.exports = { kurumaSay, bi, small, isJa, FREE_CH, KURUMA_ID };
