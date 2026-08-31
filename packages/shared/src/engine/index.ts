// 엔진 층 배럴 — **주제(게임 콘텐츠)를 하나도 모르는 것만** 여기에 둔다.
//
// 판정 기준: 이 파일 아래의 어떤 심볼도 카드·보드·좌표·클루 규칙을 참조하지 않는다.
// 반대로 `content/`는 여기를 import 해도 되지만, **여기서 `content/`를 import 하면 안 된다**
// (한 방향 의존 — 그것이 «엔진과 콘텐츠를 분리했다»는 주장의 유일한 기계적 근거다).

export * from "./ai";
export * from "./color";
export * from "./room-code";
export * from "./view-notation";
export * from "./view-timing";
