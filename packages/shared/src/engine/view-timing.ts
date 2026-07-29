// 뷰 타이밍 — **엔진 층.** 주제를 하나도 모른다(보드도, 카드도, 좌표도 참조하지 않는다).
//
// 원래 `packages/shared/src/view-consts.ts`에 클루 좌표계·보드 팔레트와 같은 파일에 있었다.
// 그 파일이 선언한 중립성의 축은 «렌더러 독립»일 뿐 «주제 독립»이 아니었다
// (docs/design/20260729-mafia-content-design.md §1.2-⑤ — `ViewTiming`·`bubbleLifeMs`·`expK`를
//  «순수 엔진»으로 판정). 값·주석은 그대로 옮기기만 했다.
//
// ⚠ 이 파일은 DOM·Phaser·Three 타입을 하나도 참조하지 않는다.
//    (서버도 import 할 수 있어야 `bubbleLifeMs` ↔ `SPEAK_HOLD` 정합을 한 곳에서 잠근다.)

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
