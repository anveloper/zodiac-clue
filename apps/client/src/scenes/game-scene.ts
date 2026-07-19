import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  ROOM_REGIONS,
  emoji,
  label,
} from "@zodiac-clue/shared";

const CELL = 20;
const PLAYER_COLORS = [
  0xef4444, 0xf59e0b, 0xe5e7eb, 0x22c55e, 0x3b82f6, 0xa855f7,
];
const MOVE_COOLDOWN_MS = 110;

export class GameScene extends Phaser.Scene {
  private room!: Room;
  private sprites = new Map<string, Phaser.GameObjects.Rectangle>();
  private tags = new Map<string, Phaser.GameObjects.Text>();
  private lastMove = 0;

  constructor() {
    super("game");
  }

  create(): void {
    this.room = this.registry.get("room") as Room;
    this.drawMap();

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

  private drawMap(): void {
    // 방(장소) 영역
    for (const r of ROOM_REGIONS) {
      this.add
        .rectangle(r.x * CELL, r.y * CELL, r.w * CELL, r.h * CELL, 0x2a2a35)
        .setOrigin(0);
      this.add.text(r.x * CELL + 4, r.y * CELL + 4, label(r.name), {
        fontSize: "11px",
        color: "#8890a8",
      });
    }
    // 그리드 라인
    const g = this.add.graphics();
    g.lineStyle(1, 0x2c2c36, 1);
    for (let x = 0; x <= GRID_WIDTH; x++) {
      g.lineBetween(x * CELL, 0, x * CELL, GRID_HEIGHT * CELL);
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      g.lineBetween(0, y * CELL, GRID_WIDTH * CELL, y * CELL);
    }
  }

  private render(state: Room["state"]): void {
    const players = state.players as Map<string, PlayerView>;
    const ids = [...players.keys()];
    const seen = new Set<string>();

    players.forEach((p, id) => {
      seen.add(id);
      let rect = this.sprites.get(id);
      if (!rect) {
        const color = PLAYER_COLORS[ids.indexOf(id) % PLAYER_COLORS.length];
        rect = this.add
          .rectangle(0, 0, CELL - 4, CELL - 4, color)
          .setOrigin(0);
        this.sprites.set(id, rect);
        const tag = this.add
          .text(0, 0, `${emoji(p.suspect)} ${p.name}`, {
            fontSize: "9px",
            color: "#ffffff",
          })
          .setOrigin(0, 1);
        this.tags.set(id, tag);
      }
      rect.setPosition(p.x * CELL + 2, p.y * CELL + 2);
      rect.setAlpha(p.eliminated ? 0.3 : 1);
      this.tags.get(id)?.setPosition(p.x * CELL, p.y * CELL);
    });

    for (const id of [...this.sprites.keys()]) {
      if (!seen.has(id)) {
        this.sprites.get(id)?.destroy();
        this.sprites.delete(id);
        this.tags.get(id)?.destroy();
        this.tags.delete(id);
      }
    }
  }
}

type PlayerView = {
  name: string;
  suspect: string;
  x: number;
  y: number;
  eliminated: boolean;
};
