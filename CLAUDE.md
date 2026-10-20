# kuruma bot (Claude Code on the web 용)

한일 친구 디스코드 서버의 봇. discord.js v14, Node 20, Oracle Cloud VM에서 pm2(translate-bot)로 실행.
주인: チャ (GitHub chatmdgus). 답은 한국어 음슴체로 짧게.

## 작업 방식
- 작업 전에 docs/TODO.md, docs/DECISIONS.md 를 먼저 읽는다. 끝난 일은 TODO에 [x]와 날짜로 표시한다.
- 평소 변경은 `staging` 브랜치에 커밋하고, 열려 있는 PR 하나("모아둔 변경사항")에 계속 쌓는다. 주인이 머지할 때 한 번에 배포된다. 급한 수정만 따로 PR.
- 이 저장소는 코드만 있다. 서버에는 직접 접속할 수 없다. 쿠루마봇(kuruma-dev)이 서버를 직접 고치는 경우가 있으니 작업 전 git fetch 로 main 확인.
- 수정은 브랜치 → PR → main 머지. main에 머지되면 GitHub Actions(deploy.yml)가 서버에서 git pull → node --check → pm2 restart 하고, 봇이 안 켜지면 자동으로 되돌린다.
- 커밋 전에 바꾼 파일마다 `node --check 파일` 통과 확인.
- PR 설명에 무엇을 왜 바꿨는지, 디스코드에서 어떻게 확인하면 되는지 3줄 이내로 적는다.
- 큰 변경이나 동작 방식 변경은 먼저 계획을 말하고 주인 확인을 받는다.

## 절대 금지
- .env, 토큰, API 키, 데이터 파일(data.json, terms.json, names.json, pronouns.json, llm-usage.json, data/ 등)을 커밋하지 않는다. .gitignore를 지운다거나 느슨하게 바꾸지 않는다.
- 키를 코드에 직접 쓰지 않는다. 항상 process.env.* 를 쓴다.
- .github/workflows/deploy.yml 은 주인이 요청할 때만 바꾼다.

## 환경변수 (이름만, 값은 서버 .env에 있음)
DISCORD_TOKEN 계열, DEEPL_API_KEY, OPENAI_API_KEY, OPENAI_MODEL, LLM_BUDGET_YEN, LLM_PRICE_IN/OUT, LLM_USDJPY, LLM_CREDIT_USD,
TR_TEST_CHANNEL, TR_LOG, DEFAULT_PRONOUN, STEAM_SALE_CHANNELS, BOOTH_FREE_CHANNELS, BOOTH_FREE_EXEMPT, KEEP_USER_IDS, PARTY_CHANNELS, MEMBER_COUNT_CHANNELS, ASK_DAILY_LIMIT, ASK_BUDGET_YEN, ASK_CHANNELS,
GATE_CHANNEL, ROLE_CHANNEL, PRESENCE_INTENT(=1이면 Presence 인텐트, 포털에서 먼저 켜야 함), TSUKKOMI_RATE, TSUKKOMI_REACT_RATE, FUN_CHANNEL

## 파일
- index.js: 메인. 번역 웹훅, 파티 모집(!파티, 자연어 nlParty, 자유채팅 질문), GAME_DB/findGame, 뒤쪽 패치 블록(STEAM_GAMES, GAME_SLANG*, NL_*)
- translate-rules.js: 번역 파이프라인. 단어장/이름/1인칭, 규칙 표(KO_ONLY, JA_ONLY, CHOSEONG), DeepL, GPT 번역(LLM_*), 비교 기록, 주간 리포트
- ask.js: "야 차봇 ~" 질문 기능. 지금 꺼져 있음 (index.js 맨 끝 require 주석, ASK_OFF)
- tsukkomi.js: 자유채팅 키워드 츳코미(쿠루마봇 웹훅). welcome.js: 입장 인사. fun.js: 환율·생일(!생일)·멤버 수 돌파 축하. kuruma-say.js: 쿠루마봇 웹훅 공용
- gate.js: 입장 인사(#안뇽·ようこそ)·국적 리액션 롤(#역할·ロール, `!역할메시지`) — 칼봇에서 옮김. voice-status.js: 음성 채널 상태에 하는 게임 표시(PRESENCE_INTENT=1일 때만)
- 서버 홈(~)의 상태 파일: .tsukkomi-state.json, .kuruma-fun.json(생일), .welcome-state.json, .tr-alive.json, .kuruma-gate.json(역할 메시지 ID) — 저장소 밖
- booth-free.js, booth-watch.js, steam-sale.js, steam-picks.js, member-count.js, keep-mine.js, tts.js, fetch-games.js
- 데이터 파일은 서버에만 있다. 단어장/이름은 디스코드 명령(!단어, !이름, !게임별명)으로 관리한다.

## 디스코드 채널
- 테스트 채널(주인 전용): 1561588267520892948
