import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  CELL_PX,
  ELIM_ALPHA,
  GRID_HEIGHT,
  GRID_WIDTH,
  PIXEL_PAL,
  RING_CURRENT,
  SCHEME_DESAT_KEEP,
  SPENT_ALPHA,
  ROOM_REGIONS,
  bubbleLifeMs,
  desaturate,
  hexString,
  label,
  regionOf,
  timingOf,
  zodiacColor,
  zodiacCue,
  type MotionProfile,
  type ViewTiming,
  PASSAGE_ALPHA_HOVER,
  PASSAGE_ALPHA_IDLE,
  PASSAGE_FADE_MS,
  PASSAGE_HOVER_PX,
  SUMMON_ANCHOR_ALPHA,
  BUBBLE_BORDER_PX,
  BUBBLE_SAFE_PAD_PX,
  doorOutward,
  doorSideOf,
} from "@zodiac-clue/shared";
import { clampToSafe, safeWidth } from "./hud-inset";
import { currentTiming, cvdMode } from "./view-motion";
import {
  CVD_CELL,
  SUMMON_MARK,
  cvdCueDots,
  gridCells,
  lootStamp,
  zodiacBadge,
} from "./pixel-glyphs";
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

// 뷰4 "도트풍" — 탑다운 픽셀 스타일 오버레이 씬.
// GameScene(뷰1)이 입력·카메라·로직을 담당하고, 이 씬은 카메라를 미러링하며
// 도트 비주얼만 그린다(외부 에셋 0, 전부 절차적 생성). 좌표계는 GameScene과 동일.
//
// ⚠ `game-scene`을 **import 하지 않는다**(순환 의존 제거 — spec §3 · roadmap §9.1).
//   좌표·팔레트·타이밍은 전부 shared에서 온다. 카메라 미러링은 런타임 씬 조회
//   (`this.scene.get("game")`)로만 하므로 모듈 그래프에 phaser 뷰1이 끌려오지 않는다.

/** 좌표계는 뷰1과 공유한다 — 단일 소스는 shared의 `CELL_PX`. */
const CELL = CELL_PX;
const BOARD_W = GRID_WIDTH * CELL;
const BOARD_H = GRID_HEIGHT * CELL;

/** 도트 팔레트 — `BOARD`에서 명도만 파생한 값(새 색을 만들지 않는다). */
const PAL = PIXEL_PAL;

/** 도트 1단위(px). 계단 표기는 전부 이 배수로만 찍는다(안티에일리어싱 금지). */
const DOT = 3;

/** 절차적 잔디 타일 텍스처 키 — 씬 종료 시 반드시 회수한다(§9.3). */
const GRASS_TEX = "px-grass";

/** `pulseCell`의 의미 → 뷰4 팔레트 번역(색이 아니라 의미를 받는다). */
const TONE_COLOR: Record<PulseTone, number> = {
  neutral: PAL.cream,
  suggest: PAL.gold,
  alert: 0xff6b5e,
};

type PlayerView = {
  name: string;
  suspect: string;
  isBot: boolean;
  x: number;
  y: number;
  eliminated: boolean;
};

/** 도트 크리터 — 탈락 시 눈을 ✕ 도트로 바꾸기 위해 눈 파츠를 들고 있는다. */
type Critter = {
  c: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Rectangle;
  body: Phaser.GameObjects.Container;
  /** 정상 눈(흰자·눈동자). 탈락 시 숨긴다. */
  eyes: Phaser.GameObjects.GameObject[];
  /** 탈락 ✕ 눈(2×2 도트). 평소 숨김 — 알파 단독 표기 금지(§1.2). */
  elimEyes: Phaser.GameObjects.GameObject[];
  /** 색을 입은 파츠(몸통·귀) — `identity()`가 이 목록의 색을 되맞춘다. */
  colorParts: Phaser.GameObjects.Rectangle[];
  suspect: string;
  placed: boolean;
  eliminated: boolean;
  /**
   * 지금 향하고 있는 **목표 픽셀 좌표**(서버 칸 → px). `c.x/c.y`(그리는 중인 값)와
   * 반드시 구분한다 — `syncTokens()`가 매 프레임 도는 폴링 렌더러라 "현재 좌표가
   * 목표와 다르다"를 트윈 재시작 조건으로 쓰면 트윈이 영원히 0프레임째에 머문다(§아래 주석).
   */
  tx: number;
  ty: number;
};

/** 장물 상자 1건 — 컨테이너와 **목표 좌표**를 함께 들고 있어야 트윈이 살아남는다. */
type LootBox = {
  c: Phaser.GameObjects.Container;
  tx: number;
  ty: number;
};

/** 말풍선 1건이 소유한 오브젝트·타이머 전부. */
type BubbleRec = {
  txt: Phaser.GameObjects.Text;
  /** 배경 분리 테두리 + (귓속말이면) 도트 파선. 공개/귓속말 모두 존재한다. */
  deco?: Phaser.GameObjects.Graphics;
  /** 귓속말 여부 — 테두리 문법을 가른다(계약 §2). */
  whisper?: boolean;
  reveal?: TypeReveal;
  tick?: Phaser.Time.TimerEvent;
  hold?: Phaser.Time.TimerEvent;
};

/** 점 → 선분 최단거리. 통로 선 근접 판정에만 쓴다. */
const distToSegPx = (
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export class PixelScene extends Phaser.Scene implements ViewContract {
  /** 뷰4 = 도트. */
  readonly viewId: ViewId = "pixel";
  /** 뷰1과 **같은 Phaser WebGL 컨텍스트**를 공유한다(§9.5). */
  readonly contextCost = 1;

  private room!: Room;
  private tokens = new Map<string, Critter>();
  private loot = new Map<string, LootBox>();
  private helpers = new Map<string, Phaser.GameObjects.Container>();
  private bubbles = new Map<string, BubbleRec>();
  /** 지금 턴(계약 `setCurrent`). 사본일 뿐 진실값은 서버에 있다. */
  private currentId: string | null = null;
  /** 방 영역(px) — 포커스·살펴봄·통로 표기가 공용으로 쓴다. */
  private roomRects = new Map<string, Phaser.Geom.Rectangle>();
  /** 방 상단 하이라이트 라인(실선) — 살펴본 방은 파선 도트로 바뀐다. */
  private roomTopLine = new Map<string, Phaser.GameObjects.Rectangle>();
  /** 살펴봄 파선 도트(기본 숨김). */
  private surveyDots = new Map<string, Phaser.GameObjects.Container>();
  private passageLayer?: Phaser.GameObjects.Container;
  /** 통로 선분(월드 좌표) — 커서 근접 판정용. */
  private passageSegs: readonly [number, number, number, number][] = [];
  private outcomeFx: Phaser.GameObjects.GameObject[] = [];
  /** 감속 프로파일 타이밍(§1.3). */
  private timing: ViewTiming = currentTiming();
  /** 색각 대체 표기(§4.3) 활성 여부 — 색을 끄지 않고 보강한다. */
  private cvd = false;

  constructor() {
    super("pixel");
  }

  create(): void {
    this.room = this.registry.get("room") as Room;
    this.cvd = cvdMode();
    this.cameras.main.setRoundPixels(true);
    this.makeGrassTexture();
    this.drawBoard();
    // 씬 종료·파괴에서 절차적 텍스처·타이머를 회수한다(§9.3).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.dispose());
    // 표시 여부는 setStage가 sys.setVisible로 제어(뷰4에서만 보임).
  }

  /** 16px 잔디 타일 텍스처를 절차적으로 생성. */
  private makeGrassTexture(): void {
    if (this.textures.exists(GRASS_TEX)) return;
    const g = this.add.graphics();
    g.fillStyle(PAL.grass1, 1);
    g.fillRect(0, 0, 16, 16);
    // 고정 패턴(결정적) — 어두운/밝은 풀 픽셀 흩뿌림
    const dark: [number, number][] = [
      [2, 3], [3, 3], [9, 1], [12, 6], [5, 10], [13, 12], [1, 13], [7, 7],
    ];
    const light: [number, number][] = [
      [4, 2], [10, 4], [6, 9], [14, 8], [2, 11], [11, 13], [8, 14],
    ];
    g.fillStyle(PAL.grass2, 1);
    for (const [x, y] of dark) g.fillRect(x, y, 2, 1);
    g.fillStyle(PAL.grass3, 1);
    for (const [x, y] of light) g.fillRect(x, y, 1, 1);
    g.generateTexture(GRASS_TEX, 16, 16);
    g.destroy();
  }

  /** 픽셀 보드: 잔디 바닥 + 방(판자 패널) + 문 + 중앙 잔치상. */
  private drawBoard(): void {
    this.add
      .tileSprite(0, 0, BOARD_W, BOARD_H, GRASS_TEX)
      .setOrigin(0)
      .setDepth(0);

    // 중앙 잔치상 (나무 궤짝 느낌)
    const fx = 9 * CELL;
    const fy = 9 * CELL;
    const fw = 6 * CELL;
    const fh = 6 * CELL;
    this.pixelPanel(fx, fy, fw, fh, PAL.woodDark, PAL.wood, PAL.gold);
    this.add
      .rectangle(fx + fw / 2, fy + fh / 2 - 6, 46, 40, PAL.gold)
      .setStrokeStyle(3, PAL.ink)
      .setDepth(1);
    this.add
      .rectangle(fx + fw / 2, fy + fh / 2 - 6, 10, 40, PAL.loot)
      .setDepth(1); // 리본
    this.add
      .text(fx + fw / 2, fy + fh / 2 + 34, "잔치상", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: hexString(PAL.cream),
      })
      .setOrigin(0.5)
      .setDepth(1);

    // 방(판자 패널 + 명패 + 문)
    for (const r of ROOM_REGIONS) {
      const x = r.x * CELL;
      const y = r.y * CELL;
      const w = r.w * CELL;
      const h = r.h * CELL;
      this.roomRects.set(r.name, new Phaser.Geom.Rectangle(x, y, w, h));
      const top = this.pixelPanel(x, y, w, h, PAL.roomEdge, PAL.room, PAL.roomHi);
      this.roomTopLine.set(r.name, top);
      // "이미 살펴본 방" — 상단 라인을 파선 도트로(§2 계약 표 뷰4 칸). 기본 숨김.
      const dots = this.add.container(0, 0).setDepth(1).setVisible(false);
      for (let dx = 0; dx + DOT * 2 <= w - 6; dx += DOT * 4) {
        dots.add(
          this.add
            .rectangle(x + 3 + dx, y + 3, DOT * 2, DOT, PAL.roomHi)
            .setOrigin(0),
        );
      }
      this.surveyDots.set(r.name, dots);

      const name = label(r.name);
      this.add
        .rectangle(x + 8, y + 8, name.length * 18 + 16, 26, PAL.ink, 0.88)
        .setOrigin(0)
        .setStrokeStyle(2, PAL.gold)
        .setDepth(2);
      this.add
        .text(x + 16, y + 12, name, {
          fontFamily: "monospace",
          fontSize: "16px",
          color: hexString(PAL.roomHi),
        })
        .setOrigin(0)
        .setDepth(3);

      // ── 문(입구) ──
      // 뷰1과 같은 형태 규칙: **벽을 끊고** 문지방·문설주로 그린다.
      // 예전에는 나무 타일 + 문짝 + "입구" 뱃지 3겹이라 도트 격자 위에서 뭉쳤다.
      const side = doorSideOf(r);
      const out = doorOutward(side);
      const horiz = out.y !== 0;
      const dcx = r.door.x * CELL + CELL / 2;
      const dcy = r.door.y * CELL + CELL / 2;
      const wx = horiz ? dcx : (out.x < 0 ? r.x : r.x + r.w) * CELL;
      const wy = horiz ? (out.y < 0 ? r.y : r.y + r.h) * CELL : dcy;
      const half = Math.round((CELL * 0.42) / DOT) * DOT;
      // ① 벽 끊기 — 방 테두리를 바닥색 도트로 덮는다.
      this.add
        .rectangle(
          wx,
          wy,
          horiz ? half * 2 : DOT * 2,
          horiz ? DOT * 2 : half * 2,
          PAL.room,
        )
        .setDepth(1);
      // ② 문지방 — 개구부 폭의 금색 띠(도트 격자에 맞춘 두께).
      this.add
        .rectangle(
          wx - (horiz ? 0 : (out.x * DOT * 2) / 2),
          wy - (horiz ? (out.y * DOT * 2) / 2 : 0),
          horiz ? half * 2 : DOT * 2,
          horiz ? DOT * 2 : half * 2,
          PAL.gold,
        )
        .setAlpha(0.55)
        .setDepth(2);
      // ③ 문설주 — 개구부 양 끝의 나무 기둥.
      for (const sgn of [-1, 1]) {
        this.add
          .rectangle(
            horiz ? wx + sgn * half : wx,
            horiz ? wy : wy + sgn * half,
            horiz ? DOT : DOT * 3,
            horiz ? DOT * 3 : DOT,
            PAL.woodDark,
          )
          .setDepth(3);
      }

      // ── 소환 앵커(§5 행 18) ──
      // ⚠ 좌표는 만들지 않는다 — `r.summon`은 서버 `freeCellIn()`이 자리 배정의 정렬
      //   기준으로 쓰는 값(shared 단일 소스)이고, 뷰는 그 칸을 표시만 한다.
      // 도트 문법이라 파선 사각은 **계단 도트**로, 🔔은 3×3 `SUMMON_MARK`로 옮긴다.
      // 밝기는 4뷰 공용 `SUMMON_ANCHOR_ALPHA` — 뷰마다 다르면 "언제 눈에 들어오는가"가 갈린다.
      const sx = r.summon.x * CELL;
      const sy = r.summon.y * CELL;
      const anchor = this.add
        .container(0, 0)
        .setDepth(1)
        .setAlpha(SUMMON_ANCHOR_ALPHA);
      for (let i = DOT; i + DOT * 2 <= CELL - DOT; i += DOT * 4) {
        anchor.add(
          this.add
            .rectangle(sx + i, sy + DOT, DOT * 2, DOT, PAL.gold)
            .setOrigin(0),
        );
        anchor.add(
          this.add
            .rectangle(sx + i, sy + CELL - DOT * 2, DOT * 2, DOT, PAL.gold)
            .setOrigin(0),
        );
        anchor.add(
          this.add
            .rectangle(sx + DOT, sy + i, DOT, DOT * 2, PAL.gold)
            .setOrigin(0),
        );
        anchor.add(
          this.add
            .rectangle(sx + CELL - DOT * 2, sy + i, DOT, DOT * 2, PAL.gold)
            .setOrigin(0),
        );
      }
      const mcx = sx + CELL / 2;
      const mcy = sy + CELL / 2;
      for (const { col, row } of gridCells(SUMMON_MARK)) {
        anchor.add(
          this.add.rectangle(
            mcx + (col - 1) * DOT,
            mcy + (row - 1) * DOT,
            DOT,
            DOT,
            PAL.gold,
          ),
        );
      }
    }
  }

  /**
   * 사각 픽셀 패널: 바깥 테두리 + 안쪽 채움 + 상단 하이라이트 라인(도트 입체감).
   * 상단 라인을 돌려주는 이유 = `setSurveyed`가 그 라인을 파선으로 바꾼다.
   */
  private pixelPanel(
    x: number,
    y: number,
    w: number,
    h: number,
    edge: number,
    fill: number,
    hi: number,
  ): Phaser.GameObjects.Rectangle {
    this.add.rectangle(x, y, w, h, edge).setOrigin(0).setDepth(0);
    this.add
      .rectangle(x + 3, y + 3, w - 6, h - 6, fill)
      .setOrigin(0)
      .setDepth(0);
    const top = this.add
      .rectangle(x + 3, y + 3, w - 6, 3, hi)
      .setOrigin(0)
      .setDepth(0); // 상단 하이라이트
    this.add.rectangle(x + 3, y + 3, 3, h - 6, hi).setOrigin(0).setDepth(0); // 좌측 하이라이트
    return top;
  }

  /**
   * 도트 캐릭터(크리터) — 몸통 블록 + 귀 + 눈 + **머리 위 3×3 문장 배지**.
   *
   * 시그니처가 `color`가 아니라 `suspect`인 이유: 색은 십이지 고유값(§4)에서 파생되고,
   * 실루엣 12종(§2.3)도 같은 키로 갈라진다. 색을 인자로 받으면 두 번 고쳐야 한다.
   *
   * roadmap §2.3 **축소판** 채택 — 12종을 가르는 축은 배지 하나다.
   * 풀버전(귀 4형 × 볏 2형 × 꼬리 3형)은 execution-plan §5.1에서 컷됐으므로
   * **몸통·귀 실루엣은 12종이 동일하게 유지**한다(컷 경계를 코드로 지킨다).
   */
  private makeCritter(
    suspect: string,
    opts: { gray?: boolean } = {},
  ): {
    c: Phaser.GameObjects.Container;
    eyes: Phaser.GameObjects.GameObject[];
    elimEyes: Phaser.GameObjects.GameObject[];
    colorParts: Phaser.GameObjects.Rectangle[];
  } {
    const s = CELL; // 셀 기준
    // 계략 NPC는 **실루엣은 십이지대로 두고 색만** 채도를 낮춘다 —
    // "저 회색 크리터가 누구인지"가 읽혀야 한다(§4.2).
    const base = zodiacColor(suspect);
    const color = opts.gray ? desaturate(base, SCHEME_DESAT_KEEP) : base;
    // 색면 아웃라인(§4.1) — 도트 뷰는 잉크 3px 스트로크가 그 역할을 한다.
    const body = this.add.rectangle(0, 2, s * 0.6, s * 0.56, color);
    body.setStrokeStyle(3, PAL.ink);
    const earL = this.add
      .rectangle(-s * 0.2, -s * 0.28, s * 0.16, s * 0.22, color)
      .setStrokeStyle(3, PAL.ink);
    const earR = this.add
      .rectangle(s * 0.2, -s * 0.28, s * 0.16, s * 0.22, color)
      .setStrokeStyle(3, PAL.ink);
    const eyeL = this.add.rectangle(-s * 0.12, -s * 0.02, 5, 6, 0xffffff);
    const eyeR = this.add.rectangle(s * 0.12, -s * 0.02, 5, 6, 0xffffff);
    const pupL = this.add.rectangle(-s * 0.12, 0, 3, 3, PAL.ink);
    const pupR = this.add.rectangle(s * 0.12, 0, 3, 3, PAL.ink);
    const eyes = [eyeL, eyeR, pupL, pupR];
    const elimEyes = [
      ...this.makeElimEye(-s * 0.12, -s * 0.01),
      ...this.makeElimEye(s * 0.12, -s * 0.01),
    ];
    const cue = this.makeCvdCue(suspect, s);
    const badge = this.makeBadge(suspect, s);
    const c = this.add.container(0, 0, [
      ...badge,
      earL,
      earR,
      body,
      ...eyes,
      ...elimEyes,
      ...cue,
    ]);
    return { c, eyes, elimEyes, colorParts: [body, earL, earR] };
  }

  /**
   * 머리 위 3×3 문장 배지(roadmap §2.3 축소판) — 십이지 12종을 **색과 독립으로** 가른다.
   *
   * 배치 근거: 현재-턴 사각 링 상단(`y = 2 - CELL*0.82/2 ≈ -14.4`)보다 위,
   * 말풍선 하단(`y = -CELL*0.9 = -36`)보다 아래 — **기존 상태 표기와 겹치지 않는다**.
   * 탈락 시에는 컨테이너 알파(§1.2)를 그대로 함께 받고, 눈 ✕는 얼굴에 찍히므로
   * 배지가 2차 표기를 가리지 않는다.
   *
   * 색은 잉크 명판 위 크림색 도트 고정 — 배지가 십이지색을 쓰면 축이 하나로 합쳐져
   * "색을 빼고도 구분"이라는 목적 자체가 사라진다.
   */
  private makeBadge(
    suspect: string,
    s: number,
  ): Phaser.GameObjects.GameObject[] {
    const grid = zodiacBadge(suspect);
    if (!grid) return [];
    const cy = -s * 0.62;
    const plate = this.add
      .rectangle(0, cy, DOT * 5, DOT * 5, PAL.ink, 0.92)
      .setStrokeStyle(1, PAL.gold, 0.9);
    const out: Phaser.GameObjects.GameObject[] = [plate];
    for (const { col, row } of gridCells(grid)) {
      out.push(
        this.add.rectangle(
          (col - 1) * DOT,
          cy + (row - 1) * DOT,
          DOT,
          DOT,
          PAL.cream,
        ),
      );
    }
    return out;
  }

  /** 탈락 눈 = ✕ 2×2 도트(§2 계약 표 `setElim` 뷰4 칸). 기본 숨김. */
  private makeElimEye(cx: number, cy: number): Phaser.GameObjects.Rectangle[] {
    const d = 2; // 도트 1단위
    const offs: [number, number][] = [
      [-d, -d],
      [d, -d],
      [0, 0],
      [-d, d],
      [d, d],
    ];
    return offs.map(([ox, oy]) =>
      this.add.rectangle(cx + ox, cy + oy, d, d, PAL.ink).setVisible(false),
    );
  }

  /**
   * 색각 대체 표기(§4.3) — 8×8 도트 셀에 **계열(4) × 명도단(3)**을 그린다.
   * 계열 바: 적 ▌좌 · 벽 ▀상 · 자 ▐우 · 청 ▄하 / 명도 핍: T0 ● T1 ●● T2 ●●●.
   * 색은 흰색 고정 — 색 대체 표기가 색에 의존하면 의미가 없다.
   */
  private makeCvdCue(
    suspect: string,
    s: number,
  ): Phaser.GameObjects.Rectangle[] {
    if (!this.cvd) return [];
    const cue = zodiacCue(suspect);
    if (!cue) return [];
    const d = 1.5; // 도트 1단위(px)
    const cy = s * 0.16; // 몸통 하단
    // 글리프 어휘는 `pixel-glyphs.cvdCueDots` 단일 소스 — 뷰1·2·3이 같은 함수를 쓴다.
    return cvdCueDots(cue).map((r) =>
      this.add.rectangle(
        (r.x + r.w / 2 - CVD_CELL / 2) * d,
        cy + (r.y + r.h / 2 - CVD_CELL / 2) * d,
        r.w * d,
        r.h * d,
        0xffffff,
      ),
    );
  }

  // ── 계약: 표시/은닉 · 감속 프로파일 ───────────────────────
  /**
   * 표시 전환. **첫 진입의 `scene.run("pixel")`은 씬 밖(main.ts)의 몫**이다 —
   * 시작되지 않은 씬에는 이 메서드가 존재하지 않기 때문. 시작 이후의 토글만 담당한다.
   * TODO(main.ts): `scene.run` 1회 + `setActive` 위임으로 정리 — 파일 범위 밖.
   */
  setActive(on: boolean): void {
    this.sys.setVisible(on);
    if (!on) this.clearBubbles();
  }

  /** 감속 프로파일 전환(§1.3). */
  setMotion(p: MotionProfile): void {
    this.timing = timingOf(p);
  }

  update(): void {
    if (!this.scene.isVisible()) return;
    this.mirrorCamera();
    this.updatePassageHover();
    this.syncTokens();
    this.bubbles.forEach((b, id) => {
      const anchor = this.tokens.get(id)?.c ?? this.helpers.get(id);
      if (!anchor) return;
      this.placeBubble(b, anchor.x, anchor.y);
      this.layoutBubbleDeco(b);
      if (b.reveal) paintReveal(b.reveal);
    });
  }

  /**
   * 말풍선을 화면 안 · HUD 비가림 영역에 놓는다 — 뷰1 `placeBubble`과 **같은 규칙**.
   * 카메라는 뷰1을 미러링하므로(`mirrorCamera`) 좌표계도 뷰1과 같다.
   * 도트 뷰는 `setRoundPixels(true)`라 역스케일 결과가 정수 격자에 스냅된다.
   */
  private placeBubble(rec: BubbleRec, ax: number, ay: number): void {
    const cam = this.cameras.main;
    const z = cam.zoom || 1;
    const vx = cam.scrollX + (cam.width * (1 - 1 / z)) / 2;
    const vy = cam.scrollY + (cam.height * (1 - 1 / z)) / 2;
    const txt = rec.txt;
    const pad = BUBBLE_SAFE_PAD_PX;
    const maxW = Math.max(1, safeWidth(cam.width) - pad * 2);
    const fit = Math.min(1, maxW / Math.max(1, txt.width));
    txt.setScale(fit / z);
    const w = txt.width * fit;
    const h = txt.height * fit;
    const asx = (ax - vx) * z;
    const asy = (ay - vy) * z;
    const above = asy - CELL * 0.9 * z - h;
    const sy0 = above >= pad ? above : asy + CELL * 0.62 * z;
    const p = clampToSafe(asx - w / 2, sy0, w, h, pad, cam.width, cam.height);
    txt.setPosition(vx + (p.x + w / 2) / z, vy + (p.y + h) / z);
  }

  // ── 계약: 대사 ───────────────────────────────────────────
  /** `say` 라우팅의 기존 진입점. 계약 메서드로 넘긴다(이름 호환 유지). */
  showBubble(id: string, text: string): void {
    this.bubble(id, text);
  }

  /**
   * NPC/계략 대사 말풍선(도트 톤 + 타자기).
   * 타자기는 **전문을 1회만 그리고 마스크로** 드러낸다 — 뷰1의 `setText` 재업로드
   * 결함을 뷰4에 복제하지 않기 위한 것(§9.3).
   */
  bubble(id: string, text: string, opts: BubbleOpts = {}): void {
    const anchor = this.tokens.get(id)?.c ?? this.helpers.get(id);
    if (!anchor) return;
    this.dropBubble(id);
    const body = opts.whisper ? `(귓속말) ${text}` : text;
    const txt = this.add
      .text(anchor.x, anchor.y - CELL * 0.9, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: hexString(PAL.ink),
        backgroundColor: hexString(PAL.cream),
        padding: { x: 6, y: 3 },
        align: "center",
        wordWrap: { width: 240 },
      })
      .setOrigin(0.5, 1)
      .setDepth(100);
    // 테두리는 **항상** — 크림 바탕과 잔디/마루의 대비가 낮아 선이 없으면 경계가 녹는다.
    const rec: BubbleRec = { txt, deco: this.add.graphics().setDepth(101) };
    rec.whisper = opts.whisper === true;
    this.bubbles.set(id, rec);

    // 수명·타자기 속도는 4뷰 공용값 — 뷰4만 3200ms 하드코딩이던 것을 제거했다.
    const total = bubbleLifeMs(body, this.timing);
    const typeMs = this.timing.TYPE_MS;
    const expire = (): void => {
      if (this.bubbles.get(id) === rec) this.dropBubble(id);
    };
    const reveal = beginReveal(this, txt, body);
    rec.reveal = reveal;
    // 첫 프레임부터 안전 영역 안에서 시작한다(폴링 뷰라 `update`가 곧 따라오지만,
    // 그 한 프레임에 화면 밖에 그려지면 타자기 첫 글자가 잘린 채로 보인다).
    this.placeBubble(rec, anchor.x, anchor.y);
    paintReveal(reveal);
    this.layoutBubbleDeco(rec);

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
   * 말풍선 테두리. 공개 대사는 잉크 실선(배경 분리 §1.6),
   * 귓속말은 그 바깥에 금색 도트 파선(3px 계단 — 도트 문법 유지).
   * 두께·도트 크기는 **화면 기준**이라 줌아웃에서도 같은 굵기로 남는다.
   */
  private layoutBubbleDeco(rec: BubbleRec): void {
    const g = rec.deco;
    if (!g) return;
    const tl = rec.txt.getTopLeft();
    const w = rec.txt.displayWidth;
    const h = rec.txt.displayHeight;
    const z = this.cameras.main.zoom || 1;
    const lw = BUBBLE_BORDER_PX / z;
    g.clear();
    g.lineStyle(lw, PAL.ink, 1);
    g.strokeRect(tl.x - lw / 2, tl.y - lw / 2, w + lw, h + lw);
    if (!rec.whisper) return;
    const d = DOT / z;
    g.fillStyle(PAL.gold, 1);
    for (let x = 0; x < w; x += d * 2) {
      g.fillRect(tl.x + x, tl.y - lw - d, d, d);
      g.fillRect(tl.x + x, tl.y + h + lw, d, d);
    }
    for (let y = 0; y < h; y += d * 2) {
      g.fillRect(tl.x - lw - d, tl.y + y, d, d);
      g.fillRect(tl.x + w + lw, tl.y + y, d, d);
    }
  }

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

  /** GameScene(뷰1)의 카메라를 그대로 미러 — 줌·팬·추적을 재사용. */
  private mirrorCamera(): void {
    const gs = this.scene.get("game");
    const gcam = gs?.cameras?.main;
    if (!gcam) return;
    const cam = this.cameras.main;
    cam.setZoom(gcam.zoom);
    cam.scrollX = gcam.scrollX;
    cam.scrollY = gcam.scrollY;
  }

  /** 서버 상태 → 도트 토큰/장물/NPC 위치 동기화. */
  private syncTokens(): void {
    const state = this.room.state as unknown as {
      players: Map<string, PlayerView>;
      weapons: Map<string, { value: string; x: number; y: number }>;
      helpers: Map<string, { value: string; x: number; y: number; used: boolean }>;
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

    // 장물(도트 상자)
    const seenLoot = new Set<string>();
    state.weapons.forEach((w, key) => {
      seenLoot.add(key);
      const cx = w.x * CELL + CELL / 2;
      const cy = w.y * CELL + CELL / 2;
      const s = this.loot.get(key);
      if (!s) {
        this.loot.set(key, {
          c: this.makeLootBox(cx, cy, w.value),
          tx: cx,
          ty: cy,
        });
      } else if (s.tx !== cx || s.ty !== cy) {
        // 말과 같은 이유로 **목표 좌표**와 비교한다 — `syncActor`의 긴 주석 참고.
        // (`s.c.x`와 비교하면 매 프레임 트윈이 재시작돼 장물이 그 자리에 얼어붙는다.)
        s.tx = cx;
        s.ty = cy;
        this.tweens.killTweensOf(s.c);
        this.tweens.add({
          targets: s.c,
          x: cx,
          y: cy,
          duration: this.timing.LOOT_TWEEN_MS,
          ease: "Quad.Out",
        });
      }
    });
    for (const key of [...this.loot.keys()]) {
      if (seenLoot.has(key)) continue;
      const s = this.loot.get(key);
      if (s) {
        this.tweens.killTweensOf(s.c);
        s.c.destroy();
      }
      this.loot.delete(key);
    }

    // 고정 NPC(계략) — 실루엣은 십이지대로, 색만 채도를 낮춘 크리터 + 태그
    const seenHelpers = new Set<string>();
    state.helpers.forEach((h, key) => {
      seenHelpers.add(key);
      const cx = h.x * CELL + CELL / 2;
      const cy = h.y * CELL + CELL / 2;
      let c = this.helpers.get(key);
      if (!c) {
        const body = this.makeCritter(h.value, { gray: true });
        const tag = this.add
          .text(0, CELL * 0.44, "계략", {
            fontFamily: "monospace",
            fontSize: "10px",
            color: hexString(PAL.gold),
            backgroundColor: "#000000aa",
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5, 0);
        c = this.add.container(cx, cy, [body.c, tag]).setDepth(4);
        this.helpers.set(key, c);
      } else if (c.x !== cx || c.y !== cy) {
        // 계략 NPC는 판 시작에 한 번 놓이고 움직이지 않는다. 다만 재대국에서 같은
        // 십이지가 **다른 자리**로 다시 깔릴 수 있어(서버 `helpers.clear()` → `set`)
        // 위치를 놓치면 유령이 남는다. 트윈이 아니라 **스냅** — 이동이 아니라 재배치다.
        c.setPosition(cx, cy);
      }
      c.setAlpha(h.used ? SPENT_ALPHA : 1);
    });
    for (const key of [...this.helpers.keys()]) {
      if (seenHelpers.has(key)) continue;
      this.helpers.get(key)?.destroy();
      this.helpers.delete(key);
    }

    for (const id of [...this.tokens.keys()]) {
      if (!seen.has(id)) this.removeActor(id);
    }
  }

  /**
   * 도트 장물 상자 — 뚜껑 분리(`lootWarp`가 2프레임으로 여닫는다) +
   * **앞면 3×3 스탬프**로 장물 6종을 구분한다(spec §5 행 13 · roadmap §2.3 축소판).
   *
   * ⚠ 자식 순서 `[box, lid, ...stamp]`는 `lootWarp`가 `list[1]`을 뚜껑으로 집는
   *   전제다 — 스탬프를 **뒤에** 붙여 그 전제를 깨지 않는다.
   *   `LOOT_DOTS` 8×8 6벌(풀버전 텍스처)은 execution-plan §5.1에서 컷.
   */
  private makeLootBox(
    cx: number,
    cy: number,
    value: string,
  ): Phaser.GameObjects.Container {
    const box = this.add
      .rectangle(0, CELL * 0.02, CELL * 0.56, CELL * 0.48, PAL.loot)
      .setStrokeStyle(3, PAL.ink);
    const lid = this.add
      .rectangle(0, -CELL * 0.2, CELL * 0.62, CELL * 0.13, PAL.gold)
      .setStrokeStyle(2, PAL.ink);
    const parts: Phaser.GameObjects.GameObject[] = [box, lid];
    const sy = CELL * 0.06;
    for (const { col, row } of gridCells(lootStamp(value))) {
      parts.push(
        this.add.rectangle(
          (col - 1) * DOT,
          sy + (row - 1) * DOT,
          DOT,
          DOT,
          PAL.ink,
        ),
      );
    }
    return this.add.container(cx, cy, parts).setDepth(4);
  }

  // ── 계약: 액터 ───────────────────────────────────────────
  syncActor(a: ActorSnapshot): void {
    const cx = a.cell.x * CELL + CELL / 2;
    const cy = a.cell.y * CELL + CELL / 2;
    let t = this.tokens.get(a.id);
    if (!t) {
      // 현재 턴 링은 도트 문법상 **사각**(원형 금지) — §2 계약 표 setCurrent 뷰4 칸.
      const ring = this.add
        .rectangle(0, 2, CELL * 0.86, CELL * 0.82, 0x000000, 0)
        .setStrokeStyle(3, RING_CURRENT)
        .setVisible(false);
      const critter = this.makeCritter(a.suspect);
      // 이름표 좌측 색 스트라이프 — 색과 이름을 같은 픽셀에(§4.2).
      const nameTxt = this.add
        .text(0, CELL * 0.5, `${a.isBot ? "🤖" : ""}${a.name}`, {
          fontFamily: "monospace",
          fontSize: "12px",
          color: hexString(PAL.cream),
          backgroundColor: "#000000aa",
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5, 0);
      const stripe = this.add
        .rectangle(
          -nameTxt.width / 2 + 1.5,
          CELL * 0.5 + nameTxt.height / 2,
          3,
          nameTxt.height,
          zodiacColor(a.suspect),
        )
        .setOrigin(0.5);
      const c = this.add
        .container(cx, cy, [ring, critter.c, nameTxt, stripe])
        .setDepth(5);
      t = {
        c,
        ring,
        body: critter.c,
        eyes: critter.eyes,
        elimEyes: critter.elimEyes,
        colorParts: [...critter.colorParts, stripe],
        suspect: a.suspect,
        placed: true,
        eliminated: a.eliminated,
        tx: cx,
        ty: cy,
      };
      this.tokens.set(a.id, t);
    } else if (t.tx !== cx || t.ty !== cy) {
      // ⚠ 비교 대상은 **목표 좌표(`t.tx/ty`)**지 `t.c.x/y`가 아니다.
      //
      //   이 뷰는 `update()`마다 `syncTokens()`로 서버 상태를 다시 읽는 **폴링** 렌더러다
      //   (뷰1은 `room.onStateChange` 이벤트 구동이라 이 경로를 1회만 탄다).
      //   그래서 조건을 "그리는 중인 좌표 ≠ 목표"로 쓰면 트윈이 도착하기 전까지 **매 프레임**
      //   참이 되어 `killTweensOf` → `add`를 반복한다.
      //   Phaser 3.60+ `Tween.update()`는 **첫 호출에서 `delta = 0`으로 리셋**한다
      //   ("start progress from zero"). 즉 트윈은 두 번째 스텝부터 움직인다 →
      //   매 프레임 죽였다 새로 만들면 어떤 트윈도 두 번째 스텝을 맞지 못해
      //   `elapsed`가 0에 못 박히고 **말이 영원히 제자리에 선다.**
      //   (뷰를 나가면 폴링이 멈춰 마지막 트윈이 살아남아 "튀는" 것이 그 증상이었다.)
      //
      //   목표가 **바뀔 때만** 재시작하면 트윈이 온전히 한 번 살아 실시간으로 따라온다.
      //   뷰2·3(`iso-view.ts`)이 같은 폴링을 `target` + dt 보간으로 푸는 것과 같은 규약이다.
      t.tx = cx;
      t.ty = cy;
      this.tweens.killTweensOf(t.c);
      this.tweens.add({
        targets: t.c,
        x: cx,
        y: cy,
        duration: this.timing.MOVE_TWEEN_MS,
        ease: "Quad.Out",
      });
    }
    this.setElim(a.id, a.eliminated);
  }

  /** 퇴장 — 말풍선·타이머·트윈까지 정리(계약 §2). */
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

  setCurrent(id: string | null): void {
    this.currentId = id;
    this.tokens.forEach((t, tid) => t.ring.setVisible(tid === id));
  }

  /** 탈락 — 알파 + 눈을 ✕ 2×2 도트로(알파 단독 금지 §1.2). */
  setElim(id: string, on: boolean): void {
    const t = this.tokens.get(id);
    if (!t) return;
    t.eliminated = on;
    t.c.setAlpha(on ? ELIM_ALPHA : 1);
    for (const e of t.eyes) {
      (e as Phaser.GameObjects.Rectangle).setVisible(!on);
    }
    for (const e of t.elimEyes) {
      (e as Phaser.GameObjects.Rectangle).setVisible(on);
    }
  }

  // ── 계약: 순간이동 ───────────────────────────────────────
  /** 순간이동 — 사각 프레임 3겹 + 4방향 화살표(spec §2 뷰4 칸). */
  // `from`은 쓰지 않는다 — 도트 문법에서 잔상 경로 대신 **도착 칸의 프레임 3겹**과
  // 4방향 화살표로 "여기로 옮겨졌다"를 표기한다(spec §2 뷰4 칸).
  warp(id: string, _from: ViewCell, to: ViewCell, reason: WarpReason): void {
    const bx = to.x * CELL + CELL / 2;
    const by = to.y * CELL + CELL / 2;
    const t = this.tokens.get(id);
    if (t) {
      this.tweens.killTweensOf(t.c);
      t.c.setPosition(bx, by);
      // 목표 좌표도 함께 옮긴다 — 다음 `syncTokens()` 폴링이 "아직 안 갔다"고 오해해
      // 방금 순간이동한 말을 다시 트윈으로 끌지 않도록.
      t.tx = bx;
      t.ty = by;
    }
    const ms = this.timing.WARP_MS;
    if (ms <= 0) return;
    const tint = reason === "summon" ? PAL.gold : PAL.wood;
    // 사각 프레임 3겹 — 도트 문법상 원형 금지.
    for (let k = 0; k < 3; k++) {
      const size = CELL * (0.7 + k * 0.3);
      const frame = this.add
        .rectangle(bx, by, size, size, 0x000000, 0)
        .setStrokeStyle(DOT, tint)
        .setDepth(6);
      this.tweens.add({
        targets: frame,
        alpha: 0,
        duration: ms,
        delay: k * (ms / 6),
        onComplete: () => frame.destroy(),
      });
    }
    // 4방향 화살표(계단 도트) — 출발 방향을 함께 읽히게 한다.
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const arrow = this.add
        .rectangle(bx + dx * CELL * 0.6, by + dy * CELL * 0.6, DOT * 3, DOT * 3, tint)
        .setDepth(6);
      this.tweens.add({
        targets: arrow,
        x: bx + dx * CELL * 0.3,
        y: by + dy * CELL * 0.3,
        alpha: 0,
        duration: ms,
        onComplete: () => arrow.destroy(),
      });
    }
  }

  /**
   * 장물 순간이동 — Container tween + 뚜껑 2프레임(spec §2 뷰4 칸).
   * 잔상 상자도 **같은 스탬프**를 달고 날아간다 — 어떤 장물이 옮겨졌는지가
   * 배너 없이 화면만으로 읽힌다.
   */
  lootWarp(value: string, from: ViewCell, to: ViewCell): void {
    const ax = from.x * CELL + CELL / 2;
    const ay = from.y * CELL + CELL / 2;
    const bx = to.x * CELL + CELL / 2;
    const by = to.y * CELL + CELL / 2;
    const ms = this.timing.WARP_MS;
    const ghost = this.makeLootBox(ax, ay, value).setDepth(6);
    if (ms <= 0) {
      ghost.destroy();
      return;
    }
    const lid = ghost.list[1] as Phaser.GameObjects.Rectangle;
    // 뚜껑 2프레임: 열림(위로 1도트) → 닫힘.
    this.tweens.add({
      targets: lid,
      y: -CELL * 0.2 - DOT * 2,
      duration: Math.max(1, ms / 2),
      yoyo: true,
    });
    this.tweens.add({
      targets: ghost,
      x: bx,
      y: by,
      duration: ms,
      ease: "Quad.InOut",
      onComplete: () => ghost.destroy(),
    });
  }

  // ── 계약: 무대·칸 주목 ───────────────────────────────────
  /**
   * 사건의 무대 — 카메라는 뷰1을 미러링하므로 **자동으로 따라온다**(spec §2 뷰4 칸).
   * 이 뷰가 더할 정보는 방 테두리 점멸뿐이다.
   */
  focusRoom(room: string, _mode: FocusMode): void {
    const rect = this.roomRects.get(room);
    if (!rect || !regionOf(room)) return;
    const border = this.add
      .rectangle(rect.x, rect.y, rect.width, rect.height, 0x000000, 0)
      .setOrigin(0)
      .setStrokeStyle(DOT * 2, PAL.gold)
      .setDepth(6);
    this.tweens.add({
      targets: border,
      alpha: 0,
      duration: Math.max(1, this.timing.WARP_BANNER_MS),
      onComplete: () => border.destroy(),
    });
  }

  /** 특정 칸 주목 — 3px 계단 도트(안티에일리어싱 금지 · spec §2 뷰4 칸). */
  pulseCell(cell: ViewCell, tone: PulseTone): void {
    const cx = cell.x * CELL;
    const cy = cell.y * CELL;
    const dots: Phaser.GameObjects.Rectangle[] = [];
    const color = TONE_COLOR[tone];
    for (let i = 0; i < CELL; i += DOT * 2) {
      dots.push(
        this.add.rectangle(cx + i, cy, DOT, DOT, color).setOrigin(0),
        this.add.rectangle(cx + i, cy + CELL - DOT, DOT, DOT, color).setOrigin(0),
        this.add.rectangle(cx, cy + i, DOT, DOT, color).setOrigin(0),
        this.add.rectangle(cx + CELL - DOT, cy + i, DOT, DOT, color).setOrigin(0),
      );
    }
    for (const d of dots) d.setDepth(6);
    this.tweens.add({
      targets: dots,
      alpha: 0,
      duration: Math.max(1, this.timing.WARP_BANNER_MS / 2),
      onComplete: () => {
        for (const d of dots) d.destroy();
      },
    });
  }

  // ── 계약: 식별·파생 정보·종료 ────────────────────────────
  /**
   * 도트 표기는 절차적 생성이라 프리로드할 에셋이 없다 — 대신 살아 있는 크리터의
   * 색을 `suspect` 키로 **되맞춘다**(팔레트가 바뀌어도 화면과 계약이 갈라지지 않는다).
   */
  identity(suspect: string): void {
    const color = zodiacColor(suspect);
    this.tokens.forEach((t) => {
      if (t.suspect !== suspect) return;
      for (const p of t.colorParts) p.setFillStyle(color);
    });
  }

  /** "이미 살펴본 방" — 상단 라인을 파선 도트로(§2 뷰4 칸). 진실값 아님. */
  setSurveyed(rooms: readonly string[]): void {
    const set = new Set(rooms);
    this.roomTopLine.forEach((line, name) => {
      const on = set.has(name);
      line.setVisible(!on);
      this.surveyDots.get(name)?.setVisible(on);
    });
  }

  /** 비밀 통로 — 2×2 도트 계단 마크(§2 뷰4 칸). */
  setPassages(links: readonly PassageLink[]): void {
    this.passageLayer?.destroy(true);
    this.passageLayer = undefined;
    this.passageSegs = [];
    if (links.length === 0) return;
    const layer = this.add.container(0, 0).setDepth(1);
    layer.setAlpha(PASSAGE_ALPHA_IDLE);
    const segs: [number, number, number, number][] = [];
    for (const l of links) {
      const a = this.roomRects.get(l.from);
      const b = this.roomRects.get(l.to);
      if (!a || !b) continue;
      const ax = a.centerX;
      const ay = a.centerY;
      const bx = b.centerX;
      const by = b.centerY;
      segs.push([ax, ay, bx, by]);
      const steps = Math.max(2, Math.floor(Math.hypot(bx - ax, by - ay) / (DOT * 12)));
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        // 계단: x를 먼저 옮기고 y를 옮기는 도트 2×2 마크.
        const px = Math.round((ax + (bx - ax) * k) / DOT) * DOT;
        const py = Math.round((ay + (by - ay) * k) / DOT) * DOT;
        layer.add(
          this.add
            .rectangle(px, py, DOT * 2, DOT * 2, PAL.gold, 0.55)
            .setOrigin(0.5),
        );
      }
    }
    this.passageLayer = layer;
    this.passageSegs = segs;
  }

  /**
   * 커서가 통로 선 근처면 드러내고 아니면 다시 잠근다(뷰1과 같은 규칙).
   * 뷰4는 카메라를 뷰1에서 미러링하므로 줌도 그쪽 값을 쓴다.
   */
  private updatePassageHover(): void {
    const layer = this.passageLayer;
    if (!layer || this.passageSegs.length === 0) return;
    const p = this.input.activePointer;
    const zoom = this.cameras.main.zoom || 1;
    const near = p.active
      ? this.passageSegs.some(
          ([ax, ay, bx, by]) =>
            distToSegPx(p.worldX, p.worldY, ax, ay, bx, by) <
            PASSAGE_HOVER_PX / zoom,
        )
      : false;
    const want = near ? PASSAGE_ALPHA_HOVER : PASSAGE_ALPHA_IDLE;
    if (Math.abs(layer.alpha - want) < 0.01) return;
    this.tweens.killTweensOf(layer);
    this.tweens.add({ targets: layer, alpha: want, duration: PASSAGE_FADE_MS });
  }

  /** 승리 — 왕관 도트 + 화면 금색 프레임(§2 뷰4 칸). `null`이면 해제. */
  setOutcome(o: ViewOutcome | null): void {
    for (const fx of this.outcomeFx) {
      this.tweens.killTweensOf(fx);
      fx.destroy();
    }
    this.outcomeFx = [];
    if (!o) return;
    const t = this.tokens.get(o.winnerId);
    if (t) {
      // 왕관 = 도트 5칸(밑변 + 뿔 3).
      const crown = this.add.container(t.c.x, t.c.y - CELL * 0.62).setDepth(7);
      crown.add(this.add.rectangle(0, DOT, DOT * 5, DOT, PAL.gold));
      for (const dx of [-DOT * 2, 0, DOT * 2]) {
        crown.add(this.add.rectangle(dx, -DOT, DOT, DOT * 2, PAL.gold));
      }
      this.outcomeFx.push(crown);
    }
    // 화면 금색 프레임 — 카메라에 고정(스크롤 무시).
    const cam = this.cameras.main;
    const frame = this.add
      .rectangle(0, 0, cam.width, cam.height, 0x000000, 0)
      .setOrigin(0)
      .setStrokeStyle(DOT * 3, PAL.gold)
      .setScrollFactor(0)
      .setDepth(90);
    this.outcomeFx.push(frame);
  }

  // ── 계약: 자원 해제(§9.3) ────────────────────────────────
  /**
   * 씬 종료·파괴에서 호출된다. 절차적 잔디 텍스처는 `TextureManager`에 **영구 등록**
   * 되므로 씬이 내려가도 GPU에 남는다 — 여기서 명시적으로 회수한다.
   */
  dispose(): void {
    this.clearBubbles();
    this.tokens.forEach((t) => {
      this.tweens.killTweensOf(t.c);
      t.c.destroy();
    });
    this.tokens.clear();
    this.loot.forEach((s) => {
      this.tweens.killTweensOf(s.c);
      s.c.destroy();
    });
    this.loot.clear();
    this.helpers.forEach((c) => c.destroy());
    this.helpers.clear();
    this.setOutcome(null);
    this.passageLayer?.destroy(true);
    this.passageLayer = undefined;
    this.roomRects.clear();
    this.roomTopLine.clear();
    this.surveyDots.clear();
    if (this.textures.exists(GRASS_TEX)) this.textures.remove(GRASS_TEX);
  }
}
