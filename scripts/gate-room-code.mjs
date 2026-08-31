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

if (json) {
  console.log(JSON.stringify({ ok: fails.length === 0, fails }));
} else {
  console.log("\n── 방 코드 게이트 ─────────────────────────────────────────────");
  console.log(`  알파벳 ${ALPHABET.length}자 · 길이 ${LEN} · 경우의 수 ${(ALPHABET.length ** LEN).toLocaleString("ko")}`);
  for (const f of fails) console.log(`      FAIL  ${f}`);
  console.log(fails.length ? `\n  결과: FAIL — ${fails.length}건` : "\n  결과: PASS — 부를 수 있고, 보이는 대로 칠 수 있다.");
}
process.exit(fails.length ? 1 : 0);
