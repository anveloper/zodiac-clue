// HUD(우측 패널)가 화면을 가리는 양을 계산하는 헬퍼.
// 렌더러가 여럿이던 시절 각 뷰가 같은 계산을 따로 들고 있던 것을 하나로 합친 파일이다
// (2026-08-25 이후 호출부는 `game-scene` 하나뿐이지만, 카메라 인셋 계산이
//  씬 코드와 섞이지 않는 편이 읽기 쉬워 파일은 그대로 둔다).
//
// 근거: archive/design/20260727-improvement-roadmap.md §7.8(인셋 가드) + §9.2
// (정정: null이 아니라 zero-rect가 원인 · 프레임당 강제 리플로우 제거).
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

/**
 * ── 말풍선 안전 영역 ────────────────────────────────────────
 * 카메라 인셋(`HudInset`)은 **우측 컬럼 하나**만 본다. 카메라를 옮기는 목적에는 그것으로
 * 충분하지만, 말풍선은 다르다 — 상단 중앙 턴 배너·좌상단 액션바·폰 하단 조작 데크는
 * 캔버스(z 0·2) 위에 z 5로 떠 있어서 **말풍선을 통째로 덮는다.** 캔버스에 그린 글자는
 * DOM 겹침 게이트(S6)가 재지 못하므로 이 계산이 그 자리를 대신한다.
 *
 * 측정 대상은 `.hud`(고정 배치 HUD 조각 전부) + `#rightPanel`.
 * 각 조각을 **화면 어느 변에 붙어 있는가**로 분류해 4방향 밴드로 합친다 —
 * 개별 사각형 회피는 프레임마다 해가 바뀌어 말풍선이 떨린다(밴드는 단조·결정론적).
 */
export type HudSafe = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const ZERO_SAFE: HudSafe = { top: 0, right: 0, bottom: 0, left: 0 };

/** HUD 조각 선택자. `.hud`는 index.html의 고정 HUD 공통 클래스. */
const OVERLAY_SELECTOR = ".hud, #rightPanel";

/** 한 변이 화면의 이 비율을 넘게 가린다고 판정되면 계산이 무너진 것으로 본다. */
const MAX_BAND_FRAC = 0.45;

let cachedSafe: HudSafe = ZERO_SAFE;
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

/** 화면을 실제로 가리고 있는 요소인지. `measure()`의 ①②③과 같은 판정을 공유한다. */
const covers = (r: DOMRect, el: Element, vw: number, vh: number): boolean => {
  if (r.width <= 0 || r.height <= 0) return false;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return false;
  const cs = window.getComputedStyle(el);
  return !(
    cs.display === "none" ||
    cs.visibility === "hidden" ||
    Number(cs.opacity) === 0
  );
};

/**
 * **상단에 붙은 HUD 조각 각각**의 가로 범위와 아래변. `HudSafe.top`은 이들의 최댓값인데,
 * 그것을 그대로 쓰면 **화면 왼쪽에만 있는 조각이 오른쪽까지 밀어낸다**(실측: 폰에서
 * 「지금 차례」 얼굴 카드 bottom 142가 전폭 턴 배너 74.4를 덮어써 밴드가 142가 된다).
 *
 * 말풍선이 밴드를 쓰는 사유는 「개별 사각형 회피는 프레임마다 해가 바뀌어 떨린다」인데,
 * **y만 아래로 미는 1차원 문제에는 그 사유가 성립하지 않는다** — 단조라 떨림이 없다.
 * 그래서 그런 용도에만 개별 조각을 준다.
 */
export type HudTopPiece = { left: number; right: number; bottom: number };

let cachedTopPieces: HudTopPiece[] = [];

/** `[x0, x1]`(화면 px)와 **가로로 겹치는** 상단 조각들의 아래변 최댓값. */
export const hudTopAt = (x0: number, x1: number): number => {
  let y = 0;
  for (const p of cachedTopPieces) {
    if (p.right <= x0 || p.left >= x1) continue;
    if (p.bottom > y) y = p.bottom;
  }
  return y;
};

const measureSafe = (): HudSafe => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 0 || vh <= 0) return ZERO_SAFE;
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  const pieces: HudTopPiece[] = [];
  for (const el of Array.from(document.querySelectorAll(OVERLAY_SELECTOR))) {
    const r = el.getBoundingClientRect();
    if (!covers(r, el, vw, vh)) continue;
    if (r.height >= vh * 0.5) {
      // 세로로 긴 조각 = 측면 컬럼. 어느 쪽에 붙었는지는 **중심**으로 가른다
      // (폰에서 우측 컬럼이 화면 폭의 2/3를 덮어도 좌측으로 오분류되지 않도록).
      if ((r.left + r.right) / 2 >= vw / 2) right = Math.max(right, vw - r.left);
      else left = Math.max(left, r.right);
    } else if (r.bottom <= vh * 0.5) {
      top = Math.max(top, r.bottom);
      pieces.push({ left: r.left, right: r.right, bottom: r.bottom });
    } else if (r.top >= vh * 0.5) {
      bottom = Math.max(bottom, vh - r.top);
    }
    // 화면 한가운데 떠 있는 짧은 조각(모달 등)은 밴드를 만들지 않는다 —
    // 전면을 막는 것들이라 그 순간에는 말풍선을 옮겨 봐야 의미가 없다.
  }
  cachedTopPieces = pieces;
  return {
    top: clamp(top, 0, vh * MAX_BAND_FRAC),
    right: clamp(right, 0, vw * MAX_BAND_FRAC),
    bottom: clamp(bottom, 0, vh * MAX_BAND_FRAC),
    left: clamp(left, 0, vw * MAX_BAND_FRAC),
  };
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
      cachedSafe = measureSafe();
    });
  observer.observe(el);
  // 말풍선 안전 영역은 우측 컬럼만으로 결정되지 않는다 — 턴 배너·조작 데크가
  // 접히거나 글자가 바뀌면 밴드가 달라지므로 HUD 조각 전부를 관찰한다.
  for (const o of Array.from(document.querySelectorAll(OVERLAY_SELECTOR))) {
    observer.observe(o);
  }
  observed = el;
};

/** 캐시 강제 갱신(측정 발생). 패널을 코드로 여닫은 직후 등에 호출. */
export const refreshHudInset = (): void => {
  if (refs > 0) attachObserver();
  cached = measure();
  cachedSafe = measureSafe();
};

/** 캐시된 인셋. 프레임 루프는 이것만 읽는다(리플로우 0). */
export const hudInset = (): HudInset => cached;

/** 캐시된 우측 인셋(px) — 가장 흔한 사용처의 단축형. */
export const hudRightInset = (): number => cached.right;

/** 캐시된 말풍선 안전 밴드(화면 px). 프레임 루프는 이것만 읽는다(리플로우 0). */
export const hudSafe = (): HudSafe => cachedSafe;

export type SafeBox = { x: number; y: number; w: number; h: number };

/**
 * `w×h` 상자를 **HUD가 가리지 않는 화면 영역** 안으로 민다(화면 px 좌표계).
 * 상자가 안전 영역보다 크면 좌상단에 맞춘다 — 잘리더라도 **첫 글자부터** 보이는 쪽이
 * 읽을 수 있는 쪽이다(가운데 정렬하면 양끝이 동시에 잘린다).
 *
 * 4뷰가 같은 함수를 쓴다. 뷰1·4는 캔버스 좌표를, 뷰2·3은 DOM 좌표를 넣는다 —
 * 좌표계가 같은 화면 px이라 결과가 갈리지 않는다.
 */
export const clampToSafe = (
  x: number,
  y: number,
  w: number,
  h: number,
  pad: number,
  vw: number,
  vh: number,
): { x: number; y: number } => {
  const s = cachedSafe;
  const lo = { x: s.left + pad, y: s.top + pad };
  const hi = { x: vw - s.right - pad - w, y: vh - s.bottom - pad - h };
  return {
    x: hi.x <= lo.x ? lo.x : clamp(x, lo.x, hi.x),
    y: hi.y <= lo.y ? lo.y : clamp(y, lo.y, hi.y),
  };
};

/** 안전 영역의 가로 폭(화면 px) — 말풍선 최대 폭 산정에 쓴다. */
export const safeWidth = (vw: number): number =>
  Math.max(1, vw - cachedSafe.left - cachedSafe.right);

/**
 * 인셋 캐시 사용 시작. 첫 사용자에서 `ResizeObserver` + `resize` 리스너를 붙인다.
 * 반드시 `releaseHudInset()`과 짝을 맞출 것.
 */
export const acquireHudInset = (): void => {
  refs += 1;
  if (refs === 1) {
    onWindowResize = () => {
      cached = measure();
      cachedSafe = measureSafe();
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
  cachedSafe = ZERO_SAFE;
  cachedTopPieces = [];
};
