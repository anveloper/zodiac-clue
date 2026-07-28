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
  bubbleLifeMs,
  emoji,
  hexString,
  inFeast,
  label,
  roomAt,
  timingOf,
  zodiacColor,
  type MotionProfile,
  type ViewTiming,
} from "@zodiac-clue/shared";
import { acquireHudInset, hudInset, releaseHudInset } from "./hud-inset";
import { currentTiming } from "./view-motion";

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
 * 파선 사각형 — 탈락 2차 표기(§1.2 `ELIM_NEEDS_SECOND_CUE`).
 * 알파만으로는 저대비·회색조에서 탈락이 사라지므로 이름표에 파선을 두른다.
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
  placed: boolean;
};

type PlayerView = {
  name: string;
  suspect: string;
  isBot: boolean;
  x: number;
  y: number;
  eliminated: boolean;
};

export class GameScene extends Phaser.Scene {
  private room!: Room;
  private tokens = new Map<string, Token>();
  private bubbles = new Map<string, Phaser.GameObjects.Text>();
  private lastMove = 0;
  private cam!: Phaser.Cameras.Scene2D.Camera;
  private myId = "";
  private freeLook = false;
  private spaceHeld = false;
  private rightPan = false;
  private followId = "";
  private followTarget?: Phaser.GameObjects.Container;
  private camSwitchTimer?: Phaser.Time.TimerEvent;
  private bubbleTimers = new Map<string, Phaser.Time.TimerEvent>();
  private weaponSprites = new Map<string, Phaser.GameObjects.Text>();
  private helperSprites = new Map<string, Phaser.GameObjects.Container>();
  private insetHeld = false;
  /** 감속 프로파일 타이밍(§1.3). 보간 길이는 매번 여기서 재조회한다. */
  private timing: ViewTiming = currentTiming();

  constructor() {
    super("game");
  }

  create(): void {
    this.room = this.registry.get("room") as Room;
    this.myId = this.room.sessionId;
    // HUD 인셋 캐시 구독 — 씬이 내려갈 때 반드시 해제(ResizeObserver 누수 금지).
    this.holdInset();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dropInset());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.dropInset());
    this.drawBoard();

    // ── 카메라: 내 캐릭터 추적 탑뷰 (bounds 없음 → 캐릭터가 항상 중앙, 보드 밖 여백 허용) ──
    const cam = this.cameras.main;
    cam.setZoom(INIT_ZOOM);
    cam.centerOn(BOARD_W / 2, BOARD_H / 2);
    this.cam = cam;

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

  /** 매 프레임: 말풍선 위치 + HUD 패널 보정(줌·드래그에 실시간 반응). */
  update(): void {
    this.bubbles.forEach((b, id) => {
      const t = this.tokens.get(id);
      if (t) b.setPosition(t.c.x, t.c.y - CELL * 0.95);
    });
    if (this.cam) {
      this.cam.followOffset.x = this.insetOffset();
      this.cam.followOffset.y = this.insetOffsetY();
    }
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

      // 입구(door) — 이 칸으로만 출입. 밝은 금색 타일 + 🚪 + "입구" 라벨로 명확히.
      const dcx = r.door.x * CELL + CELL / 2;
      const dcy = r.door.y * CELL + CELL / 2;
      this.add
        .rectangle(dcx, dcy, CELL * 0.94, CELL * 0.94, BOARD.doorTile, 1)
        .setStrokeStyle(3, BOARD.gold);
      this.add
        .text(dcx, dcy - CELL * 0.08, "🚪", {
          fontSize: `${Math.floor(CELL * 0.55)}px`,
        })
        .setOrigin(0.5);
      this.add
        .text(dcx, dcy + CELL * 0.34, "입구", {
          fontSize: "11px",
          color: hexString(BOARD.corridor),
          backgroundColor: hexString(BOARD.gold),
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5);
    }
  }

  // ── 말(플레이어/NPC) 렌더 ──
  private render(state: Room["state"]): void {
    const players = state.players as Map<string, PlayerView>;
    const current = (state.currentTurn as string) ?? "";
    const seen = new Set<string>();

    players.forEach((p, id) => {
      seen.add(id);
      const token = this.tokens.get(id) ?? this.createToken(id, p);
      // 칸 정중앙에 정렬(겹침 방지는 서버가 빈 칸 배치로 처리)
      const cx = p.x * CELL + CELL / 2;
      const cy = p.y * CELL + CELL / 2;

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

      const isCurrent = id === current;
      token.ring.setVisible(isCurrent);
      token.disc.setStrokeStyle(
        TOKEN_OUTLINE_PX,
        isCurrent ? RING_CURRENT : TOKEN_OUTLINE_COLOR,
      );
      // 탈락 감쇠는 ring을 포함한 **토큰 전체**에(뷰2·3·4와 같은 정보 강도).
      const alpha = p.eliminated ? ELIM_ALPHA : 1;
      token.ring.setAlpha(alpha);
      token.disc.setAlpha(alpha);
      token.face.setAlpha(alpha);
      token.name.setAlpha(alpha);
      token.stripe.setAlpha(alpha);
      // 2차 표기(파선)는 감쇠 대상이 아니다 — 감쇠되면 2중 표기의 의미가 사라진다.
      token.elimDash.setVisible(p.eliminated);
    });

    // ── 장물(훔친 것) 토큰 렌더 ──
    const weapons = state.weapons as Map<
      string,
      { value: string; x: number; y: number }
    >;
    weapons.forEach((w, key) => {
      const cx = w.x * CELL + CELL / 2;
      const cy = w.y * CELL + CELL / 2;
      let s = this.weaponSprites.get(key);
      if (!s) {
        s = this.add
          .text(cx, cy, emoji(w.value), {
            fontSize: `${Math.floor(CELL * 0.5)}px`,
          })
          .setOrigin(0.5)
          .setDepth(2);
        s.setStroke(hexString(BOARD.corridor), 4);
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

    // ── 고정 NPC(계략) 렌더 ──
    const helpers = state.helpers as Map<
      string,
      { value: string; x: number; y: number; used: boolean }
    >;
    helpers.forEach((h, key) => {
      const cx = h.x * CELL + CELL / 2;
      const cy = h.y * CELL + CELL / 2;
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
      if (!seen.has(id)) {
        this.tokens.get(id)?.c.destroy();
        this.tokens.delete(id);
        this.bubbles.get(id)?.destroy();
        this.bubbles.delete(id);
        this.bubbleTimers.get(id)?.remove();
        this.bubbleTimers.delete(id);
      }
    }
  }

  /** NPC 대사 말풍선을 해당 말 위에 타이핑 효과로 띄운다. */
  showBubble(id: string, text: string): void {
    // 플레이어 토큰 또는 고정 NPC(계략) 스프라이트 위에 말풍선을 띄운다.
    const anchor = this.tokens.get(id)?.c ?? this.helperSprites.get(id);
    if (!anchor) return;
    // 이전 말풍선/타이머 정리
    this.bubbleTimers.get(id)?.remove();
    this.bubbleTimers.delete(id);
    this.bubbles.get(id)?.destroy();

    const bubble = this.add
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
    this.bubbles.set(id, bubble);

    // 총 수명은 shared `bubbleLifeMs`가 계산한다(서버 SPEAK_HOLD와 정합을 맞추는 지점).
    const total = bubbleLifeMs(text, this.timing);
    const typeMs = this.timing.TYPE_MS;
    const expire = (): void => {
      if (this.bubbles.get(id) === bubble) {
        this.bubbles.delete(id);
        bubble.destroy();
      }
    };

    // reduced 프로파일(TYPE_MS=0)은 타자기 없이 전문을 즉시 띄운다.
    if (typeMs <= 0) {
      bubble.setText(text);
      this.time.delayedCall(total, expire);
      return;
    }

    let i = 0;
    const timer = this.time.addEvent({
      delay: typeMs,
      loop: true,
      callback: () => {
        if (this.bubbles.get(id) !== bubble) {
          timer.remove();
          return;
        }
        i += 1;
        bubble.setText(text.slice(0, i));
        if (i >= text.length) {
          timer.remove();
          this.bubbleTimers.delete(id);
          this.time.delayedCall(Math.max(0, total - text.length * typeMs), expire);
        }
      },
    });
    this.bubbleTimers.set(id, timer);
  }

  private createToken(id: string, p: PlayerView): Token {
    // 색은 접속 순서가 아니라 `suspect`로 결정된다 — 판 도중에도 불변(§4).
    const color = zodiacColor(p.suspect);
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
      .text(0, 0, emoji(p.suspect), {
        fontSize: `${Math.floor(CELL * 0.52)}px`,
      })
      .setOrigin(0.5);
    const name = this.add
      .text(0, CELL * 0.55, `${p.isBot ? "🤖" : ""}${p.name}`, {
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
    ]);
    const token: Token = {
      c,
      ring,
      disc,
      face,
      name,
      stripe,
      elimDash,
      placed: false,
    };
    this.tokens.set(id, token);
    return token;
  }
}
