import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  ROOM_REGIONS,
  emoji,
  label,
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
const CAM_LERP = 0.12;
const PAN_STEP = 48;

// 보드 팔레트 (한옥/사극 톤)
const C_CORRIDOR = 0x2a2118;
const C_GRID = 0x3a2e20;
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
  private myTarget?: Phaser.GameObjects.Container;
  private freeLook = false;

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
      // 정통 클루: 내 턴 + 이동 한도가 남았을 때만 이동
      const s = this.room.state as unknown as {
        currentTurn: string;
        stepsLeft: number;
      };
      if (s.currentTurn !== this.myId || (s.stepsLeft ?? 0) <= 0) return;
      const now = this.time.now;
      if (now - this.lastMove < MOVE_COOLDOWN_MS) return;
      this.lastMove = now;
      this.room.send("move", { dx, dy });
    });
  }

  /** 매 프레임 말풍선을 해당 말 위치에 붙여둔다(트윈 중에도 따라오도록). */
  update(): void {
    this.bubbles.forEach((b, id) => {
      const t = this.tokens.get(id);
      if (t) b.setPosition(t.c.x, t.c.y - CELL * 0.95);
    });
  }

  /** 자유시점 on/off — off 시 내 캐릭터로 부드럽게 복귀. */
  private setFreeLook(on: boolean): void {
    if (this.freeLook === on) return;
    this.freeLook = on;
    if (on) {
      this.cam.stopFollow();
    } else if (this.myTarget) {
      this.cam.startFollow(this.myTarget, true, CAM_LERP, CAM_LERP);
    }
  }

  // ── 보드 그리기 (복도 + 방 + 중앙 잔치상) ──
  private drawBoard(): void {
    this.add.rectangle(0, 0, BOARD_W, BOARD_H, C_CORRIDOR).setOrigin(0);
    const grid = this.add.graphics();
    grid.lineStyle(1, C_GRID, 0.5);
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
      .text(fx + fw / 2, fy + fh / 2 - 20, "🎁", { fontSize: "52px" })
      .setOrigin(0.5);
    this.add
      .text(fx + fw / 2, fy + fh / 2 + 34, "잔치상", {
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
      if (id === this.myId && this.myTarget !== token.c) {
        this.myTarget = token.c;
        if (!this.freeLook) {
          this.cam.startFollow(token.c, true, CAM_LERP, CAM_LERP);
        }
      }

      const [ox, oy] = tokenOffset(id);
      const cx = p.x * CELL + CELL / 2 + ox;
      const cy = p.y * CELL + CELL / 2 + oy;

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

    for (const id of [...this.tokens.keys()]) {
      if (!seen.has(id)) {
        this.tokens.get(id)?.c.destroy();
        this.tokens.delete(id);
        this.bubbles.get(id)?.destroy();
        this.bubbles.delete(id);
      }
    }
  }

  /** NPC 대사 말풍선을 해당 말 위에 잠시 띄운다. */
  showBubble(id: string, text: string): void {
    const token = this.tokens.get(id);
    if (!token) return;
    this.bubbles.get(id)?.destroy();
    const bubble = this.add
      .text(token.c.x, token.c.y - CELL * 0.95, text, {
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
    this.time.delayedCall(4200, () => {
      if (this.bubbles.get(id) === bubble) this.bubbles.delete(id);
      bubble.destroy();
    });
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

/** id 기반 결정적 소량 오프셋 — 같은 칸에 여럿 있어도 겹치지 않게. */
const tokenOffset = (id: string): [number, number] => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ox = (((h % 5) - 2) * CELL) / 7;
  const oy = ((((h >> 3) % 5) - 2) * CELL) / 7;
  return [ox, oy];
};
