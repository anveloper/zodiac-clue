#!/usr/bin/env node
/**
 * 참가 문지기 게이트 — **실제로 서버를 띄워 때려 본다.**
 *
 * 왜 텍스트 검사로는 안 되는가(55회차 검수 실증): 소스에 `createJoinGuard(`가 있는지만 보면
 * **감싸기 블록을 `new Server(...)` 앞으로 옮겨 자물쇠를 통째로 끈 상태**도 PASS가 난다.
 * 그때 실제 서버는 없는 코드 40회를 전부 통과시켰다(차단 0). 같은 검수가 두 개의 우회를
 * 더 찾았다 — `joinById//` 경로 변형(초당 35,088 통과)과 `%ZZ` 한 방(프로세스 사망).
 * **그 셋은 전부 «소스에 무엇이 적혔나»가 아니라 «요청을 보내면 무슨 일이 나나»다.**
 *
 * 그래서 이 게이트는 임의 포트에 서버를 띄우고 HTTP로 묻는다. 느리므로(≈3s) 전체 모드 전용이다.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = process.argv.includes("--json");
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

/** 남의 포트를 쓰지 않는다 — 빈 포트를 스스로 고른다(화면 게이트와 같은 규약). */
const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await freePort();
const bin = join(ROOT, "apps/server/node_modules/.bin/tsx");
const child = spawn(bin, ["src/index.ts"], {
  cwd: join(ROOT, "apps/server"),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

const base = `http://127.0.0.1:${port}`;
const post = (path, headers = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" })
    .then(async (r) => ({ status: r.status, headers: r.headers, body: await r.text() }))
    .catch((e) => ({ status: 0, err: e.message, headers: new Headers(), body: "" }));

const stop = () => {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* 이미 죽었으면 그만 */
  }
};

let up = false;
for (let i = 0; i < 100; i++) {
  const r = await fetch(`${base}/health`).catch(() => null);
  if (r?.ok) {
    up = true;
    break;
  }
  await sleep(100);
}
if (!up) {
  stop();
  const why = `서버를 못 띄웠다(포트 ${port}) — 의존성이 설치돼 있나\n${log.slice(-400)}`;
  if (json) console.log(JSON.stringify({ ok: false, skip: why, fails: [] }));
  else console.log(`\n  SKIP  ${why}\n  이것은 «통과»가 아니다.`);
  process.exit(3);
}

try {
  /* ① **깨진 인코딩 한 방에 죽지 않는가.** 초안은 `decodeURIComponent`가 `URIError`를 던지고
     그것이 `async` 리스너 안이라 **요청 하나로 프로세스가 내려갔다.** */
  await post("/matchmake/joinById/%ZZ");
  await post("/matchmake/joinById/%E0%A4%A");
  const alive = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false);
  ok(alive, "깨진 퍼센트 인코딩 요청 뒤 서버가 죽는다 — 인증 없이 원격에서 판을 전부 날릴 수 있다");
  if (!alive) throw new Error("서버가 죽어 이후 검사를 못 한다");

  /* ② **경로 변형으로 새지 않는가.** 문지기와 라우터가 서로 다른 URL을 보면 그 틈으로 다 지나간다. */
  const burn = async (mk, n) =>
    (await Promise.all(Array.from({ length: n }, (_, i) => post(mk(i))))).filter((r) => r.status === 429).length;
  const straight = await burn((i) => `/matchmake/joinById/AAAA${String(i).padStart(4, "0")}`, 60);
  ok(straight > 0, "없는 코드를 60번 던져도 하나도 안 막힌다 — 문지기가 배선돼 있지 않다");
  for (const [label, mk] of [
    ["joinById//", (i) => `/matchmake/joinById//BB${String(i).padStart(4, "0")}`],
    ["matchmake//joinById", (i) => `/matchmake//joinById/CC${String(i).padStart(4, "0")}`],
    ["대문자 경로", (i) => `/matchmake/joinById/DD${String(i).padStart(4, "0")}?x=1`],
  ]) {
    const blocked = await burn(mk, 40);
    ok(blocked > 0, `경로 변형 «${label}»이 문지기를 우회한다 — 라우터와 다른 눈으로 보고 있다`);
  }

  /* ③ **프리플라이트는 예산을 안 먹는다.** 먹으면 실효 상한이 절반이 되고, 걸리는 지점이
     `OPTIONS`라 사용자에게는 원인 불명 실패가 된다. */
  const pre = await fetch(`${base}/matchmake/joinById/EEEE0001`, { method: "OPTIONS" }).catch(() => null);
  ok(pre !== null && pre.status !== 429, "프리플라이트(OPTIONS)가 429를 받는다 — 예산을 먹고 있다");

  /* ④ **거절 응답이 브라우저에 도달하는가.** `ACAO: *` + 자격증명 요청은 CORS 위반이라
     브라우저가 응답을 통째로 버린다 — 사용자는 429 대신 «네트워크 오류»를 본다. */
  const denied = await post("/matchmake/joinById/FFFF0001", { Origin: "https://example.test" });
  ok(denied.status === 429, `예산을 다 쓴 뒤에도 안 막힌다(${denied.status})`);
  ok(
    denied.headers.get("access-control-allow-origin") === "https://example.test",
    `429의 CORS가 오리진을 안 돌려준다(${denied.headers.get("access-control-allow-origin")}) — 브라우저가 응답을 버린다`,
  );
  ok(denied.headers.get("access-control-allow-credentials") === "true", "429에 `Allow-Credentials`가 없다 — 브라우저가 응답을 버린다");
  ok(Number(denied.headers.get("retry-after")) >= 1, "`Retry-After`가 없거나 0이다");
  let msg = "";
  try {
    msg = JSON.parse(denied.body).error ?? "";
  } catch {
    /* 아래에서 잡힌다 */
  }
  ok(/초 뒤에 다시/.test(msg), `거절 문안이 사람 말이 아니다: ${denied.body.slice(0, 80)}`);

  /* ⑤ **있는 방으로 가는 길이 살아 있는가.** 예산이 마른 IP가 정상 참가까지 못 하면
     한 Wi-Fi를 쓰는 파티 게임에서 남의 오타가 나를 가둔다.
     ⚠️ 방은 **HTTP 매치메이킹**으로 만든다 — `colyseus.js`를 직접 import하면 직렬화기가
        등록되지 않아 소켓이 열리는 순간 죽는다(첫 판에 그렇게 깨졌다). 여기 필요한 것은
        «진짜 방 id» 하나뿐이므로 소켓을 열 이유가 없다. */
  const made = await post("/matchmake/create/clue");
  let roomId = "";
  try {
    roomId = JSON.parse(made.body)?.room?.roomId ?? "";
  } catch {
    /* 아래에서 잡힌다 */
  }
  ok(roomId !== "", `방을 못 만들어 «있는 방» 검사를 못 했다(${made.status} ${made.body.slice(0, 80)})`);
  if (roomId) {
    const real = await post(`/matchmake/joinById/${roomId}`);
    ok(real.status !== 429, "예산이 마르면 «있는 방»에도 못 들어간다 — 남의 오타가 나를 가둔다");
  }
} catch (e) {
  ok(false, `검사 중 예외 — ${e.message}`);
} finally {
  stop();
}

if (json) {
  console.log(JSON.stringify({ ok: fails.length === 0, fails }));
} else {
  console.log("\n── 참가 문지기 게이트 (실서버 HTTP) ───────────────────────────");
  for (const f of fails.filter(Boolean)) console.log(`      FAIL  ${f}`);
  console.log(
    fails.length ? `\n  결과: FAIL — ${fails.length}건` : "\n  결과: PASS — 우회로가 없고, 정상 참가는 안 막힌다.",
  );
}
process.exit(fails.length ? 1 : 0);
