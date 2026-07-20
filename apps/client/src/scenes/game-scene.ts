import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  ROOM_REGIONS,
  emoji,
  label,
} from "@zodiac-clue/shared";

export const CELL = 24;
export const BOARD_W = GRID_WIDTH * CELL;
export const BOARD_H = GRID_HEIGHT * CELL;

const PLAYER_COLORS = [
  0xef4444, 0xf59e0b, 0x84cc16, 0x22c55e, 0x38bdf8, 0xa855f7,
];
const MOVE_COOLDOWN_MS = 110;

// 보드 팔레트 (한옥/사극 톤)
const C_CORRIDOR = 0x2a2118;
const C_GRID = 0x3a2e20;
const C_ROOM = 0xcbb489;
const C_ROOM_EDGE = 0x7c6238;
const C_GOLD = 0xffd479;

type Token = {
  ring: Phaser.GameObjects.Arc;
  disc: Phaser.GameObjects.Arc;
  face: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
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

  constructor() {
    super("game");
  }

  create(): void {
    this.room = this.registry.get("room") as Room;
    this.drawBoard();

    this.room.onStateChange((state) => this.render(state));

    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
      const now = this.time.now;
      if (now - this.lastMove < MOVE_COOLDOWN_MS) return;
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case "ArrowUp":
        case "w":
          dy = -1;
          break;
        case "ArrowDown":
        case "s":
          dy = 1;
          break;
        case "ArrowLeft":
        case "a":
          dx = -1;
          break;
        case "ArrowRight":
        case "d":
          dx = 1;
          break;
        default:
          return;
      }
      this.lastMove = now;
      this.room.send("move", { dx, dy });
    });
  }

  // ── 보드 그리기 (복도 + 방 + 중앙 잔치상) ──
  private drawBoard(): void {
    // 복도 바닥
    this.add.rectangle(0, 0, BOARD_W, BOARD_H, C_CORRIDOR).setOrigin(0);
    const grid = this.add.graphics();
    grid.lineStyle(1, C_GRID, 0.5);
    for (let x = 0; x <= GRID_WIDTH; x++) {
      grid.lineBetween(x * CELL, 0, x * CELL, BOARD_H);
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      grid.lineBetween(0, y * CELL, BOARD_W, y * CELL);
    }

    // 중앙 잔치상 (클루의 중앙 카드 자리)
    const fx = 9 * CELL;
    const fy = 9 * CELL;
    const fw = 6 * CELL;
    const fh = 6 * CELL;
    const feast = this.add.graphics();
    feast.fillStyle(0x3a2b1a, 1);
    feast.fillRoundedRect(fx, fy, fw, fh, 12);
    feast.lineStyle(2, 0xb8933f, 1);
    feast.strokeRoundedRect(fx, fy, fw, fh, 12);
    this.add
      .text(fx + fw / 2, fy + fh / 2 - 12, "🎁", { fontSize: "30px" })
      .setOrigin(0.5);
    this.add
      .text(fx + fw / 2, fy + fh / 2 + 20, "잔치상", {
        fontSize: "13px",
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
      g.fillRoundedRect(x, y, w, h, 8);
      g.lineStyle(2, C_ROOM_EDGE, 1);
      g.strokeRoundedRect(x, y, w, h, 8);

      const name = label(r.name);
      const plW = Math.min(w - 10, name.length * 13 + 18);
      const plaque = this.add.graphics();
      plaque.fillStyle(0x2b2013, 0.92);
      plaque.fillRoundedRect(x + 6, y + 6, plW, 20, 5);
      this.add
        .text(x + 6 + plW / 2, y + 16, name, {
          fontSize: "12px",
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
      const token = this.tokens.get(id) ?? this.createToken(id, ids.indexOf(id), p);
      const [ox, oy] = tokenOffset(id);
      const cx = p.x * CELL + CELL / 2 + ox;
      const cy = p.y * CELL + CELL / 2 + oy;
      token.ring.setPosition(cx, cy);
      token.disc.setPosition(cx, cy);
      token.face.setPosition(cx, cy);
      token.name.setPosition(cx, cy + CELL * 0.5);
      this.bubbles.get(id)?.setPosition(cx, cy - CELL * 0.95);

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
        const t = this.tokens.get(id);
        t?.ring.destroy();
        t?.disc.destroy();
        t?.face.destroy();
        t?.name.destroy();
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
      .text(token.disc.x, token.disc.y - CELL * 0.95, text, {
        fontSize: "11px",
        color: "#2a2118",
        backgroundColor: "#f0e0c0",
        padding: { x: 6, y: 3 },
        align: "center",
        wordWrap: { width: 170 },
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
      .text(0, 0, `${p.isBot ? "🤖" : ""}${p.name}`, {
        fontSize: "9px",
        color: "#f0e9dc",
        backgroundColor: "#000000aa",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 0);
    const token: Token = { ring, disc, face, name };
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
