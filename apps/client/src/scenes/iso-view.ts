import * as THREE from "three";
import type { Room } from "colyseus.js";
import {
  BOARD,
  DT_MAX_MS,
  ELIM_ALPHA,
  FEAST,
  GRID_HEIGHT,
  GRID_WIDTH,
  RING_CURRENT,
  ROOM_REGIONS,
  SPENT_ALPHA,
  TOKEN_OUTLINE_COLOR,
  bubbleLifeMs,
  emoji,
  expK,
  hexString,
  inFeast,
  label,
  roomAt,
  timingOf,
  zodiacColor,
  type MotionProfile,
  type ViewTiming,
} from "@zodiac-clue/shared";
import { acquireHudInset, hudRightInset, releaseHudInset } from "./hud-inset";
import { currentTiming } from "./view-motion";

// 2.5D 뷰: 평면 보드를 카메라로 살짝 내려다보는(피치) 원근 뷰.
// 서버 상태(그리드 x,y)를 그대로 읽어 3D 월드로 매핑한다. 룰/입력은 2D와 동일.
//
// ⚠ 표기 수치(알파·보간 길이·타자기 속도·팔레트)는 전부 shared의 view-consts에서 온다.
//   여기서 리터럴로 다시 쓰면 뷰1·뷰4와 갈라진다.

const CAM_PITCH = (42 * Math.PI) / 180; // 내려다보는 각(수평 기준)
const MIN_DIST = 9; // 근접
const MAX_DIST = 34; // 전체 조망
const INIT_DIST = 17;
const LERP_ME = 0.14; // 내 턴 추적(빠름)
const LERP_OTHER = 0.06; // 남 턴 추적(천천히)
const PAN_STEP = 0.6; // 자유시점 방향키 팬

// 그리드(gx,gy) → 월드(x,0,z). 보드 중심을 원점에.
const worldX = (gx: number): number => gx - GRID_WIDTH / 2 + 0.5;
const worldZ = (gy: number): number => gy - GRID_HEIGHT / 2 + 0.5;

type PlayerView = {
  name: string;
  suspect: string;
  isBot: boolean;
  x: number;
  y: number;
  eliminated: boolean;
};

type Token = {
  group: THREE.Group;
  ring: THREE.Mesh;
  face: THREE.Sprite;
  elimMark: THREE.Sprite; // 탈락 2차 표기(알파 단독 금지 — §1.2 ELIM_NEEDS_SECOND_CUE)
  cur: THREE.Vector2; // 현재 보간 위치(그리드 단위)
  target: THREE.Vector2; // 목표 위치
  placed: boolean;
};

/** 장물 토큰 — 위치를 dt 기반 지수 보간으로 따라간다(스냅 금지). */
type LootToken = {
  sprite: THREE.Sprite;
  cur: THREE.Vector2; // 현재 보간 위치(그리드 단위)
  target: THREE.Vector2;
  placed: boolean;
};

type Bubble = {
  el: HTMLDivElement;
  id: string;
  full: string;
  shown: number;
  typeTimer: number;
  holdTimer: number;
};

/** 이모지/텍스트를 캔버스 텍스처로 만들어 빌보드 스프라이트로 반환. */
const makeSprite = (
  text: string,
  opts: {
    fontPx: number;
    color?: string;
    bg?: string;
    padX?: number;
    padY?: number;
    worldH: number;
    /** 좌측 색 스트라이프(§4.2) — 색과 이름을 같은 픽셀에 둔다. */
    stripe?: string;
  },
): THREE.Sprite => {
  const {
    fontPx,
    color = "#ffffff",
    bg,
    padX = 0,
    padY = 0,
    worldH,
    stripe,
  } = opts;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Sprite();
  const font = `${fontPx}px system-ui, "Apple SD Gothic Neo", sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  // 스트라이프 폭은 폰트에 비례(3px @ 13px 기준) — 어느 줌에서도 같은 굵기로 읽힌다.
  const stripeW = stripe ? Math.max(4, Math.round(fontPx * 0.22)) : 0;
  const tw = Math.ceil(metrics.width) + padX * 2 + stripeW;
  const th = Math.ceil(fontPx * 1.3) + padY * 2;
  canvas.width = tw;
  canvas.height = th;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (bg) {
    ctx.fillStyle = bg;
    const r = 8;
    ctx.beginPath();
    ctx.roundRect(0, 0, tw, th, r);
    ctx.fill();
  }
  if (stripe) {
    ctx.fillStyle = stripe;
    ctx.fillRect(0, 0, stripeW, th);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, stripeW + (tw - stripeW) / 2, th / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((worldH * tw) / th, worldH, 1);
  sprite.renderOrder = 10;
  return sprite;
};

/**
 * 그룹(토큰/NPC) **전체 구성 요소**에 같은 불투명도를 적용한다.
 * 탈락·계략사용 표기가 `Sprite`(얼굴)에만 걸려 disc·ring·이름표가 불투명하게
 * 남던 결함(view-contract-spec §5 행 3·12, §6 P0)의 수정 지점.
 * `Mesh`의 머티리얼은 `transparent`가 꺼져 있으면 opacity가 무시되므로 함께 켠다.
 */
const setGroupOpacity = (root: THREE.Object3D, opacity: number): void => {
  root.traverse((obj) => {
    const holder = obj as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
    };
    if (!holder.material) return;
    const mats = Array.isArray(holder.material)
      ? holder.material
      : [holder.material];
    for (const m of mats) {
      if (!m.transparent) {
        m.transparent = true;
        m.needsUpdate = true;
      }
      m.opacity = opacity;
    }
  });
};

export class IsoView {
  private room: Room;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private bubbleLayer: HTMLDivElement;

  private myId: string;
  private tokens = new Map<string, Token>();
  private weapons = new Map<string, LootToken>();
  private helpers = new Map<string, THREE.Group>();
  private bubbles = new Map<string, Bubble>();

  private look = new THREE.Vector3(0, 0, 0); // 현재 카메라가 보는 지점(보간)
  private panOffset = new THREE.Vector3(0, 0, 0); // 자유시점 이동
  private camDist = INIT_DIST;
  private freeLook = false;
  private dragging = false;
  private lastPointer = new THREE.Vector2();

  private followId = "";
  private switchTimer = 0;
  private lastMove = 0;
  private active = false;
  private raf = 0;
  /** 감속 프로파일 타이밍(§1.3). 보간 길이는 매 프레임 여기서 재조회한다. */
  private timing: ViewTiming = currentTiming();
  /** 직전 프레임의 rAF 타임스탬프(ms). 0이면 "첫 프레임"(dt 기본값 사용). */
  private lastFrameMs = 0;

  // 뷰3(에셋 모드): 이모지 대신 /assets/의 정면 아트를 로드. 실패 시 이모지 폴백.
  private useAssets = false;
  private loader = new THREE.TextureLoader();
  private roomMats = new Map<string, THREE.MeshStandardMaterial>();
  private feastMat?: THREE.MeshStandardMaterial;

  constructor(room: Room, host: HTMLElement) {
    this.room = room;
    this.myId = room.sessionId;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    // z-index 확정: Phaser(#game, 0) < three 캔버스(2) < 버블(3) < HUD(5).
    // three는 Phaser '위에 얹어 가리기만' 한다 — #game은 절대 숨기지 않는다
    // (RESIZE로 0크기가 되면 되돌아왔을 때 빈 화면이 되던 버그 방지).
    this.canvas.style.cssText =
      "position:fixed; inset:0; width:100%; height:100%; z-index:2; display:none;";
    this.bubbleLayer = document.createElement("div");
    this.bubbleLayer.style.cssText =
      "position:fixed; inset:0; pointer-events:none; z-index:3; display:none;";

    // #game(2D 캔버스) 바로 뒤·HUD 앞에 삽입 → HUD가 항상 위에 쌓이도록.
    const gameDiv = document.getElementById("game");
    if (gameDiv?.parentElement) {
      gameDiv.parentElement.insertBefore(this.canvas, gameDiv.nextSibling);
      gameDiv.parentElement.insertBefore(
        this.bubbleLayer,
        this.canvas.nextSibling,
      );
    } else {
      host.appendChild(this.canvas);
      host.appendChild(this.bubbleLayer);
    }

    this.scene.background = new THREE.Color(0x1c1712);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    this.buildLights();
    this.buildBoard();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.onResize = this.onResize.bind(this);
    this.loop = this.loop.bind(this);
  }

  // ── 활성/비활성(토글) ──
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.canvas.style.display = on ? "block" : "none";
    this.bubbleLayer.style.display = on ? "block" : "none";
    if (on) {
      this.resize();
      // 인셋 캐시 구독(뷰1과 공유·refcount). 비활성화 때 반드시 해제한다.
      acquireHudInset();
      this.lastFrameMs = 0; // 숨어 있던 시간이 dt로 새지 않도록 리셋
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
      this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("contextmenu", this.onContextMenu);
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("resize", this.onResize);
      this.raf = requestAnimationFrame(this.loop);
    } else {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      this.canvas.removeEventListener("wheel", this.onWheel);
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("contextmenu", this.onContextMenu);
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerup", this.onPointerUp);
      window.removeEventListener("resize", this.onResize);
      cancelAnimationFrame(this.raf);
      this.lastFrameMs = 0;
      // 숨은 뷰에서 말풍선 타자기/유지 타이머가 계속 도는 것을 막는다.
      // (rAF는 멈췄으므로 위치 갱신도 없다 — 남겨두면 보이지 않는 DOM만 갱신된다.)
      this.clearBubbles();
      // 마지막 사용자면 hud-inset이 ResizeObserver를 disconnect 한다.
      releaseHudInset();
    }
  }

  /** 감속 프로파일 전환(§1.3). */
  setMotion(p: MotionProfile): void {
    this.timing = timingOf(p);
  }

  /** 말풍선 DOM·타이머 전량 정리. 비활성화·퇴장 시 반드시 호출된다. */
  private clearBubbles(): void {
    this.bubbles.forEach((b) => {
      window.clearInterval(b.typeTimer);
      window.clearTimeout(b.holdTimer);
      b.el.remove();
    });
    this.bubbles.clear();
  }

  // ── 뷰3(에셋 모드) 토글 ──
  // 이모지 스프라이트/색 슬랩 ↔ /assets/ 정면 아트/룸 텍스처. 로더는 정적 파일만
  // 부르므로 스토리지·CORS·요금 없음(같은 오리진). 실패 시 이모지로 폴백.
  setAssets(on: boolean): void {
    if (this.useAssets === on) return;
    this.useAssets = on;

    // 방 바닥 텍스처(룸 종횡비=박스 UV). 없으면 원래 단색으로 복귀.
    this.roomMats.forEach((mat, name) => {
      if (on) this.applyTexture(mat, `/assets/room/${name}-floor.svg`, BOARD.room);
      else this.clearTexture(mat, BOARD.room);
    });
    if (this.feastMat) {
      if (on) this.applyTexture(this.feastMat, "/assets/room/feast.svg", BOARD.feast);
      else this.clearTexture(this.feastMat, BOARD.feast);
    }

    // 토큰·장물·NPC 스프라이트는 지워두면 다음 syncState에서 새 플래그로 재생성.
    this.tokens.forEach((t) => this.scene.remove(t.group));
    this.tokens.clear();
    this.weapons.forEach((lt) => this.scene.remove(lt.sprite));
    this.weapons.clear();
    this.helpers.forEach((g) => this.scene.remove(g));
    this.helpers.clear();
  }

  private applyTexture(
    mat: THREE.MeshStandardMaterial,
    url: string,
    fallbackColor: number,
  ): void {
    this.loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set(0xffffff); // 텍스처 원색 보존
        mat.needsUpdate = true;
      },
      undefined,
      () => this.clearTexture(mat, fallbackColor),
    );
  }

  private clearTexture(mat: THREE.MeshStandardMaterial, color: number): void {
    mat.map = null;
    mat.color.set(color);
    mat.needsUpdate = true;
  }

  /** 캐릭터 정면 얼굴 스프라이트(에셋 모드면 /assets, 아니면 이모지). */
  private charFace(id: string, worldH: number, fontPx: number): THREE.Sprite {
    const fallback = (): THREE.Sprite => makeSprite(emoji(id), { fontPx, worldH });
    if (!this.useAssets) return fallback();
    return this.assetSprite(`/assets/char/${id}-face.svg`, worldH, fallback);
  }

  /** 장물 정면 아이콘 스프라이트. */
  private lootSprite(id: string, worldH: number): THREE.Sprite {
    const fallback = (): THREE.Sprite =>
      makeSprite(emoji(id), { fontPx: 96, worldH });
    if (!this.useAssets) return fallback();
    return this.assetSprite(`/assets/loot/${id}-icon.svg`, worldH, fallback);
  }

  /** 정사각 이미지 스프라이트(비동기 로드). 실패하면 폴백 스프라이트 텍스처로 교체. */
  private assetSprite(
    url: string,
    worldH: number,
    fallback: () => THREE.Sprite,
  ): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(worldH, worldH, 1); // 아이콘은 정사각
    sprite.renderOrder = 10;
    this.loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        mat.map = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {
        const fb = fallback();
        const fbMat = fb.material as THREE.SpriteMaterial;
        mat.map = fbMat.map;
        mat.needsUpdate = true;
        sprite.scale.copy(fb.scale);
      },
    );
    return sprite;
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xfff2d8, 0.6);
    dir.position.set(-8, 16, 6);
    this.scene.add(dir);
  }

  // ── 보드(복도 바닥 + 그리드 + 방 + 잔치상 + 문) ──
  private buildBoard(): void {
    const W = GRID_WIDTH;
    const H = GRID_HEIGHT;
    // 복도 바닥
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ color: BOARD.corridor }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // 그리드 선
    const grid = new THREE.GridHelper(W, W, BOARD.grid, BOARD.gridMinor);
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.01;
    this.scene.add(grid);

    // 방(살짝 높은 박스 → 2.5D 깊이감) + 명패 + 문
    for (const r of ROOM_REGIONS) {
      const roomMat = new THREE.MeshStandardMaterial({ color: BOARD.room });
      this.roomMats.set(r.name, roomMat);
      const box = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.2, r.h), roomMat);
      box.position.set(
        worldX(r.x) + (r.w - 1) / 2,
        0.1,
        worldZ(r.y) + (r.h - 1) / 2,
      );
      this.scene.add(box);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(box.geometry),
        new THREE.LineBasicMaterial({ color: BOARD.roomEdge }),
      );
      edge.position.copy(box.position);
      this.scene.add(edge);

      // 명패(방 이름) — 방 위쪽에 빌보드
      const plaque = makeSprite(label(r.name), {
        fontPx: 44,
        color: hexString(BOARD.plaqueText),
        bg: `${hexString(BOARD.plaque)}e8`,
        padX: 18,
        padY: 10,
        worldH: 0.7,
      });
      plaque.position.set(box.position.x, 0.9, worldZ(r.y) - 0.1);
      this.scene.add(plaque);

      // 문(입구) — 이 칸으로만 출입. 밝은 바닥 타일 + 문기둥 + "입구" 라벨로 명확히.
      const dx = worldX(r.door.x);
      const dz = worldZ(r.door.y);
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(0.94, 0.94),
        new THREE.MeshBasicMaterial({
          color: BOARD.gold,
          transparent: true,
          opacity: 0.85,
        }),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(dx, 0.24, dz);
      this.scene.add(mark);
      const post = new THREE.MeshStandardMaterial({ color: BOARD.wood });
      for (const sx of [-0.42, 0.42]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), post);
        pillar.position.set(dx + sx, 0.35, dz);
        this.scene.add(pillar);
      }
      const door = makeSprite("🚪", { fontPx: 90, worldH: 0.8 });
      door.position.set(dx, 0.66, dz);
      this.scene.add(door);
      const doorLabel = makeSprite("입구", {
        fontPx: 30,
        color: hexString(BOARD.corridor),
        bg: hexString(BOARD.gold),
        padX: 8,
        padY: 4,
        worldH: 0.3,
      });
      doorLabel.position.set(dx, 1.15, dz);
      this.scene.add(doorLabel);
    }

    // 중앙 잔치상
    const feastMat = new THREE.MeshStandardMaterial({ color: BOARD.feast });
    this.feastMat = feastMat;
    const feast = new THREE.Mesh(
      new THREE.BoxGeometry(FEAST.w, 0.34, FEAST.h),
      feastMat,
    );
    feast.position.set(
      worldX(FEAST.x) + (FEAST.w - 1) / 2,
      0.17,
      worldZ(FEAST.y) + (FEAST.h - 1) / 2,
    );
    this.scene.add(feast);
    const feastEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(feast.geometry),
      new THREE.LineBasicMaterial({ color: BOARD.feastEdge }),
    );
    feastEdge.position.copy(feast.position);
    this.scene.add(feastEdge);
    const gift = makeSprite("🎁", { fontPx: 130, worldH: 1.5 });
    gift.position.set(feast.position.x, 1.1, feast.position.z);
    this.scene.add(gift);
    const feastLabel = makeSprite("잔치상", {
      fontPx: 46,
      color: hexString(BOARD.feastText),
      worldH: 0.6,
    });
    feastLabel.position.set(feast.position.x, 0.5, feast.position.z + 1.4);
    this.scene.add(feastLabel);
  }

  // ── 토큰 생성 ──
  private createToken(id: string, p: PlayerView): Token {
    const group = new THREE.Group();
    // 색은 접속 순서가 아니라 `suspect`로 결정된다 — 판 도중에도 불변(§4).
    const color = zodiacColor(p.suspect);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 32),
      // transparent를 켜두지 않으면 탈락 시 opacity가 무시돼 disc만 불투명하게 남는다.
      new THREE.MeshStandardMaterial({ color, transparent: true }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.22;
    group.add(disc);

    // 색면 아웃라인(§4.1) — disc에는 스트로크가 없어 밝은 방바닥 위에서 색면이 번진다.
    const outline = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.46, 32),
      new THREE.MeshBasicMaterial({
        color: TOKEN_OUTLINE_COLOR,
        side: THREE.DoubleSide,
        transparent: true,
      }),
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.y = 0.221;
    group.add(outline);

    // 뷰3(에셋 모드)에서는 아트가 얼굴을 덮으므로 **색은 발밑으로** 내린다(§4.2).
    // 아트 색과 팀 색을 섞지 않기 위해 접지 데칼로만 색을 반복한다.
    if (this.useAssets) {
      const decal = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 32),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      );
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = 0.205;
      group.add(decal);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.6, 32),
      new THREE.MeshBasicMaterial({
        color: RING_CURRENT,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.23;
    ring.visible = false;
    ring.renderOrder = 9;
    group.add(ring);

    const face = this.charFace(p.suspect, 0.95, 110);
    face.position.set(0, 0.85, 0);
    group.add(face);

    const nameSprite = makeSprite(`${p.isBot ? "🤖" : ""}${p.name}`, {
      fontPx: 34,
      color: hexString(BOARD.nameText),
      bg: "#000000aa",
      padX: 10,
      padY: 6,
      worldH: 0.36,
      // 이름표 좌측 색 스트라이프 — 색과 이름을 같은 픽셀에(§4.2).
      stripe: hexString(color),
    });
    nameSprite.position.set(0, 0.35, 0.15);
    group.add(nameSprite);

    // 탈락 2차 표기 — 알파 단독은 저대비·회색조에서 사라진다(§1.2).
    // 문안은 ui-copy §"아이콘 사전"의 탈락 기호 ❌를 그대로 쓴다.
    const elimMark = makeSprite("❌", { fontPx: 96, worldH: 0.6 });
    elimMark.position.set(0, 0.9, 0.2);
    elimMark.renderOrder = 11;
    elimMark.visible = false;
    group.add(elimMark);

    this.scene.add(group);
    const token: Token = {
      group,
      ring,
      face,
      elimMark,
      cur: new THREE.Vector2(p.x, p.y),
      target: new THREE.Vector2(p.x, p.y),
      placed: false,
    };
    this.tokens.set(id, token);
    return token;
  }

  // ── 상태 → 씬 반영(매 프레임 호출) ──
  private syncState(): void {
    const state = this.room.state as unknown as {
      players: Map<string, PlayerView>;
      weapons: Map<string, { value: string; x: number; y: number }>;
      helpers: Map<
        string,
        { value: string; x: number; y: number; used: boolean }
      >;
      currentTurn: string;
    };
    const players = state.players;
    const current = state.currentTurn ?? "";
    const seen = new Set<string>();

    players.forEach((p, id) => {
      seen.add(id);
      const token = this.tokens.get(id) ?? this.createToken(id, p);
      token.target.set(p.x, p.y);
      const isCurrent = id === current;
      token.ring.visible = isCurrent;
      // 탈락 표기는 face 스프라이트가 아니라 **토큰 전체**(disc·ring·이름표·얼굴)에.
      const alpha = p.eliminated ? ELIM_ALPHA : 1;
      setGroupOpacity(token.group, alpha);
      // 2차 표기(❌)는 감쇠 대상이 아니다 — 감쇠되면 2중 표기의 의미가 사라진다.
      token.elimMark.visible = p.eliminated;
      (token.elimMark.material as THREE.SpriteMaterial).opacity = 1;
    });

    // 장물 토큰 — 위치는 target만 갱신하고 실제 이동은 loop()에서 dt 보간(스냅 금지).
    state.weapons.forEach((w, key) => {
      let lt = this.weapons.get(key);
      if (!lt) {
        const sprite = this.lootSprite(w.value, 0.8);
        sprite.position.set(worldX(w.x), 0.55, worldZ(w.y));
        this.scene.add(sprite);
        lt = {
          sprite,
          cur: new THREE.Vector2(w.x, w.y),
          target: new THREE.Vector2(w.x, w.y),
          placed: false,
        };
        this.weapons.set(key, lt);
      }
      lt.target.set(w.x, w.y);
    });

    // 고정 NPC(계략)
    state.helpers.forEach((h, key) => {
      let g = this.helpers.get(key);
      if (!g) {
        g = new THREE.Group();
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(0.42, 32),
          // helper 감광도 disc를 포함해야 하므로 transparent를 켜둔다.
          new THREE.MeshStandardMaterial({ color: BOARD.helperDisc, transparent: true }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.22;
        g.add(disc);
        const face = this.charFace(h.value, 0.85, 100);
        face.position.set(0, 0.8, 0);
        g.add(face);
        const mark = makeSprite("🃏", { fontPx: 48, worldH: 0.4 });
        mark.position.set(0.3, 1.15, 0);
        g.add(mark);
        const tag = makeSprite("계략", {
          fontPx: 30,
          color: hexString(BOARD.helperTag),
          bg: "#000000aa",
          padX: 8,
          padY: 4,
          worldH: 0.28,
        });
        tag.position.set(0, 0.32, 0.15);
        g.add(tag);
        g.position.set(worldX(h.x), 0, worldZ(h.y));
        this.scene.add(g);
        this.helpers.set(key, g);
      }
      // 사용된 계략 감광도 Sprite만이 아니라 disc Mesh를 포함한 **그룹 전체**에.
      setGroupOpacity(g, h.used ? SPENT_ALPHA : 1);
    });

    // 카메라 추적 대상 = 현재 턴(지연 전환)
    const followCand = current && this.tokens.has(current) ? current : this.myId;
    if (followCand !== this.followId && this.switchTimer === 0) {
      const isMe = followCand === this.myId;
      this.switchTimer = window.setTimeout(
        () => {
          this.followId = followCand;
          this.switchTimer = 0;
          this.panOffset.set(0, 0, 0); // 새 턴 대상으로 리센터
        },
        isMe
          ? this.timing.CAM_SWITCH_SELF_MS
          : this.timing.CAM_SWITCH_OTHER_MS,
      );
    }
    if (this.followId === "") this.followId = followCand;

    // 사라진 토큰 정리
    for (const id of [...this.tokens.keys()]) {
      if (!seen.has(id)) {
        const t = this.tokens.get(id);
        if (t) this.scene.remove(t.group);
        this.tokens.delete(id);
        // 퇴장 시 말풍선·타이머까지 뷰가 정리한다(계약 §2 removeActor).
        const b = this.bubbles.get(id);
        if (b) {
          window.clearInterval(b.typeTimer);
          window.clearTimeout(b.holdTimer);
          b.el.remove();
          this.bubbles.delete(id);
        }
      }
    }
  }

  // ── 매 프레임 루프 ──
  // `now`는 rAF 타임스탬프(ms). 고정 프레임을 가정하지 않기 위해 dt를 여기서 만든다.
  private loop(now: number): void {
    if (!this.active) return;
    const dtMs =
      this.lastFrameMs === 0
        ? 1000 / 60
        : Math.min(DT_MAX_MS, Math.max(0, now - this.lastFrameMs));
    this.lastFrameMs = now;
    this.syncState();

    // 토큰 위치 보간 — 프레임 시간 기반 지수 보간 k = 1 - exp(-dt/τ).
    // (기존 lerp(0.25)는 **프레임레이트 종속**이라 120Hz에서 뷰1의 tween 110ms보다
    //  두 배 빨리 도착했다. 같은 이동이 뷰마다 다른 속도로 보이면 그건 정보 차이다.)
    const moveK = expK(dtMs, this.timing.MOVE_TWEEN_MS);
    this.tokens.forEach((t) => {
      t.cur.lerp(t.target, t.placed ? moveK : 1);
      t.placed = true;
      t.group.position.set(worldX(t.cur.x), 0, worldZ(t.cur.y));
    });

    // 장물 위치 보간 — 동일한 dt 기반 지수 보간.
    // (기존: 매 프레임 position.set으로 순간이동해 "무슨 일이 일어났는지" 안 읽혔다)
    const lootK = expK(dtMs, this.timing.LOOT_TWEEN_MS);
    this.weapons.forEach((lt) => {
      lt.cur.lerp(lt.target, lt.placed ? lootK : 1);
      lt.placed = true;
      lt.sprite.position.set(worldX(lt.cur.x), 0.55, worldZ(lt.cur.y));
    });

    // 카메라: 추적 대상으로 부드럽게
    const ft = this.tokens.get(this.followId);
    if (ft) {
      const inset = this.insetWorld();
      const desired = new THREE.Vector3(
        worldX(ft.cur.x) + inset + this.panOffset.x,
        0,
        worldZ(ft.cur.y) + this.panOffset.z,
      );
      const l = this.followId === this.myId ? LERP_ME : LERP_OTHER;
      this.look.lerp(desired, this.freeLook || this.dragging ? 1 : l);
    }
    const off = new THREE.Vector3(
      0,
      Math.sin(CAM_PITCH),
      Math.cos(CAM_PITCH),
    ).multiplyScalar(this.camDist);
    this.camera.position.copy(this.look).add(off);
    this.camera.lookAt(this.look);

    this.updateBubbles();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }

  /**
   * 우측 패널이 가리는 만큼 시선 중심을 오른쪽으로 보정(토큰이 보이는 영역 중앙에 오도록).
   * 측정은 `hud-inset`의 ResizeObserver 캐시가 담당 — 프레임 루프에서 리플로우가 없다.
   * 세로(bottom) 인셋은 42° 피치 때문에 화면-세로↔월드-z 환산이 선형이 아니라
   * 여기서는 쓰지 않는다(하단 시트 레이아웃 도입 시 별도 처리).
   */
  private insetWorld(): number {
    const insetPx = hudRightInset();
    if (insetPx <= 0) return 0;
    const frac = insetPx / window.innerWidth;
    const aspect = window.innerWidth / window.innerHeight;
    const viewW = 2 * this.camDist * Math.tan((45 * Math.PI) / 360) * aspect;
    return (frac * viewW) / 2;
  }

  // ── 말풍선(DOM 오버레이 + 타자기) ──
  showBubble(id: string, text: string): void {
    const prev = this.bubbles.get(id);
    if (prev) {
      window.clearInterval(prev.typeTimer);
      window.clearTimeout(prev.holdTimer);
      prev.el.remove();
      this.bubbles.delete(id);
    }
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute; transform:translate(-50%,-100%); max-width:260px;" +
      `background:${hexString(BOARD.bubbleBg)}; color:${hexString(BOARD.bubbleText)};` +
      "padding:4px 8px; border-radius:8px;" +
      "font-size:15px; line-height:1.35; text-align:center; white-space:pre-wrap;" +
      "box-shadow:0 2px 8px #0008;";
    this.bubbleLayer.appendChild(el);
    const b: Bubble = {
      el,
      id,
      full: text,
      shown: 0,
      typeTimer: 0,
      holdTimer: 0,
    };
    // 총 수명은 shared `bubbleLifeMs`가 계산한다(서버 SPEAK_HOLD와 정합을 맞추는 지점).
    const total = bubbleLifeMs(text, this.timing);
    const typeMs = this.timing.TYPE_MS;
    const expire = (): void => {
      el.remove();
      this.bubbles.delete(id);
    };
    if (typeMs <= 0) {
      // reduced 프로파일: 타자기 없이 전문을 즉시 띄운다.
      el.textContent = text;
      b.shown = text.length;
      b.holdTimer = window.setTimeout(expire, total);
    } else {
      b.typeTimer = window.setInterval(() => {
        b.shown += 1;
        el.textContent = text.slice(0, b.shown);
        if (b.shown >= text.length) {
          window.clearInterval(b.typeTimer);
          b.holdTimer = window.setTimeout(
            expire,
            Math.max(0, total - text.length * typeMs),
          );
        }
      }, typeMs);
    }
    this.bubbles.set(id, b);
  }

  private updateBubbles(): void {
    if (this.bubbles.size === 0) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.bubbles.forEach((b) => {
      const token = this.tokens.get(b.id);
      const helper = this.helpers.get(b.id);
      const base = token ? token.group.position : helper?.position;
      if (!base) return;
      const pos = new THREE.Vector3(base.x, 1.6, base.z).project(this.camera);
      const sx = (pos.x * 0.5 + 0.5) * w;
      const sy = (-pos.y * 0.5 + 0.5) * h;
      b.el.style.left = `${sx}px`;
      b.el.style.top = `${sy}px`;
      b.el.style.display = pos.z > 1 ? "none" : "block";
    });
  }

  // ── 입력 ──
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.camDist = THREE.MathUtils.clamp(
      this.camDist * (e.deltaY > 0 ? 1.1 : 0.9),
      MIN_DIST,
      MAX_DIST,
    );
  }

  private onPointerDown(e: PointerEvent): void {
    // 우클릭/휠클릭 드래그 = 화면 팬(자유시점 아니어도). 좌클릭은 자유시점(Space) 중에만.
    const rightOrMid = e.button === 1 || e.button === 2;
    if (!this.freeLook && !rightOrMid) return;
    this.dragging = true;
    this.lastPointer.set(e.clientX, e.clientY);
    if (rightOrMid) e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer.set(e.clientX, e.clientY);
    const k = this.camDist / 600;
    this.panOffset.x -= dx * k;
    this.panOffset.z -= dy * k;
  }

  private onPointerUp(): void {
    this.dragging = false;
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this.freeLook = true;
      return;
    }
    let dx = 0;
    let dy = 0;
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
        dy = -1;
        break;
      case "ArrowDown":
      case "KeyS":
        dy = 1;
        break;
      case "ArrowLeft":
      case "KeyA":
        dx = -1;
        break;
      case "ArrowRight":
      case "KeyD":
        dx = 1;
        break;
      default:
        return;
    }
    if (this.freeLook) {
      this.panOffset.x += dx * PAN_STEP;
      this.panOffset.z += dy * PAN_STEP;
      return;
    }
    // 이동 게이팅(2D와 동일)
    const s = this.room.state as unknown as {
      currentTurn: string;
      stepsLeft: number;
      players: Map<string, { x: number; y: number }>;
    };
    if (s.currentTurn !== this.myId) return;
    const me = s.players.get(this.myId);
    const inRoom = !!me && roomAt(me.x, me.y) !== null;
    const free = !!me && (inRoom || inFeast(me.x, me.y));
    const steps = s.stepsLeft ?? 0;
    if (!free && steps <= 0) return;
    if (me && inRoom && steps <= 0) {
      const tx = me.x + dx;
      const ty = me.y + dy;
      if (roomAt(tx, ty) === null && !inFeast(tx, ty)) return;
    }
    const now = performance.now();
    if (now - this.lastMove < this.timing.MOVE_COOLDOWN_MS) return;
    this.lastMove = now;
    this.room.send("move", { dx, dy });
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this.freeLook = false;
      this.dragging = false;
      this.panOffset.set(0, 0, 0);
    }
  }

  private onResize(): void {
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
