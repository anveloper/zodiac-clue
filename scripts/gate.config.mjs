// 회귀 게이트 설정 — **수치는 전부 여기 한 곳에만 있다.**
//
// 근거 문서: docs/design/20260727-improvement-roadmap.md §9.1(번들)·§9.6(수용 게이트)
//           docs/design/20260727-execution-plan.md §2(08-02 기준선 / 08-04 통과)·§6(일일 체크포인트)
//           docs/design/20260720-ai-tech-doc.md §3(환각 검증)
//
// ⚠ 이 파일은 **판정 기준**만 담는다. "지금 값이 얼마인가"(기준선)는
//    `scripts/gate.baseline.json`에 따로 기록한다 — 기준선은 코드 변경과 함께
//    **사람이 사유를 적고** 갱신하는 값이고, 기준은 로드맵이 바뀔 때만 움직이기 때문이다.

/** 게이트가 검사하는 항목. `quick`은 커밋 전 모드(`--quick`)에 포함되는가. */
export const ITEMS = {
  typecheck: {
    id: "typecheck",
    label: "타입 (pnpm -r typecheck)",
    quick: true,
    // 근거: 8~15초. 컴파일이 깨진 채 커밋되면 다른 작업자 전원이 즉시 막힌다.
    //       마감 4일 전 최다빈도 사고이므로 quick의 1순위.
    why: "가장 싸고(≈10s) 가장 자주 깨진다. 깨진 채 push하면 동시 작업자 전원이 멈춘다.",
  },
  build: {
    id: "build",
    label: "빌드 (client vite build)",
    quick: false,
    // 근거: 25~60초. typecheck가 잡지 못하는 것(자산 경로·순환 의존·번들러 해석)만
    //       추가로 잡는다. 커밋마다 물리기에는 비싸고, 번들 계측의 **선행 조건**이라
    //       전체 모드에서만 돈다.
    why: "느리다(≈30s+). typecheck 이후 남는 위험은 번들러 해석뿐 — 그건 push/촬영 전 전체 모드에서 잡는다. 번들 게이트의 선행 조건.",
  },
  bundle: {
    id: "bundle",
    label: "번들 예산 (roadmap §9.1)",
    quick: false,
    why: "빌드 산출물이 있어야 잰다. 빌드가 전체 모드 전용이므로 함께 전체 모드.",
  },
  sim: {
    id: "sim",
    label: "규칙 밸런스 회귀 (sim-balance)",
    quick: true,
    // 근거: 시드 고정 순수 시뮬. 1~2초. 규칙을 건드린 커밋이 밸런스를 뒤집었는지
    //       그 자리에서 알려준다 — 나중에 알면 되돌릴 시간이 없다.
    why: "시드 고정 순수 시뮬이라 ≈2초. 규칙 커밋이 밸런스를 뒤집은 것을 **그 커밋에서** 잡는 유일한 수단.",
  },
  narrator: {
    id: "narrator",
    label: "LLM 환각 검증 (eval-narrator · 오프라인)",
    quick: true,
    // quick에서는 `--quick`(36케이스), 전체에서는 전수 스윕(≈11만 문장).
    why: "quick은 36케이스(≈3s)로 규약 위반의 존재만 본다. 전수(≈11만 문장)는 전체 모드. **어느 모드에서도 Gemini 실호출 0.**",
  },
  gpu: {
    id: "gpu",
    label: "GPU 자원 정적 계측 (roadmap §9.3)",
    quick: true,
    why: "정적 스캔이라 0.05초. 공짜인 검사를 빼면 quick의 신뢰도만 떨어진다.",
  },
  docs: {
    id: "docs",
    label: "문서·코드 상수 정합",
    quick: true,
    why: "정적 스캔이라 0.05초. 문서/코드 갈라짐이 반복 발생한 저장소라 상시 감시가 싸다.",
  },
  screen: {
    id: "screen",
    label: "화면 게이트 (겹침·세로스크롤·터치타깃)",
    quick: false,
    // 근거(실측 ≈18s): Colyseus 서버 + Vite + Chrome 기동에 대부분이 들고,
    //       화면 10회(5종 × 뷰포트 2종) 왕복은 각 1.6초다. quick 전체가 ≈3초이므로
    //       넣는 순간 커밋 게이트가 **6배 이상 무거워진다.**
    //       그보다 큰 이유는 **포트를 두 개 열고 Chrome을 띄운다**는 것이다 —
    //       커밋마다 물리면 동시에 dev를 켜 둔 작업자와 자원을 다툰다.
    //       이 게이트가 잡는 사고(가림·밀림·작은 버튼)는 커밋 단위가 아니라
    //       **화면 커밋이 쌓인 뒤 push·촬영 전에** 확인하면 충분하다.
    why: "브라우저·서버·클라를 실제로 띄운다(실측 ≈18s, 포트 2개 + Chrome). quick(≈3s)에 넣으면 6배 무거워지고 남의 dev와 자원을 다툰다 — push·촬영·제출 전 전체 모드 전용.",
  },
};

/**
 * §9.6 런타임 게이트 — **이 러너로는 측정할 수 없다.**
 * 뷰1→2→3→4→1 10회 순회 후 `renderer.info.memory` ±5 는 살아 있는 WebGL 컨텍스트가 필요하다.
 * 따라서 항상 `SKIP`으로 **명시 출력**한다(은폐된 미측정 금지 — §9.6의 취지).
 */
export const RUNTIME_GATE = {
  id: "runtime",
  label: "§9.6 런타임 수용 게이트 (뷰 10회 순회 ±5)",
  reason:
    "브라우저 WebGL 컨텍스트가 필요해 CLI로 측정 불가. " +
    "절차: node scripts/gate-gpu-baseline.mjs --print-runtime-gate",
};

// ── 번들 예산 (roadmap §9.1) ────────────────────────────────────────
export const BUNDLE = {
  distDir: "apps/client/dist",
  /**
   * 로드맵 §9.1이 명시한 **목표**: 크리티컬 JS 2,130 → 약 120 kB.
   * 목표는 "달성하면 좋은 값"이라 **FAIL 기준으로 쓰지 않는다**(오늘 돌리면 전부 FAIL이라
   * 아무도 안 돌리게 된다). 대신 목표 대비 진척을 항상 인쇄한다.
   */
  targetInitialJsKb: 120,
  targetSource: "roadmap §9.1 «크리티컬 JS 2,130 → 약 120 kB (−94%)»",
  /**
   * 실제 FAIL 기준 = **래칫**. 기준선(gate.baseline.json)보다 이만큼 넘게 커지면 실패.
   * 3%를 고른 이유: 현 기준선 2,175 kB에서 +65 kB. 기능 추가 한 건이 우발적으로 삼키는
   * 크기(라이브러리 하나 = 수백 kB)보다는 작고, 코드 몇 줄 추가로는 절대 안 닿는 폭이다.
   * 스플리팅이 들어와 기준선이 100 kB대로 내려가면 3% = 3 kB로 자동으로 촘촘해진다.
   */
  ratchetSlackPct: 3,
  /** 기준선보다 이만큼(%) 이상 **줄었으면** 기준선을 조여 달라고 안내한다(FAIL 아님). */
  ratchetTightenPct: 10,
  /**
   * 단일 청크 상한 — 스플리팅의 성공 여부를 크기 하나로 재는 보조 지표.
   * 지금은 청크가 1개라 이 값이 초기 로드와 같다. 스플리팅 후에는
   * "가장 큰 지연 청크"(phaser 1,479 kB)가 여기 걸린다 → 경고만 한다.
   */
  warnChunkKb: 1600,
};

// ── 규칙 밸런스 회귀 (sim-balance) ──────────────────────────────────
export const SIM = {
  /**
   * 게이트가 재는 변형 = **현재 규칙**(⑥ revealed 분리 + 즉시고발 + 재진입 + 상한 75).
   * 나머지 변형은 "왜 지금 규칙인가"의 근거라 회귀 대상이 아니다.
   */
  variant: "current",
  seed: 20260728,
  /**
   * 판 수. 시드가 고정이라 **같은 코드면 결과가 비트 단위로 같다**(RNG는 mulberry32 단일 스트림).
   * 그런데 밸런스와 무관한 리팩터가 RNG 소비 순서만 바꿔도 표본이 통째로 새로 뽑힌다.
   * 그 경우의 표본오차를 무시할 수 있는 크기로 20,000판을 쓴다(≈2초).
   *   승률 p≈0.20에서 SE = √(p(1-p)/N) = 0.28 %p → 두 독립표본 차의 SE = 0.40 %p.
   *   따라서 아래 밴드(±2.0 %p)는 **표본잡음의 5σ**이고, 실질적으로 "설계상 의미 있는
   *   밸런스 변화"만 걸린다.
   */
  games: 20000,
  /**
   * 허용 밴드. 시드 고정이므로 이 폭은 **잡음 흡수용이 아니라 "이 정도 움직이면
   * 의도된 밸런스 변경이다"의 선**이다. 넘으면 FAIL → 사람이 기준선을 사유와 함께 갱신한다.
   */
  bands: {
    // 사람 승률: 공정 몫 16.7%. ±2.0 %p면 "16.7 근처"라는 설계 의도를 깨지 않는 폭이고,
    // 봇 확률적 오답 고발 같은 규칙 변경은 이보다 크게 움직인다(로드맵 실측 2.3%→22.3%).
    humanWinPct: { band: 2.0, unit: "%p" },
    // 판 길이: 7.3라운드. ±0.8은 "체감 페이싱이 달라졌다"의 하한(약 11%).
    avgRounds: { band: 0.8, unit: "라운드" },
    // 제안 p95: 67. ±8은 상한 75와의 여유(8)와 같다 — 이보다 움직이면 상한 근거가 무너진다.
    p95Suggestions: { band: 8, unit: "회" },
    // 보드가 장식인지 재는 지표(9개 방 중 몇 개를 밟는가). 5.1 → ±0.6.
    avgHumanRooms: { band: 0.6, unit: "개" },
  },
  /**
   * 밴드가 아니라 **절대 상한**으로 잠그는 값 — 설계 의도가 "0에 가깝다"인 지표.
   */
  ceilings: {
    // 상한은 밸런스 손잡이가 아니라 무한지연 백스톱(sim-balance 주석). 목표 도달률 ≤1%.
    // 2%를 넘으면 백스톱이 밸런스에 개입하기 시작한 것이다.
    capHitPct: { max: 2.0, unit: "%" },
    // 무승부는 공통단서 추가 공개로 수렴하므로 설계상 0%여야 한다.
    drawPct: { max: 0.5, unit: "%" },
  },
};

// ── 문서·코드 상수 정합 ────────────────────────────────────────────
// 원칙: **오탐이 없는 것만.** 앵커(문서 쪽 문구)를 못 찾으면 FAIL이 아니라 SKIP이다
//       (문서가 리라이트된 것과 값이 갈라진 것은 다른 사건이다).
export const DOC_CHECKS = [
  {
    id: "D1",
    label: "SUGGEST_CAP — 서버 규칙 ↔ 시뮬 미러",
    kind: "code-vs-code",
    why:
      "sim-balance.mjs는 clue-room.ts 규칙의 **이식본**이다. 한쪽만 바뀌면 " +
      "시뮬 기준선이 배포되는 규칙과 다른 것을 재게 된다(회귀 게이트가 조용히 거짓말을 한다).",
    a: { file: "apps/server/src/rooms/clue-room.ts", re: /^const SUGGEST_CAP = (\d+);/m },
    b: { file: "scripts/sim-balance.mjs", re: /^const SUGGEST_CAP = (\d+);/m },
  },
  {
    id: "D2",
    label: "MAX_PLAYERS — shared ↔ 시뮬 SEATS",
    kind: "code-vs-code",
    why: "좌석 수가 갈라지면 시뮬의 승률·공정몫(16.7%)이 전부 무의미해진다.",
    a: { file: "packages/shared/src/index.ts", re: /^export const MAX_PLAYERS = (\d+);/m },
    b: { file: "scripts/sim-balance.mjs", re: /^const SEATS = (\d+);/m },
  },
  {
    id: "D3",
    label: "LINE_BUDGET_SUGGEST / LINE_MAX — 코드 ↔ ai-tech-doc §3 C2",
    kind: "code-vs-doc",
    why:
      "④ 제출물이 «제안 25자 / 그 외 40자»를 **규약으로 명시**한다. " +
      "07-28에 한 번 갈라진 전력이 있다(문서 40자 vs 코드 80자).",
    code: [
      { name: "LINE_BUDGET_SUGGEST", file: "apps/server/src/ai/narrator.ts", re: /^export const LINE_BUDGET_SUGGEST = (\d+);/m },
      { name: "LINE_MAX", file: "apps/server/src/ai/narrator.ts", re: /^export const LINE_MAX = (\d+);/m },
    ],
    doc: {
      file: "docs/design/20260720-ai-tech-doc.md",
      // 앵커: "제안 **25자** / 그 외 **40자**" 형태(강조 기호 유무 무관).
      re: /제안\s*\*{0,2}(\d+)자\*{0,2}\s*\/\s*그\s*외\s*\*{0,2}(\d+)자/,
      names: ["LINE_BUDGET_SUGGEST", "LINE_MAX"],
    },
  },
  {
    id: "D4",
    label: "CELL_PX / PX_PER_UNIT — 코드 ↔ view-contract-spec §1.1",
    kind: "code-vs-doc",
    why: "4뷰 좌표 환산의 유일한 상수. 문서가 «1칸 = CELL_PX 40 … PX_PER_UNIT(40)»으로 값을 박아뒀다.",
    code: [{ name: "CELL_PX", file: "packages/shared/src/view-consts.ts", re: /^export const CELL_PX = (\d+);/m }],
    doc: {
      file: "docs/design/20260727-view-contract-spec.md",
      re: /1칸\s*=\s*`?CELL_PX`?\s*\*{0,2}(\d+)/,
      names: ["CELL_PX"],
    },
  },
];

// ── 화면 게이트 (gate-screen.mjs) ───────────────────────────────────
//
// 왜 여기 있는가: 07-28 실기 스크린샷이 잡은 세 가지를 **자동 검증이 전부 놓쳤다.**
//   ① 턴 배너가 상단 액션 바 6개 중 5개를 덮었다.
//      → 그때 게이트가 물은 것은 "버튼이 DOM에 있고 뷰포트 안인가"였고 답은 **참**이었다.
//        가려진 요소도 `getBoundingClientRect()`는 정상 크기를, `visibility`는 `visible`을
//        그대로 보고한다. **가림은 요소의 속성이 아니라 요소 쌍의 관계**다.
//   ② 문서가 세로로 스크롤돼 화면이 통째로 밀려 올라갔다.
//      → 그때 잰 것은 `scrollWidth vs innerWidth`(**가로**)뿐이었다. 세로는 잰 적이 없다.
//        게다가 전체 페이지 캡처는 밀린 화면을 **정상으로 렌더**한다(스크린샷도 못 잡는다).
//   ③ 터치 타깃이 전반적으로 44px 미달이었다.
//
// 기대값을 **화면별로** 둔다. 예: 세로 스크롤은 게임 화면에서 금지지만
// 랜딩·대기실에서는 정상이다(카드가 뷰포트보다 길 수 있다). 한 기준을 전 화면에
// 밀어붙이면 곧 아무도 못 믿는 게이트가 된다.
export const SCREEN = {
  /** 손가락 타깃 하한(px). 근거: Apple HIG 44pt · index.html §터치 T1이 이미 쓰는 값. */
  minTouchPx: 44,
  /**
   * 겹침 표본점. 가시 사각형의 중심 + 네 모서리(20%/80% 안쪽).
   * FAIL 조건 = **중심이 막혔거나** 5점 중 3점 이상이 막혔을 때.
   * 한 점만 막힌 것으로 실패시키면 이웃 요소의 그림자·둥근 모서리가 오탐을 만든다.
   */
  sampleInsetPct: 0.2,
  blockedFailCount: 3,
  /**
   * 쌍 겹침을 "겹쳤다"고 볼 최소 교차 면적(px²)과 **최소 교차 변**(px).
   *
   * 면적만 보면 오탐이 난다 — 실측: 턴 배너 하단(y=72.6)과 손패 상단(y=72.0)이
   * **0.6px 접선**으로 만나 폭 163px과 곱해져 98px²가 나왔다. 이것은 «덮음»이 아니라
   * 서브픽셀 반올림이다. 가로·세로 **양쪽 모두** 이 변을 넘어야 겹침으로 센다.
   * 4px = 글자 한 획도 가리지 못하는 폭이라, 진짜 가림(수십 px)은 그대로 걸린다.
   */
  minOverlapPx2: 16,
  minOverlapEdgePx: 4,
  /** 세로 스크롤 허용 오차(px). 서브픽셀 반올림. */
  scrollTolPx: 1,
  /** 화면 하나가 준비 상태에 도달할 때까지 기다리는 상한(ms). 넘으면 SKIP(판정 불가). */
  readyTimeoutMs: 25_000,
  /** 준비 후 레이아웃이 멎기를 기다리는 시간(ms). */
  settleMs: 700,

  /**
   * 뷰포트. 폰에서는 **터치 에뮬레이션 + `pointer: coarse`** 를 켠다 —
   * 이 저장소의 D-패드·44px 하한은 전부 `@media (pointer: coarse)` 안에 있어서
   * 켜지 않으면 **실제로 심사자가 보는 화면과 다른 화면을 재게 된다.**
   */
  viewports: [
    { id: "phone", label: "폰 390×844", width: 390, height: 844, dsf: 3, mobile: true, coarse: true },
    { id: "desktop", label: "데스크톱 1440×900", width: 1440, height: 900, dsf: 1, mobile: false, coarse: false },
  ],

  /**
   * 화면별 기대값.
   *   url/steps/ready — 어떻게 그 화면에 도달하는가(파라미터 없는 진입을 기본으로 둔다).
   *   vscroll        — "locked": 문서가 세로로 스크롤되면 FAIL / "allow": 스크롤이 정상
   *   protect        — **무엇이 가려도 안 되는가.** 심사자가 눌러야 하는 것들.
   *   pairs          — 서로 가리면 안 되는 **요소 쌍**(관계로만 드러나는 사고).
   *   touchExempt    — 44px 하한에서 제외할 선택자. **사유 없이는 추가하지 마라.**
   */
  screens: [
    {
      id: "landing",
      label: "랜딩(파라미터 없는 진입)",
      url: "/",
      steps: [],
      ready: "!document.getElementById('landing').classList.contains('hidden') && !!document.getElementById('createBtn')",
      // 랜딩은 카드가 길어질 수 있다. 세로 스크롤은 **정상**이다.
      vscroll: "allow",
      protect: [
        { sel: "#createBtn", why: "심사자의 첫 행동. 이게 가려지면 45초가 통째로 죽는다" },
        { sel: "#joinBtn", why: "초대 코드 참가 경로" },
        { sel: "#codeInput", why: "코드 입력칸" },
        { sel: "#refreshRooms", why: "공개방 새로고침" },
        { sel: "#visSeg .seg-btn", min: 2, why: "공개/비공개 선택" },
        { sel: ".ai-links a", min: 3, why: "제출물 문서로 가는 유일한 링크(심사자 동선)" },
      ],
      pairs: [
        ["#createBtn", ".join-row", "«방 만들기»와 «초대 코드» 줄이 겹치면 둘 다 오조작"],
        ["#landingMsg", "#roomList", "상태 문구가 공개방 목록을 덮으면 참여 경로가 사라진다"],
      ],
      touchExempt: [],
    },
    {
      id: "lobby",
      label: "대기실(방 만들기 직후)",
      url: "/",
      steps: [{ click: "#createBtn" }],
      ready: "!document.getElementById('lobby').classList.contains('hidden')",
      vscroll: "allow",
      protect: [
        { sel: "#startBtn", why: "방장이 잔치를 시작하는 단 하나의 버튼" },
        { sel: "#copyBtn", why: "초대 링크 복사" },
        { sel: "#inviteLink", why: "초대 링크(선택·복사 대상)" },
        { sel: "#lobbyChars .char", min: 12, why: "캐릭터 12칸 — 하나라도 가려지면 못 고른다" },
      ],
      pairs: [
        ["#lobbyPersona", "#startBtn", "직업 설명이 [잔치 시작]을 덮으면 시작을 못 한다"],
        ["#lobbyChars", "#startBtn", "캐릭터 격자와 시작 버튼"],
      ],
      touchExempt: [],
    },
    {
      id: "game",
      label: "게임 뷰1(솔로 즉시 진입 · 안내 카드 없음)",
      // ?solo=1 = 원클릭 솔로(create→start). demo=1 = 60초 안내 카드 생략.
      url: "/?solo=1&demo=1",
      steps: [],
      ready:
        "!document.getElementById('gameScreen').classList.contains('hidden')" +
        " && !document.getElementById('turnInfo').classList.contains('hidden')",
      // 게임 화면은 **문서 스크롤 자체가 없어야 한다**(index.html `body.no-scroll`).
      // 밀려 올라가면 보드가 위로 사라지고 아래에 검은 띠가 남는다 — 실기에서 실제로 났다.
      vscroll: "locked",
      protect: [
        {
          sel: ".hud-ctrl button",
          min: 6,
          why:
            "액션 바 6개. **07-28 실기에서 [제안] 말고 5개가 턴 배너에 가려졌다.** " +
            "존재·크기·visibility는 그때도 전부 정상이었다 — 여기서는 실제 히트 테스트로 본다",
        },
        { sel: "#viewToggle", why: "뷰 전환 진입점(제출물 ③의 4뷰 시연 경로)" },
        { sel: "#turnInfo", why: "지금 누구 턴인가 — 가려지면 판 진행을 못 읽는다" },
        { sel: "#rpToggle", optional: true, why: "우측 패널 토글(폰에서만 뜬다)" },
        { sel: ".hud-dpad .dp", min: 4, optional: true, why: "터치 이동 패드(coarse에서만 렌더)" },
      ],
      pairs: [
        ["#turnInfo", ".hud-ctrl", "**07-28 사고 그 자체.** 턴 배너가 액션 바를 덮었다"],
        ["#turnInfo", ".hud-hand", "배너가 손패를 덮으면 «내 3장»을 못 본다"],
        [".hud-ctrl", ".hud-dpad", "액션 바와 D-패드가 겹치면 이동 중 오조작"],
        [".hud-ctrl", ".hud-view", "액션 바와 뷰 전환 칩"],
        [".hud-hand", ".hud-dpad", "손패와 D-패드"],
        ["#rightPanel", ".hud-ctrl", "우측 컬럼이 액션 바를 덮으면 아무 행동도 못 한다"],
      ],
      touchExempt: [],
    },
    {
      id: "goal-modal",
      label: "게임 + 60초 안내 카드(모달)",
      url: "/?solo=1",
      steps: [],
      ready:
        "!document.getElementById('gameScreen').classList.contains('hidden')" +
        " && !document.getElementById('goalCard').classList.contains('hidden')",
      vscroll: "locked",
      // 모달이 뜬 동안 **뒤가 가려지는 것은 정상**이다. 그래서 보호 대상은 모달 자신뿐이다.
      protect: [
        { sel: "#goalOk", why: "안내를 닫는 유일한 버튼. 가려지면 게임에 못 들어간다" },
        { sel: "#goalCard .goal-lines div", min: 3, why: "규칙 3줄 — 45초 심사의 본문" },
      ],
      pairs: [["#goalOk", ".goal-lines", "확인 버튼이 본문을 덮으면 규칙을 못 읽는다"]],
      touchExempt: [],
    },
    {
      id: "accuse-modal",
      label: "게임 + 고발 모달(select 3개)",
      url: "/?solo=1&demo=1",
      steps: [
        { waitFor: "!document.getElementById('turnInfo').classList.contains('hidden')" },
        { click: "#accuse" },
      ],
      ready: "!!document.querySelector('.overlay .modal select')",
      vscroll: "locked",
      protect: [
        { sel: ".modal select", min: 3, why: "용의자·훔친 것·장소 — 고발의 전부" },
        { sel: ".modal .actions button", min: 2, why: "[취소]/[고발한다]" },
      ],
      pairs: [[".modal .actions", ".modal-note", "버튼 줄이 안내 문구를 덮는가"]],
      touchExempt: [],
    },
  ],

  /**
   * **측정하지 못하는 화면** — 조용히 빼지 않는다. 실행할 때마다 사유와 함께 인쇄한다.
   * (은폐된 미측정이 회귀보다 위험하다 — roadmap §9.6의 취지)
   */
  unreachable: [
    {
      id: "result",
      label: "결과 화면(승패 오버레이)",
      why:
        "정답 봉투는 동기화 상태에 없다(비밀 정보 규약) — 클라가 정답을 알 수 없어 " +
        "«고발 성공»을 결정론적으로 만들 수 없다. NPC가 맞힐 때까지 실판을 돌리면 " +
        "수십 초가 걸리고 결과도 시드마다 달라진다. 사람이 §사람 확인에서 본다.",
    },
    {
      id: "views-2-3-4",
      label: "뷰2·3·4(2.5D/3D 화면)",
      why:
        "헤드리스 `--disable-gpu`에서 WebGL 컨텍스트가 소프트웨어 경로로 떨어져 " +
        "레이아웃이 실기와 달라질 수 있다. HUD 레이어는 뷰1과 같은 DOM이라 " +
        "여기서 재는 값이 그대로 적용된다 — 다른 것은 캔버스뿐이다.",
    },
  ],

  /** 기계가 **판정할 수 없는** 것. 실행할 때마다 인쇄한다. 지우지 마라. */
  human: [
    ["미(美)·균형", "여백·정렬·색의 조화는 기계가 못 잰다. 캡처 PNG를 열어 봐라."],
    ["읽히는가", "글자 크기·대비·줄바꿈이 폰에서 읽히는지. 44px은 «누를 수 있다»일 뿐 «읽힌다»가 아니다."],
    ["실기 1회", "헤드리스는 실제 폰이 아니다. 주소창 접힘·노치·홈 인디케이터는 실기에서만 나온다."],
    ["의도된 겹침", "겹쳐도 되는 것(모달·오버레이)은 화면별 기대값에 적어 뒀다. 그 목록이 지금도 맞는지 사람이 판단하라."],
    ["45초 동선", "가려지지 않았다는 것과 «심사자가 다음에 무엇을 눌러야 할지 안다»는 것은 다르다."],
    ["CSS로 넓힌 히트 영역", "이 게이트는 요소의 상자만 잰다. `::after`로 넓힌 탭 영역은 못 본다 — 반대로 상자가 작으면 실패로 나온다."],
    ["뷰2·3·4 · 결과 화면", "위 «측정 못 한 화면» 목록 참고. 이 게이트는 뷰1과 모달만 본다."],
  ],
};
