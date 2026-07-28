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
  timingOf,
  zodiacColor,
  zodiacCue,
  type MotionProfile,
  type ViewTiming,
  type ZodiacFamily,
} from "@zodiac-clue/shared";
import { currentTiming, cvdMode } from "./view-motion";

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
  placed: boolean;
};

export class PixelScene extends Phaser.Scene {
  private room!: Room;
  private tokens = new Map<string, Critter>();
  private loot = new Map<string, Phaser.GameObjects.Container>();
  private helpers = new Map<string, Phaser.GameObjects.Container>();
  private bubbles = new Map<string, Phaser.GameObjects.Text>();
  private bubbleTimers = new Map<string, Phaser.Time.TimerEvent>();
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
    // 표시 여부는 setStage가 sys.setVisible로 제어(뷰4에서만 보임).
  }

  /** 16px 잔디 타일 텍스처를 절차적으로 생성. */
  private makeGrassTexture(): void {
    if (this.textures.exists("px-grass")) return;
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
    g.generateTexture("px-grass", 16, 16);
    g.destroy();
  }

  /** 픽셀 보드: 잔디 바닥 + 방(판자 패널) + 문 + 중앙 잔치상. */
  private drawBoard(): void {
    this.add
      .tileSprite(0, 0, BOARD_W, BOARD_H, "px-grass")
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
      this.pixelPanel(x, y, w, h, PAL.roomEdge, PAL.room, PAL.roomHi);

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

      // 문(입구)
      const dcx = r.door.x * CELL + CELL / 2;
      const dcy = r.door.y * CELL + CELL / 2;
      this.add
        .rectangle(dcx, dcy, CELL * 0.9, CELL * 0.9, PAL.wood)
        .setStrokeStyle(3, PAL.gold)
        .setDepth(1);
      this.add
        .rectangle(dcx, dcy, CELL * 0.34, CELL * 0.62, PAL.woodDark)
        .setDepth(2); // 문짝
      this.add
        .text(dcx, dcy + CELL * 0.5, "입구", {
          fontFamily: "monospace",
          fontSize: "11px",
          color: hexString(PAL.ink),
          backgroundColor: hexString(PAL.gold),
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5, 0)
        .setDepth(3);
    }
  }

  /** 사각 픽셀 패널: 바깥 테두리 + 안쪽 채움 + 상단 하이라이트 라인(도트 입체감). */
  private pixelPanel(
    x: number,
    y: number,
    w: number,
    h: number,
    edge: number,
    fill: number,
    hi: number,
  ): void {
    this.add.rectangle(x, y, w, h, edge).setOrigin(0).setDepth(0);
    this.add
      .rectangle(x + 3, y + 3, w - 6, h - 6, fill)
      .setOrigin(0)
      .setDepth(0);
    this.add.rectangle(x + 3, y + 3, w - 6, 3, hi).setOrigin(0).setDepth(0); // 상단 하이라이트
    this.add.rectangle(x + 3, y + 3, 3, h - 6, hi).setOrigin(0).setDepth(0); // 좌측 하이라이트
  }

  /**
   * 도트 캐릭터(크리터) — 몸통 블록 + 귀 + 눈.
   *
   * 시그니처가 `color`가 아니라 `suspect`인 이유: 색은 십이지 고유값(§4)에서 파생되고,
   * 실루엣 12종(§2.3)도 같은 키로 갈라진다. 색을 인자로 받으면 두 번 고쳐야 한다.
   */
  private makeCritter(
    suspect: string,
    opts: { gray?: boolean } = {},
  ): {
    c: Phaser.GameObjects.Container;
    eyes: Phaser.GameObjects.GameObject[];
    elimEyes: Phaser.GameObjects.GameObject[];
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
    const c = this.add.container(0, 0, [
      earL,
      earR,
      body,
      ...eyes,
      ...elimEyes,
      ...cue,
    ]);
    return { c, eyes, elimEyes };
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
    const cell = d * 8;
    const cy = s * 0.16; // 몸통 하단
    const white = 0xffffff;
    const bars: Record<ZodiacFamily, [number, number, number, number]> = {
      red: [-cell / 2 + d, cy, d * 2, cell],
      jade: [0, cy - cell / 2 + d, cell, d * 2],
      violet: [cell / 2 - d, cy, d * 2, cell],
      blue: [0, cy + cell / 2 - d, cell, d * 2],
    };
    const [bx, by, bw, bh] = bars[cue.family];
    const out = [this.add.rectangle(bx, by, bw, bh, white)];
    const n = cue.tier + 1;
    for (let i = 0; i < n; i++) {
      out.push(
        this.add.rectangle((i - (n - 1) / 2) * d * 2, cy, d, d, white),
      );
    }
    return out;
  }

  /** 감속 프로파일 전환(§1.3). */
  setMotion(p: MotionProfile): void {
    this.timing = timingOf(p);
  }

  update(): void {
    if (!this.scene.isVisible()) return;
    this.mirrorCamera();
    this.syncTokens();
    this.bubbles.forEach((b, id) => {
      const anchor = this.tokens.get(id)?.c ?? this.helpers.get(id);
      if (anchor) b.setPosition(anchor.x, anchor.y - CELL * 0.9);
    });
  }

  /** NPC/계략 대사 말풍선(도트 톤 + 타자기). say 라우팅에서 뷰1과 동일하게 호출. */
  showBubble(id: string, text: string): void {
    const anchor = this.tokens.get(id)?.c ?? this.helpers.get(id);
    if (!anchor) return;
    this.bubbleTimers.get(id)?.remove();
    this.bubbleTimers.delete(id);
    this.bubbles.get(id)?.destroy();
    const b = this.add
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
    this.bubbles.set(id, b);

    // 수명·타자기 속도는 4뷰 공용값 — 뷰4만 3200ms 하드코딩이던 것을 제거했다.
    const total = bubbleLifeMs(text, this.timing);
    const typeMs = this.timing.TYPE_MS;
    const expire = (): void => {
      if (this.bubbles.get(id) === b) {
        this.bubbles.delete(id);
        b.destroy();
      }
    };
    if (typeMs <= 0) {
      b.setText(text);
      this.time.delayedCall(total, expire);
      return;
    }
    let i = 0;
    const timer = this.time.addEvent({
      delay: typeMs,
      loop: true,
      callback: () => {
        if (this.bubbles.get(id) !== b) {
          timer.remove();
          return;
        }
        i += 1;
        b.setText(text.slice(0, i));
        if (i >= text.length) {
          timer.remove();
          this.bubbleTimers.delete(id);
          this.time.delayedCall(Math.max(0, total - text.length * typeMs), expire);
        }
      },
    });
    this.bubbleTimers.set(id, timer);
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
      const cx = p.x * CELL + CELL / 2;
      const cy = p.y * CELL + CELL / 2;
      let t = this.tokens.get(id);
      if (!t) {
        // 현재 턴 링은 도트 문법상 **사각**(원형 금지) — §2 계약 표 setCurrent 뷰4 칸.
        const ring = this.add
          .rectangle(0, 2, CELL * 0.86, CELL * 0.82, 0x000000, 0)
          .setStrokeStyle(3, RING_CURRENT)
          .setVisible(false);
        const critter = this.makeCritter(p.suspect);
        // 이름표 좌측 색 스트라이프 — 색과 이름을 같은 픽셀에(§4.2).
        const nameTxt = this.add
          .text(0, CELL * 0.5, `${p.isBot ? "🤖" : ""}${p.name}`, {
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
            zodiacColor(p.suspect),
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
          placed: true,
        };
        this.tokens.set(id, t);
      } else if (t.c.x !== cx || t.c.y !== cy) {
        this.tweens.killTweensOf(t.c);
        this.tweens.add({
          targets: t.c,
          x: cx,
          y: cy,
          duration: this.timing.MOVE_TWEEN_MS,
          ease: "Quad.Out",
        });
      }
      t.ring.setVisible(id === current);
      t.c.setAlpha(p.eliminated ? ELIM_ALPHA : 1);
      // 알파 단독 금지(§1.2) — 탈락은 눈을 ✕ 도트로 바꿔 2중 표기한다.
      for (const e of t.eyes) (e as Phaser.GameObjects.Rectangle).setVisible(!p.eliminated);
      for (const e of t.elimEyes) {
        (e as Phaser.GameObjects.Rectangle).setVisible(p.eliminated);
      }
    });

    // 장물(도트 상자)
    state.weapons.forEach((w, key) => {
      const cx = w.x * CELL + CELL / 2;
      const cy = w.y * CELL + CELL / 2;
      let s = this.loot.get(key);
      if (!s) {
        const box = this.add
          .rectangle(0, 0, CELL * 0.5, CELL * 0.4, PAL.loot)
          .setStrokeStyle(3, PAL.ink);
        const lid = this.add.rectangle(0, -CELL * 0.16, CELL * 0.56, CELL * 0.12, PAL.gold).setStrokeStyle(2, PAL.ink);
        s = this.add.container(cx, cy, [box, lid]).setDepth(4);
        this.loot.set(key, s);
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

    // 고정 NPC(계략) — 실루엣은 십이지대로, 색만 채도를 낮춘 크리터 + 태그
    state.helpers.forEach((h, key) => {
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
      }
      c.setAlpha(h.used ? SPENT_ALPHA : 1);
    });

    for (const id of [...this.tokens.keys()]) {
      if (!seen.has(id)) {
        this.tokens.get(id)?.c.destroy();
        this.tokens.delete(id);
        // 퇴장 시 말풍선·타이머까지 정리(계약 §2 removeActor).
        this.bubbleTimers.get(id)?.remove();
        this.bubbleTimers.delete(id);
        this.bubbles.get(id)?.destroy();
        this.bubbles.delete(id);
      }
    }
  }
}
