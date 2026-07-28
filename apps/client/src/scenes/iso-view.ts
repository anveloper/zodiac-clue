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
  regionOf,
  roomAt,
  timingOf,
  zodiacColor,
  zodiacCue,
  type MotionProfile,
  type ViewTiming,
  type ZodiacCue,
  doorSideOf,
  PASSAGE_ALPHA_HOVER,
  PASSAGE_ALPHA_IDLE,
  PASSAGE_FADE_MS,
  PASSAGE_HOVER_PX,
  SUMMON_ANCHOR_ALPHA,
  SUMMON_ANCHOR_ICON,
} from "@zodiac-clue/shared";
import { acquireHudInset, hudRightInset, releaseHudInset } from "./hud-inset";
import { currentTiming, cvdMode } from "./view-motion";
import { CVD_CELL, cvdCueDots } from "./pixel-glyphs";
import {
  OUTLINE_RING,
  TURN_RING,
  UNIT_BOX,
  UNIT_BOX_EDGES,
  UNIT_CIRCLE,
  UNIT_PLANE,
  WARP_RING,
  disposeObject,
  disposeScene,
  isSharedTexture,
  loadTextureCached,
  releaseSharedResources,
} from "./three-res";
import type {
  ActorSnapshot,
  BubbleOpts,
  FocusMode,
  PassageLink,
  PulseTone,
  ViewCell,
  ViewContract,
  ViewId,
  ViewOutcome,
  WarpReason,
} from "./view-contract";

// 2.5D 뷰: 평면 보드를 카메라로 살짝 내려다보는(피치) 원근 뷰.
// 서버 상태(그리드 x,y)를 그대로 읽어 3D 월드로 매핑한다. 룰/입력은 2D와 동일.
//
// ⚠ 표기 수치(알파·보간 길이·타자기 속도·팔레트)는 전부 shared의 view-consts에서 온다.
//   여기서 리터럴로 다시 쓰면 뷰1·뷰4와 갈라진다.
// ⚠ 지오메트리는 `three-res`의 **공유 단위 프리미티브 + scale**만 쓴다.
//   여기서 `new THREE.XxxGeometry`를 다시 쓰면 뷰 왕복마다 GPU에 쌓인다(§9.3).

const CAM_PITCH = (42 * Math.PI) / 180; // 내려다보는 각(수평 기준)
const MIN_DIST = 9; // 근접
const MAX_DIST = 34; // 전체 조망
const INIT_DIST = 17;
const LERP_ME = 0.14; // 내 턴 추적(빠름)
const LERP_OTHER = 0.06; // 남 턴 추적(천천히)
const PAN_STEP = 0.6; // 자유시점 방향키 팬

/** `pulseCell`의 의미 → 뷰2·3 팔레트 번역(색이 아니라 의미를 받는다). */
const TONE_COLOR: Record<PulseTone, number> = {
  neutral: BOARD.plaqueText,
  suggest: BOARD.gold,
  alert: 0xff6b5e,
};

/** "이미 살펴본 방" 바닥 감광 계수(§2 계약 표 `setSurveyed` 뷰2·3 칸 — 30% 어둡게). */
const SURVEYED_DIM = 0.7;

// 그리드(gx,gy) → 월드(x,0,z). 보드 중심을 원점에.
const worldX = (gx: number): number => gx - GRID_WIDTH / 2 + 0.5;
const worldZ = (gy: number): number => gy - GRID_HEIGHT / 2 + 0.5;

type Token = {
  group: THREE.Group;
  ring: THREE.Mesh;
  face: THREE.Sprite;
  elimMark: THREE.Sprite; // 탈락 2차 표기(알파 단독 금지 — §1.2 ELIM_NEEDS_SECOND_CUE)
  cur: THREE.Vector2; // 현재 보간 위치(그리드 단위)
  target: THREE.Vector2; // 목표 위치
  /** 색·아트의 파생 키(§4). `identity()`가 이 키로 표기를 되맞춘다. */
  suspect: string;
  placed: boolean;
  eliminated: boolean;
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

/**
 * 일회성 연출 오브젝트. 자기 rAF/타이머를 갖지 않고 `loop(dt)`가 진행시킨다
 * (§9.4 — 프레임레이트 종속 제거). 끝나면 `disposeObject`로 반드시 해제된다.
 */
type Fx = {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  step: (obj: THREE.Object3D, k: number) => void;
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
    /**
     * `?cvd=1` 색각 대체 표기(§4.3) — 이름표 **우측**에 8×8 도트 셀을 붙인다.
     * 별도 스프라이트를 띄우지 않고 같은 캔버스에 그리는 이유:
     * 뷰2·3의 1차 식별자는 이모지/아트이므로 보조 표기가 오브젝트 수를 늘리면
     * (= 빌보드가 하나 더 뜨면) 화면이 어지러워지고 GPU 자원 회수 경로도 늘어난다.
     */
    cue?: ZodiacCue;
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
    cue,
  } = opts;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Sprite();
  const font = `${fontPx}px system-ui, "Apple SD Gothic Neo", sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  // 스트라이프 폭은 폰트에 비례(3px @ 13px 기준) — 어느 줌에서도 같은 굵기로 읽힌다.
  const stripeW = stripe ? Math.max(4, Math.round(fontPx * 0.22)) : 0;
  // 대체 표기 셀은 글자 높이의 0.62배 — 이름을 압도하지 않는 최소 크기.
  const cueDot = cue ? Math.max(1, (fontPx * 0.62) / CVD_CELL) : 0;
  const cueW = cue ? cueDot * CVD_CELL + Math.round(fontPx * 0.18) : 0;
  const tw = Math.ceil(metrics.width) + padX * 2 + stripeW + cueW;
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
  ctx.fillText(text, stripeW + (tw - stripeW - cueW) / 2, th / 2);
  if (cue) {
    // 색 대체 표기는 **흰색 고정**(§4.3) — 색에 의존하면 의미가 없다.
    ctx.fillStyle = "#ffffff";
    const ox = tw - cueW + (cueW - cueDot * CVD_CELL) / 2;
    const oy = (th - cueDot * CVD_CELL) / 2;
    for (const r of cvdCueDots(cue)) {
      ctx.fillRect(ox + r.x * cueDot, oy + r.y * cueDot, r.w * cueDot, r.h * cueDot);
    }
  }
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

export class IsoView implements ViewContract {
  /**
   * 한 인스턴스가 뷰2·뷰3을 겸한다 — `useAssets`가 어느 stage인지를 가른다.
   * (인스턴스를 2개로 쪼개면 WebGL 컨텍스트가 늘어난다 — §9.5 경고.)
   */
  get viewId(): ViewId {
    return this.useAssets ? "three-asset" : "three-emoji";
  }

  /** 뷰2·뷰3이 **같은 컨텍스트 1개를 공유**한다(§9.5). */
  readonly contextCost = 1;

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
  private fx: Fx[] = [];

  private look = new THREE.Vector3(0, 0, 0); // 현재 카메라가 보는 지점(보간)
  private panOffset = new THREE.Vector3(0, 0, 0); // 자유시점 이동
  private camDist = INIT_DIST;
  private freeLook = false;
  private dragging = false;
  private lastPointer = new THREE.Vector2();

  private followId = "";
  private currentId: string | null = null;
  private switchTimer = 0;
  private lastMove = 0;
  private active = false;
  private raf = 0;
  private disposed = false;
  /** 감속 프로파일 타이밍(§1.3). 보간 길이는 매 프레임 여기서 재조회한다. */
  private timing: ViewTiming = currentTiming();
  /** 직전 프레임의 rAF 타임스탬프(ms). 0이면 "첫 프레임"(dt 기본값 사용). */
  private lastFrameMs = 0;
  /** 색각 대체 표기(§4.3). 뷰4에만 있던 것을 뷰2·3으로 넓혀 계약을 맞춘다. */
  private cvd = cvdMode();

  // 뷰3(에셋 모드): 이모지 대신 /assets/의 정면 아트를 로드. 실패 시 이모지 폴백.
  private useAssets = false;
  private loader = new THREE.TextureLoader();
  private roomMats = new Map<string, THREE.MeshStandardMaterial>();
  /** 방 바닥의 기본색(텍스처가 붙으면 0xffffff). 살펴봄 감광의 기준값. */
  private roomBase = new Map<string, number>();
  /** 명패 옆 "살펴봄" ✓ 스프라이트 — 기본 숨김. */
  private surveyMarks = new Map<string, THREE.Sprite>();
  private surveyed = new Set<string>();
  private feastMat?: THREE.MeshStandardMaterial;
  /** 비밀 통로 정적 표기(아치 + 파선). `setPassages`가 통째로 교체한다. */
  private passageGroup?: THREE.Group;
  /** 통로 파선 머티리얼 — 한 벌을 공유하므로 여기서 opacity 하나만 바꾸면 전부 따라온다. */
  private passageMat?: THREE.MeshBasicMaterial;
  /** 통로 선분(월드) — 화면 투영해 커서 근접을 잰다. */
  private passageSegs: readonly [THREE.Vector3, THREE.Vector3][] = [];
  /** 마지막 커서 위치(클라이언트 px). 캔버스 밖이면 null. */
  private hoverPx: { x: number; y: number } | null = null;
  /** 승리 연출(PointLight). `setOutcome(null)`이 걷는다. */
  private outcomeLight?: THREE.PointLight;
  /** `focusRoom("camera")`가 잡아 둔 시선 목표와 만료 시각(ms). */
  private focusPoint: THREE.Vector3 | null = null;
  private focusUntil = 0;
  private onPageHide: () => void;

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

    // 페이지 이탈 = 이 뷰의 마지막. 여기서 dispose하지 않으면 §9.3의 누수가
    // "탭을 닫을 때까지" 유지된다. main.ts가 dispose를 부르지 않아도 안전하게.
    this.onPageHide = () => {
      this.dispose();
      releaseSharedResources();
    };
    window.addEventListener("pagehide", this.onPageHide);

    // 런타임 게이트(§9.6) 측정 훅 — 콘솔에서 `__zcIso.debugInfo()`.
    (window as unknown as { __zcIso?: IsoView }).__zcIso = this;
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
      // 진행 중이던 일회성 연출도 GPU 자원째 회수한다(§9.3).
      this.clearFx();
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
      if (on) this.applyTexture(mat, `/assets/room/${name}-floor.svg`, BOARD.room, name);
      else this.clearTexture(mat, BOARD.room, name);
    });
    if (this.feastMat) {
      if (on) this.applyTexture(this.feastMat, "/assets/room/feast.svg", BOARD.feast);
      else this.clearTexture(this.feastMat, BOARD.feast);
    }

    // 토큰·장물·NPC는 **해제하고** 지운다 — 다음 syncState가 새 플래그로 재생성한다.
    // (기존에는 scene.remove만 해서 왕복 1회당 geometry 18+/material 36+/texture 28+가
    //  유출됐다 — §9.3의 핵심 지점.)
    this.tokens.forEach((t) => disposeObject(t.group));
    this.tokens.clear();
    this.weapons.forEach((lt) => disposeObject(lt.sprite));
    this.weapons.clear();
    this.helpers.forEach((g) => disposeObject(g));
    this.helpers.clear();
  }

  private applyTexture(
    mat: THREE.MeshStandardMaterial,
    url: string,
    fallbackColor: number,
    roomName?: string,
  ): void {
    loadTextureCached(
      this.loader,
      url,
      (tex) => {
        // 이전 맵이 캐시 공유본이 아니면 먼저 해제한다(덮어쓰기 = 조용한 누수였다).
        if (mat.map && mat.map !== tex && !isSharedTexture(mat.map)) {
          mat.map.dispose();
        }
        mat.map = tex;
        mat.color.set(0xffffff); // 텍스처 원색 보존
        mat.needsUpdate = true;
        if (roomName) {
          this.roomBase.set(roomName, 0xffffff);
          this.applyRoomTint(roomName);
        }
      },
      () => this.clearTexture(mat, fallbackColor, roomName),
    );
  }

  private clearTexture(
    mat: THREE.MeshStandardMaterial,
    color: number,
    roomName?: string,
  ): void {
    if (mat.map && !isSharedTexture(mat.map)) mat.map.dispose();
    mat.map = null;
    mat.color.set(color);
    mat.needsUpdate = true;
    if (roomName) {
      this.roomBase.set(roomName, color);
      this.applyRoomTint(roomName);
    }
  }

  /** 방 바닥 색 = 기본색 × (살펴봤으면 감광). 두 정보가 색 하나를 공유하는 지점. */
  private applyRoomTint(name: string): void {
    const mat = this.roomMats.get(name);
    if (!mat) return;
    mat.color.setHex(this.roomBase.get(name) ?? BOARD.room);
    if (this.surveyed.has(name)) mat.color.multiplyScalar(SURVEYED_DIM);
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
    loadTextureCached(
      this.loader,
      url,
      (tex) => {
        mat.map = tex;
        mat.needsUpdate = true;
      },
      () => {
        const fb = fallback();
        const fbMat = fb.material as THREE.SpriteMaterial;
        mat.map = fbMat.map;
        mat.needsUpdate = true;
        sprite.scale.copy(fb.scale);
        // 폴백 스프라이트 자체는 씬에 들어가지 않는다 — 텍스처만 넘기고 머티리얼은 해제.
        fbMat.map = null;
        fbMat.dispose();
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
  // 지오메트리는 전부 `three-res`의 단위 프리미티브 + scale이다(§9.3: 49 → 24).
  private buildBoard(): void {
    const W = GRID_WIDTH;
    const H = GRID_HEIGHT;
    // 복도 바닥
    const floor = new THREE.Mesh(
      UNIT_PLANE,
      new THREE.MeshStandardMaterial({ color: BOARD.corridor }),
    );
    floor.scale.set(W, H, 1);
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
      this.roomBase.set(r.name, BOARD.room);
      const box = new THREE.Mesh(UNIT_BOX, roomMat);
      box.scale.set(r.w, 0.2, r.h);
      box.position.set(
        worldX(r.x) + (r.w - 1) / 2,
        0.1,
        worldZ(r.y) + (r.h - 1) / 2,
      );
      this.scene.add(box);
      const edge = new THREE.LineSegments(
        UNIT_BOX_EDGES,
        new THREE.LineBasicMaterial({ color: BOARD.roomEdge }),
      );
      edge.scale.copy(box.scale);
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
      // 살펴봄 ✓ 스탬프 — 명패 **왼쪽**. 기본 숨김(§5 행 16).
      // 오른쪽에서 왼쪽으로 옮긴 이유는 두 가지다.
      //  ① 뷰1이 ✓를 명패 **내부 좌측**으로 옮겼다(그쪽은 문 타일에 가려지는 방이 3개였다).
      //     4뷰의 읽는 순서를 "✓ 다음 이름"으로 맞춘다 — 같은 정보가 뷰마다 다른 자리에
      //     있으면 뷰를 갈아타며 보는 심사 동선에서 그대로 오독이 된다.
      //  ② 명패 오른쪽은 문(입구) 빌보드와 겹치는 방이 있었다(안방 — 문 (3,18)이 명패
      //     오른쪽 바로 옆에 선다). 문 스프라이트가 뒤에 추가돼 ✓ 위에 그려졌다.
      // 그래도 남는 겹침은 `renderOrder`로 잘라낸다 — ✓는 문(10)보다 위(12)에 둔다.
      const check = makeSprite("✓", {
        fontPx: 44,
        color: hexString(BOARD.gold),
        worldH: 0.42,
      });
      check.position.set(
        box.position.x - plaque.scale.x / 2 - 0.22,
        0.9,
        worldZ(r.y) - 0.1,
      );
      check.renderOrder = 12;
      check.visible = false;
      this.scene.add(check);
      this.surveyMarks.set(r.name, check);

      // 문(입구) — 이 칸으로만 출입. 밝은 바닥 타일 + 문기둥 + "입구" 라벨로 명확히.
      const dx = worldX(r.door.x);
      const dz = worldZ(r.door.y);
      // 예전에는 밝은 금색 바닥판(0.94×0.94, 불투명 0.85) + 기둥 2개 +
      // **90px 🚪 빌보드** + "입구" 라벨을 한 칸에 겹쳐 세웠다. 문이 아니라 표지판 더미였다.
      // 이제 실제 문틀(문지방 + 문설주 + 상인방)로 세운다 — 42° 시점에서 형태만으로 읽힌다.
      const side = doorSideOf(r);
      const alongX = side === "top" || side === "bottom"; // 개구부가 x축으로 열린다
      // ① 문지방 — 개구부 폭으로 좁게 깔린 띠. 칸 전체를 칠하지 않는다.
      const sill = new THREE.Mesh(
        UNIT_PLANE,
        new THREE.MeshBasicMaterial({
          color: BOARD.gold,
          transparent: true,
          opacity: 0.42,
        }),
      );
      sill.scale.set(alongX ? 0.88 : 0.26, alongX ? 0.26 : 0.88, 1);
      sill.rotation.x = -Math.PI / 2;
      sill.position.set(dx, 0.205, dz);
      this.scene.add(sill);
      const post = new THREE.MeshStandardMaterial({ color: BOARD.wood });
      // ② 문설주 2개 — 개구부 양 끝.
      for (const sgn of [-1, 1]) {
        const pillar = new THREE.Mesh(UNIT_BOX, post);
        pillar.scale.set(0.13, 0.78, 0.13);
        pillar.position.set(
          dx + (alongX ? sgn * 0.42 : 0),
          0.39,
          dz + (alongX ? 0 : sgn * 0.42),
        );
        this.scene.add(pillar);
      }
      // ③ 상인방 — 두 기둥을 잇는 가로 보. 비밀 통로 아치와 같은 어휘라
      //    "지나갈 수 있는 자리"로 함께 읽힌다.
      const lintel = new THREE.Mesh(UNIT_BOX, post);
      lintel.scale.set(alongX ? 0.97 : 0.16, 0.14, alongX ? 0.16 : 0.97);
      lintel.position.set(dx, 0.82, dz);
      this.scene.add(lintel);

      // ── 소환 앵커(§5 행 18) ──
      // 제안이 성립하면 지목된 인물이 **이 칸을 기준으로** 방 안에 선다.
      // ⚠ 좌표는 만들지 않는다 — `r.summon`은 서버 `freeCellIn()`이 자리 배정의 정렬
      //   기준으로 쓰는 값(shared 단일 소스)이고, 뷰는 그 칸을 표시만 한다.
      // 지오메트리는 **공유 상수 + scale**만 쓴다(§9.3 G1 — 런타임 생성 0건).
      //   WARP_RING(0.56~0.68)을 0.72배 → 반지름 0.40~0.49로 칸(1.0) 안에 딱 들어간다.
      //   `warp()`의 소환 링과 같은 도형인 것이 의도다 — 앵커는 그 연출이 착지하는 자리다.
      const sx = worldX(r.summon.x);
      const sz = worldZ(r.summon.y);
      const anchorRing = new THREE.Mesh(
        WARP_RING,
        new THREE.MeshBasicMaterial({
          color: BOARD.gold,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: SUMMON_ANCHOR_ALPHA,
          depthWrite: false,
        }),
      );
      anchorRing.rotation.x = -Math.PI / 2;
      anchorRing.scale.set(0.72, 0.72, 1);
      // 방 박스 윗면(y=0.2) 바로 위 · 토큰 disc(0.22)보다는 아래.
      anchorRing.position.set(sx, 0.205, sz);
      this.scene.add(anchorRing);
      const anchorIcon = makeSprite(SUMMON_ANCHOR_ICON, {
        fontPx: 64,
        worldH: 0.4,
      });
      (anchorIcon.material as THREE.SpriteMaterial).opacity =
        SUMMON_ANCHOR_ALPHA;
      // 토큰 얼굴(0.85)보다 낮게 띄워 소환된 말이 마크를 덮도록 둔다.
      anchorIcon.position.set(sx, 0.45, sz);
      this.scene.add(anchorIcon);
    }

    // 중앙 잔치상
    const feastMat = new THREE.MeshStandardMaterial({ color: BOARD.feast });
    this.feastMat = feastMat;
    const feast = new THREE.Mesh(UNIT_BOX, feastMat);
    feast.scale.set(FEAST.w, 0.34, FEAST.h);
    feast.position.set(
      worldX(FEAST.x) + (FEAST.w - 1) / 2,
      0.17,
      worldZ(FEAST.y) + (FEAST.h - 1) / 2,
    );
    this.scene.add(feast);
    const feastEdge = new THREE.LineSegments(
      UNIT_BOX_EDGES,
      new THREE.LineBasicMaterial({ color: BOARD.feastEdge }),
    );
    feastEdge.scale.copy(feast.scale);
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
  private createToken(id: string, a: ActorSnapshot): Token {
    const group = new THREE.Group();
    // 색은 접속 순서가 아니라 `suspect`로 결정된다 — 판 도중에도 불변(§4).
    const color = zodiacColor(a.suspect);
    const disc = new THREE.Mesh(
      UNIT_CIRCLE,
      // transparent를 켜두지 않으면 탈락 시 opacity가 무시돼 disc만 불투명하게 남는다.
      new THREE.MeshStandardMaterial({ color, transparent: true }),
    );
    disc.scale.set(0.42, 0.42, 1);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.22;
    group.add(disc);

    // 색면 아웃라인(§4.1) — disc에는 스트로크가 없어 밝은 방바닥 위에서 색면이 번진다.
    const outline = new THREE.Mesh(
      OUTLINE_RING,
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
        UNIT_CIRCLE,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      );
      decal.scale.set(0.62, 0.62, 1);
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = 0.205;
      group.add(decal);
    }

    const ring = new THREE.Mesh(
      TURN_RING,
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

    const face = this.charFace(a.suspect, 0.95, 110);
    face.position.set(0, 0.85, 0);
    group.add(face);

    const nameSprite = makeSprite(`${a.isBot ? "🤖" : ""}${a.name}`, {
      fontPx: 34,
      color: hexString(BOARD.nameText),
      bg: "#000000aa",
      padX: 10,
      padY: 6,
      worldH: 0.36,
      // 이름표 좌측 색 스트라이프 — 색과 이름을 같은 픽셀에(§4.2).
      stripe: hexString(color),
      // `?cvd=1`이면 우측에 계열 바 + 명도 핍(§4.3). 뷰2·3 공통.
      cue: this.cvd ? zodiacCue(a.suspect) : undefined,
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
      cur: new THREE.Vector2(a.cell.x, a.cell.y),
      target: new THREE.Vector2(a.cell.x, a.cell.y),
      suspect: a.suspect,
      placed: false,
      eliminated: a.eliminated,
    };
    this.tokens.set(id, token);
    return token;
  }

  // ── 계약: 액터 ───────────────────────────────────────────
  /** 액터 1명의 현재 상태 반영. 실제 이동은 `loop()`의 dt 보간이 한다. */
  syncActor(a: ActorSnapshot): void {
    const token = this.tokens.get(a.id) ?? this.createToken(a.id, a);
    token.target.set(a.cell.x, a.cell.y);
    this.setElim(a.id, a.eliminated);
  }

  /** 퇴장 — 말풍선·타이머는 물론 **GPU 자원까지** 뷰가 정리한다(계약 §2 · §9.3). */
  removeActor(id: string): void {
    const t = this.tokens.get(id);
    if (t) {
      disposeObject(t.group);
      this.tokens.delete(id);
    }
    const b = this.bubbles.get(id);
    if (b) {
      window.clearInterval(b.typeTimer);
      window.clearTimeout(b.holdTimer);
      b.el.remove();
      this.bubbles.delete(id);
    }
    if (this.currentId === id) this.currentId = null;
  }

  /** 지금 턴 — `RingGeometry` visible(§5 행 1). */
  setCurrent(id: string | null): void {
    this.currentId = id;
    this.tokens.forEach((t, tid) => {
      t.ring.visible = tid === id;
    });
  }

  /**
   * 탈락 — 감쇠는 face 스프라이트가 아니라 **토큰 전체**(disc·ring·이름표·얼굴)에.
   * 2차 표기(❌)는 감쇠 대상이 아니다 — 감쇠되면 2중 표기의 의미가 사라진다.
   */
  setElim(id: string, on: boolean): void {
    const t = this.tokens.get(id);
    if (!t) return;
    t.eliminated = on;
    setGroupOpacity(t.group, on ? ELIM_ALPHA : 1);
    t.elimMark.visible = on;
    (t.elimMark.material as THREE.SpriteMaterial).opacity = 1;
    // ring은 현재 턴일 때만 보인다 — 감쇠와 별개로 가시성을 되맞춘다.
    t.ring.visible = this.currentId === id;
  }

  // ── 계약: 일회성 연출(fx) ────────────────────────────────
  private addFx(
    obj: THREE.Object3D,
    dur: number,
    step: (o: THREE.Object3D, k: number) => void,
  ): void {
    this.scene.add(obj);
    this.fx.push({ obj, t: 0, dur: Math.max(1, dur), step });
  }

  private stepFx(dtMs: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dtMs;
      const k = Math.min(1, f.t / f.dur);
      f.step(f.obj, k);
      if (k >= 1) {
        disposeObject(f.obj);
        this.fx.splice(i, 1);
      }
    }
  }

  private clearFx(): void {
    for (const f of this.fx) disposeObject(f.obj);
    this.fx = [];
  }

  /** 순간이동 — `RingGeometry` 펄스 + y축 포물선(spec §2 뷰2·3 칸). */
  warp(id: string, from: ViewCell, to: ViewCell, reason: WarpReason): void {
    const t = this.tokens.get(id);
    if (t) {
      // 워프는 걷는 것이 아니다 — 보간을 끊고 목적지에 둔다.
      t.cur.set(to.x, to.y);
      t.target.set(to.x, to.y);
      t.placed = true;
    }
    const ms = this.timing.WARP_MS;
    if (ms <= 0) return; // reduced: 배너가 대신한다(§1.3)
    const tint = reason === "summon" ? BOARD.gold : BOARD.wood;
    const pulse = new THREE.Mesh(
      WARP_RING,
      new THREE.MeshBasicMaterial({
        color: tint,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
      }),
    );
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.set(worldX(to.x), 0.25, worldZ(to.y));
    pulse.renderOrder = 12;
    this.addFx(pulse, ms, (o, k) => {
      o.scale.setScalar(1 + k * 1.8);
      ((o as THREE.Mesh).material as THREE.Material).opacity = 1 - k;
    });

    // 출발 → 도착을 y축 포물선으로 잇는 잔상 링 3겹.
    for (let i = 1; i <= 3; i++) {
      const f = i / 4;
      const ghost = new THREE.Mesh(
        WARP_RING,
        new THREE.MeshBasicMaterial({
          color: tint,
          side: THREE.DoubleSide,
          transparent: true,
          depthTest: false,
        }),
      );
      ghost.rotation.x = -Math.PI / 2;
      ghost.renderOrder = 12;
      const gx = worldX(from.x) + (worldX(to.x) - worldX(from.x)) * f;
      const gz = worldZ(from.y) + (worldZ(to.y) - worldZ(from.y)) * f;
      const gy = 0.25 + Math.sin(f * Math.PI) * 1.6; // 포물선
      ghost.position.set(gx, gy, gz);
      this.addFx(ghost, ms, (o, k) => {
        o.scale.setScalar(1 - k * 0.5);
        ((o as THREE.Mesh).material as THREE.Material).opacity = 0.9 * (1 - k);
      });
    }
  }

  /** 장물 순간이동 — 스프라이트가 y축 포물선을 그리며 이동. */
  lootWarp(value: string, from: ViewCell, to: ViewCell): void {
    const ms = this.timing.WARP_MS;
    const ghost = this.lootSprite(value, 0.8);
    ghost.position.set(worldX(from.x), 0.55, worldZ(from.y));
    if (ms <= 0) {
      disposeObject(ghost);
      return;
    }
    const ax = worldX(from.x);
    const az = worldZ(from.y);
    const bx = worldX(to.x);
    const bz = worldZ(to.y);
    this.addFx(ghost, ms, (o, k) => {
      o.position.set(
        ax + (bx - ax) * k,
        0.55 + Math.sin(k * Math.PI) * 1.4,
        az + (bz - az) * k,
      );
      ((o as THREE.Sprite).material as THREE.SpriteMaterial).opacity =
        1 - k * 0.4;
    });
  }

  // ── 계약: 무대·칸 주목 ───────────────────────────────────
  /** 사건의 무대 — `look` 목표 이동(camera) 또는 `emissive` 점멸(highlight). */
  focusRoom(room: string, mode: FocusMode): void {
    const r = regionOf(room);
    if (!r) return;
    const cx = worldX(r.x) + (r.w - 1) / 2;
    const cz = worldZ(r.y) + (r.h - 1) / 2;
    if (mode === "camera") {
      this.focusPoint = new THREE.Vector3(cx, 0, cz);
      this.focusUntil =
        performance.now() + Math.max(1, this.timing.CAM_PAN_OTHER_MS) + 900;
    }
    const mat = this.roomMats.get(room);
    if (!mat) return;
    const dur = Math.max(1, this.timing.WARP_BANNER_MS);
    // emissive는 머티리얼 1개의 속성이라 fx 오브젝트가 필요 없다 —
    // 대신 빈 Object3D를 타이머 삼아 태우고 종료 시 원복한다(자원 0).
    const clock = new THREE.Object3D();
    mat.emissive.setHex(BOARD.gold);
    this.addFx(clock, dur, (_o, k) => {
      mat.emissiveIntensity = (1 - k) * 0.6 * (0.5 + 0.5 * Math.cos(k * 18));
      if (k >= 1) mat.emissive.setHex(0x000000);
    });
  }

  /** 특정 칸 주목 — y=0.02 평면 데칼(spec §2 뷰2·3 칸). */
  pulseCell(cell: ViewCell, tone: PulseTone): void {
    const decal = new THREE.Mesh(
      UNIT_PLANE,
      new THREE.MeshBasicMaterial({
        color: TONE_COLOR[tone],
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    decal.scale.set(0.94, 0.94, 1);
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(worldX(cell.x), 0.02, worldZ(cell.y));
    this.addFx(decal, Math.max(1, this.timing.WARP_BANNER_MS / 2), (o, k) => {
      ((o as THREE.Mesh).material as THREE.Material).opacity = 0.55 * (1 - k);
    });
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
    this.stepFx(dtMs);

    // 토큰 위치 보간 — 프레임 시간 기반 지수 보간 k = 1 - exp(-dt/τ).
    // (기존 lerp(0.25)는 **프레임레이트 종속**이라 120Hz에서 뷰1의 tween 110ms보다
    //  두 배 빨리 도착했다. 같은 이동이 뷰마다 다른 속도로 보이면 그건 정보 차이다.)
    this.updatePassageHover(dtMs);
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

    // 카메라: 추적 대상으로 부드럽게. `focusRoom("camera")`가 잡아둔 목표가 우선.
    const focusing = this.focusPoint !== null && now < this.focusUntil;
    if (focusing && this.focusPoint) {
      this.look.lerp(this.focusPoint, this.freeLook ? 1 : LERP_OTHER);
    } else {
      if (this.focusPoint && !focusing) this.focusPoint = null;
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

  // ── 상태 → 씬 반영(매 프레임 호출) ──
  private syncState(): void {
    const state = this.room.state as unknown as {
      players: Map<string, ActorSnapshotSource>;
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
      this.syncActor({
        id,
        suspect: p.suspect,
        name: p.name,
        isBot: p.isBot,
        cell: { x: p.x, y: p.y },
        eliminated: p.eliminated,
      });
    });
    this.setCurrent(current === "" ? null : current);

    // 장물 토큰 — 위치는 target만 갱신하고 실제 이동은 loop()에서 dt 보간(스냅 금지).
    const seenLoot = new Set<string>();
    state.weapons.forEach((w, key) => {
      seenLoot.add(key);
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
    for (const key of [...this.weapons.keys()]) {
      if (seenLoot.has(key)) continue;
      const lt = this.weapons.get(key);
      if (lt) disposeObject(lt.sprite);
      this.weapons.delete(key);
    }

    // 고정 NPC(계략)
    const seenHelpers = new Set<string>();
    state.helpers.forEach((h, key) => {
      seenHelpers.add(key);
      let g = this.helpers.get(key);
      if (!g) {
        g = new THREE.Group();
        const disc = new THREE.Mesh(
          UNIT_CIRCLE,
          // helper 감광도 disc를 포함해야 하므로 transparent를 켜둔다.
          new THREE.MeshStandardMaterial({ color: BOARD.helperDisc, transparent: true }),
        );
        disc.scale.set(0.42, 0.42, 1);
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
    for (const key of [...this.helpers.keys()]) {
      if (seenHelpers.has(key)) continue;
      const g = this.helpers.get(key);
      if (g) disposeObject(g);
      this.helpers.delete(key);
    }

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
      if (!seen.has(id)) this.removeActor(id);
    }
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
  /** `say` 라우팅의 기존 진입점. 계약 메서드로 넘긴다(이름 호환 유지). */
  showBubble(id: string, text: string): void {
    this.bubble(id, text);
  }

  bubble(id: string, text: string, opts: BubbleOpts = {}): void {
    const prev = this.bubbles.get(id);
    if (prev) {
      window.clearInterval(prev.typeTimer);
      window.clearTimeout(prev.holdTimer);
      prev.el.remove();
      this.bubbles.delete(id);
    }
    // 귓속말은 공개 대사와 반드시 구분된다(계약 §2) — 접두 + 파선 테두리.
    const body = opts.whisper ? `(귓속말) ${text}` : text;
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute; transform:translate(-50%,-100%); max-width:260px;" +
      `background:${hexString(BOARD.bubbleBg)}; color:${hexString(BOARD.bubbleText)};` +
      "padding:4px 8px; border-radius:8px;" +
      "font-size:15px; line-height:1.35; text-align:center; white-space:pre-wrap;" +
      "box-shadow:0 2px 8px #0008;" +
      (opts.whisper ? `border:2px dashed ${hexString(BOARD.gold)};` : "");
    this.bubbleLayer.appendChild(el);
    const b: Bubble = {
      el,
      id,
      full: body,
      shown: 0,
      typeTimer: 0,
      holdTimer: 0,
    };
    // 총 수명은 shared `bubbleLifeMs`가 계산한다(서버 SPEAK_HOLD와 정합을 맞추는 지점).
    const total = bubbleLifeMs(body, this.timing);
    const typeMs = this.timing.TYPE_MS;
    const expire = (): void => {
      el.remove();
      this.bubbles.delete(id);
    };
    if (typeMs <= 0) {
      // reduced 프로파일: 타자기 없이 전문을 즉시 띄운다.
      el.textContent = body;
      b.shown = body.length;
      b.holdTimer = window.setTimeout(expire, total);
    } else {
      b.typeTimer = window.setInterval(() => {
        b.shown += 1;
        el.textContent = body.slice(0, b.shown);
        if (b.shown >= body.length) {
          window.clearInterval(b.typeTimer);
          b.holdTimer = window.setTimeout(
            expire,
            Math.max(0, total - body.length * typeMs),
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

  // ── 계약: 식별·파생 정보·종료 ────────────────────────────
  /**
   * 뷰3(에셋)에서는 **실제 프리로드**가 된다 — 아트가 캐시에 올라와 있으면 토큰 생성
   * 시점의 팝인이 사라진다. 뷰2(이모지)는 캔버스에서 즉시 파생되므로 할 일이 없다.
   */
  identity(suspect: string): void {
    if (!this.useAssets) return;
    loadTextureCached(
      this.loader,
      `/assets/char/${suspect}-face.svg`,
      () => undefined,
      () => undefined,
    );
  }

  /** "이미 살펴본 방" — 명패 ✓ + 바닥 30% 어둡게(§2 뷰2·3 칸). 진실값 아님. */
  setSurveyed(rooms: readonly string[]): void {
    this.surveyed = new Set(rooms);
    this.surveyMarks.forEach((mark, name) => {
      mark.visible = this.surveyed.has(name);
    });
    this.roomMats.forEach((_m, name) => this.applyRoomTint(name));
  }

  /**
   * 비밀 통로 — 낮은 아치 + 파선(§2 뷰2·3 칸).
   * 파선은 **공유 단위 평면 메시의 반복**으로 그린다 — 여기서 BufferGeometry를
   * 새로 만들면 `setPassages` 호출마다 GPU에 쌓인다(§9.3).
   */
  setPassages(links: readonly PassageLink[]): void {
    if (this.passageGroup) {
      disposeObject(this.passageGroup);
      this.passageGroup = undefined;
    }
    this.passageMat = undefined;
    this.passageSegs = [];
    if (links.length === 0) return;
    const group = new THREE.Group();
    // 기본은 거의 안 보인다 — 보드를 가로지르는 선이라 항상 선명하면 판을 읽는 것을 방해한다.
    const dashMat = new THREE.MeshBasicMaterial({
      color: BOARD.gold,
      transparent: true,
      opacity: PASSAGE_ALPHA_IDLE,
      depthWrite: false,
    });
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    const archMat = new THREE.MeshStandardMaterial({ color: BOARD.wood });
    for (const l of links) {
      const a = regionOf(l.from);
      const b = regionOf(l.to);
      if (!a || !b) continue;
      const ax = worldX(a.x) + (a.w - 1) / 2;
      const az = worldZ(a.y) + (a.h - 1) / 2;
      const bx = worldX(b.x) + (b.w - 1) / 2;
      const bz = worldZ(b.y) + (b.h - 1) / 2;
      segs.push([
        new THREE.Vector3(ax, 0.03, az),
        new THREE.Vector3(bx, 0.03, bz),
      ]);
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(2, Math.floor(len / 1.2));
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const dash = new THREE.Mesh(UNIT_PLANE, dashMat);
        dash.scale.set(0.5, 0.16, 1);
        dash.rotation.x = -Math.PI / 2;
        dash.rotation.z = -Math.atan2(bz - az, bx - ax);
        dash.position.set(ax + (bx - ax) * k, 0.03, az + (bz - az) * k);
        group.add(dash);
      }
      // 양 끝에 낮은 아치(상인방) — "여기로 빠져나갈 수 있다"는 정적 표기.
      for (const [px, pz] of [
        [ax, az],
        [bx, bz],
      ] as const) {
        const lintel = new THREE.Mesh(UNIT_BOX, archMat);
        lintel.scale.set(0.9, 0.12, 0.14);
        lintel.position.set(px, 0.62, pz);
        group.add(lintel);
      }
    }
    this.scene.add(group);
    this.passageGroup = group;
    this.passageMat = dashMat;
    this.passageSegs = segs;
  }

  /**
   * 커서가 통로 선 근처면 드러내고 아니면 다시 잠근다(뷰1·4와 같은 규칙).
   * 42° 피치라 월드 거리로는 화면 거리를 알 수 없어 **양 끝점을 화면에 투영해** 잰다.
   */
  private updatePassageHover(dtMs: number): void {
    const mat = this.passageMat;
    if (!mat || this.passageSegs.length === 0) return;
    let near = false;
    const p = this.hoverPx;
    if (p) {
      const r = this.canvas.getBoundingClientRect();
      const toPx = (v: THREE.Vector3): [number, number] => {
        const c = v.clone().project(this.camera);
        return [
          r.left + ((c.x + 1) / 2) * r.width,
          r.top + ((1 - c.y) / 2) * r.height,
        ];
      };
      near = this.passageSegs.some(([a, b]) => {
        const [ax, ay] = toPx(a);
        const [bx, by] = toPx(b);
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const t =
          l2 === 0
            ? 0
            : Math.max(
                0,
                Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2),
              );
        return (
          Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)) <
          PASSAGE_HOVER_PX
        );
      });
    }
    const want = near ? PASSAGE_ALPHA_HOVER : PASSAGE_ALPHA_IDLE;
    // 툭 켜지면 그것대로 시선을 뺏는다 — dt 지수 보간으로 부드럽게.
    mat.opacity += (want - mat.opacity) * expK(dtMs, PASSAGE_FADE_MS);
  }

  /** 승리 — `PointLight` + 팬(§5 행 22). `null`이면 연출 해제. */
  setOutcome(o: ViewOutcome | null): void {
    if (this.outcomeLight) {
      this.scene.remove(this.outcomeLight);
      this.outcomeLight.dispose();
      this.outcomeLight = undefined;
    }
    if (!o) return;
    const t = this.tokens.get(o.winnerId);
    if (!t) return;
    const light = new THREE.PointLight(BOARD.gold, 24, 12, 2);
    light.position.set(worldX(t.cur.x), 2.4, worldZ(t.cur.y));
    this.scene.add(light);
    this.outcomeLight = light;
    // 승자에게 카메라를 준다(팬).
    this.focusPoint = new THREE.Vector3(worldX(t.cur.x), 0, worldZ(t.cur.y));
    this.focusUntil = performance.now() + 4000;
  }

  // ── 계약: 자원 해제(§9.3) ────────────────────────────────
  /**
   * 뷰를 영구히 버릴 때만 호출한다. `setActive(false)`와 다르다 —
   * 여기서는 WebGL 컨텍스트까지 놓는다.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.setActive(false);
    this.clearBubbles();
    this.clearFx();
    window.clearTimeout(this.switchTimer);
    window.removeEventListener("pagehide", this.onPageHide);
    this.tokens.clear();
    this.weapons.clear();
    this.helpers.clear();
    this.roomMats.clear();
    this.roomBase.clear();
    this.surveyMarks.clear();
    this.passageGroup = undefined;
    this.outcomeLight = undefined;
    this.feastMat = undefined;
    disposeScene(this.scene);
    this.renderer.dispose();
    // 컨텍스트를 명시적으로 놓지 않으면 브라우저가 "가장 오래된 것"을 임의로
    // 회수하다가 다른 뷰를 검게 만든다(§9.5).
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.bubbleLayer.remove();
    const w = window as unknown as { __zcIso?: IsoView };
    if (w.__zcIso === this) delete w.__zcIso;
  }

  /**
   * 회귀 게이트(§9.6) 측정 훅. 콘솔에서 `__zcIso.debugInfo()`로 읽는다.
   * 뷰1→2→3→4→1 10회 순회 전후의 `geometries`·`textures`가 ±5 이내면 통과.
   */
  debugInfo(): {
    geometries: number;
    textures: number;
    programs: number;
    calls: number;
    triangles: number;
  } {
    const info = this.renderer.info;
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      calls: info.render.calls,
      triangles: info.render.triangles,
    };
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
    // 드래그 중이 아니어도 통로 호버 판정에 좌표가 필요하다.
    const r = this.canvas.getBoundingClientRect();
    this.hoverPx =
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom
        ? { x: e.clientX, y: e.clientY }
        : null;
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer.set(e.clientX, e.clientY);
    const k = this.camDist / 600;
    this.panOffset.x -= dx * k;
    this.panOffset.z -= dy * k;
    this.focusPoint = null; // 사용자가 화면을 잡으면 강제 포커스는 즉시 놓는다
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

/** 서버 상태의 플레이어 레코드(그대로 `ActorSnapshot`으로 옮겨진다). */
type ActorSnapshotSource = {
  name: string;
  suspect: string;
  isBot: boolean;
  x: number;
  y: number;
  eliminated: boolean;
};
