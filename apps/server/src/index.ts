import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ClueRoom } from "./rooms/clue-room";
import { currentModel, hasApiKey } from "./ai/narrator";
import { healthSnapshot } from "./ai/telemetry";
import {
  clientKey,
  createJoinGuard,
  joinByIdTarget,
  JOIN_MAX_EXISTING_PER_WINDOW,
} from "./util/join-guard";

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

/**
 * 룸 타입 레지스트리 — **주제(콘텐츠) 하나당 한 줄.**
 * 클라 `network.ts`의 `RoomType`과 같은 문자열 집합이어야 한다(두 곳이 갈라지면 방이 안 열린다).
 *
 * ⚠️ 지금 등록된 주제는 클루 하나뿐이다. 표를 만든 것은 `define` 호출을 한 곳으로 모아
 * 두 번째 주제를 여기 한 줄로 붙이게 하려는 것일 뿐, **없는 주제를 있는 것처럼 세지 않는다.**
 */
/**
 * 🔴 **참가 시도에 대가를 붙인다.** 54회차가 방 코드를 «부를 수 있게» 만들며 엔트로피를
 * 2⁵⁴ → 2⁴⁰으로 깎았는데, 추측에 아무 대가가 없어 실측 **초당 9,615회**가 통했다.
 *
 * **Colyseus가 쓰는 것과 같은 수법으로 한 겹 더 감싼다** — `Server.attachMatchMakingRoutes`는
 * 기존 `request` 리스너를 걷어내고(`Server.js:169-170`) 자기 것을 걸어 매치메이크가 아니면
 * 원래 리스너들에 넘긴다. 그래서 **`new Server(...)` 뒤에** 같은 일을 한 번 더 하면
 * 우리 문지기가 **가장 바깥**에 선다. (그전에 걸면 Colyseus가 걷어내 버린다 — 순서가 전부다.)
 */
const missGuard = createJoinGuard();
const existingGuard = createJoinGuard(JOIN_MAX_EXISTING_PER_WINDOW);
/** 프록시 홉 수. `TRUST_PROXY=1`은 «프록시 한 겹». 0(기본)이면 헤더를 안 믿는다. */
const trustProxyHops = Number(process.env.TRUST_PROXY ?? 0) || 0;

/** 429·프리플라이트 응답도 Colyseus와 **같은 CORS**를 써야 브라우저가 안 버린다. */
const corsFor = (req: IncomingMessage): Record<string, string> => ({
  /* 🔴 `*`를 쓰면 안 된다 — `colyseus.js`는 항상 `withCredentials`를 붙이고,
     자격증명 요청에 `ACAO: *`는 CORS 위반이라 **브라우저가 응답을 통째로 버린다.**
     그러면 사용자는 429가 아니라 «네트워크 오류»를 본다(검수 지적 · 교차 오리진 배포와
     dev의 `:5173 → :2567`이 전부 그 경우다). Colyseus의 `getCorsHeaders`와 같은 규칙이다. */
  "Access-Control-Allow-Origin": (req.headers.origin as string | undefined) ?? "*",
  "Access-Control-Allow-Credentials": "true",
});

{
  const inner = httpServer.listeners("request").slice(0) as ((
    req: IncomingMessage,
    res: ServerResponse,
  ) => void)[];
  httpServer.removeAllListeners("request");
  httpServer.on("request", (req, res) => {
    /* 🔴 **`async` 예외가 새면 응답이 영영 안 나가고 프로세스가 죽는다.**
       초안은 리스너 자체를 `async`로 두었고, `%ZZ` 하나에 `URIError`가 나
       **요청 한 개로 서버가 내려갔다**(검수 실증). 안쪽을 감싸고 밖은 동기로 둔다. */
    void (async () => {
      try {
        if (!(await passesJoinGuard(req, res))) return;
      } catch (e) {
        console.error("[zodiac-clue] 참가 문지기 예외(통과시킨다):", e);
      }
      for (const l of inner) l.call(httpServer, req, res);
    })();
  });
}

/** 통과시킬지 판단한다. `false`면 이 함수가 이미 응답을 끝냈다. */
async function passesJoinGuard(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  /* 🔴 **`POST`만 본다.** 브라우저는 참가 한 번마다 `OPTIONS` 프리플라이트를 먼저 보내고,
     초안은 그것까지 «없는 방»으로 셌다 — 실효 상한이 20이 아니라 **10**이었고(검수 실측),
     걸리는 지점이 프리플라이트라 사용자에게는 원인 불명 실패가 됐다.
     같은 경로의 `GET`은 Colyseus에서 «공개방 목록»이라 추측 대상이 아니다. */
  if (req.method !== "POST") return true;
  const target = joinByIdTarget(
    req.url,
    matchMaker.controller.allowedRoomNameChars,
    matchMaker.controller.matchmakeRoute,
  );
  if (target === null) return true;

  const key = clientKey(req.headers, req.socket.remoteAddress, trustProxyHops);
  const now = Date.now();

  const deny = (waitMs: number, msg: string): boolean => {
    res.writeHead(429, {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(Math.max(1, Math.ceil(waitMs / 1000))),
      "Cache-Control": "no-store",
      ...corsFor(req),
    });
    res.end(JSON.stringify({ error: msg }));
    return false;
  };

  /* 🔴 **먼저 «있는 방인가»를 묻고, 그 다음에 문지기를 세운다.**
     순서를 뒤집으면 예산이 마른 IP는 **있는 방에도 못 들어간다**(실측 429).
     한 Wi-Fi를 쓰는 파티 게임에서 남의 오타가 나를 가두는 것은 자물쇠가 아니라 사고다.
     ⚠️ Colyseus는 «없음»과 «잠김»에 **같은 4212**를 쓰고 실패에도 HTTP 200을 쓴다 —
        응답으로는 못 가르므로 여기서 직접 묻는다. 만석·시작됨은 방이 **있으므로** 안 센다. */
  let missing: boolean;
  try {
    missing = (await matchMaker.query({ roomId: target })).length === 0;
  } catch (e) {
    /* 🔴 **fail-open이 아니라 fail-closed다.** 조회가 죽으면 참가 자체가 어차피 안 된다
       (같은 드라이버를 매치메이커도 쓴다) — 그런데 통과시키면 그 순간 자물쇠만 꺼진다.
       공격자가 그 상태를 유도할 수 있다(검수 지적). */
    console.warn("[zodiac-clue] 참가 문지기: 방 조회 실패(없는 방으로 센다):", e);
    missing = true;
  }

  if (missing) {
    if (!missGuard.allow(key, now)) {
      return deny(
        missGuard.retryAfterMs(key, now),
        `없는 방을 너무 자주 찾았어요. ${Math.max(1, Math.ceil(missGuard.retryAfterMs(key, now) / 1000))}초 뒤에 다시 시도해 주세요.`,
      );
    }
    missGuard.recordMiss(key, now);
    return true;
  }

  /* 있는 방도 **무제한은 아니다** — `joinById`는 호출마다 좌석 예약을 하나 잡으므로
     코드를 아는 사람이 반복하면 그 방을 영구히 봉쇄할 수 있다(검수 실증). 예산은 훨씬 느슨하다. */
  if (!existingGuard.allow(key, now)) {
    return deny(
      existingGuard.retryAfterMs(key, now),
      `참가 요청이 너무 잦아요. ${Math.max(1, Math.ceil(existingGuard.retryAfterMs(key, now) / 1000))}초 뒤에 다시 시도해 주세요.`,
    );
  }
  existingGuard.recordMiss(key, now);
  return true;
}

const ROOM_TYPES = { clue: ClueRoom } as const;

for (const [type, room] of Object.entries(ROOM_TYPES)) {
  gameServer.define(type, room);
}

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
