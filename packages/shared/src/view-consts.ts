// 4뷰 공용 표기 상수 — 단일 소스 (docs/design/20260727-view-contract-spec.md §1).
//
// 렌더러(뷰1 2d-emoji · 뷰2 three-emoji · 뷰3 three-asset · 뷰4 pixel)는
// 표기에 관한 수치를 **이 파일에서만** 가져온다. 같은 상태가 뷰마다 다르게 보이면
// 그건 "표현의 자유"가 아니라 **정보가 갈라진 것**이고, 뷰를 전환해 보는 심사 동선에서
// 그대로 결함으로 읽힌다.
//
// ⚠ 이 파일은 DOM·Phaser·Three 타입을 하나도 참조하지 않는다.
//    (서버도 import 할 수 있어야 `bubbleLifeMs` ↔ `SPEAK_HOLD` 정합을 한 곳에서 잠근다.)

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

// ── §1.2 표기 강도 (모든 뷰 동일 · 모션 프로파일 무관) ────────
// "정보가 얼마나 죽어 보이는가"는 표현이 아니라 정보다.

/** 탈락(고발 실패) 토큰의 불투명도. 토큰 **전체**(링·원·얼굴·이름표)에 적용한다. */
export const ELIM_ALPHA = 0.35;
/** 이미 사용된 계략 NPC의 불투명도. */
export const SPENT_ALPHA = 0.3;
/** 현재 턴 링 색(금색). */
export const RING_CURRENT = 0xffd479;
/**
 * 탈락 표기는 알파 단독 금지 — 회색조·저대비에서 사라진다.
 * 알파 + (파선 테두리 또는 ✕ 오버레이) 2중 표기가 계약이다.
 */
export const ELIM_NEEDS_SECOND_CUE = true;
/**
 * §4.1 — 모든 토큰 색면은 최소 2px 아웃라인.
 * 팔레트가 밝은 방바닥과 대비 1.0~1.3까지 떨어지는 것을 **설계상 허용**하는 대신,
 * 배경 분리를 아웃라인이 전담한다.
 */
export const TOKEN_OUTLINE_PX = 2;
export const TOKEN_OUTLINE_COLOR = 0xffffff;

// ── §1.3 타이밍 ─────────────────────────────────────────────

/** 감속 프로파일. `?motion=` > `prefers-reduced-motion` > full 로 결정한다. */
export type MotionProfile = "full" | "reduced";

export type ViewTiming = {
  /** 이동 입력 쿨다운 — **규칙**이라 프로파일 불변. */
  MOVE_COOLDOWN_MS: number;
  /** 토큰 1칸 이동 보간 길이. */
  MOVE_TWEEN_MS: number;
  /** 장물 이동 보간 길이. */
  LOOT_TWEEN_MS: number;
  /** 순간이동(소환·비밀통로) 연출 길이. */
  WARP_MS: number;
  /** 순간이동 배너 노출 길이(연출이 없어진 만큼 reduced에서 길게). */
  WARP_BANNER_MS: number;
  /** 말풍선 타자기 속도(글자당). */
  TYPE_MS: number;
  /**
   * 타자기 완료 후 유지 시간.
   *
   * **읽기 속도에서 유도한 값이다**(예전 2600은 뷰별 인라인 리터럴 2600/3200을 옮겨 적은
   * 것이라 근거가 없었다). 한국어 자막 권장 읽기 속도 12자/초 = `READ_MS 83ms/자`를
   * 기준으로, 말풍선이 살아 있어야 하는 최소 시간은 `len × READ_MS`다.
   * full 프로파일은 그중 `len × TYPE_MS(55)`를 타자기가 이미 소비하므로 남는 몫만 붙들면 된다:
   *   `HOLD ≥ (READ_MS − TYPE_MS) × len_max = (83 − 55) × 40 = 1120` → **1200**
   * (`len_max 40` = 디렉팅 명세 ④ §2.3의 대사 길이 상한).
   * reduced는 타자기가 없어(`TYPE_MS 0`) 전량을 홀드가 부담한다: `83 × 40 = 3320` → **3400**.
   * 두 프로파일은 규약 상한 40자에서 총 수명 3400ms로 **정확히 수렴한다**.
   */
  BUBBLE_HOLD_MS: number;
  /** 짧은 대사가 깜빡이는 것을 막는 말풍선 최소 총 수명. */
  BUBBLE_MIN_TOTAL_MS: number;
  /** 내 턴으로 전환될 때 카메라 전환 지연. */
  CAM_SWITCH_SELF_MS: number;
  /** 남의 턴으로 전환될 때 지연(반증을 먼저 인지하게 → 덜 어지럽다). */
  CAM_SWITCH_OTHER_MS: number;
  /** 내 토큰으로 팬하는 시간(0이면 팬 대신 컷). */
  CAM_PAN_SELF_MS: number;
  /** 남의 토큰으로 팬하는 시간(0이면 컷). */
  CAM_PAN_OTHER_MS: number;
  /** 주사위 눈이 바뀌는 간격. */
  DICE_TICK_MS: number;
  /** 주사위 깜빡임 횟수(reduced는 0 = 결과 눈만). */
  DICE_TICKS: number;
  /** 주사위 결과 유지 시간. */
  DICE_HOLD_MS: number;
  /** 뷰 전환 인터스티셜 노출 시간. */
  INTERSTITIAL_MS: number;
};

export const TIMING_FULL: ViewTiming = {
  MOVE_COOLDOWN_MS: 110,
  MOVE_TWEEN_MS: 110,
  LOOT_TWEEN_MS: 260,
  WARP_MS: 420,
  WARP_BANNER_MS: 1200,
  TYPE_MS: 55, // 로드맵 §1.4 — AI 활용의 유일한 가시적 증거라 **불변**.
  BUBBLE_HOLD_MS: 1200, // 2600 → 1200 (읽기 속도 유도치, 위 주석). 봇 1턴 −1400ms.
  BUBBLE_MIN_TOTAL_MS: 1800,
  CAM_SWITCH_SELF_MS: 150,
  CAM_SWITCH_OTHER_MS: 900,
  CAM_PAN_SELF_MS: 350,
  CAM_PAN_OTHER_MS: 1000,
  DICE_TICK_MS: 150,
  DICE_TICKS: 6,
  DICE_HOLD_MS: 1900,
  INTERSTITIAL_MS: 1100,
};

export const TIMING_REDUCED: ViewTiming = {
  MOVE_COOLDOWN_MS: 110, // 규칙 — 불변
  MOVE_TWEEN_MS: 0,
  LOOT_TWEEN_MS: 0,
  WARP_MS: 0,
  WARP_BANNER_MS: 1800,
  TYPE_MS: 0,
  BUBBLE_HOLD_MS: 3400,
  BUBBLE_MIN_TOTAL_MS: 1800,
  CAM_SWITCH_SELF_MS: 0,
  CAM_SWITCH_OTHER_MS: 600,
  CAM_PAN_SELF_MS: 0,
  CAM_PAN_OTHER_MS: 0,
  DICE_TICK_MS: 150,
  DICE_TICKS: 0,
  DICE_HOLD_MS: 2400,
  INTERSTITIAL_MS: 1600,
};

export const timingOf = (p: MotionProfile): ViewTiming =>
  p === "reduced" ? TIMING_REDUCED : TIMING_FULL;

/**
 * 말풍선 총 수명(ms) = max(최소치, 타자기 시간 + 유지 시간).
 * 서버 `SPEAK_HOLD`가 이 값보다 짧으면 봇이 말하는 도중 턴이 넘어가 카메라가 튄다.
 * **두 값의 정합은 여기서 계산한다** — 서버도 이 함수를 import 할 수 있다.
 */
export const bubbleLifeMs = (
  text: string,
  t: ViewTiming = TIMING_FULL,
): number =>
  Math.max(t.BUBBLE_MIN_TOTAL_MS, text.length * t.TYPE_MS + t.BUBBLE_HOLD_MS);

/** 탭 복귀·긴 스톨 후 한 프레임에 순간이동하지 않도록 하는 dt 상한(ms). */
export const DT_MAX_MS = 100;

/**
 * 프레임 시간 기반 지수 보간 계수 `k = 1 - exp(-dt/τ)`, `τ = durationMs/3`.
 * τ를 1/3로 잡으면 durationMs 경과 시 잔차가 e⁻³ ≈ 5%가 되어
 * 같은 durationMs를 쓰는 tween(뷰1·뷰4)과 "같은 시간에 도착한 것처럼" 보인다.
 * 계수가 아니라 **시간**을 상수로 두는 것이 목적(프레임레이트 종속 제거).
 */
export const expK = (dtMs: number, durationMs: number): number =>
  durationMs <= 0 ? 1 : 1 - Math.exp(-dtMs / (durationMs / 3));

// ── §1.4 팔레트 ─────────────────────────────────────────────
// 보드 색은 여기 한 번만 정의한다. 뷰4(`PIXEL_PAL`)는 **명도만 파생**하고
// 새 색을 만들지 않는다.

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

export const rgbOf = (hex: number): { r: number; g: number; b: number } => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
});

export const packRgb = (r: number, g: number, b: number): number =>
  (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);

/** `#rrggbb` 문자열(CSS·Phaser 텍스트 스타일용). */
export const hexString = (hex: number): string =>
  `#${(hex >>> 0).toString(16).padStart(6, "0")}`;

/** 명도만 조절: amt>0이면 흰쪽, amt<0이면 검은쪽. 색상·채도 관계는 보존한다. */
export const shade = (hex: number, amt: number): number => {
  const { r, g, b } = rgbOf(hex);
  if (amt >= 0) {
    return packRgb(
      r + (255 - r) * amt,
      g + (255 - g) * amt,
      b + (255 - b) * amt,
    );
  }
  const k = 1 + amt;
  return packRgb(r * k, g * k, b * k);
};

/** 채도만 낮춘다. `keep`=1 원색, 0 완전 회색. 명도(상대휘도)는 유지. */
export const desaturate = (hex: number, keep: number): number => {
  const { r, g, b } = rgbOf(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return packRgb(
    y + (r - y) * keep,
    y + (g - y) * keep,
    y + (b - y) * keep,
  );
};

/** 계략(미사용 NPC)에 쓰는 채도 유지율 — §4.2 "채도 20%". */
export const SCHEME_DESAT_KEEP = 0.2;

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
  nameText: 0xf0e9dc,
} as const;

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
