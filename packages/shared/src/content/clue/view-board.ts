// 클루 보드의 뷰 상수 — **콘텐츠(주제) 층.**
//
// 좌표계(칸)·비밀 통로·소환 앵커·보드 팔레트·첫 화면 조망은 전부 «24×24 격자 위에 방 9개와
// 잔치상이 있다»는 클루 보드 데이터에서 나온 값이다
// (docs/design/20260729-mafia-content-design.md §1.2-⑤가 `view-consts.ts:11-23,215-242,244-280,291-329`을
//  «클루 전용»으로 판정 — `INIT_MIN_CELLS`의 근거 주석은 방 3열의 실측 좌표다).
// 원래 `packages/shared/src/view-consts.ts`에 엔진 상수와 같은 파일에 있었다. 값·주석은
// **한 글자도 바꾸지 않고** 옮기기만 했다 — 루트 배럴이 그대로 재수출하므로 import 경로는 변하지 않는다.
//
// 의존 방향은 content → engine 한 방향뿐이다(`shade`만 가져다 쓴다).

import { shade } from "../../engine/color";
// `RING_CURRENT`(현재 턴 링 색)는 «주제 무관인가»가 판정되지 않아 옮기지 않았다 —
// `packages/shared/src/view-consts.ts`(미분류 표기 상수)에 그대로 있다.
import { RING_CURRENT } from "../../view-consts";

// ── §1.1 좌표계 ──────────────────────────────────────────────
// 서버가 주는 위치 진실값은 그리드 칸 하나뿐(x,y ∈ 0..23).
// 뷰1·뷰4 = 픽셀, 뷰2·뷰3 = 월드 유닛. 환산은 PX_PER_UNIT **하나로만** 한다.

/** 1칸 = 픽셀 (뷰1·뷰4). */
export const CELL_PX = 40;
/** 1칸 = 월드 유닛 (뷰2·뷰3). */
export const CELL_UNIT = 1;
/** 픽셀 ↔ 월드 유닛 환산 계수(유일한 환산 상수). */
export const PX_PER_UNIT = CELL_PX / CELL_UNIT;

export const pxToUnit = (px: number): number => px / PX_PER_UNIT;
export const unitToPx = (u: number): number => u * PX_PER_UNIT;

/** 보드 팔레트 단일 정의(한옥·사극 톤). 뷰1·뷰2·뷰3가 그대로 쓴다. */
/**
 * 비밀 통로 표기의 밝기 — 보드를 가로지르는 선이라 **기본값은 거의 안 보여야 한다.**
 * 항상 선명하면 방·토큰보다 먼저 눈에 들어와 판을 읽는 것을 방해한다(07-28 사용자 피드백).
 * 마우스를 가져가면 드러나고, 떼면 다시 잠긴다. 4뷰가 같은 값을 쓴다.
 */
export const PASSAGE_ALPHA_IDLE = 0.09;
/** 마우스가 선 근처일 때. */
export const PASSAGE_ALPHA_HOVER = 0.75;
/** 커서에서 선까지 이 화면 거리(px) 안이면 드러난다. */
export const PASSAGE_HOVER_PX = 34;
/** 밝기 전환 시간(ms) — 툭 켜지면 그것대로 시선을 뺏는다. */
export const PASSAGE_FADE_MS = 160;

/**
 * 소환 앵커 표기(spec §5 행 18) — 제안이 성립하면 지목된 인물이 이 칸을 **기준으로**
 * 방 안에 자리를 잡는다. 지금까지 4뷰 어디에도 보드 표현이 없어, 소환된 토큰이
 * "왜 하필 저기 섰는가"가 화면만으로는 읽히지 않았다.
 *
 * ⚠ **좌표는 렌더러가 만들지 않는다.** 칸의 진실값은 `ROOM_REGIONS[].summon`이고,
 *    서버 `freeCellIn()`이 **바로 그 칸에서 가까운 순으로**(맨해튼 거리 + 명패행·외곽
 *    페널티, 문 칸 제외) 빈자리를 배정한다. 뷰가 하는 일은 그 칸을 **표시**하는 것뿐이다 —
 *    클라가 자리를 계산하면 진실값 경계를 넘는다(그리고 서버와 갈라진다).
 *
 * 밝기: 상시 표기라 비밀 통로(0.09)보다는 읽히고 문·명패(1.0)보다는 뒤에 있어야 한다.
 * 4뷰가 같은 값을 써야 "언제 눈에 들어오는가"가 갈리지 않는다(§1.5와 같은 이유).
 */
export const SUMMON_ANCHOR_ALPHA = 0.34;
/**
 * 소환 앵커 아이콘 — 서버 소환 로그(`🔔 소환 — …`)와 **같은 기호**다.
 * 로그와 보드가 다른 기호를 쓰면 같은 사건이 두 개로 읽힌다.
 * 뷰4는 이모지를 쓸 수 없어(도트 문법) `pixel-glyphs.SUMMON_MARK`로 옮겨 찍는다.
 */
export const SUMMON_ANCHOR_ICON = "🔔";

export const BOARD = {
  /** 복도 바닥 = 먹빛. 도트 뷰의 잉크(윤곽)와 같은 색이다. */
  corridor: 0x2a2118,
  grid: 0x5a4a34,
  gridMinor: 0x453a2a,
  room: 0xcbb489,
  roomEdge: 0x7c6238,
  /** 명패·라벨 바탕. */
  plaque: 0x2b2013,
  plaqueText: 0xf0d9a8,
  feast: 0x3a2b1a,
  feastEdge: 0xb8933f,
  feastText: 0xd8c188,
  gold: RING_CURRENT,
  doorTile: 0x6b4a1e,
  wood: 0x8a5a2a,
  /** 잔디(뷰4 바닥) — 도트 뷰에서만 노출되지만 색 정의는 여기 모은다. */
  grass: 0x5b8c4a,
  /** 장물 상자. */
  loot: 0xc98a3a,
  /** 계략 NPC 원판. */
  helperDisc: 0x2b2013,
  helperEdge: 0x8a6a3a,
  helperTag: 0xe0a35a,
  /** 말풍선 바탕/글자. */
  bubbleBg: 0xf0e0c0,
  bubbleText: 0x2a2118,
  /**
   * 말풍선 **테두리**. 바탕(`bubbleBg`)과 방바닥(`room`)의 대비는 1.55:1뿐이라
   * 말풍선이 밝은 방 위에 뜨면 경계가 녹아 "무엇이 말풍선인지"가 안 읽힌다.
   * 비텍스트 대비(WCAG 1.4.11 ≥ 3:1)를 이 선이 전담한다 —
   * 먹빛 대 방바닥 7.85:1, 먹빛 대 말풍선 바탕 12.1:1(§1.6).
   * 토큰 아웃라인(§4.1)과 같은 논리다: 색면은 스스로 배경과 분리되지 않는다.
   */
  bubbleEdge: 0x2a2118,
  nameText: 0xf0e9dc,
} as const;

// ── §1.7 첫 화면 조망 ───────────────────────────────────────
/**
 * 첫 화면에서 **짧은 변**에 최소한 들어와야 하는 칸 수.
 *
 * 근거는 보드 배치다 — 방 3열이 x 1‑5 · 9‑14 · 18‑22에 있고 명패는 각 방의
 * 좌상단(x칸+10 … +74 px)에 있다. 폰 세로(390)에서 **명패가 잘리지 않는 방**을
 * 세어 보면 16칸에서는 2개(가운데 열)뿐이고 **17칸에서 6개**가 된다 —
 * 640px 창은 오른쪽 열 명패(≤794px)를 14px 차이로 놓치기 때문이다.
 * 기존값(줌 1.0 = 9.75칸)에서는 방 2개였다.
 *
 * 더 넓히면(19칸) 9개 명패가 다 들어오지만 보드가 화면 높이의 58%로 줄어
 * 이번 과제 ②가 없애려는 «빈 여백»을 되살린다. 17칸이 두 요구의 교차점이다.
 *
 * 데스크톱은 이 값으로 계산한 줌이 기본 줌보다 커서 `fitZoom`이 기본값을 돌려준다 —
 * 즉 **데스크톱 줌은 이 상수의 영향을 받지 않는다**(1440×900 → 1.32 → clamp 1.0).
 */
export const INIT_MIN_CELLS = 17;

/**
 * 직교 뷰(뷰1·뷰4) 초기 줌. `short` = 뷰포트 짧은 변(px).
 * 결과는 `[minZoom, baseZoom]` 안이며, 넓은 화면에서는 정확히 `baseZoom`이다.
 */
export const fitZoom = (
  short: number,
  baseZoom: number,
  minZoom: number,
): number =>
  Math.min(
    baseZoom,
    Math.max(minZoom, short / (INIT_MIN_CELLS * CELL_PX)),
  );

/**
 * 원근 뷰(뷰2·3) 초기 카메라 거리에 쓰는 **가로 칸 수** 목표.
 * 원근+피치(42°)라 세로는 거리의 1.5배 이상이 들어온다 — 가로만 맞추면
 * 세로는 자동으로 보드 전체를 덮는다. 16칸을 그대로 쓰면 세로 여백이 화면의 40%가 되어
 * 이번 과제 ②가 고치려는 증상을 되살리므로, 가로 목표만 낮춰 잡는다.
 */
export const INIT_MIN_CELLS_PERSPECTIVE = 11;

/**
 * 뷰4(도트) 팔레트 — `BOARD`에서 **명도만** 파생한다.
 * 새 색을 만들지 않는 것이 계약(§1.4). 도트 문법상 필요한 하이라이트/그림자는
 * `shade()` 한 단계로만 만든다.
 */
export const PIXEL_PAL = {
  grass1: BOARD.grass,
  grass2: shade(BOARD.grass, -0.15),
  grass3: shade(BOARD.grass, 0.12),
  room: shade(BOARD.room, 0.06),
  roomHi: shade(BOARD.room, 0.25),
  roomEdge: shade(BOARD.roomEdge, -0.25),
  wood: BOARD.wood,
  woodDark: shade(BOARD.wood, -0.32),
  gold: shade(BOARD.gold, -0.06),
  ink: BOARD.corridor,
  cream: shade(BOARD.room, 0.6),
  loot: BOARD.loot,
} as const;
