// `@zodiac-clue/shared` 패키지 배럴.
//
// 층 구조(docs/design/20260729-mafia-content-design.md §3 L0-③):
//   engine/        주제를 모르는 것 — AI 계측 타입 · 색 유틸 · 뷰 타이밍 · 뷰 표기 강도
//   content/clue/  클루 고유 — 십이지 카드 팩 · 대감집 보드 · 제안/반증 프로토콜 · 보드 뷰 상수
//
// 2026-07-29 — **미분류 층이 사라졌다.** `view-consts.ts`에 남아 있던 9상수를 판정해
// 6개(`ELIM_ALPHA`·`ELIM_NEEDS_SECOND_CUE`·`TOKEN_OUTLINE_PX/COLOR`·`BUBBLE_BORDER_PX`·
// `BUBBLE_SAFE_PAD_PX`)는 `engine/view-notation.ts`로, 3개(`RING_CURRENT`·`SPENT_ALPHA`·
// `SCHEME_DESAT_KEEP`)는 `content/clue/view-board.ts`로 옮기고 빈 파일을 지웠다.
// 판정 기준 4개(어휘·근거·값·방향)는 `engine/view-notation.ts` 헤더에 있다.
//
// 의존 방향은 content → engine 한 방향뿐이다. 이 배럴은 **두 층을 전부 재수출**하므로
// 기존 import 경로(`import { ... } from "@zodiac-clue/shared"`)는 한 줄도 바뀌지 않는다 —
// 그래서 `pnpm -r typecheck` 통과가 곧 «동작 동일»의 증명이 된다.
//
// ⚠️ 배럴을 유지하는 것은 «지금은 주제가 하나뿐이라 경로를 흔들 이유가 없다»는 뜻이지,
// 두 주제가 같은 이름 공간을 영원히 공유해도 된다는 뜻이 아니다. 두 번째 주제가 실제로
// 들어오는 순간 이 파일은 이름 충돌로 먼저 깨진다 — 그때가 서브패스 export를 여는 시점이다.

export * from "./engine";
export * from "./content/clue";
