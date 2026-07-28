import * as THREE from "three";

/**
 * three GPU 자원(지오메트리·머티리얼·텍스처)의 수명 관리 — roadmap §9.3.
 *
 * 배경: `grep dispose apps/client/src` → **0건**이었다. Three는 geometry/material/
 * texture를 GC하지 않는다. 뷰1→2→3→4→1 왕복마다 GPU에 자원이 쌓이고, 로드맵의 간판
 * 기능(뷰 전환 연표)이 정확히 그 동선을 유도한다.
 *
 * 세 가지를 여기서 해결한다.
 *  1. **공유 지오메트리 상수화** — 단위 프리미티브 1개를 만들고 치수는 `scale`로 준다.
 *     (보드 초기 geometry 49 → 24, 토큰/NPC는 0 신규)
 *  2. **`THREE.Cache`** — 뷰3 재진입마다 같은 SVG를 재디코드·재업로드하지 않는다.
 *  3. **`disposeObject()`** — 재귀 해제. ⚠ `THREE.Sprite`는 **모듈 전역 공유
 *     지오메트리**를 쓰므로 geometry를 dispose하면 화면의 모든 스프라이트가 함께
 *     죽는다. 순진한 구현이 정확히 여기서 깨진다 → 아래 `isSprite` 가드.
 */

// ── §9.3 ② THREE.Cache ─────────────────────────────────────
// ImageLoader가 URL 단위로 디코드 결과를 캐시한다. 기본값이 false라 켜야 한다.
THREE.Cache.enabled = true;

// ── §9.3 ① 공유 지오메트리 ─────────────────────────────────
// 치수가 다른 오브젝트(방 9개·잔치상)도 **단위 프리미티브 + scale**로 처리해
// 런타임 geometry 신규 생성을 0으로 만든다.
/** 단위 평면(1×1, XY). 바닥·문 타일·데칼에 scale로 치수를 준다. */
export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
/** 단위 박스(1×1×1). 방·기둥·잔치상. */
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
/** 단위 박스의 모서리선. 박스와 같은 scale을 주면 그대로 맞는다. */
export const UNIT_BOX_EDGES = new THREE.EdgesGeometry(UNIT_BOX);
/** 단위 원판(r=1). 토큰 disc·접지 데칼. */
export const UNIT_CIRCLE = new THREE.CircleGeometry(1, 32);
/** 토큰 색면 아웃라인 링(§4.1) — 내외경 비율이 고정이라 별도 상수. */
export const OUTLINE_RING = new THREE.RingGeometry(0.42, 0.46, 32);
/** 현재 턴 링. */
export const TURN_RING = new THREE.RingGeometry(0.5, 0.6, 32);
/** 순간이동 잔상 링(계약 `warp`). */
export const WARP_RING = new THREE.RingGeometry(0.56, 0.68, 32);

const SHARED_GEOMETRIES: ReadonlySet<THREE.BufferGeometry> =
  new Set<THREE.BufferGeometry>([
    UNIT_PLANE,
    UNIT_BOX,
    UNIT_BOX_EDGES,
    UNIT_CIRCLE,
    OUTLINE_RING,
    TURN_RING,
    WARP_RING,
  ]);

/** 공유 지오메트리인가 — dispose 대상에서 제외된다. */
export const isSharedGeometry = (g: THREE.BufferGeometry): boolean =>
  SHARED_GEOMETRIES.has(g);

// ── URL 텍스처 캐시 ────────────────────────────────────────
// `THREE.Cache`는 **디코드된 이미지**를 캐시할 뿐 `Texture` 객체는 매번 새로 만들어져
// GPU 업로드가 반복된다. 그래서 URL → Texture 매핑을 여기서 한 겹 더 둔다.
// 이 텍스처들은 여러 머티리얼이 공유하므로 `disposeObject`가 건드리지 않는다.
const textureCache = new Map<string, THREE.Texture>();
const sharedTextures = new Set<THREE.Texture>();

/** 공유(캐시) 텍스처인가 — dispose 대상에서 제외된다. */
export const isSharedTexture = (t: THREE.Texture): boolean =>
  sharedTextures.has(t);

/**
 * URL 텍스처 로드(캐시 경유). 이미 받은 URL이면 **동기적으로** 같은 Texture를 준다.
 * 실패하면 `onError` — 호출부가 이모지 폴백으로 되돌린다.
 */
export const loadTextureCached = (
  loader: THREE.TextureLoader,
  url: string,
  onLoad: (tex: THREE.Texture) => void,
  onError: () => void,
): void => {
  const hit = textureCache.get(url);
  if (hit) {
    onLoad(hit);
    return;
  }
  loader.load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      textureCache.set(url, tex);
      sharedTextures.add(tex);
      onLoad(tex);
    },
    undefined,
    () => onError(),
  );
};

/** 머티리얼이 들고 있을 수 있는 텍스처 슬롯. 있는 것만 해제한다. */
const TEXTURE_SLOTS = [
  "map",
  "alphaMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "lightMap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "specularMap",
] as const;

/** 머티리얼 + 그가 소유한(공유가 아닌) 텍스처를 해제한다. */
export const disposeMaterial = (mat: THREE.Material): void => {
  const holder = mat as unknown as Record<string, unknown>;
  for (const slot of TEXTURE_SLOTS) {
    const tex = holder[slot];
    if (tex instanceof THREE.Texture && !isSharedTexture(tex)) tex.dispose();
  }
  mat.dispose();
};

const materialsOf = (
  m: THREE.Material | THREE.Material[] | undefined,
): THREE.Material[] => (m ? (Array.isArray(m) ? m : [m]) : []);

/**
 * 오브젝트 트리를 재귀 해제하고 부모에서 떼어낸다.
 *
 * ⚠ **Sprite 예외**: `THREE.Sprite`는 three 모듈 내부의 전역 `_geometry` 하나를
 *    모든 인스턴스가 공유한다. 이걸 dispose하면 아직 살아 있는 다른 스프라이트가
 *    전부 깨진다(WebGL 버퍼가 삭제된다). 그래서 Sprite는 **머티리얼·텍스처만**
 *    해제하고 geometry는 절대 건드리지 않는다.
 * ⚠ 공유 지오메트리(`SHARED_GEOMETRIES`)·공유 텍스처도 같은 이유로 제외한다.
 */
export const disposeObject = (root: THREE.Object3D): void => {
  root.traverse((obj) => {
    const holder = obj as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    const isSprite = (obj as THREE.Sprite).isSprite === true;
    if (holder.geometry && !isSprite && !isSharedGeometry(holder.geometry)) {
      holder.geometry.dispose();
    }
    for (const mat of materialsOf(holder.material)) disposeMaterial(mat);
  });
  root.removeFromParent();
};

/** 씬 전체 해제 — 자식을 역순으로 떼어내며 `disposeObject`. */
export const disposeScene = (scene: THREE.Scene): void => {
  for (const child of [...scene.children]) disposeObject(child);
  if (scene.background instanceof THREE.Texture) scene.background.dispose();
};

/**
 * 프로세스 종료(페이지 이탈) 시점에만 부르는 최종 해제.
 * 공유 지오메트리·캐시 텍스처까지 비운다 — 뷰 전환에서는 **절대 부르지 않는다**.
 */
export const releaseSharedResources = (): void => {
  for (const tex of sharedTextures) tex.dispose();
  sharedTextures.clear();
  textureCache.clear();
  for (const geo of SHARED_GEOMETRIES) geo.dispose();
  THREE.Cache.clear();
};
