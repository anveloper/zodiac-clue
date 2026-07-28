import { createServer } from "node:http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ClueRoom } from "./rooms/clue-room";
import { currentModel, hasApiKey } from "./ai/narrator";
import { healthSnapshot } from "./ai/telemetry";

// apps/server/.env 로드(있으면). 키는 커밋 금지(.gitignore).
try {
  process.loadEnvFile();
} catch {
  /* .env 없으면 무시 → 폴백 대사 사용 */
}

const port = Number(process.env.PORT) || 2567;

/**
 * HTTP 계층 — `GET /health` 하나만 연다(④ §4-4).
 * WebSocket 전송과 **같은 포트**를 쓰도록 이 서버를 `WebSocketTransport`에 넘긴다.
 * 별도 포트를 열면 배포(단일 포트 노출)에서 헬스만 접근 불가가 된다.
 *
 * ⚠️ 응답에 **키 값은 어떤 형태로도 담지 않는다.** `hasApiKey()`가 boolean만 돌려주고,
 * 이 파일은 `process.env.GEMINI_API_KEY`를 읽지도 않는다.
 */
const httpServer = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
    const body = JSON.stringify(
      healthSnapshot({ hasKey: hasApiKey(), model: currentModel() }),
      null,
      2,
    );
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      // 심사자 화면(다른 오리진의 클라)이 칩·배지를 그리려면 읽을 수 있어야 한다.
      // 공개 정보(경로 분포·모델명)만 담기므로 전체 공개로 둔다.
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("clue", ClueRoom);

gameServer
  .listen(port)
  .then(() => {
    console.log(`[zodiac-clue] Colyseus listening on ws://localhost:${port}`);
    console.log(`[zodiac-clue] health: http://localhost:${port}/health`);
    console.log(
      `[zodiac-clue] NPC 대사: ${
        hasApiKey() ? `Gemini ON (${currentModel()})` : "폴백(규칙)"
      }`,
    );
  })
  .catch((err) => {
    console.error("[zodiac-clue] failed to start:", err);
    process.exit(1);
  });
