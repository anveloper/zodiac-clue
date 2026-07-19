import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ClueRoom } from "./rooms/clue-room";

const port = Number(process.env.PORT) || 2567;

const gameServer = new Server({
  transport: new WebSocketTransport(),
});

gameServer.define("clue", ClueRoom);

gameServer
  .listen(port)
  .then(() => {
    console.log(`[zodiac-clue] Colyseus listening on ws://localhost:${port}`);
  })
  .catch((err) => {
    console.error("[zodiac-clue] failed to start:", err);
    process.exit(1);
  });
