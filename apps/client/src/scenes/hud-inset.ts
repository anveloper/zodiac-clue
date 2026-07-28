// HUD(우측 패널)가 화면을 가리는 양을 계산하는 뷰 공용 헬퍼.
// 뷰1(game-scene)·뷰2·3(iso-view)이 같은 계산을 각자 들고 있던 것을 하나로 합쳤다.
// 뷰4(pixel-scene)는 뷰1 카메라를 미러링하므로 여기 수정이 자동 전파된다.
//
// 근거: roadmap §7.8(인셋 가드) + §9.2(정정: null이 아니라 zero-rect가 원인 ·
// 프레임당 강제 리플로우 제거). view-contract-spec §3 "공용 hudInset(): {right,bottom}".
//
// ⚠️ §7.8이 제안한 `offsetParent === null` 가드는 이 DOM에 쓸 수 없다 —
// `.rp-col`이 `position: fixed`이고 fixed 요소의 offsetParent는 항상 null이라
// 인셋이 영구히 0이 된다. 실제 원인(§9.2)인 zero-rect / 화면 밖 / 비표시로 판정한다.

/** 관찰·측정 대상 패널. */
const PANEL_ID = "rightPanel";

/**
 * 인셋 상한(화면 대비). 화면 절반을 넘는 보정은 "패널이 화면을 가린다"가 아니라
 * 계산이 무너진 것이므로 카메라를 붕괴시키기 전에 잘라낸다.
 */
const MAX_INSET_FRAC = 0.5;

/**
 * 하단 시트 판정(§7.9의 `<900 또는 portrait는 하단 시트` 대비).
 * 가로를 거의 다 덮으면서 **세로로는 낮을 때**만 시트로 본다 —
 * 폭 조건만 보면 320px 폰에서 전체 높이 우측 컬럼이 시트로 오인돼 세로 보정이 걸린다.
 */
const SHEET_WIDTH_FRAC = 0.8;
const SHEET_HEIGHT_FRAC = 0.7;

export type HudInset = {
  /** 화면 오른쪽에서 패널이 덮는 폭(px). */
  right: number;
  /** 화면 아래쪽에서 패널이 덮는 높이(px). */
  bottom: number;
};

const ZERO: HudInset = { right: 0, bottom: 0 };

let cached: HudInset = ZERO;
let observer: ResizeObserver | null = null;
let observed: Element | null = null;
let onWindowResize: (() => void) | null = null;
/** 캐시를 쓰는 뷰 수. 0이 되면 관찰자를 disconnect 한다(누수 금지). */
let refs = 0;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * 실제 측정(강제 리플로우 발생). 프레임 루프에서 부르지 말 것 —
 * `ResizeObserver` / `resize` 이벤트에서만 호출된다.
 */
const measure = (): HudInset => {
  const el = document.getElementById(PANEL_ID);
  if (!el) return ZERO;

  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 0 || vh <= 0) return ZERO;

  // ① zero-rect — `display:none`이거나 아직 레이아웃 전이면 rect가 전부 0이다.
  //    그대로 두면 `vw - rect.left === vw`가 되어 인셋 = 화면 전체 폭 → 카메라 붕괴.
  if (r.width <= 0 || r.height <= 0) return ZERO;

  // ② 화면 밖(오프스크린 슬라이드 등) — 가리는 게 없으므로 0.
  if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return ZERO;

  // ③ 비표시(visibility/opacity로 숨긴 경우) — rect는 정상이지만 가리지 않는다.
  const cs = window.getComputedStyle(el);
  if (
    cs.display === "none" ||
    cs.visibility === "hidden" ||
    Number(cs.opacity) === 0
  ) {
    return ZERO;
  }

  // 하단 시트(가로를 거의 다 덮음) ↔ 우측 컬럼을 구분해 한 축에만 인셋을 준다.
  if (r.width >= vw * SHEET_WIDTH_FRAC && r.height <= vh * SHEET_HEIGHT_FRAC) {
    return { right: 0, bottom: clamp(vh - r.top, 0, vh * MAX_INSET_FRAC) };
  }
  return { right: clamp(vw - r.left, 0, vw * MAX_INSET_FRAC), bottom: 0 };
};

const attachObserver = (): void => {
  if (typeof ResizeObserver === "undefined") return;
  const el = document.getElementById(PANEL_ID);
  if (!el || observed === el) return;
  observer?.disconnect();
  observer =
    observer ??
    new ResizeObserver(() => {
      cached = measure();
    });
  observer.observe(el);
  observed = el;
};

/** 캐시 강제 갱신(측정 발생). 패널을 코드로 여닫은 직후 등에 호출. */
export const refreshHudInset = (): void => {
  if (refs > 0) attachObserver();
  cached = measure();
};

/** 캐시된 인셋. 프레임 루프는 이것만 읽는다(리플로우 0). */
export const hudInset = (): HudInset => cached;

/** 캐시된 우측 인셋(px) — 가장 흔한 사용처의 단축형. */
export const hudRightInset = (): number => cached.right;

/**
 * 인셋 캐시 사용 시작. 첫 사용자에서 `ResizeObserver` + `resize` 리스너를 붙인다.
 * 반드시 `releaseHudInset()`과 짝을 맞출 것.
 */
export const acquireHudInset = (): void => {
  refs += 1;
  if (refs === 1) {
    onWindowResize = () => {
      cached = measure();
    };
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("orientationchange", onWindowResize);
  }
  refreshHudInset();
};

/** 사용 종료. 마지막 사용자가 빠지면 `disconnect()` + 리스너 해제. */
export const releaseHudInset = (): void => {
  refs = Math.max(0, refs - 1);
  if (refs > 0) return;
  observer?.disconnect();
  observer = null;
  observed = null;
  if (onWindowResize) {
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("orientationchange", onWindowResize);
    onWindowResize = null;
  }
  cached = ZERO;
};
