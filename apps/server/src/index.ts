import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ClueRoom } from "./rooms/clue-room";

// apps/server/.env 로드(있으면). 키는 커밋 금지(.gitignore).
try {
  process.loadEnvFile();
} catch {
  /* .env 없으면 무시 → 폴백 대사 사용 */
}

const port = Number(process.env.PORT) || 2567;

const gameServer = new Server({
  transport: new WebSocketTransport(),
});

gameServer.define("clue", ClueRoom);

gameServer
  .listen(port)
  .then(() => {
    console.log(`[zodiac-clue] Colyseus listening on ws://localhost:${port}`);
    console.log(
      `[zodiac-clue] NPC 대사: ${process.env.GEMINI_API_KEY ? "Gemini ON" : "폴백(규칙)"}`,
    );
  })
  .catch((err) => {
    console.error("[zodiac-clue] failed to start:", err);
    process.exit(1);
  });
