// `@zodiac-clue/shared` 패키지 배럴.
//
// 층 구조(docs/design/20260729-mafia-content-design.md §3 L0-③):
//   engine/        주제를 모르는 것 — AI 계측 타입 · 색 유틸 · 뷰 타이밍
//   content/clue/  클루 고유 — 십이지 카드 팩 · 대감집 보드 · 제안/반증 프로토콜 · 보드 뷰 상수
//   view-consts.ts **미분류** — 어느 층인지 판정되지 않은 표기 강도 상수(그 파일 헤더 참조)
//
// 의존 방향은 content → engine 한 방향뿐이다. 이 배럴은 **세 층을 전부 재수출**하므로
// 기존 import 경로(`import { ... } from "@zodiac-clue/shared"`)는 한 줄도 바뀌지 않는다 —
// 그래서 `pnpm -r typecheck` 통과가 곧 «동작 동일»의 증명이 된다.
//
// ⚠️ 배럴을 유지하는 것은 «지금은 주제가 하나뿐이라 경로를 흔들 이유가 없다»는 뜻이지,
// 두 주제가 같은 이름 공간을 영원히 공유해도 된다는 뜻이 아니다. 두 번째 주제가 실제로
// 들어오는 순간 이 파일은 이름 충돌로 먼저 깨진다 — 그때가 서브패스 export를 여는 시점이다.

export * from "./engine";
export * from "./content/clue";
export * from "./view-consts";
