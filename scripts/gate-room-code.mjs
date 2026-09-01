#!/usr/bin/env node
/**
 * 방 코드 게이트 — **부를 수 있는 코드**의 불변량을 지킨다.
 *
 * 왜 별도 검사인가: 54회차가 `roomId`를 Crockford base32로 바꿨는데, 그 축을 재는 것이
 * 하나도 없었다. 화면 게이트는 코드를 **그리기만** 하고 모양을 판정하지 않으며,
 * 정규화(`ABC-123`·소문자·`O`→`0`)와 «옛 형식은 건드리지 않는다»는 규약은
 * 화면에 아예 안 나타난다. 저장소 규칙: **게이트가 못 재는 것을 새로 만들지 마라.**
 *
 * 서버·브라우저가 필요 없는 순수 함수 검사라 `quick`에 넣는다.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages/shared/src/engine/room-code.ts");
/* 🔴 **공용 모듈만 보면 «서버가 그걸 쓰는지»를 못 잰다.** 검수가 서버의 `assignRoomCode`를
   `Math.random` + 자기 알파벳(I·L·O 포함)으로 통째로 갈아 끼웠는데 이 게이트가 **PASS**를 줬다. */
const SERVER = join(ROOT, "apps/server/src/rooms/clue-room.ts");
/* 자물쇠는 **두 짝**이다 — 엔트로피(코드)와 대가(레이트리밋). 한쪽만 재면 다른 쪽이
   조용히 사라진다. 55회차가 뒤쪽을 붙였으므로 같은 게이트가 함께 본다. */
const GUARD = join(ROOT, "apps/server/src/util/join-guard.ts");
const ENTRY = join(ROOT, "apps/server/src/index.ts");
const json = process.argv.includes("--json");

/* 공용 모듈은 TS다. 빌드 산출물이 없으므로 **소스에서 값을 읽어** 같은 규약을 다시 세운다.
   ⚠️ 여기서 구현을 «다시 쓰면» 검사가 구현을 따라 틀린다 — 그래서 읽는 것은
      알파벳·길이·정규식 **선언 세 줄뿐**이고, 동작은 아래에서 그 선언으로만 판정한다. */
const src = readFileSync(SRC, "utf8");
const pick = (re, what) => {
  const m = src.match(re);
  if (!m) {
    console.error(`  FAIL  ${what}을 소스에서 못 읽었다 — 선언이 바뀌었나(${SRC})`);
    process.exit(1);
  }
  return m[1];
};
const ALPHABET = pick(/ROOM_CODE_ALPHABET = "([^"]+)"/, "알파벳");
const GROUP = Number(pick(/ROOM_CODE_GROUP = (\d+)/, "끊음 단위"));
const LEN = Number(pick(/ROOM_CODE_LEN = (\d+)/, "길이"));
const RE_SRC = pick(/ROOM_CODE_RE = \/(\S+)\//, "정규식");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

/* ① 알파벳에 «혼동 쌍»이 남아 있으면 안 된다. 이 검사가 이 게이트의 존재 이유다 —
      53회차가 등폭 서체로 «모양»만 고치고 알파벳은 그대로 뒀다가 검수에서 뒤집혔다. */
for (const ch of "ILOU") ok(!ALPHABET.includes(ch), `알파벳에 «${ch}»가 있다 — 0/O·1/I/L 혼동이 되살아난다`);
ok(!/[a-z]/.test(ALPHABET), "알파벳에 소문자가 있다 — 대소문자를 구분해 불러야 한다");
ok(!/[-_]/.test(ALPHABET), "알파벳에 «-» 또는 «_»가 있다 — 한국어로 부를 말이 없다");
ok(new Set(ALPHABET).size === ALPHABET.length, "알파벳에 중복 글자가 있다");
/* ② 모듈로 편향 — 256 % n === 0 이어야 `byte % n`이 고르다. */
ok(256 % ALPHABET.length === 0, `256 % ${ALPHABET.length} !== 0 — 바이트→글자에 모듈로 편향이 생긴다`);

/* ②-b **끊는 자리는 «읽기 단위»여야 한다.** 3~4자가 전화번호가 오래 쓴 단위다.
   1~2자로 끊으면 끊는 것이 아니라 흩는 것이고, `LEN`과 같으면 안 끊은 것이다.
   ⚠️ 초안은 `shown === slice(0,GROUP)+"-"+slice(GROUP)`만 봤는데, 양변을 **같은 상수로**
      만들었으니 `GROUP`을 1로 바꿔도 통과하는 **항진식**이었다(검수 결함 주입 ④). */
ok(GROUP >= 3 && GROUP <= 4, `끊음 단위가 ${GROUP}자다 — 3~4자가 아니면 «불러 주기»에 도움이 안 된다`);
ok(LEN % GROUP === 0, `길이 ${LEN}이 끊음 ${GROUP}으로 안 나눠떨어진다 — 조각 길이가 들쭉날쭉해진다`);

/* ③ 정규식이 알파벳과 **같은 집합**이어야 한다. 둘이 갈라지면 만들 수는 있는데
      칠 수 없는 코드가 생긴다(또는 그 반대). */
const RE1 = new RegExp(`^[${RE_SRC.replace(/^\^\[|\]\{\d+\}\$$/g, "")}]$`);
for (let c = 0x20; c < 0x7f; c++) {
  const ch = String.fromCharCode(c);
  ok(ALPHABET.includes(ch) === RE1.test(ch), `«${ch}» 가 알파벳과 정규식에서 엇갈린다`);
}
ok(new RegExp(RE_SRC).source.includes(`{${LEN}}`), `정규식 길이가 ROOM_CODE_LEN(${LEN})과 다르다`);

/* ④ **서버가 이 모듈을 실제로 쓰는가.** 안 보면 서버가 자기 알파벳을 써도 이 게이트는 초록이다. */
const srv = readFileSync(SERVER, "utf8");
/* ⚠️ 파일 전체에서 `Math.random`을 찾으면 **게임 난수까지** 잡는다(첫 판에 그렇게 걸렸다).
   보는 것은 코드를 만드는 함수 **본문 하나**다. */
const body = (() => {
  const i = srv.indexOf("private async assignRoomCode");
  if (i < 0) return null;
  const j = srv.indexOf("\n  }", i);
  return j < 0 ? null : srv.slice(i, j);
})();
if (!body) {
  ok(false, `서버에서 \`assignRoomCode\` 본문을 못 찾았다(${SERVER}) — 이름이 바뀌었나`);
} else {
  ok(/roomCodeFromBytes\s*\(/.test(body), "`assignRoomCode`가 `roomCodeFromBytes`를 안 쓴다 — 공용 알파벳을 우회한다");
  ok(/randomBytes\s*\(/.test(body), "`assignRoomCode`가 `randomBytes`를 안 쓴다 — 비공개 방의 자물쇠가 예측 가능해진다");
  ok(!/Math\.random/.test(body), "`assignRoomCode`에 `Math.random`이 있다 — 그것은 자물쇠가 아니다");
  ok(/this\.roomId\s*=/.test(body), "`assignRoomCode`가 `roomId`를 대입하지 않는다 — 코드가 방 id가 아니다");
  ok(new RegExp(`ROOM_CODE_LEN`).test(body), "`assignRoomCode`가 길이를 공용 상수에서 안 가져온다");
}

/* ⑤ 동작 — 화면에 보이는 대로 친 것이 그대로 들어가야 한다. */
const mod = await import(pathToFileURL(SRC).href).catch((e) => ({ __err: e }));
if (mod.__err) {
  /* 🔴 **«못 쟀다»를 PASS로 찍지 않는다.** 초안은 SKIP 한 줄을 인쇄하고 exit 0을 줬는데,
     그 줄은 `--json` 경로(=verify가 쓰는 길)에는 **나오지도 않았다.** 이 저장소의 하한은
     Node 20(`package.json engines`)이고 거기엔 타입 스트리핑이 없다 — 즉 실행기에 따라
     동작 검사가 통째로 사라진 채 초록이 나온다(검수 지적). exit 3 = 판정 불가. */
  const why = `동작 검사를 못 돌렸다 — 이 실행기가 TS 모듈을 직접 못 읽는다(${mod.__err.message})`;
  if (json) console.log(JSON.stringify({ ok: false, skip: why, fails }));
  else console.log(`\n  SKIP  ${why}\n  이것은 «통과»가 아니다.`);
  process.exit(3);
}
const { normalizeRoomCode, formatRoomCode, roomCodeFromBytes } = mod;
const bytes = (seed) => Uint8Array.from({ length: LEN }, (_, i) => (i * 7 + seed * 29) % 256);
const sample = roomCodeFromBytes(bytes(0));
ok(new RegExp(RE_SRC).test(sample), `생성된 코드가 모양을 안 지킨다: ${sample}`);
/* 난수를 무시하고 늘 같은 값을 돌려줘도 초안은 통과했다(검수 결함 주입). */
ok(roomCodeFromBytes(bytes(3)) !== sample, "서로 다른 바이트열이 같은 코드를 낸다 — 난수를 안 쓴다");
/* 바이트가 모자라면 조용히 `0`으로 채우면 안 된다 — 자물쇠에 구멍이 뚫린다. */
let threw = false;
try {
  roomCodeFromBytes(new Uint8Array(LEN - 1));
} catch {
  threw = true;
}
ok(threw, "바이트가 모자라도 코드를 만든다 — 부족분이 한 글자로 몰린다");
/* 🔴 **선언의 `256 % 32`를 검산하는 것으로는 «구현이 그 값을 쓰는지»를 못 본다** —
   검수가 `% ROOM_CODE_ALPHABET.length`를 `% 31`로 바꿨는데 초안이 통과시켰다.
   그래서 **출력에서** 본다: 바이트 0..255를 전부 넣으면 알파벳의 **모든 글자가**,
   그리고 **알파벳 밖 글자는 하나도** 나와야 한다. `% 31`이면 마지막 글자가 영영 안 나온다. */
const produced = new Set();
for (let b = 0; b < 256; b++) produced.add(roomCodeFromBytes(new Uint8Array(LEN).fill(b))[0]);
for (const ch of ALPHABET) ok(produced.has(ch), `«${ch}»가 어떤 바이트로도 안 나온다 — 구현이 다른 나머지를 쓴다`);
for (const ch of produced) ok(ALPHABET.includes(ch), `알파벳에 없는 «${ch}»가 나온다`);
const shown = formatRoomCode(sample);
/* 끊는 «자리»까지 본다. 초안은 `includes("-")`만 봐서 `A-BC123`도 통과했다(검수 결함 주입). */
ok(shown === `${sample.slice(0, GROUP)}-${sample.slice(GROUP)}`, `끊는 자리가 ROOM_CODE_GROUP(${GROUP})과 다르다: ${shown}`);
ok(normalizeRoomCode(` ${shown.toLowerCase()} `) === sample, `보이는 대로 친 값이 안 돌아온다: ${shown}`);
ok(normalizeRoomCode("O".repeat(LEN)) === "0".repeat(LEN), "Crockford 입력 규약 O→0 이 깨졌다");
ok(normalizeRoomCode("IL".repeat(LEN / 2)) === "1".repeat(LEN), "Crockford 입력 규약 I·L→1 이 깨졌다");
/* 옛 형식(`nanoid`)을 새 코드로 오인하면 **옛 링크가 남의 방으로 간다.**
   ⚠️ 표본을 하나만 두면 안 된다 — 초안은 `gkzuKFC5_` 하나만 봤고, 그건 하필 `_` 때문에
      안 걸리는 표본이었다. 하이픈이 낀 옛 id가 진짜 함정이다(검수 실증). */
for (const old of ["gkzuKFC5_", "xy-z1-2-3", "A-B-C1-23", "aE5sox2sU", "6rLjQ-Z0x"]) {
  ok(normalizeRoomCode(old) === null, `옛 형식 «${old}»를 새 코드로 오인한다 — 참가가 남의 방으로 간다`);
  ok(formatRoomCode(old) === old, `옛 형식 «${old}»를 표시할 때 가공한다`);
}

/* ⑦ **대가(레이트리밋)** — 없는 방을 찍어 보는 데 값이 붙어 있는가. */
const guard = await import(pathToFileURL(GUARD).href).catch((e) => ({ __err: e }));
if (guard.__err) {
  ok(false, `참가 문지기를 못 읽었다 — ${guard.__err.message}`);
} else {
  const { createJoinGuard, clientKey, joinByIdTarget, JOIN_MAX_PER_WINDOW, JOIN_WINDOW_MS, JOIN_MAX_KEYS } = guard;
  /* 상한은 «사람은 안 걸리고 기계는 걸리는» 사이여야 한다. 사람이 **없는** 코드를
     분당 5번 넘게 치는 일은 드물고, 100을 넘으면 자물쇠라고 부를 수 없다. */
  ok(JOIN_MAX_PER_WINDOW >= 5 && JOIN_MAX_PER_WINDOW <= 100, `창당 상한 ${JOIN_MAX_PER_WINDOW}은 «사람은 통과·기계는 차단» 범위(5~100) 밖이다`);
  ok(JOIN_WINDOW_MS >= 10_000 && JOIN_WINDOW_MS <= 600_000, `창 길이 ${JOIN_WINDOW_MS}ms가 10초~10분 밖이다`);

  const g = createJoinGuard(3, 1000);
  const t = 1_000_000; // 시계는 주입한다 — 게이트가 실제 시간을 기다리면 안 된다
  ok(g.allow("a", t), "첫 시도가 막힌다");
  for (let i = 0; i < 3; i++) g.recordMiss("a", t + i);
  ok(!g.allow("a", t + 3), "예산을 넘겨도 안 막힌다");
  ok(g.allow("b", t + 3), "남의 예산이 나를 막는다 — 키가 안 갈린다");
  /* 🔴 **거절을 기록하면 공격자가 창을 영원히 연장한다.** 막힌 채로 계속 두드리면
     기록이 밀려 창이 끝나지 않는다 — 그러면 정상 사용자만 갇힌다. */
  ok(!g.allow("a", t + 900), "창 안인데 예산이 풀린다");
  ok(g.allow("a", t + 1001), "창이 지나도 안 풀린다 — 거절을 기록하고 있다(창이 영원히 연장된다)");
  /* ⚠️ 위에서 시계를 창 밖으로 넘겼으므로 `g`의 기억은 이미 비었다 —
     남은 시간은 **새 문지기**로 잰다(같은 통을 재사용하면 0이 나와 검사가 거짓으로 통과한다). */
  const g2 = createJoinGuard(3, 1000);
  for (let i = 0; i < 3; i++) g2.recordMiss("a", t + i);
  const wait = g2.retryAfterMs("a", t + 3);
  ok(wait > 0 && wait <= 1000, `남은 시간(${wait}ms)이 창 길이를 벗어난다`);
  ok(g2.retryAfterMs("c", t) === 0, "한 번도 안 온 키에 대기 시간이 있다");
  ok(g2.size() === 1, `기억하는 키 수가 틀렸다(${g2.size()})`);
  ok(createJoinGuard(3, 1000).size() === 0, "아무 일도 없었는데 키를 센다");

  /* `X-Forwarded-For`를 그냥 믿으면 헤더 한 줄로 상한을 무한히 우회한다. */
  const hdr = { "x-forwarded-for": "9.9.9.9, 10.0.0.1" };
  ok(clientKey(hdr, "1.2.3.4", 0) === "1.2.3.4", "홉 수 0인데 `X-Forwarded-For`를 읽는다 — 위조로 상한을 우회할 수 있다");
  /* 🔴 **맨 왼쪽은 클라이언트가 써 넣은 값이다.** 표준 프록시는 오른쪽에 덧붙인다 —
     왼쪽을 쓰면 헤더 한 줄로 상한이 무한히 열린다(검수 실증: 200회 전부 통과). */
  ok(clientKey(hdr, "1.2.3.4", 1) === "10.0.0.1", "프록시 한 겹인데 맨 왼쪽(=위조 가능)을 쓴다");
  ok(clientKey(hdr, "1.2.3.4", 2) === "9.9.9.9", "홉 수만큼 왼쪽으로 못 간다");
  ok(clientKey({}, undefined, 0) === "unknown", "IP가 없을 때 키가 비어 버린다");

  /* 🔴 **기억이 무한히 자라면 안 된다.** 초안은 상한도 축출도 없어 서로 다른 키 100만 개에
     heap이 **+301.4 MB** 늘고 창이 지나도 안 줄었다(검수 실측). */
  ok(JOIN_MAX_KEYS > 0 && JOIN_MAX_KEYS <= 200_000, `키 상한 ${JOIN_MAX_KEYS}이 범위 밖이다`);
  const g3 = createJoinGuard(3, 1000, 50);
  for (let i = 0; i < 2000; i++) g3.recordMiss(`k${i}`, t + i);
  ok(g3.size() <= 50, `키 상한을 안 지킨다(${g3.size()} > 50) — 기억이 무한히 자란다`);
  const g4 = createJoinGuard(3, 1000);
  for (let i = 0; i < 100; i++) g4.recordMiss(`m${i}`, t);
  ok(g4.evict(t + 5000) === 100 && g4.size() === 0, `창이 지난 통을 안 버린다(${g4.size()}개 남음)`);

  /* 토크나이저는 **라우터의 것을 주입받는다** — 두 파서가 갈리면 그 틈으로 다 지나간다.
     아래 값은 `@colyseus/core`의 `matchmaker/controller.js`가 쓰는 바로 그것이고,
     서버가 실제로 그것을 넘기는지는 `index.ts` 검사로 본다(아래). */
  const CHARS = /([a-zA-Z_\-0-9]+)/gi;
  const T = (u) => joinByIdTarget(u, CHARS, "matchmake");
  ok(T("/matchmake/joinById/ABCD1234") === "ABCD1234", "참가 경로에서 방 id를 못 뽑는다");
  /* 🔴 검수가 실제로 뚫은 변형들 — 라우터는 토큰으로 보므로 이것들도 «참가»다. */
  ok(T("/matchmake/joinById//ABCD1234") === "ABCD1234", "«joinById//» 변형을 못 본다 — 문지기가 통째로 우회된다");
  ok(T("/matchmake//joinById/ABCD1234") === "ABCD1234", "«matchmake//joinById» 변형을 못 본다");
  ok(T("/matchmake/joinById/ABCD1234?x=1") === "ABCD1234", "질의 문자열이 붙으면 못 본다");
  /* 깨진 퍼센트 인코딩에 **예외를 던지면 안 된다** — 그 예외가 서버를 죽였다. */
  let threw2 = false;
  try {
    T("/matchmake/joinById/%ZZ");
  } catch {
    threw2 = true;
  }
  ok(!threw2, "깨진 퍼센트 인코딩에 예외를 던진다 — 요청 하나로 프로세스가 죽는다");
  ok(T("/matchmake/create/clue") === null, "방 만들기까지 문지기에 건다 — 추측할 것이 없는 길이다");
  ok(T("/matchmake/clue") === null, "공개방 목록까지 문지기에 건다");
  ok(T("/health") === null, "헬스까지 문지기에 건다");
  /* 배선 하나만은 여기서 본다 — **주입원이 라우터인가.** 이것이 어긋나면 위 검사가 전부 헛것이 된다. */
  const entry = readFileSync(ENTRY, "utf8");
  ok(
    /matchMaker\.controller\.allowedRoomNameChars/.test(entry),
    "서버가 라우터의 토크나이저를 안 넘긴다 — 문지기와 라우터가 다른 눈으로 보게 된다",
  );

  /* ⚠️ **배선은 여기서 안 잰다.** 초안이 `entry` 문자열에 정규식을 돌렸는데,
     검수가 «감싸기를 `new Server` 앞으로 옮긴» 상태를 그대로 통과시켰다 —
     소스에 글자가 있는 것과 그 코드가 **일을 하는 것**은 다르다.
     그 축은 `scripts/gate-join-guard.mjs`가 **실서버 HTTP**로 잰다(전체 모드). */
}

if (json) {
  console.log(JSON.stringify({ ok: fails.length === 0, fails }));
} else {
  console.log("\n── 방 코드 자물쇠 게이트 ───────────────────────────────────────");
  console.log(`  알파벳 ${ALPHABET.length}자 · 길이 ${LEN} · 경우의 수 ${(ALPHABET.length ** LEN).toLocaleString("ko")}`);
  console.log(`  대가: 창 ${guard.JOIN_WINDOW_MS ?? "?"}ms 안에 «없는 방» ${guard.JOIN_MAX_PER_WINDOW ?? "?"}회까지`);
  for (const f of fails) console.log(`      FAIL  ${f}`);
  console.log(
    fails.length
      ? `\n  결과: FAIL — ${fails.length}건`
      : "\n  결과: PASS — 부를 수 있고, 보이는 대로 칠 수 있고, 찍어 보는 데 값이 붙는다.",
  );
}
process.exit(fails.length ? 1 : 0);
