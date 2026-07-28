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
