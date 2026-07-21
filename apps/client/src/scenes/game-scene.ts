import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  ROOM_REGIONS,
  emoji,
  inFeast,
  label,
  roomAt,
} from "@zodiac-clue/shared";

// 셀 크기 = 근접(줌 1.0) 기준 해상도. 크게 잡아 줌 1.0에서 선명하게 보이도록.
export const CELL = 40;
export const BOARD_W = GRID_WIDTH * CELL;
export const BOARD_H = GRID_HEIGHT * CELL;

const PLAYER_COLORS = [
  0xef4444, 0xf59e0b, 0x84cc16, 0x22c55e, 0x38bdf8, 0xa855f7,
];
const MOVE_COOLDOWN_MS = 110;
const MOVE_TWEEN_MS = 110; // 칸 이동 보간

// 카메라: 근접(1.0)이 기본·최대 근처, 축소(<1)로 전체 조망
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.25;
const INIT_ZOOM = 1.0;
const CAM_LERP = 0.12; // 내 캐릭터 추적(빠름)
const SLOW_LERP = 0.06; // NPC 턴 추적(천천히)
const PAN_STEP = 48;
const CAM_SWITCH_DELAY = 900; // 턴 바뀔 때 카메라 전환 지연(반증 먼저 인지 → 덜 어지러움)
const TYPE_MS = 55; // 대사 타이핑 속도(글자당) — 추후 TTS 속도에 맞춤
const BUBBLE_HOLD_MS = 2600; // 타이핑 완료 후 유지

// 보드 팔레트 (한옥/사극 톤)
const C_CORRIDOR = 0x2a2118;
const C_GRID = 0x5a4a34;
const C_ROOM = 0xcbb489;
const C_ROOM_EDGE = 0x7c6238;
const C_GOLD = 0xffd479;

type Token = {
  c: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Arc;
  disc: Phaser.GameObjects.Arc;
  face: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
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
  private followId = "";
  private followTarget?: Phaser.GameObjects.Container;
  private camSwitchTimer?: Phaser.Time.TimerEvent;
  private bubbleTimers = new Map<string, Phaser.Time.TimerEvent>();
  private weaponSprites = new Map<string, Phaser.GameObjects.Text>();
  private helperSprites = new Map<string, Phaser.GameObjects.Container>();

  constructor() {
    super("game");
  }

  create(): void {
    this.room = this.registry.get("room") as Room;
    this.myId = this.room.sessionId;
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

    // 자유시점 중 드래그 팬
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.freeLook || !p.isDown) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });

    // 특수키(Space, hold) = 자유시점 토글
    this.input.keyboard?.on("keydown-SPACE", () => this.setFreeLook(true));
    this.input.keyboard?.on("keyup-SPACE", () => this.setFreeLook(false));

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
      if (now - this.lastMove < MOVE_COOLDOWN_MS) return;
      this.lastMove = now;
      this.room.send("move", { dx, dy });
    });
  }

  /** 우측 패널(기록/노트)이 가리는 폭(px). 그만큼 카메라 중심을 왼쪽으로 보정. */
  private rightInset(): number {
    const el = document.getElementById("rightPanel");
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, window.innerWidth - r.left);
  }

  /** 보이는 영역 중앙에 대상이 오도록 하는 followOffset.x (월드 단위). */
  private insetOffset(): number {
    return -this.rightInset() / 2 / this.cam.zoom;
  }

  /** 매 프레임: 말풍선 위치 + 우측 패널 보정(줌·드래그에 실시간 반응). */
  update(): void {
    this.bubbles.forEach((b, id) => {
      const t = this.tokens.get(id);
      if (t) b.setPosition(t.c.x, t.c.y - CELL * 0.95);
    });
    if (this.cam) this.cam.followOffset.x = this.insetOffset();
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
    this.add.rectangle(0, 0, BOARD_W, BOARD_H, C_CORRIDOR).setOrigin(0);
    const grid = this.add.graphics();
    grid.lineStyle(1, C_GRID, 0.9);
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
    feast.fillStyle(0x3a2b1a, 1);
    feast.fillRoundedRect(fx, fy, fw, fh, 16);
    feast.lineStyle(3, 0xb8933f, 1);
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
        color: "#d8c188",
      })
      .setOrigin(0.5);

    // 방 (한지 바닥 + 테두리 + 명패)
    for (const r of ROOM_REGIONS) {
      const x = r.x * CELL;
      const y = r.y * CELL;
      const w = r.w * CELL;
      const h = r.h * CELL;
      const g = this.add.graphics();
      g.fillStyle(C_ROOM, 1);
      g.fillRoundedRect(x, y, w, h, 12);
      g.lineStyle(3, C_ROOM_EDGE, 1);
      g.strokeRoundedRect(x, y, w, h, 12);

      const name = label(r.name);
      const plW = Math.min(w - 16, name.length * 20 + 24);
      const plaque = this.add.graphics();
      plaque.fillStyle(0x2b2013, 0.92);
      plaque.fillRoundedRect(x + 10, y + 10, plW, 30, 7);
      this.add
        .text(x + 10 + plW / 2, y + 25, name, {
          fontSize: "18px",
          color: "#f0d9a8",
        })
        .setOrigin(0.5);

      // 입구(door) — 이 칸으로만 출입
      const dcx = r.door.x * CELL + CELL / 2;
      const dcy = r.door.y * CELL + CELL / 2;
      this.add
        .rectangle(dcx, dcy, CELL * 0.9, CELL * 0.9, 0x2a2118, 1)
        .setStrokeStyle(2, C_GOLD);
      this.add
        .text(dcx, dcy, "🚪", { fontSize: `${Math.floor(CELL * 0.6)}px` })
        .setOrigin(0.5);
    }
  }

  // ── 말(플레이어/NPC) 렌더 ──
  private render(state: Room["state"]): void {
    const players = state.players as Map<string, PlayerView>;
    const ids = [...players.keys()];
    const current = (state.currentTurn as string) ?? "";
    const seen = new Set<string>();

    players.forEach((p, id) => {
      seen.add(id);
      const token =
        this.tokens.get(id) ?? this.createToken(id, ids.indexOf(id), p);
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
          duration: MOVE_TWEEN_MS,
          ease: "Quad.Out",
        });
      }

      const isCurrent = id === current;
      token.ring.setVisible(isCurrent);
      token.disc.setStrokeStyle(2, isCurrent ? C_GOLD : 0xffffff);
      const alpha = p.eliminated ? 0.3 : 1;
      token.disc.setAlpha(alpha);
      token.face.setAlpha(alpha);
      token.name.setAlpha(alpha);
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
        s.setStroke("#2a2118", 4);
        this.weaponSprites.set(key, s);
      } else if (s.x !== cx || s.y !== cy) {
        this.tweens.killTweensOf(s);
        this.tweens.add({ targets: s, x: cx, y: cy, duration: 260, ease: "Quad.Out" });
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
          .circle(0, 0, CELL * 0.42, 0x2b2013)
          .setStrokeStyle(2, 0x8a6a3a);
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
            color: "#e0a35a",
            backgroundColor: "#000000aa",
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5, 0);
        c = this.add.container(cx, cy, [disc, face, mark, tag]).setDepth(1);
        this.helperSprites.set(key, c);
      }
      c.setAlpha(h.used ? 0.3 : 1);
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
          isMe ? 150 : CAM_SWITCH_DELAY,
          () => {
            if (this.followId !== followId || this.freeLook) return;
            this.cam.stopFollow();
            this.cam.pan(
              t.x - this.insetOffset(),
              t.y,
              isMe ? 350 : 1000,
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
        color: "#2a2118",
        backgroundColor: "#f0e0c0",
        padding: { x: 8, y: 4 },
        align: "center",
        wordWrap: { width: 260 },
      })
      .setOrigin(0.5, 1)
      .setDepth(100);
    this.bubbles.set(id, bubble);

    // 타이핑 효과 (추후 TTS 속도에 맞춰 TYPE_MS 조정)
    let i = 0;
    const timer = this.time.addEvent({
      delay: TYPE_MS,
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
          this.time.delayedCall(BUBBLE_HOLD_MS, () => {
            if (this.bubbles.get(id) === bubble) {
              this.bubbles.delete(id);
              bubble.destroy();
            }
          });
        }
      },
    });
    this.bubbleTimers.set(id, timer);
  }

  private createToken(id: string, index: number, p: PlayerView): Token {
    const color = PLAYER_COLORS[index % PLAYER_COLORS.length];
    const ring = this.add
      .circle(0, 0, CELL * 0.55, 0x000000, 0)
      .setStrokeStyle(3, C_GOLD)
      .setVisible(false);
    const disc = this.add
      .circle(0, 0, CELL * 0.4, color)
      .setStrokeStyle(2, 0xffffff);
    const face = this.add
      .text(0, 0, emoji(p.suspect), {
        fontSize: `${Math.floor(CELL * 0.52)}px`,
      })
      .setOrigin(0.5);
    const name = this.add
      .text(0, CELL * 0.55, `${p.isBot ? "🤖" : ""}${p.name}`, {
        fontSize: "13px",
        color: "#f0e9dc",
        backgroundColor: "#000000aa",
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 0);
    const c = this.add.container(0, 0, [ring, disc, face, name]);
    const token: Token = { c, ring, disc, face, name, placed: false };
    this.tokens.set(id, token);
    return token;
  }
}
