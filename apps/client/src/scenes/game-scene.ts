import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  BOARD,
  CELL_PX,
  ELIM_ALPHA,
  GRID_HEIGHT,
  GRID_WIDTH,
  RING_CURRENT,
  ROOM_REGIONS,
  SPENT_ALPHA,
  TOKEN_OUTLINE_COLOR,
  TOKEN_OUTLINE_PX,
  PASSAGE_ALPHA_HOVER,
  PASSAGE_ALPHA_IDLE,
  PASSAGE_FADE_MS,
  PASSAGE_HOVER_PX,
  SUMMON_ANCHOR_ALPHA,
  SUMMON_ANCHOR_ICON,
  BUBBLE_BORDER_PX,
  BUBBLE_SAFE_PAD_PX,
  bubbleLifeMs,
  fitZoom,
  doorOutward,
  doorSideOf,
  emoji,
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
} from "@zodiac-clue/shared";
import {
  acquireHudInset,
  clampToSafe,
  hudInset,
  releaseHudInset,
  safeWidth,
} from "./hud-inset";
import { currentTiming, cvdMode } from "./view-motion";
import { CVD_CELL, cvdCueDots } from "./pixel-glyphs";
import { markMovedOnce } from "./move-hint";
import {
  beginReveal,
  destroyReveal,
  finishReveal,
  paintReveal,
  type TypeReveal,
} from "./typewriter";
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

// 셀 크기 = 근접(줌 1.0) 기준 해상도. 크게 잡아 줌 1.0에서 선명하게 보이도록.
// 값의 단일 소스는 shared의 `CELL_PX` — 여기서는 호환용으로 재수출만 한다.
export const CELL = CELL_PX;
export const BOARD_W = GRID_WIDTH * CELL;
export const BOARD_H = GRID_HEIGHT * CELL;

// 카메라: 근접(1.0)이 기본·최대 근처, 축소(<1)로 전체 조망
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.25;
const INIT_ZOOM = 1.0;
const CAM_LERP = 0.12; // 내 캐릭터 추적(빠름)
const SLOW_LERP = 0.06; // NPC 턴 추적(천천히)
const PAN_STEP = 48;

/** 이름표 좌측 색 스트라이프 두께(px) — 색과 이름을 같은 픽셀에(§4.2). */
const NAME_STRIPE_PX = 3;

/**
 * 방 명패 안 "살펴봄" ✓ 스탬프 — **명패 내부 좌측**에 찍는다(§5 행 16).
 *
 * 🔴 왜 옮겼나: 예전 자리는 명패 **바깥 오른쪽**(`x + 10 + plW + 6`)이었는데,
 *    명패 폭 `plW = min(w-16, 글자수*20+24)`가 좁은 방에서는 그 좌표가 **입구 타일과
 *    겹친다.** 입구는 명패보다 뒤에 그려지므로 ✓가 문 뒤로 사라졌다 —
 *    행랑채(문 (11,18))는 ✓가 문 정중앙(460,745)에 찍혀 완전히 가려졌고,
 *    안방(3,18)·별당(20,20)도 문 타일에 절반 이상 먹혔다. 나머지 6방은 우연히 보였다.
 *    즉 "같은 정보가 방마다 보이기도 하고 안 보이기도" 하던 상태다.
 *
 * 새 자리는 명패 안쪽이라 **폭·문 위치와 무관하게 항상 명패 배경 위**에 있다.
 * 명패의 좌우 여백은 `(plW - 글자폭)/2 ≈ 글자수 + 12 px`(≥14)이므로 13px ✓(글리프 ≈11px)가
 * 이름과 겹치지 않는다 — 명패를 넓히지 않는 것이 조건이었다(넓히면 이번엔 이름이 문 밑으로 간다).
 * 읽는 순서도 뷰2·3(명패 **좌측** ✓)과 같아진다.
 */
const SURVEY_CHECK_INSET_PX = 3;
const SURVEY_CHECK_FONT_PX = 13;

/** `pulseCell`의 의미 → 뷰1 팔레트 번역(색이 아니라 의미를 받는다). */
const TONE_COLOR: Record<PulseTone, number> = {
  neutral: BOARD.plaqueText,
  suggest: BOARD.gold,
  alert: 0xff6b5e,
};

const cellCenter = (c: ViewCell): { x: number; y: number } => ({
  x: c.x * CELL + CELL / 2,
  y: c.y * CELL + CELL / 2,
});

/**
 * 파선 사각형 — 탈락 2차 표기(§1.2 `ELIM_NEEDS_SECOND_CUE`)와 귓속말 테두리에 공용.
 * 알파만으로는 저대비·회색조에서 탈락이 사라진다.
 */
const drawDashedRect = (
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  dash = 4,
  gap = 3,
): void => {
  const seg = (x1: number, y1: number, x2: number, y2: number): void => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(d + dash, len);
      g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
    }
  };
  seg(x, y, x + w, y);
  seg(x + w, y, x + w, y + h);
  seg(x + w, y + h, x, y + h);
  seg(x, y + h, x, y);
};

/** 두 점 사이 파선(비밀 통로 표기). */
const drawDashedLine = (
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash = 10,
  gap = 8,
): void => {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len === 0) return;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(d + dash, len);
    g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
  }
};

type Token = {
  c: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Arc;
  disc: Phaser.GameObjects.Arc;
  face: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  /** 이름표 좌측 색 스트라이프 — 색과 이름을 같은 픽셀에. */
  stripe: Phaser.GameObjects.Rectangle;
  /** 탈락 파선 테두리(2차 표기). */
  elimDash: Phaser.GameObjects.Graphics;
  /** 색·이모지의 파생 키(§4). `identity()`가 이 키로 표기를 되맞춘다. */
  suspect: string;
  placed: boolean;
  eliminated: boolean;
};

/** 말풍선 1건이 소유한 오브젝트·타이머 전부. 정리 경로를 한 곳으로 모은다. */
type BubbleRec = {
  txt: Phaser.GameObjects.Text;
  /** 배경 분리 테두리 + (귓속말이면) 파선 테두리. 공개/귓속말 모두 존재한다. */
  deco?: Phaser.GameObjects.Graphics;
  /** 귓속말 여부 — 테두리 문법을 가른다(계약 §2). */
  whisper?: boolean;
  /** 타자기 마스크(§9.3 — `setText` 재업로드 금지). */
  reveal?: TypeReveal;
  tick?: Phaser.Time.TimerEvent;
  hold?: Phaser.Time.TimerEvent;
};

type PlayerView = {
  name: string;
  suspect: string;
  isBot: boolean;
  x: number;
  y: number;
  eliminated: boolean;
};

/** 점 → 선분 최단거리. 통로 선 근접 판정에만 쓴다. */
const distToSeg = (
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export class GameScene extends Phaser.Scene implements ViewContract {
  /** 뷰1 = 2D 이모지. */
  readonly viewId: ViewId = "2d-emoji";
  /**
   * Phaser 게임 인스턴스 1개 = WebGL 컨텍스트 1개. 뷰1과 뷰4가 **그 하나를 공유**하므로
   * 두 stage가 같은 비용 1을 나눠 갖는다(§9.5 — 인스턴스를 쪼개면 컨텍스트가 는다).
   */
  readonly contextCost = 1;

  private room!: Room;
  private tokens = new Map<string, Token>();
  private bubbles = new Map<string, BubbleRec>();
  private lastMove = 0;
  private cam!: Phaser.Cameras.Scene2D.Camera;
  private myId = "";
  private freeLook = false;
  private spaceHeld = false;
  private rightPan = false;
  private followId = "";
  private followTarget?: Phaser.GameObjects.Container;
  private camSwitchTimer?: Phaser.Time.TimerEvent;
  private weaponSprites = new Map<string, Phaser.GameObjects.Text>();
  private helperSprites = new Map<string, Phaser.GameObjects.Container>();
  private insetHeld = false;
  /** 지금 턴(계약 `setCurrent`). 진실값은 서버 상태이며 여기엔 사본만 둔다. */
  private currentId: string | null = null;
  /** 방 명패의 "살펴봄" ✓ 스탬프 — `setSurveyed`가 켠다. */
  private surveyMarks = new Map<string, Phaser.GameObjects.Text>();
  /** 방 강조 사각형(포커스/서베이 공용). */
  private roomRects = new Map<string, Phaser.Geom.Rectangle>();
  /** 비밀 통로 정적 표기 레이어. */
  private passageLayer?: Phaser.GameObjects.Container;
  /** 통로 선분(월드 좌표) — 커서 근접 판정용. 선분 3개뿐이라 매 프레임 재도 싸다. */
  private passageSegs: readonly [number, number, number, number][] = [];
  /** 승리 연출 오브젝트 — `setOutcome(null)`이 걷는다. */
  private outcomeFx: Phaser.GameObjects.GameObject[] = [];
  /** 감속 프로파일 타이밍(§1.3). 보간 길이는 매번 여기서 재조회한다. */
  private timing: ViewTiming = currentTiming();
  /** 색각 대체 표기(§4.3). 뷰4에만 있던 것을 4뷰 공통으로 맞춘다. */
  private cvd = false;

  constructor() {
    super("game");
  }

  create(): void {
    this.room = this.registry.get("room") as Room;
    this.myId = this.room.sessionId;
    this.cvd = cvdMode();
    // HUD 인셋 캐시 구독 — 씬이 내려갈 때 반드시 해제(ResizeObserver 누수 금지).
    this.holdInset();
    // 씬 종료·파괴에서 GPU 자원·타이머를 회수한다(§9.3 — dispose 0건이던 지점).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.dispose());
    this.drawBoard();

    // ── 카메라: 내 캐릭터 추적 탑뷰 ──
    // bounds는 매 프레임 `applyCamBounds()`가 **인셋·줌을 반영해** 다시 잡는다.
    // 고정 bounds를 여기서 한 번 거는 방식은 쓸 수 없다 — 우측 패널 인셋과 줌이
    // 런타임에 바뀌는데 bounds는 그 둘의 함수이기 때문이다(아래 주석 참조).
    const cam = this.cameras.main;
    // 초기 줌: 폰 세로처럼 짧은 변이 좁으면 «어디로 가야 하는지»가 안 보인다.
    // 넓은 화면에서는 `fitZoom`이 INIT_ZOOM을 그대로 돌려주므로 데스크톱은 불변이다.
    cam.setZoom(fitZoom(Math.min(cam.width, cam.height), INIT_ZOOM, MIN_ZOOM));
    cam.centerOn(BOARD_W / 2, BOARD_H / 2);
    this.cam = cam;
    this.applyCamBounds();

    this.room.onStateChange((state) => this.render(state));
    // 씬 생성 시점엔 상태가 이미 적용돼 있으므로 즉시 1회 렌더(입력 전 오브젝트 표시)
    this.render(this.room.state);

    // 휠 줌 (1.0=선명 근접, 축소하며 전체 조망)
    this.input.on(
      "wheel",
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        const z = Phaser.Math.Clamp(
          cam.zoom * (dy > 0 ? 0.9 : 1.1),
          MIN_ZOOM,
          MAX_ZOOM,
        );
        cam.setZoom(z);
      },
    );

    // 우클릭 메뉴 차단(우클릭 드래그 팬용)
    this.input.mouse?.disableContextMenu();

    // 드래그 팬: 자유시점(Space) 중 또는 우클릭 드래그
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.freeLook || !p.isDown) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    // 우클릭(또는 휠클릭) 누르는 동안 자유시점 팬
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown() || p.middleButtonDown()) {
        this.rightPan = true;
        this.applyFreeLook();
      }
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.rightPan && !p.rightButtonDown() && !p.middleButtonDown()) {
        this.rightPan = false;
        this.applyFreeLook();
      }
    });

    // 특수키(Space, hold) = 자유시점 토글
    this.input.keyboard?.on("keydown-SPACE", () => {
      this.spaceHeld = true;
      this.applyFreeLook();
    });
    this.input.keyboard?.on("keyup-SPACE", () => {
      this.spaceHeld = false;
      this.applyFreeLook();
    });

    // 이동 / (자유시점 중엔) 방향키 팬
    // e.code(물리키)로 처리 → 한글 IME(ㅈㅁㄴㅇ)·WASD·화살표 모두 동작.
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
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
        cam.scrollX += (dx * PAN_STEP) / cam.zoom;
        cam.scrollY += (dy * PAN_STEP) / cam.zoom;
        return;
      }
      // 정통 클루: 내 턴에만 이동. 이동 한도는 복도 이동만 제한
      // (방 안·잔치상 위에서는 한도 0이어도 자유 이동).
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
      // 방에 들어간 턴엔 못 나감: 방+스텝0이면 방 밖으로 나가는 이동 차단
      if (me && inRoom && steps <= 0) {
        const tx = me.x + dx;
        const ty = me.y + dy;
        if (roomAt(tx, ty) === null && !inFeast(tx, ty)) return;
      }
      const now = this.time.now;
      if (now - this.lastMove < this.timing.MOVE_COOLDOWN_MS) return;
      this.lastMove = now;
      this.room.send("move", { dx, dy });
      markMovedOnce(); // 키보드 첫 이동에도 발견용 패드 접기(다희 스펙 §3.3)
    });
  }

  /**
   * 보이는 영역 중앙에 대상이 오도록 하는 followOffset (월드 단위).
   * 인셋은 `hud-inset`이 ResizeObserver로 캐시한 값 — 여기서 측정하지 않는다(리플로우 0).
   */
  private insetOffset(): number {
    return -hudInset().right / 2 / this.cam.zoom;
  }

  /** 하단 시트 레이아웃일 때의 세로 보정. 우측 컬럼 레이아웃에서는 항상 0. */
  private insetOffsetY(): number {
    return -hudInset().bottom / 2 / this.cam.zoom;
  }

  /**
   * 카메라를 **보드 경계**로 묶는다 — 따라가는 말이 가장자리에 있어도 보드 밖 여백이
   * 화면을 채우지 않게(실측: 좌·상단 40%가 검은 여백).
   *
   * ⚠ 인셋과 충돌하지 않는 이유가 이 함수의 전부다.
   *   `insetOffset()`은 토큰을 **보이는 영역(우측 패널을 뺀 폭)의 중앙**에 두려고
   *   카메라를 오른쪽으로 `inset/2` 만큼 민다. 그런데 bounds를 보드에 딱 맞게 걸면
   *   그 이동이 오른쪽 경계에서 먼저 잘려 인셋 보정이 무효가 된다.
   *   그래서 bounds를 **오른쪽으로 정확히 `inset/zoom` 만큼 넓힌다** —
   *   Phaser의 clamp가 보장하는 것은 `worldView.right ≤ bounds.right`이고,
   *   `보이는 영역의 오른쪽 = worldView.right − inset/zoom`이므로 결과는
   *   **«보이는 영역이 보드를 벗어나지 않는다»**가 된다. 인셋 보정은 그 안에서 온전히 산다.
   *   (하단 시트 레이아웃의 bottom 인셋도 같은 방식.)
   *
   * 줌아웃해서 보드가 화면보다 작아지면 Phaser의 clamp는 한쪽 끝에 **달라붙는다**
   * (`bx > bw`가 되어 항상 `bw`로 떨어진다). 그때는 bounds를 화면 크기까지
   * 대칭으로 넓혀 «가운데»가 되게 한다.
   */
  private applyCamBounds(): void {
    const cam = this.cam;
    if (!cam) return;
    const z = cam.zoom || 1;
    const ins = hudInset();
    let bx = 0;
    let by = 0;
    let bw = BOARD_W + ins.right / z;
    let bh = BOARD_H + ins.bottom / z;
    const dw = cam.width / z;
    const dh = cam.height / z;
    if (bw < dw) {
      bx -= (dw - bw) / 2;
      bw = dw;
    }
    if (bh < dh) {
      by -= (dh - bh) / 2;
      bh = dh;
    }
    cam.setBounds(bx, by, bw, bh);
    // Phaser는 `preRender`에서 클램프하는데, 뷰4로 전환하면 뷰1은 **보이지 않아
    // preRender가 돌지 않는다**(그래도 update는 돈다). 뷰4가 이 카메라를 미러링하므로
    // 여기서 한 번 더 직접 클램프해 두 경로가 같은 값을 보게 한다.
    cam.scrollX = cam.clampX(cam.scrollX);
    cam.scrollY = cam.clampY(cam.scrollY);
  }

  /** 카메라 좌표계: 화면 px → 월드. `worldView`는 preRender 시점 값이라 직접 계산한다. */
  private viewOrigin(): { x: number; y: number; z: number } {
    const cam = this.cam;
    const z = cam.zoom || 1;
    return {
      x: cam.scrollX + (cam.width * (1 - 1 / z)) / 2,
      y: cam.scrollY + (cam.height * (1 - 1 / z)) / 2,
      z,
    };
  }

  /**
   * 말풍선 1건을 **화면 안 · HUD 비가림 영역**에 놓는다.
   *
   * ① 크기: 줌과 무관하게 같은 화면 크기로 읽히도록 `1/zoom`으로 역스케일한다.
   *    (폰 초기 줌 0.6에서 15px 글자가 9px이 되던 것 — LLM 대사는 그러면 증거가 못 된다.)
   *    안전 영역보다 넓어지면 그만큼 더 줄여 **잘리는 것보다 작아지는 쪽**을 택한다.
   * ② 위치: 화자 위가 원칙. 위로 안 들어가면 아래로 뒤집고, 그래도 남으면 클램프한다.
   */
  private placeBubble(rec: BubbleRec, ax: number, ay: number): void {
    const cam = this.cam;
    if (!cam) return;
    const { x: vx, y: vy, z } = this.viewOrigin();
    const txt = rec.txt;
    const pad = BUBBLE_SAFE_PAD_PX;
    const maxW = Math.max(1, safeWidth(cam.width) - pad * 2);
    const fit = Math.min(1, maxW / Math.max(1, txt.width));
    txt.setScale(fit / z);
    const w = txt.width * fit; // 화면 px
    const h = txt.height * fit;
    const asx = (ax - vx) * z;
    const asy = (ay - vy) * z;
    const above = asy - CELL * 0.95 * z - h;
    // 위로 못 들어가면 아래로 — 클램프만 하면 말풍선이 화자 얼굴을 덮어
    // "누가 말했는가"가 사라진다.
    const sy0 = above >= pad ? above : asy + CELL * 0.62 * z;
    const p = clampToSafe(asx - w / 2, sy0, w, h, pad, cam.width, cam.height);
    txt.setPosition(vx + (p.x + w / 2) / z, vy + (p.y + h) / z);
  }

  /** 매 프레임: 말풍선 위치 + HUD 패널 보정(줌·드래그에 실시간 반응). */
  update(): void {
    this.updatePassageHover();
    this.applyCamBounds();
    this.bubbles.forEach((b, id) => {
      const anchor = this.tokens.get(id)?.c ?? this.helperSprites.get(id);
      if (!anchor) return;
      this.placeBubble(b, anchor.x, anchor.y);
      this.layoutBubbleDeco(b);
      // 마스크는 월드 좌표라 말풍선이 움직이면 다시 칠해야 한다(텍스처 업로드는 없다).
      if (b.reveal) paintReveal(b.reveal);
    });
    if (this.cam) {
      this.cam.followOffset.x = this.insetOffset();
      this.cam.followOffset.y = this.insetOffsetY();
    }
  }

  // ── 계약: 표시/은닉 · 감속 프로파일 ───────────────────────
  /**
   * 뷰1은 씬을 계속 active로 두고 **표시만** 끈다 — 입력·카메라를 뷰4가 미러링하기
   * 때문이다(spec §2 표). 숨을 때 보이지 않는 말풍선 타이머는 정리한다.
   */
  setActive(on: boolean): void {
    this.sys.setVisible(on);
    if (!on) this.clearBubbles();
  }

  /** 감속 프로파일 전환(§1.3). 이후 보간 길이를 이 표에서 재조회한다. */
  setMotion(p: MotionProfile): void {
    this.timing = timingOf(p);
  }

  /** 인셋 캐시 참조 획득/해제 — 씬 종료 시 ResizeObserver가 남지 않도록. */
  private holdInset(): void {
    if (this.insetHeld) return;
    this.insetHeld = true;
    acquireHudInset();
  }

  private dropInset(): void {
    if (!this.insetHeld) return;
    this.insetHeld = false;
    releaseHudInset();
  }

  /** Space 또는 우클릭 팬 상태를 합쳐 자유시점 on/off. */
  private applyFreeLook(): void {
    this.setFreeLook(this.spaceHeld || this.rightPan);
  }

  /** 자유시점 on/off — off 시 현재 추적 대상으로 복귀. */
  private setFreeLook(on: boolean): void {
    if (this.freeLook === on) return;
    this.freeLook = on;
    if (on) {
      this.cam.stopFollow();
    } else if (this.followTarget) {
      const l = this.followId === this.myId ? CAM_LERP : SLOW_LERP;
      this.cam.startFollow(this.followTarget, true, l, l);
    }
  }

  // ── 보드 그리기 (복도 + 방 + 중앙 잔치상) ──
  private drawBoard(): void {
    this.add.rectangle(0, 0, BOARD_W, BOARD_H, BOARD.corridor).setOrigin(0);
    const grid = this.add.graphics();
    grid.lineStyle(1, BOARD.grid, 0.9);
    for (let x = 0; x <= GRID_WIDTH; x++) {
      grid.lineBetween(x * CELL, 0, x * CELL, BOARD_H);
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      grid.lineBetween(0, y * CELL, BOARD_W, y * CELL);
    }

    // 중앙 잔치상
    const fx = 9 * CELL;
    const fy = 9 * CELL;
    const fw = 6 * CELL;
    const fh = 6 * CELL;
    const feast = this.add.graphics();
    feast.fillStyle(BOARD.feast, 1);
    feast.fillRoundedRect(fx, fy, fw, fh, 16);
    feast.lineStyle(3, BOARD.feastEdge, 1);
    feast.strokeRoundedRect(fx, fy, fw, fh, 16);
    this.add
      .text(fx + fw / 2, fy + fh / 2 - 18, "🎁", {
        fontSize: "48px",
        padding: { x: 6, y: 12 },
      })
      .setOrigin(0.5);
    this.add
      .text(fx + fw / 2, fy + fh / 2 + 36, "잔치상", {
        fontSize: "22px",
        color: hexString(BOARD.feastText),
      })
      .setOrigin(0.5);

    // 방 (한지 바닥 + 테두리 + 명패)
    for (const r of ROOM_REGIONS) {
      const x = r.x * CELL;
      const y = r.y * CELL;
      const w = r.w * CELL;
      const h = r.h * CELL;
      this.roomRects.set(r.name, new Phaser.Geom.Rectangle(x, y, w, h));
      const g = this.add.graphics();
      g.fillStyle(BOARD.room, 1);
      g.fillRoundedRect(x, y, w, h, 12);
      g.lineStyle(3, BOARD.roomEdge, 1);
      g.strokeRoundedRect(x, y, w, h, 12);

      const name = label(r.name);
      const plW = Math.min(w - 16, name.length * 20 + 24);
      const plaque = this.add.graphics();
      plaque.fillStyle(BOARD.plaque, 0.92);
      plaque.fillRoundedRect(x + 10, y + 10, plW, 30, 7);
      this.add
        .text(x + 10 + plW / 2, y + 25, name, {
          fontSize: "18px",
          color: hexString(BOARD.plaqueText),
        })
        .setOrigin(0.5);
      // "이미 살펴본 방" ✓ 스탬프 — 명패 **내부 좌측**(사유는 `SURVEY_CHECK_*` 주석).
      // 기본 숨김, `setSurveyed`가 켠다(§5 행 16).
      const check = this.add
        .text(x + 10 + SURVEY_CHECK_INSET_PX, y + 25, "✓", {
          fontSize: `${SURVEY_CHECK_FONT_PX}px`,
          color: hexString(BOARD.gold),
        })
        .setOrigin(0, 0.5)
        .setVisible(false);
      this.surveyMarks.set(r.name, check);

      // ── 소환 앵커(§5 행 18) ──
      // 제안이 성립하면 지목된 인물이 **이 칸을 기준으로** 방 안에 선다.
      // ⚠ 좌표는 만들지 않는다 — `r.summon`은 서버 `freeCellIn()`이 자리 배정의 정렬
      //   기준으로 쓰는 바로 그 값(shared 단일 소스)이고, 뷰는 그 칸을 표시만 한다.
      // 겹침(같은 방에 여럿 소환)은 서버가 결정론적으로 푼다 — 앵커에서 가까운 순 +
      //   명패행·외곽 페널티 + 문 칸 제외. 클라가 다시 계산하면 서버와 갈라진다.
      const scx = r.summon.x * CELL + CELL / 2;
      const scy = r.summon.y * CELL + CELL / 2;
      const anchor = this.add.graphics().setAlpha(SUMMON_ANCHOR_ALPHA);
      anchor.lineStyle(2, BOARD.gold, 1);
      drawDashedRect(
        anchor,
        scx - CELL * 0.42,
        scy - CELL * 0.42,
        CELL * 0.84,
        CELL * 0.84,
        6,
        5,
      );
      this.add
        .text(scx, scy, SUMMON_ANCHOR_ICON, {
          fontSize: `${Math.floor(CELL * 0.34)}px`,
        })
        .setOrigin(0.5)
        .setAlpha(SUMMON_ANCHOR_ALPHA);

      // ── 입구(door) ──────────────────────────────────────────────
      // 예전에는 40px 칸 하나에 **밝은 타일 + 🚪 + "입구" 뱃지 3겹**을 쌓았다.
      // 벽은 닫힌 채라 문이 "벽에 난 구멍"으로 읽히지 않았고, 세 요소가 서로를 가렸다.
      // 이제 실제로 **벽을 끊고** 문지방·문설주로 그린다 — 라벨 없이도 읽히는 형태다.
      const side = doorSideOf(r);
      const out = doorOutward(side);
      const horiz = out.y !== 0; // 위/아래 벽이면 개구부가 가로로 열린다
      const dcx = r.door.x * CELL + CELL / 2;
      const dcy = r.door.y * CELL + CELL / 2;
      // 벽선 위의 개구부 중심(문 칸이 접한 방 경계)
      const wx = horiz ? dcx : (out.x < 0 ? r.x : r.x + r.w) * CELL;
      const wy = horiz ? (out.y < 0 ? r.y : r.y + r.h) * CELL : dcy;
      const half = CELL * 0.42;
      const doorG = this.add.graphics().setDepth(1);
      // ① 벽 끊기 — 방 테두리(3px)를 바닥색으로 덮어 개구부를 만든다.
      doorG.lineStyle(5, BOARD.room, 1);
      doorG.beginPath();
      if (horiz) {
        doorG.moveTo(wx - half, wy);
        doorG.lineTo(wx + half, wy);
      } else {
        doorG.moveTo(wx, wy - half);
        doorG.lineTo(wx, wy + half);
      }
      doorG.strokePath();
      // ② 문지방 — 개구부 안쪽에 낮게 깔린 금색 띠(칸 전체를 칠하지 않는다).
      const tw = horiz ? half * 2 : CELL * 0.22;
      const th = horiz ? CELL * 0.22 : half * 2;
      doorG.fillStyle(BOARD.gold, 0.5);
      doorG.fillRect(
        wx - tw / 2 - (horiz ? 0 : (out.x * CELL * 0.22) / 2),
        wy - th / 2 - (horiz ? (out.y * CELL * 0.22) / 2 : 0),
        tw,
        th,
      );
      // ③ 문설주 — 개구부 양 끝에 세운 짧은 기둥. 문틀로 읽히게 하는 핵심 요소.
      doorG.fillStyle(BOARD.wood, 1);
      for (const sgn of [-1, 1]) {
        const jw = horiz ? CELL * 0.12 : CELL * 0.3;
        const jh = horiz ? CELL * 0.3 : CELL * 0.12;
        doorG.fillRect(
          (horiz ? wx + sgn * half : wx) - jw / 2,
          (horiz ? wy : wy + sgn * half) - jh / 2,
          jw,
          jh,
        );
      }
      // ④ 🚪는 **복도 쪽 바깥**에 작게. 방 안에 두면 명패·✓·토큰과 자리를 다툰다.
      this.add
        .text(
          wx + out.x * CELL * 0.42,
          wy + out.y * CELL * 0.42,
          "🚪",
          { fontSize: `${Math.floor(CELL * 0.38)}px` },
        )
        .setOrigin(0.5)
        .setAlpha(0.9);
    }
  }

  // ── 말(플레이어/NPC) 렌더 ──
  private render(state: Room["state"]): void {
    const players = state.players as Map<string, PlayerView>;
    const current = (state.currentTurn as string) ?? "";
    const seen = new Set<string>();

    // 계약 경로로만 그린다 — 렌더 루프가 곧 `syncActor`의 호출부다.
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

    // ── 장물(훔친 것) 토큰 렌더 ──
    const weapons = state.weapons as Map<
      string,
      { value: string; x: number; y: number }
    >;
    const seenLoot = new Set<string>();
    weapons.forEach((w, key) => {
      seenLoot.add(key);
      const { x: cx, y: cy } = cellCenter({ x: w.x, y: w.y });
      let s = this.weaponSprites.get(key);
      if (!s) {
        s = this.add
          .text(cx, cy, emoji(w.value), {
            fontSize: `${Math.floor(CELL * 0.5)}px`,
          })
          .setOrigin(0.5)
          .setDepth(2);
        s.setStroke(hexString(BOARD.corridor), 4);
        // 클릭 → 이름 표시(요청 ③). 좌클릭만; 우/휠클릭은 팬이라 무시.
        s.setInteractive({ useHandCursor: true });
        s.on("pointerdown", (p: Phaser.Input.Pointer) => {
          if (p.leftButtonDown()) {
            window.dispatchEvent(
              new CustomEvent("zc-loot", { detail: w.value }),
            );
          }
        });
        this.weaponSprites.set(key, s);
      } else if (s.x !== cx || s.y !== cy) {
        this.tweens.killTweensOf(s);
        this.tweens.add({
          targets: s,
          x: cx,
          y: cy,
          duration: this.timing.LOOT_TWEEN_MS,
          ease: "Quad.Out",
        });
      }
    });
    // 서버에서 사라진 장물 회수(§9.3 — 남겨두면 텍스트 텍스처가 그대로 산다).
    for (const key of [...this.weaponSprites.keys()]) {
      if (seenLoot.has(key)) continue;
      this.tweens.killTweensOf(this.weaponSprites.get(key) as object);
      this.weaponSprites.get(key)?.destroy();
      this.weaponSprites.delete(key);
    }

    // ── 고정 NPC(계략) 렌더 ──
    const helpers = state.helpers as Map<
      string,
      { value: string; x: number; y: number; used: boolean }
    >;
    const seenHelpers = new Set<string>();
    helpers.forEach((h, key) => {
      seenHelpers.add(key);
      const { x: cx, y: cy } = cellCenter({ x: h.x, y: h.y });
      let c = this.helperSprites.get(key);
      if (!c) {
        const disc = this.add
          .circle(0, 0, CELL * 0.42, BOARD.helperDisc)
          .setStrokeStyle(TOKEN_OUTLINE_PX, BOARD.helperEdge);
        const face = this.add
          .text(0, 0, emoji(h.value), {
            fontSize: `${Math.floor(CELL * 0.5)}px`,
          })
          .setOrigin(0.5);
        const mark = this.add
          .text(CELL * 0.3, -CELL * 0.3, "🃏", { fontSize: "15px" })
          .setOrigin(0.5);
        const tag = this.add
          .text(0, CELL * 0.52, "계략", {
            fontSize: "10px",
            color: hexString(BOARD.helperTag),
            backgroundColor: "#000000aa",
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5, 0);
        c = this.add.container(cx, cy, [disc, face, mark, tag]).setDepth(1);
        this.helperSprites.set(key, c);
      }
      c.setAlpha(h.used ? SPENT_ALPHA : 1);
    });
    for (const key of [...this.helperSprites.keys()]) {
      if (seenHelpers.has(key)) continue;
      this.helperSprites.get(key)?.destroy();
      this.helperSprites.delete(key);
    }

    // 카메라: 현재 턴 캐릭터로 이동. 전환은 잠깐 지연(반증 먼저 인지 → 덜 어지러움).
    const followId = current && this.tokens.has(current) ? current : this.myId;
    if (followId !== this.followId) {
      this.followId = followId;
      const t = this.tokens.get(followId)?.c;
      this.followTarget = t;
      this.camSwitchTimer?.remove();
      if (!this.freeLook && t) {
        const isMe = followId === this.myId;
        const l = isMe ? CAM_LERP : SLOW_LERP;
        this.camSwitchTimer = this.time.delayedCall(
          isMe
            ? this.timing.CAM_SWITCH_SELF_MS
            : this.timing.CAM_SWITCH_OTHER_MS,
          () => {
            if (this.followId !== followId || this.freeLook) return;
            this.cam.stopFollow();
            this.cam.pan(
              t.x - this.insetOffset(),
              t.y - this.insetOffsetY(),
              isMe
                ? this.timing.CAM_PAN_SELF_MS
                : this.timing.CAM_PAN_OTHER_MS,
              "Sine.easeInOut",
              true,
              (_c, prog) => {
                if (prog === 1 && this.followId === followId && !this.freeLook) {
                  this.cam.startFollow(t, true, l, l);
                }
              },
            );
          },
        );
      }
    }

    for (const id of [...this.tokens.keys()]) {
      if (!seen.has(id)) this.removeActor(id);
    }
  }

  // ── 계약: 액터 ───────────────────────────────────────────
  /** 액터 1명의 현재 상태 반영. 없으면 만든다. */
  syncActor(a: ActorSnapshot): void {
    const token = this.tokens.get(a.id) ?? this.createToken(a.id, a);
    const { x: cx, y: cy } = cellCenter(a.cell);

    if (!token.placed) {
      token.c.setPosition(cx, cy);
      token.placed = true;
    } else if (token.c.x !== cx || token.c.y !== cy) {
      this.tweens.killTweensOf(token.c);
      this.tweens.add({
        targets: token.c,
        x: cx,
        y: cy,
        duration: this.timing.MOVE_TWEEN_MS,
        ease: "Quad.Out",
      });
    }
    this.setElim(a.id, a.eliminated);
  }

  /** 퇴장 — 말풍선·타이머·트윈까지 뷰가 정리한다(계약 §2). */
  removeActor(id: string): void {
    const t = this.tokens.get(id);
    if (t) {
      this.tweens.killTweensOf(t.c);
      t.c.destroy();
      this.tokens.delete(id);
    }
    this.dropBubble(id);
    if (this.currentId === id) this.currentId = null;
  }

  /** 지금 턴 — ring Arc + disc stroke(§5 행 1). */
  setCurrent(id: string | null): void {
    this.currentId = id;
    this.tokens.forEach((t, tid) => {
      const isCurrent = tid === id;
      t.ring.setVisible(isCurrent);
      t.disc.setStrokeStyle(
        TOKEN_OUTLINE_PX,
        isCurrent ? RING_CURRENT : TOKEN_OUTLINE_COLOR,
      );
    });
  }

  /**
   * 탈락 — 감쇠는 ring을 포함한 **토큰 전체**에(뷰2·3·4와 같은 정보 강도) +
   * 이름표 파선(2차 표기). 파선은 감쇠 대상이 아니다.
   */
  setElim(id: string, on: boolean): void {
    const t = this.tokens.get(id);
    if (!t) return;
    t.eliminated = on;
    const alpha = on ? ELIM_ALPHA : 1;
    t.ring.setAlpha(alpha);
    t.disc.setAlpha(alpha);
    t.face.setAlpha(alpha);
    t.name.setAlpha(alpha);
    t.stripe.setAlpha(alpha);
    t.elimDash.setVisible(on);
  }

  // ── 계약: 순간이동 ───────────────────────────────────────
  /**
   * 소환·비밀 통로 — Arc 잔상 3겹 + 금색 펄스(spec §2 뷰1 칸).
   * 일반 이동(tween 110ms)과 **눈으로 구분**되는 것이 이 메서드의 존재 이유다.
   */
  warp(id: string, from: ViewCell, to: ViewCell, reason: WarpReason): void {
    const a = cellCenter(from);
    const b = cellCenter(to);
    const ms = this.timing.WARP_MS;
    const tint = reason === "summon" ? BOARD.gold : BOARD.wood;
    const token = this.tokens.get(id);
    if (token) {
      // 워프는 걷는 것이 아니다 — 진행 중이던 이동 보간을 끊고 목적지에 둔다.
      this.tweens.killTweensOf(token.c);
      token.c.setPosition(b.x, b.y);
      token.placed = true;
    }
    if (ms <= 0) return; // reduced: 잔상 없이 배너로만 알린다(§1.3)
    for (let k = 0; k < 3; k++) {
      const t = (k + 1) / 4;
      const ghost = this.add
        .circle(
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          CELL * 0.5,
          0x000000,
          0,
        )
        .setStrokeStyle(3, tint)
        .setDepth(3)
        .setAlpha(0.9);
      this.tweens.add({
        targets: ghost,
        alpha: 0,
        scale: 0.6,
        duration: ms,
        delay: k * (ms / 6),
        onComplete: () => ghost.destroy(),
      });
    }
    const pulse = this.add
      .circle(b.x, b.y, CELL * 0.55, 0x000000, 0)
      .setStrokeStyle(4, BOARD.gold)
      .setDepth(3);
    this.tweens.add({
      targets: pulse,
      alpha: 0,
      scale: 1.8,
      duration: ms,
      onComplete: () => pulse.destroy(),
    });
  }

  /** 장물 순간이동 — Text tween(spec §2 뷰1 칸). */
  lootWarp(value: string, from: ViewCell, to: ViewCell): void {
    const a = cellCenter(from);
    const b = cellCenter(to);
    const ms = this.timing.WARP_MS;
    const ghost = this.add
      .text(a.x, a.y, emoji(value), { fontSize: `${Math.floor(CELL * 0.5)}px` })
      .setOrigin(0.5)
      .setDepth(3);
    ghost.setStroke(hexString(BOARD.gold), 4);
    if (ms <= 0) {
      ghost.destroy();
      return;
    }
    this.tweens.add({
      targets: ghost,
      x: b.x,
      y: b.y,
      duration: ms,
      ease: "Quad.InOut",
      onComplete: () => ghost.destroy(),
    });
  }

  // ── 계약: 무대·칸 주목 ───────────────────────────────────
  /** 사건의 무대 — `cam.pan` 또는 방 스트로크 펄스(spec §2 뷰1 칸). */
  focusRoom(room: string, mode: FocusMode): void {
    const rect = this.roomRects.get(room);
    const r = regionOf(room);
    if (!rect || !r) return;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    if (mode === "camera" && !this.freeLook) {
      this.cam.stopFollow();
      this.cam.pan(
        cx - this.insetOffset(),
        cy - this.insetOffsetY(),
        Math.max(1, this.timing.CAM_PAN_OTHER_MS),
        "Sine.easeInOut",
        true,
      );
    }
    const g = this.add.graphics().setDepth(3);
    g.lineStyle(5, BOARD.gold, 1);
    g.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration: Math.max(1, this.timing.WARP_BANNER_MS),
      onComplete: () => g.destroy(),
    });
  }

  /** 특정 칸 주목 — Rectangle 알파 펄스(spec §2 뷰1 칸). */
  pulseCell(cell: ViewCell, tone: PulseTone): void {
    const { x, y } = cellCenter(cell);
    const rect = this.add
      .rectangle(x, y, CELL * 0.94, CELL * 0.94, TONE_COLOR[tone], 0.45)
      .setDepth(3);
    this.tweens.add({
      targets: rect,
      alpha: 0,
      duration: Math.max(1, this.timing.WARP_BANNER_MS / 2),
      onComplete: () => rect.destroy(),
    });
  }

  // ── 계약: 대사 ───────────────────────────────────────────
  /** `say` 라우팅의 기존 진입점. 계약 메서드로 넘긴다(이름 호환 유지). */
  showBubble(id: string, text: string): void {
    this.bubble(id, text);
  }

  /**
   * NPC 대사 말풍선. 타자기는 **텍스트를 1회만 그리고 마스크로** 드러낸다
   * (§9.3 — 55ms마다 `setText`는 캔버스 재렌더 + 텍스처 재업로드였다).
   */
  bubble(id: string, text: string, opts: BubbleOpts = {}): void {
    // 플레이어 토큰 또는 고정 NPC(계략) 스프라이트 위에 말풍선을 띄운다.
    const anchor = this.tokens.get(id)?.c ?? this.helperSprites.get(id);
    if (!anchor) return;
    this.dropBubble(id); // 이전 말풍선/타이머/마스크 정리

    // 귓속말은 공개 대사와 반드시 구분된다(계약 §2) — 접두 + 파선 테두리.
    const body = opts.whisper ? `(귓속말) ${text}` : text;
    const txt = this.add
      .text(anchor.x, anchor.y - CELL * 0.95, "", {
        fontSize: "15px",
        color: hexString(BOARD.bubbleText),
        backgroundColor: hexString(BOARD.bubbleBg),
        padding: { x: 8, y: 4 },
        align: "center",
        wordWrap: { width: 260 },
      })
      .setOrigin(0.5, 1)
      .setDepth(100);
    // 테두리는 **항상** 그린다 — 말풍선 바탕과 방바닥의 대비가 1.55:1뿐이라
    // 선이 없으면 밝은 방 위에서 말풍선 경계가 녹는다(§1.6 `BOARD.bubbleEdge`).
    const rec: BubbleRec = { txt, deco: this.add.graphics().setDepth(101) };
    rec.whisper = opts.whisper === true;
    this.bubbles.set(id, rec);

    // 총 수명은 shared `bubbleLifeMs`가 계산한다(서버 SPEAK_HOLD와 정합을 맞추는 지점).
    const total = bubbleLifeMs(body, this.timing);
    const typeMs = this.timing.TYPE_MS;
    const expire = (): void => {
      if (this.bubbles.get(id) === rec) this.dropBubble(id);
    };

    const reveal = beginReveal(this, txt, body);
    rec.reveal = reveal;
    // 첫 프레임부터 안전 영역 안에 있어야 한다 — `update()`를 기다리면 한 프레임
    // 화면 밖에 그려진다(타자기 첫 글자가 잘리는 자리다).
    this.placeBubble(rec, anchor.x, anchor.y);
    paintReveal(reveal);
    this.layoutBubbleDeco(rec);

    // reduced 프로파일(TYPE_MS=0)은 타자기 없이 전문을 즉시 띄운다.
    if (typeMs <= 0) {
      finishReveal(reveal);
      rec.hold = this.time.delayedCall(total, expire);
      return;
    }

    rec.tick = this.time.addEvent({
      delay: typeMs,
      loop: true,
      callback: () => {
        if (this.bubbles.get(id) !== rec) {
          rec.tick?.remove();
          return;
        }
        reveal.shown += 1;
        paintReveal(reveal);
        if (reveal.shown >= reveal.total) {
          rec.tick?.remove();
          rec.tick = undefined;
          rec.hold = this.time.delayedCall(
            Math.max(0, total - reveal.total * typeMs),
            expire,
          );
        }
      },
    });
  }

  /**
   * 말풍선 테두리를 위치·스케일에 맞춘다.
   * - 공개 대사: 먹빛 실선 1겹(배경 분리 — 비텍스트 대비 §1.6).
   * - 귓속말: 그 위에 금색 파선 1겹(공개 대사와 구분 — 계약 §2). 두 겹이라
   *   "귓속말인가"와 "말풍선인가"가 서로를 지우지 않는다.
   * 선 두께는 월드가 아니라 **화면** 기준이어야 줌아웃에서 사라지지 않는다.
   */
  private layoutBubbleDeco(rec: BubbleRec): void {
    const g = rec.deco;
    if (!g) return;
    const tl = rec.txt.getTopLeft();
    const w = rec.txt.displayWidth;
    const h = rec.txt.displayHeight;
    const z = this.cam?.zoom || 1;
    const lw = BUBBLE_BORDER_PX / z;
    g.clear();
    g.lineStyle(lw, BOARD.bubbleEdge, 1);
    g.strokeRect(tl.x - lw / 2, tl.y - lw / 2, w + lw, h + lw);
    if (!rec.whisper) return;
    g.lineStyle(lw, BOARD.gold, 0.95);
    drawDashedRect(
      g,
      tl.x - lw * 2,
      tl.y - lw * 2,
      w + lw * 4,
      h + lw * 4,
      lw * 2,
      lw * 1.5,
    );
  }

  /** 말풍선 1건이 소유한 오브젝트·타이머·마스크를 전부 회수한다. */
  private dropBubble(id: string): void {
    const rec = this.bubbles.get(id);
    if (!rec) return;
    rec.tick?.remove();
    rec.hold?.remove();
    if (rec.reveal) destroyReveal(rec.reveal);
    rec.deco?.destroy();
    rec.txt.destroy();
    this.bubbles.delete(id);
  }

  private clearBubbles(): void {
    for (const id of [...this.bubbles.keys()]) this.dropBubble(id);
  }

  // ── 계약: 식별·파생 정보·종료 ────────────────────────────
  /**
   * 뷰1의 식별 표기는 **이모지 + 색 원 + 이름표 스트라이프**이고 셋 다 `suspect`에서
   * 동기적으로 파생된다 — 미리 받아둘 에셋이 없다(뷰3만 프리로드가 의미 있다).
   * 그래서 여기서는 이미 살아 있는 토큰의 표기를 그 키로 **되맞추는** 것으로 이행한다
   * (팔레트가 바뀌어도 화면과 계약이 갈라지지 않는다).
   */
  identity(suspect: string): void {
    const color = zodiacColor(suspect);
    this.tokens.forEach((t) => {
      if (t.suspect !== suspect) return;
      t.face.setText(emoji(suspect));
      t.disc.setFillStyle(color);
      t.stripe.setFillStyle(color);
    });
  }

  /** "이미 살펴본 방" — 명패에 ✓ 스탬프(§5 행 16). 진실값 아님(클라 파생). */
  setSurveyed(rooms: readonly string[]): void {
    const set = new Set(rooms);
    this.surveyMarks.forEach((mark, name) => mark.setVisible(set.has(name)));
  }

  /** 비밀 통로 — 방 중심을 잇는 대각 점선 + 🚪 미니(§5 행 7). */
  setPassages(links: readonly PassageLink[]): void {
    this.passageLayer?.destroy(true);
    this.passageLayer = undefined;
    this.passageSegs = [];
    if (links.length === 0) return;
    const layer = this.add.container(0, 0).setDepth(1);
    layer.setAlpha(PASSAGE_ALPHA_IDLE);
    const g = this.add.graphics();
    g.lineStyle(3, BOARD.gold, 0.5);
    layer.add(g);
    const segs: [number, number, number, number][] = [];
    for (const l of links) {
      const a = this.roomRects.get(l.from);
      const b = this.roomRects.get(l.to);
      if (!a || !b) continue;
      const ax = a.x + a.width / 2;
      const ay = a.y + a.height / 2;
      const bx = b.x + b.width / 2;
      const by = b.y + b.height / 2;
      drawDashedLine(g, ax, ay, bx, by);
      segs.push([ax, ay, bx, by]);
      for (const [px, py] of [
        [ax, ay],
        [bx, by],
      ] as const) {
        layer.add(
          this.add.text(px, py, "🚪", { fontSize: "16px" }).setOrigin(0.5),
        );
      }
    }
    this.passageLayer = layer;
    this.passageSegs = segs;
  }

  /**
   * 커서가 통로 선 근처면 드러내고 아니면 다시 잠근다.
   * 임계는 화면 px 기준이라 줌으로 나눠 월드 거리로 바꾼다 — 안 그러면 축소했을 때
   * 화면상 멀리 있는 선이 켜진다.
   */
  private updatePassageHover(): void {
    const layer = this.passageLayer;
    if (!layer || this.passageSegs.length === 0) return;
    const p = this.input.activePointer;
    const near = p.active
      ? this.passageSegs.some(
          ([ax, ay, bx, by]) =>
            distToSeg(p.worldX, p.worldY, ax, ay, bx, by) <
            PASSAGE_HOVER_PX / this.cam.zoom,
        )
      : false;
    const want = near ? PASSAGE_ALPHA_HOVER : PASSAGE_ALPHA_IDLE;
    if (Math.abs(layer.alpha - want) < 0.01) return;
    this.tweens.killTweensOf(layer);
    this.tweens.add({
      targets: layer,
      alpha: want,
      duration: PASSAGE_FADE_MS,
    });
  }

  /** 승리 — 승자 토큰에 금색 링 확산(§5 행 22). `null`이면 연출 해제. */
  setOutcome(o: ViewOutcome | null): void {
    for (const fx of this.outcomeFx) {
      this.tweens.killTweensOf(fx);
      fx.destroy();
    }
    this.outcomeFx = [];
    if (!o) return;
    const t = this.tokens.get(o.winnerId);
    if (!t) return;
    for (let k = 0; k < 3; k++) {
      const ring = this.add
        .circle(t.c.x, t.c.y, CELL * 0.6, 0x000000, 0)
        .setStrokeStyle(4, BOARD.gold)
        .setDepth(50);
      this.outcomeFx.push(ring);
      this.tweens.add({
        targets: ring,
        scale: 3,
        alpha: 0,
        duration: 1400,
        delay: k * 320,
        repeat: -1,
      });
    }
  }

  // ── 계약: 자원 해제(§9.3) ────────────────────────────────
  /**
   * 씬 종료·파괴에서 호출된다. Phaser는 씬 파괴 시 표시 목록을 정리하지만
   * **타이머·트윈·ResizeObserver 참조**는 우리가 건 것이라 우리가 회수한다.
   */
  dispose(): void {
    this.clearBubbles();
    this.camSwitchTimer?.remove();
    this.camSwitchTimer = undefined;
    this.tokens.forEach((t) => {
      this.tweens.killTweensOf(t.c);
      t.c.destroy();
    });
    this.tokens.clear();
    this.weaponSprites.forEach((s) => {
      this.tweens.killTweensOf(s);
      s.destroy();
    });
    this.weaponSprites.clear();
    this.helperSprites.forEach((c) => c.destroy());
    this.helperSprites.clear();
    this.setOutcome(null);
    this.passageLayer?.destroy(true);
    this.passageLayer = undefined;
    this.surveyMarks.clear();
    this.roomRects.clear();
    this.dropInset();
  }

  /**
   * `?cvd=1` 색각 대체 표기(spec §4.3) — **계열 바 + 명도 핍**을 8×8 도트 셀에.
   *
   * 뷰4에만 있던 표기를 뷰1로 넓힌다(계약 §5가 요구하는 4뷰 균일성).
   * 다만 뷰1의 1차 식별자는 이모지이므로 **얼굴을 건드리지 않고 이름표 우측**에
   * 12px 셀 하나만 붙인다 — spec §4.3이 셀 크기(8×8 도트)만 정하고 배치는
   * 뷰에 맡겼기 때문에, 가장 덜 어지러운 자리를 고른 것이다.
   * 글리프 어휘 자체는 `pixel-glyphs.cvdCueDots` 단일 소스에서 온다.
   */
  private makeCvdCue(
    suspect: string,
    name: Phaser.GameObjects.Text,
  ): Phaser.GameObjects.GameObject[] {
    if (!this.cvd) return [];
    const cue = zodiacCue(suspect);
    if (!cue) return [];
    const d = 1.5; // 도트 1단위(px) → 셀 12px
    const cx = name.width / 2 + (CVD_CELL * d) / 2 + 4;
    const cy = CELL * 0.55 + name.height / 2;
    // 잔디·방바닥 어디에서도 흰 글리프가 읽히도록 어두운 판을 깐다.
    const out: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(cx, cy, CVD_CELL * d + 4, CVD_CELL * d + 4, 0x000000, 0.67),
    ];
    for (const r of cvdCueDots(cue)) {
      out.push(
        this.add.rectangle(
          cx + (r.x + r.w / 2 - CVD_CELL / 2) * d,
          cy + (r.y + r.h / 2 - CVD_CELL / 2) * d,
          r.w * d,
          r.h * d,
          0xffffff,
        ),
      );
    }
    return out;
  }

  private createToken(id: string, a: ActorSnapshot): Token {
    // 색은 접속 순서가 아니라 `suspect`로 결정된다 — 판 도중에도 불변(§4).
    const color = zodiacColor(a.suspect);
    const ring = this.add
      .circle(0, 0, CELL * 0.55, 0x000000, 0)
      .setStrokeStyle(3, RING_CURRENT)
      .setVisible(false);
    // 색면에는 반드시 아웃라인(§4.1) — 밝은 방바닥과 대비가 1.0까지 떨어지는 색이 있다.
    const disc = this.add
      .circle(0, 0, CELL * 0.4, color)
      .setStrokeStyle(TOKEN_OUTLINE_PX, TOKEN_OUTLINE_COLOR);
    // 이모지 = 색에 의존하지 않는 1차 식별자. 색은 보조 단서다.
    const face = this.add
      .text(0, 0, emoji(a.suspect), {
        fontSize: `${Math.floor(CELL * 0.52)}px`,
      })
      .setOrigin(0.5);
    const name = this.add
      .text(0, CELL * 0.55, `${a.isBot ? "🤖" : ""}${a.name}`, {
        fontSize: "13px",
        color: hexString(BOARD.nameText),
        backgroundColor: "#000000aa",
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 0);
    // 이름표 좌측 색 스트라이프 — 색과 이름을 같은 픽셀에 둔다(§4.2).
    const stripe = this.add
      .rectangle(
        -name.width / 2 + NAME_STRIPE_PX / 2,
        CELL * 0.55 + name.height / 2,
        NAME_STRIPE_PX,
        name.height,
        color,
      )
      .setOrigin(0.5);
    // 탈락 2차 표기 — 이름표를 파선으로 두른다(§1.2).
    const elimDash = this.add.graphics();
    elimDash.lineStyle(2, 0xffffff, 0.95);
    drawDashedRect(
      elimDash,
      -name.width / 2 - 2,
      CELL * 0.55 - 2,
      name.width + 4,
      name.height + 4,
    );
    elimDash.setVisible(false);
    const c = this.add.container(0, 0, [
      ring,
      disc,
      face,
      name,
      stripe,
      elimDash,
      ...this.makeCvdCue(a.suspect, name),
    ]);
    const token: Token = {
      c,
      ring,
      disc,
      face,
      name,
      stripe,
      elimDash,
      suspect: a.suspect,
      placed: false,
      eliminated: a.eliminated,
    };
    this.tokens.set(id, token);
    return token;
  }
}
