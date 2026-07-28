#!/usr/bin/env node
/**
 * 환각 검증기 — 제출물 ④ §3 "환각 검증 프로토콜"의 실행체.
 *   문서: docs/design/20260720-ai-tech-doc.md §2(디렉팅 명세) · §3(C1~C7) · §4(관측 가능성)
 *
 * 이 스크립트는 **읽기 전용**이다. 게임 규칙·상태·문서를 일절 바꾸지 않는다.
 * 검사 대상 함수는 미러링하지 않고 **실제 소스를 그대로 import**한다
 * (`apps/server/src/ai/narrator.ts` · `packages/shared/src/cards.ts`).
 * 미러링하면 "미러가 규약을 지킨다"만 증명되고 배포되는 코드는 증명되지 않는다.
 *
 * ── 모드 ────────────────────────────────────────────────────────────
 *   기본(=오프라인)  실호출 0. 폴백 경로를 **전수**로 판정한다.
 *   --live           Gemini 실호출. **명시적 플래그로만.** §5 무료 쿼터 보호 장치 4중:
 *                    ① 기본 아님 ② 콜 수 상한(--max-calls, 기본/최대 36)
 *                    ③ 실행 전 "몇 콜 쓰는지" 출력 + 중단 유예 ④ 키 없으면 거부
 *                    실행 계획 §7.2 ⑤ — eval 36콜은 심사자 몫 쿼터와 정면 충돌한다.
 *
 * ── 사용 ────────────────────────────────────────────────────────────
 *   node scripts/eval-narrator.mjs                 # 오프라인 전수 (기본)
 *   node scripts/eval-narrator.mjs --json          # 기계 판독용 JSON
 *   node scripts/eval-narrator.mjs --quick         # 전수 스윕 생략(36케이스만)
 *   node scripts/eval-narrator.mjs --live --yes    # 실호출 36콜 (사람이 결정)
 *   node scripts/eval-narrator.mjs --live --max-calls=6 --yes
 *
 * 종료 코드: 0 통과 / 1 규칙 실패 / 2 사용법·환경 오류(판정 자체를 못 함)
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), "..");

// ── 0. tsx 부트스트랩 ────────────────────────────────────────────────
// `apps/server`는 CJS 패키지라 ESM 훅 등록(register())만으로는 .ts를 못 읽는다
// (ERR_REQUIRE_CYCLE_MODULE). tsx 로더를 --import로 물린 채 자기 자신을 재실행한다.
if (!process.env.__EVAL_NARRATOR_TSX) {
  let loader;
  try {
    const req = createRequire(join(ROOT, "apps/server/package.json"));
    loader = join(dirname(req.resolve("tsx/package.json")), "dist/loader.mjs");
  } catch {
    console.error(
      "[eval] tsx를 찾지 못했다. `pnpm install` 후 다시 실행하라.\n" +
        "       (실제 narrator.ts를 import해야 하므로 TS 로더가 필수다 — 미러링하지 않는다.)",
    );
    process.exit(2);
  }
  const r = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(loader).href, SELF, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, __EVAL_NARRATOR_TSX: "1" } },
  );
  process.exit(r.status ?? 2);
}

// ── 1. 인자 ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const num = (pfx, dflt) => {
  const a = argv.find((x) => x.startsWith(pfx));
  return a === undefined ? dflt : Number(a.slice(pfx.length));
};

const OPT = {
  live: has("--live"),
  json: has("--json"),
  quick: has("--quick"),
  yes: has("--yes"),
  seed: num("--seed=", 20260728),
  maxCalls: num("--max-calls=", 36),
  showFailures: num("--show=", 8),
};
if (has("--help") || has("-h")) {
  console.log(readFileSync(SELF, "utf8").split("*/")[0]);
  process.exit(0);
}

const log = (...a) => {
  if (!OPT.json) console.log(...a);
};

// ── 1.5 쿼터 하드 가드 ──────────────────────────────────────────────
// 기본(오프라인) 모드에서는 **네트워크 자체를 막는다.** "실호출을 안 하도록 짰다"는
// 코드 리뷰로만 보증되지만, fetch 트랩은 실행으로 보증한다. 무료 쿼터는 심사 기간
// 내내 심사자와 공유하는 통이다(실행 계획 §7.2 ⑤).
// `AI_NARRATE=off`(narrator.ts의 킬 스위치)면 --live라도 왕복이 없어야 한다 —
// 그 계약을 트랩으로 강제해 "실호출 경로 리허설"을 쿼터 0으로 돌릴 수 있게 한다.
const dryLive = (process.env.AI_NARRATE ?? "").toLowerCase() === "off";
let netCalls = 0;
if (!OPT.live || dryLive) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => {
    netCalls++;
    return Promise.reject(
      new Error(
        `[eval] 오프라인 모드에서 네트워크 호출이 시도됐다: ${String(a[0]).slice(0, 80)}`,
      ),
    );
  };
  globalThis.__evalRealFetch = realFetch;
}

// ── 2. 검사 대상 실제 소스 로드 ──────────────────────────────────────
const NARRATOR_TS = join(ROOT, "apps/server/src/ai/narrator.ts");
const CARDS_TS = join(ROOT, "packages/shared/src/cards.ts");

const narrator = await import(pathToFileURL(NARRATOR_TS).href);
const cards = await import(pathToFileURL(CARDS_TS).href);

const {
  fallbackLine,
  normalizeLine,
  normalizeWithMeta,
  narrate,
  LINE_MAX,
  LINE_MIN,
  LINE_BUDGET_SUGGEST,
} = narrator;
/** 규약 하한 — 코드가 강제하지 않는 값이라 상수가 없던 시절도 대비해 12로 떨어뜨린다(④ §2.3). */
const RAW_MIN = typeof LINE_MIN === "number" ? LINE_MIN : 12;
const { SUSPECTS, WEAPONS, ROOMS, LABELS, PERSONA, VOICE, label } = cards;

// ── 3. 사전(§3.2 공통 사전) ─────────────────────────────────────────
const CAT = {
  suspect: SUSPECTS.map(label),
  weapon: WEAPONS.map(label),
  room: ROOMS.map(label),
};
const ALL_LABELS = [...CAT.suspect, ...CAT.weapon, ...CAT.room];
const CAT_OF = new Map();
for (const [c, ls] of Object.entries(CAT)) for (const l of ls) CAT_OF.set(l, c);

/** §3.2 — 수동 확인 큐로 격리하는 오탐 후보(장소 라벨이자 일반 명사). */
const AMBIGUOUS = new Set(["후원"]);

/** §3.2 금지어 사전. */
const BANNED = [
  "정답",
  "봉투",
  "손패",
  "내 패",
  "solution",
  "envelope",
  "카드를 가지고 있",
];

/** §3.2 C3 — 마크업·머리말 사전. */
const C3_PATTERNS = [
  [/["'“”‘’«»`]/u, "따옴표"],
  [/[*_#]/u, "마크다운 기호"],
  [/^\s*NPC\s*[:：]/iu, "머리말 NPC:"],
  [/^\s*(?:[-•+]|\d+[.)])\s/u, "리스트 머리"],
];

// ── 4. 전제 조건(precondition) ───────────────────────────────────────
// §3.2가 "부분문자열 스캔으로 충분하다"고 주장하는 근거는 라벨 27종이 서로
// 부분문자열 관계가 아니라는 것이다. 주장을 믿지 않고 매 실행마다 확인한다.
const preconditions = [];
{
  const collide = [];
  for (const a of ALL_LABELS)
    for (const b of ALL_LABELS)
      if (a !== b && b.includes(a)) collide.push(`${a} ⊂ ${b}`);
  preconditions.push({
    id: "P1",
    name: "라벨 27종 상호 비포함 (부분문자열 스캔의 전제)",
    pass: ALL_LABELS.length === 27 && collide.length === 0,
    detail:
      `라벨 ${ALL_LABELS.length}종` +
      (collide.length ? ` · 포함쌍 ${collide.join(", ")}` : " · 포함쌍 0"),
  });
}

// ── 5. 정적 검사 (§2.2 "절대 넘기지 않는 값") ────────────────────────
// 런타임 스캔만으로는 "이번엔 안 들어갔다"밖에 말하지 못한다. 정답 봉투·손패는
// **입력 타입에 필드가 없어서** 넘어갈 수 없다는 것이 §2.2의 논거이므로 소스를 판정한다.
const SRC = readFileSync(NARRATOR_TS, "utf8");

/** §2.1 입력 계약이 허용한 필드 전체. */
const ALLOWED_FIELDS = [
  "name",
  "action",
  "suspect",
  "weapon",
  "room",
  "hint",
  "persona",
  "tone",
  "intro",
  "outro",
  "disproved",
];
/** 있으면 즉시 blocking — 진실값/비밀 정보를 표현 계층에 들이는 필드명. */
const FORBIDDEN_FIELD_RE =
  /solution|envelope|hand|deck|botknowledge|knowledge|revealed|candidate|seen|answer|culprit/i;

const statics = [];
{
  // S1 — NarrationInput 필드 집합
  const m = SRC.match(/export type NarrationInput = \{([\s\S]*?)\n\};/);
  const fields = m
    ? [...m[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((x) => x[1])
    : null;
  const extra = fields ? fields.filter((f) => !ALLOWED_FIELDS.includes(f)) : [];
  const forbidden = fields ? fields.filter((f) => FORBIDDEN_FIELD_RE.test(f)) : [];
  statics.push({
    id: "S1",
    name: "NarrationInput에 정답 봉투·손패 필드가 존재하지 않는다 (§2.2)",
    pass: fields !== null && extra.length === 0 && forbidden.length === 0,
    detail:
      fields === null
        ? "NarrationInput 타입을 파싱하지 못했다 — 정적 판정 불가"
        : `필드 ${fields.length}종 [${fields.join(", ")}]` +
          (extra.length ? ` · 계약 외 ${extra.join(", ")}` : "") +
          (forbidden.length ? ` · 금지 ${forbidden.join(", ")}` : " · 금지 필드 0"),
  });

  // S2 — 규칙엔진·상태 스키마에 대한 의존이 없다(비밀에 손이 닿지 않는다)
  const imports = [...SRC.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map(
    (x) => x[1],
  );
  const bad = imports.filter((p) => /rooms\/|schema\/|game-state|clue-room/.test(p));
  statics.push({
    id: "S2",
    name: "narrator.ts가 규칙엔진/상태 스키마를 import하지 않는다",
    pass: bad.length === 0,
    detail: `import [${imports.join(", ")}]` + (bad.length ? ` · 위반 ${bad}` : ""),
  });

  // S3 — 실제로 네트워크로 나가는 프롬프트가 참조하는 필드
  const body = SRC.slice(SRC.indexOf("export const narrate"));
  const refs = [...new Set([...body.matchAll(/\bi\.(\w+)/g)].map((x) => x[1]))];
  const outOfContract = refs.filter((f) => !ALLOWED_FIELDS.includes(f));
  // §2.1 — intro/outro는 "폴백 전용(LLM 경로 미사용)"이라고 문서가 주장한다. 확인한다.
  const introUsed = refs.filter((f) => f === "intro" || f === "outro");
  statics.push({
    id: "S3",
    name: "narrate()가 참조하는 입력 필드가 §2.1 입력 계약 안에 있다",
    pass: outOfContract.length === 0,
    detail:
      `참조 [${refs.join(", ")}]` +
      (outOfContract.length ? ` · 계약 외 ${outOfContract.join(", ")}` : "") +
      ` · intro/outro LLM 경로 사용 ${introUsed.length === 0 ? "없음(§2.1 부합)" : introUsed.join(",")}`,
  });

  // S4 — 대화 히스토리 미전송(§2.2 "인젝션 표면 0")
  const oneShot =
    /contents:\s*\[\{\s*role:\s*"user"/.test(SRC) &&
    !/history|messages\.map|previous/i.test(SRC);
  statics.push({
    id: "S4",
    name: "요청에 이전 대사 히스토리가 없다 (§2.2 인젝션 표면 0)",
    pass: oneShot,
    detail: oneShot ? "contents = 단일 user 턴" : "히스토리 흔적 발견",
  });

  // S5 — 네트워크로 나가는 payload의 텍스트 출처가 SYSTEM·userText 둘뿐인가
  const bodyStart = SRC.indexOf("body: JSON.stringify({");
  const payload = bodyStart >= 0 ? SRC.slice(bodyStart, SRC.indexOf("signal:", bodyStart)) : "";
  const texts = [...payload.matchAll(/text:\s*([A-Za-z_$][\w$]*)/g)].map((x) => x[1]);
  const okTexts = texts.length > 0 && texts.every((t) => t === "SYSTEM" || t === "userText");
  statics.push({
    id: "S5",
    name: "요청 payload의 텍스트 출처가 SYSTEM·userText 둘뿐이다",
    pass: okTexts,
    detail: texts.length ? `text 슬롯 [${texts.join(", ")}]` : "payload를 파싱하지 못했다 — 정적 판정 불가",
  });
}

// ── 6. 규칙 판정기 C1~C6 ────────────────────────────────────────────
// 각 판정기는 { pass, why }를 돌려준다. "대체로 괜찮음"은 없다.

const scanLabels = (text) => ALL_LABELS.filter((l) => text.includes(l));

const C1 = (text) => {
  const bad = /[\r\n]/.test(text);
  return { pass: !bad, why: bad ? "개행 포함" : "개행 없음" };
};

/**
 * C2 — 길이. 상한은 **코드 상수**를 그대로 쓴다(문서의 "정규화본 ≤80"은
 * 07-28 문장경계 절단 도입 전 값이라 낡았다 — 리포트에 그 사실을 인쇄한다).
 * 하한 12자는 §2.3이 "미강제(알려진 간극)"라고 적어둔 항목이라 **비차단**으로 계측만 한다.
 */
const C2 = (text, budget) => {
  const n = [...text].length;
  return {
    pass: n <= budget,
    short: n < 12,
    len: n,
    why: `${n}자 / 상한 ${budget}` + (n < 12 ? " (12자 미만 — §2.3 알려진 간극)" : ""),
  };
};

const C3 = (text) => {
  const hits = C3_PATTERNS.filter(([re]) => re.test(text)).map(([, n]) => n);
  return { pass: hits.length === 0, why: hits.length ? `매치 ${hits.join(",")}` : "미매치" };
};

/** C4 — 진실값 치환 없음. ① A 최소 1개 포함 ② A와 같은 카테고리의 비-A 라벨 0개. */
const C4 = (text, A) => {
  const found = scanLabels(text);
  const kept = A.filter((l) => text.includes(l));
  const cats = new Set(A.map((l) => CAT_OF.get(l)));
  const substituted = found.filter(
    (l) => !A.includes(l) && cats.has(CAT_OF.get(l)) && !AMBIGUOUS.has(l),
  );
  if (kept.length === 0)
    return { pass: false, why: `A 라벨 0개 포함 (A=[${A.join(",")}])` };
  if (substituted.length)
    return { pass: false, why: `치환 ${substituted.join(",")} ∉ A` };
  return { pass: true, why: `A중 ${kept.length}/${A.length} 유지 · 동일카테고리 침입 0` };
};

/** C5 — 미제공 카드·금지어 누출. ① 27종 스캔 ∖ A = ∅ ② 금지어 미매치. */
const C5 = (text, A) => {
  const leaked = scanLabels(text).filter((l) => !A.includes(l));
  const queued = leaked.filter((l) => AMBIGUOUS.has(l));
  const hard = leaked.filter((l) => !AMBIGUOUS.has(l));
  const banned = BANNED.filter((w) => text.includes(w));
  if (hard.length) return { pass: false, queued, why: `미제공 라벨 ${hard.join(",")}` };
  if (banned.length) return { pass: false, queued, why: `금지어 ${banned.join(",")}` };
  return { pass: true, queued, why: `누출 0${queued.length ? ` · 수동확인 ${queued.join(",")}` : ""}` };
};

/**
 * C2raw — **LLM 원문**의 길이 규약(④ §3.2 C2 "원문 기준" · §3.4 L1).
 *
 * 정규화본이 아니라 원문을 보므로 **하한 12자도 판정한다**: 코드는 하한을 강제하지 않지만
 * (§2.3 알려진 간극) 프롬프트는 «12~40자»를 요구했고, 원문 기준에서는 "요구를 지켰는가"를
 * 물을 수 있다. 즉 이 규칙이 재는 것은 코드의 강제력이 아니라 **LLM의 지시 준수**다.
 * `rawLen`은 실호출에서만 생기므로 오프라인에서는 표본 0 → **미판정**(L1).
 */
const C2RAW = (rawLen) => ({
  pass:
    typeof rawLen === "number" && rawLen >= RAW_MIN && rawLen <= LINE_MAX,
  why:
    typeof rawLen === "number"
      ? `원문 ${rawLen}자 / 규약 ${RAW_MIN}~${LINE_MAX}`
      : "원문 길이 없음(계측 미부착)",
});

/**
 * NORM — **프롬프트 준수율**의 판정 단위. 사후 정규화가 한 번이라도 발동했다는 것은
 * LLM이 출력 계약을 지키지 않아 **코드가 대신 고쳤다**는 뜻이다. `ops`가 비어야 준수.
 */
const NORM = (ops) => {
  const o = ops ?? [];
  return {
    pass: o.length === 0,
    why: o.length ? `정규화 발동 ${o.join("+")}` : "무발동 — 원문 그대로 통과",
  };
};

/** C6 — scheme 전용. hint 외 손패 라벨 등장 시 blocking FAIL. */
const C6 = (text, hintLabels, handLabels) => {
  const off = handLabels.filter((l) => !hintLabels.includes(l) && text.includes(l));
  return {
    pass: off.length === 0,
    why: off.length
      ? `hint 외 손패 ${off.join(",")}`
      : `hands 스냅샷 ${handLabels.length}장 대조 · 등장 0`,
  };
};

// ── 6.5 판정기 자기검사 (P4) ────────────────────────────────────────
// 전건 PASS 리포트는 "검사기가 아무것도 안 잡는다"와 구분되지 않는다.
// 알려진 위반 문장을 넣어 **각 규칙이 실제로 FAIL을 낸다**는 것을 매 실행마다 증명한다.
// C4의 음성 케이스는 ④ §3.2가 직접 적어둔 반례("떡시루로 바꿔 말한 경우")를 그대로 쓴다.
{
  const A = ["뱀 무녀", "술동이", "후원"];
  const HANDS = ["금고", "서재", "황소 역사"];
  const cases = [
    ["C1", "개행", () => C1("도둑은 뱀 무녀!\n술동이라네"), false],
    ["C1", "정상", () => C1("낄낄, 후원서 술동이를 훔쳤다니"), true],
    ["C2", "상한 초과", () => C2("가".repeat(41), 40), false],
    ["C2", "상한 내", () => C2("가".repeat(40), 40), true],
    ["C3", "따옴표", () => C3('"도둑은 뱀 무녀"'), false],
    ["C3", "별표", () => C3("**뱀 무녀**가 훔쳤다"), false],
    ["C3", "머리말", () => C3("NPC: 뱀 무녀가 훔쳤다"), false],
    ["C3", "리스트", () => C3("- 뱀 무녀가 훔쳤다"), false],
    ["C3", "정상(낫표)", () => C3("후원의 「술동이」"), true],
    // ④ §3.2 반례 그대로 — 제안 내용을 바꿔 말한 경우
    ["C4", "장물 치환", () => C4("낄낄, 후원서 떡시루를 훔쳤다니 볼만하구먼!", A), false],
    ["C4", "A 라벨 0개", () => C4("낄낄, 아주 볼만하구먼!", A), false],
    ["C4", "정상", () => C4("낄낄, 후원서 술동이를 훔쳤다니 볼만하구먼!", A), true],
    ["C5", "미제공 라벨", () => C5("후원의 금고가 사라졌네", A), false],
    ["C5", "금지어", () => C5("술동이가 정답일세", A), false],
    ["C5", "정상", () => C5("후원의 술동이", A), true],
    ["C6", "hint 외 손패", () => C6("자네 서재를 가졌지", ["금고"], HANDS), false],
    ["C6", "정상", () => C6("금고… 자네만 알게", ["금고"], HANDS), true],
    // ── 07-28 신설: 원문 기준 규칙(L1 해소분). **음성 케이스 없이 통과하는 검사는
    //    아무것도 잡지 않는 검사와 구분되지 않는다.**
    ["C2raw", "원문 상한 초과", () => C2RAW(LINE_MAX + 1), false],
    ["C2raw", "원문 하한 미만", () => C2RAW(RAW_MIN - 1), false],
    ["C2raw", "계측 미부착(undefined)", () => C2RAW(undefined), false],
    ["C2raw", "상한 경계", () => C2RAW(LINE_MAX), true],
    ["C2raw", "하한 경계", () => C2RAW(RAW_MIN), true],
    ["NORM", "마크업 정규화 발동", () => NORM(["markup"]), false],
    ["NORM", "절단 발동", () => NORM(["truncate"]), false],
    ["NORM", "폐기 발동", () => NORM(["oneline", "drop"]), false],
    ["NORM", "무발동", () => NORM([]), true],
  ];
  const wrong = cases.filter(([, , fn, expect]) => fn().pass !== expect);
  preconditions.push({
    id: "P4",
    name: "판정기 자기검사 — 알려진 위반을 실제로 FAIL로 잡는다",
    pass: wrong.length === 0,
    detail:
      wrong.length === 0
        ? `음성 ${cases.filter((c) => !c[3]).length}건 · 양성 ${cases.filter((c) => c[3]).length}건 전부 기대대로`
        : `오판 ${wrong.map((w) => `${w[0]}/${w[1]}`).join(", ")}`,
  });
}

// ── 6.6 정규화 실측 (P5) ────────────────────────────────────────────
// ④ §2.3의 "마크업 제거가 양끝 한정" 간극이 07-28에 해소됐다. **해소는 주장이 아니라
// 실행으로 확인한다** — 실제 `normalizeWithMeta()`에 위반 문장을 넣어
//   ① 중간 마크업이 사라지고 ② 그 결과가 C3를 통과하며 ③ ops에 사유가 남고
//   ④ **정상 문장(낫표·말줄임표·물결·가운뎃점)은 바이트 동일**한지를 본다.
// ④가 없으면 "다 지우면 통과"라는 퇴행을 이 검사가 승인해 버린다.
{
  const c3ok = (t) => C3_PATTERNS.every(([re]) => !re.test(t));
  const N = typeof normalizeWithMeta === "function" ? normalizeWithMeta : null;
  const keep = [
    "후원의 「술동이」, 자네 짓인가", // 낫표 — 폴백 문안이 실제로 쓰는 인용부호
    "스으…, 두고 보면 알겠지", // 말줄임표 — 종결부호이자 뱀 무녀 추임새
    "허, 셈속이 그러하렷다~", // 물결 — 절단 로직의 문장 경계
    "쉿… 금고 · 서재, 자네만 알게", // 가운뎃점 — hint 구분자
    "도둑은 뱀 무녀! 후원의 「술동이」", // 낫표 + 느낌표
  ];
  const cases = N
    ? [
        // 음성: 중간 마크업 — 예전 정규식(양끝 한정)이면 전부 실패한다
        ["중간 별표", () => { const r = N("**뱀 무녀**가 훔쳤다"); return r.text === "뱀 무녀가 훔쳤다" && r.ops.includes("markup") && c3ok(r.text); }],
        ["중간 밑줄", () => { const r = N("_뱀 무녀_가 훔쳤다네"); return c3ok(r.text) && r.ops.includes("markup"); }],
        ["중간 따옴표", () => { const r = N("그자가 “뱀 무녀”라 하더군"); return r.text === "그자가 뱀 무녀라 하더군" && r.ops.includes("markup"); }],
        ["백틱·해시", () => { const r = N("# `뱀 무녀`가 훔쳤다"); return c3ok(r.text) && r.ops.includes("markup"); }],
        ["양끝 따옴표(기존 동작 유지)", () => { const r = N('"도둑은 뱀 무녀"'); return r.text === "도둑은 뱀 무녀" && r.ops.includes("markup"); }],
        ["개행 → 첫 줄만", () => { const r = N("도둑은 뱀 무녀!\n술동이라네"); return r.text === "도둑은 뱀 무녀!" && r.ops.includes("oneline"); }],
        ["상한 초과 → 문장 경계 절단", () => { const r = N(`${"가".repeat(20)}! ${"나".repeat(40)}`); return r.ops.includes("truncate") && [...r.text].length <= LINE_MAX; }],
        ["경계 없음 → 폐기", () => { const r = N("가".repeat(60)); return r.text === null && r.ops.includes("drop"); }],
        ["rawLen은 원문 길이", () => N("가".repeat(60)).rawLen === 60],
        // 양성: 정상 문장은 **한 글자도 바뀌지 않는다**
        ...keep.map((s) => [
          `보존: ${s.slice(0, 10)}…`,
          () => { const r = N(s); return r.text === s && r.ops.length === 0; },
        ]),
      ]
    : [];
  const wrong = N ? cases.filter(([, fn]) => fn() !== true) : [];
  preconditions.push({
    id: "P5",
    name: "정규화 실측 — 중간 마크업 제거 ∧ 정상 문장(낫표·말줄임표) 보존 (④ §2.3)",
    pass: N !== null && wrong.length === 0,
    detail:
      N === null
        ? "normalizeWithMeta()가 없다 — 정규화 발동 종류를 판정할 수 없다(L1 미해소)"
        : wrong.length === 0
          ? `위반 문장 ${cases.length - keep.length}종 교정 · 정상 문장 ${keep.length}종 바이트 동일 · 교정 결과 전건 C3 통과`
          : `오판 ${wrong.map((w) => w[0]).join(", ")}`,
  });
}

// ── 6.7 절단 구제 실측 (P6 · 합성 코퍼스) ────────────────────────────
// 🔴 **이 코퍼스는 실측 표본이 아니다.** 라이브 `/health`가 관측한 **형태**를 재현한 것이다:
//    폴백 9건 전부 `toolong`, `ops {drop: 9}`, `truncate` **0건**, `maxRawLen 50`.
//    truncate가 한 번도 안 걸린 것은 우연이 아니라 구조다 — 프롬프트가 «한 문장만»을
//    요구하므로 종결부호는 문장 맨 끝에 하나뿐이고, 원문이 상한을 넘겼다는 것은 곧
//    그 하나가 상한 밖이라는 뜻이다. 그래서 아래 문장들은 **종결부호를 끝에만** 둔다.
// 원문 텍스트를 저장하지 않는 계측 규약(④ §2.3) 때문에 진짜 폐기 원문은 남아 있지 않다.
// → 여기서 재는 것은 «관측된 형태에 대해 새 절단이 몇 %를 살리는가»이지 실측 구제율이 아니다.
const OVERLONG_CORPUS = [
  "쯧쯧, 후원에서 술동이를 훔쳤다니 그 죄가 실로 무겁고 부끄러운 일이로다.",
  "낄낄, 서재에서 떡시루를 집어간 자가 뱀 무녀라니 이거 참으로 볼만하구먼!",
  "어험— 안방에서 금고를 열어젖힌 자가 누구인지 내 반드시 밝혀내고 말겠다.",
  // 관측 최대치(rawLen 50) 부근 — 46~47자
  "쯧쯧, 후원에서 술동이를 훔쳐 갔다니 그 죄가 실로 무겁고 부끄러운 일이 아니겠는가",
  "저, 저기… 정지에서 잡채가 없어졌다는데 혹시 토끼 낭자가 그때 다녀가지 않았을까요",
  "그거 아나, 대청에서 젓가락이 사라졌다는 소문이 벌써 온 동네에 파다하게 퍼졌다더군",
  "어험— 안방의 금고를 열어젖힌 자가 대체 누구인지 내 오늘 반드시 밝혀내고야 말겠노라",
  "저, 저기… 정지에서 잡채가 없어졌다는데 혹시 토끼 낭자가 다녀가지 않았을까요",
  "그거 아나, 대청에서 젓가락이 사라졌다는 소문이 온 동네에 파다하게 퍼졌다더군",
  "사랑방에 감돌던 그 기운이 예사롭지 않으니 두고 보면 절로 알게 되는 법이라네",
  "고하오— 별당에서 선물이 사라진 건에 대하여 지체 없이 낱낱이 밝히겠소이다.",
  "어이구, 행랑에서 떡시루를 가져간 이가 돼지 객주라면 밑질 거래는 아니지 않소?",
  "어머, 서재의 금고를 만진 사람이 게코 도령이라니 눈치 못 챌 줄 알고 그랬을까",
  "핫핫, 사랑채에서 술동이를 비운 자가 말 장수라는 것쯤은 내 눈은 못 속이지!",
  "허, 정지에서 잡채가 사라진 셈속을 따져 보면 답이 훤히 드러나는 법이 아니겠나",
  "안방의 젓가락을 가져간 이가 황소 역사는 아니니 에두를 것 없이 말해 두겠네.",
];
/** 어떤 절단으로도 살릴 수 없어야 하는 것 — 공백이 없으면 자르는 곳이 어절 중간뿐이다. */
const UNSALVAGEABLE = ["가".repeat(60), `${"나".repeat(45)}!`];

/**
 * 07-28 **이전** 절단 규칙(1순위만)의 재현 — **비교 전용**이며 판정에는 쓰지 않는다.
 * 미러링 금지 원칙의 예외: 여기서 재는 것은 «지금 코드가 맞는가»가 아니라
 * «바꾸기 전 대비 몇 건이 살아났는가»라는 **차이**이고, 옛 코드는 이미 리포에 없다.
 */
const legacyNormalize = (raw) => {
  const first = raw.split("\n")[0].replace(/[*_`#"'“”‘’«»]/g, "").replace(/ {2,}/g, " ").trim();
  if (!first) return null;
  if (first.length <= LINE_MAX) return first;
  const head = first.slice(0, LINE_MAX);
  const cut = Math.max(
    head.lastIndexOf("."), head.lastIndexOf("!"), head.lastIndexOf("?"),
    head.lastIndexOf("…"), head.lastIndexOf("~"),
  );
  return cut >= 11 ? head.slice(0, cut + 1).trim() : null;
};

const stripPunct = (s) => s.replace(/^[\s.,!?~…·—;:「」]+|[\s.,!?~…·—;:「」]+$/gu, "");

/** 결과 문장의 모든 어절이 **원문의 어절과 통째로 일치**하는가 = 어절 중간 절단 없음. */
const noMidWordCut = (raw, out) => {
  const src = new Set(raw.split(/\s+/).filter(Boolean).map(stripPunct));
  return out
    .split(/\s+/)
    .filter(Boolean)
    .map(stripPunct)
    .every((w) => w === "" || src.has(w));
};

const salvage = { n: 0, legacyKept: 0, keptNow: 0, tiers: {}, rows: [] };
{
  const N = typeof normalizeWithMeta === "function" ? normalizeWithMeta : null;
  const bad = [];
  if (N) {
    for (const raw of OVERLONG_CORPUS) {
      // 코퍼스 자체가 상한을 넘지 않으면 절단 경로를 타지 않는다 — 재는 대상이 사라진다.
      if ([...raw].length <= LINE_MAX)
        bad.push(`코퍼스 부적합(${[...raw].length}자 ≤ ${LINE_MAX}) ${raw.slice(0, 12)}…`);
      const r = N(raw);
      const old = legacyNormalize(raw);
      salvage.n++;
      if (old !== null) salvage.legacyKept++;
      if (r.text !== null) salvage.keptNow++;
      const len = r.text ? [...r.text].length : 0;
      // 불변식 — 살렸다면 ① 상한 이내 ② 하한 이상 ③ 어절 중간 절단 없음 ④ C3 통과
      if (r.text !== null) {
        if (len > LINE_MAX) bad.push(`상한초과(${len}) ${raw.slice(0, 12)}…`);
        if (len < RAW_MIN) bad.push(`하한미달(${len}) ${raw.slice(0, 12)}…`);
        if (!noMidWordCut(raw, r.text)) bad.push(`어절중간절단 → ${r.text}`);
        if (C3_PATTERNS.some(([re]) => re.test(r.text))) bad.push(`C3위반 → ${r.text}`);
        if (!r.ops.includes("truncate")) bad.push(`ops에 truncate 없음 → ${r.text}`);
      } else {
        // 공백이 있는데도 폐기했다면 구제 로직이 일을 안 한 것이다.
        bad.push(`구제 실패(폐기) ${raw.slice(0, 16)}…`);
      }
      salvage.rows.push({ rawLen: [...raw].length, old, now: r.text, len });
    }
    for (const raw of UNSALVAGEABLE) {
      const r = N(raw);
      if (r.text !== null) bad.push(`공백 없는 덩어리를 잘랐다 → ${r.text}`);
      if (!r.ops.includes("drop")) bad.push("공백 없는 덩어리에 drop이 안 붙었다");
    }
    const t = typeof narrator.normalizeStats === "function" ? narrator.normalizeStats() : {};
    salvage.tiers = t;
  }
  preconditions.push({
    id: "P6",
    name: "상한 초과 구제 — 어절 중간 절단 없이 살리고, 공백 없는 덩어리는 폐기",
    pass: N !== null && bad.length === 0,
    detail:
      N === null
        ? "normalizeWithMeta()가 없다 — 절단 구제를 판정할 수 없다"
        : bad.length === 0
          ? `합성 코퍼스 ${salvage.n}종(41~50자, 종결부호 끝에만) 전건 구제 · ` +
            `이전 규칙 생존 ${salvage.legacyKept}/${salvage.n} → 현재 ${salvage.keptNow}/${salvage.n} · ` +
            `공백 없는 덩어리 ${UNSALVAGEABLE.length}종은 그대로 폐기`
          : `위반 ${bad.slice(0, 5).join(" | ")}`,
  });
}

// ── 7. 시드 RNG · 36 케이스(§3.1) ────────────────────────────────────
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const buildCases = (seed) => {
  const rnd = mulberry32(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const out = [];
  for (const z of SUSPECTS) {
    const v = VOICE[z];
    for (const action of ["suggest", "accuse", "scheme"]) {
      const suspect = label(pick(SUSPECTS));
      const weapon = label(pick(WEAPONS));
      const room = label(pick(ROOMS));
      // scheme은 helperWhisper와 동일하게 3요소를 빈 문자열로 넘긴다(clue-room.ts:412-423).
      const hintCards =
        action === "scheme"
          ? [pick(ALL_LABELS), ...(rnd() < 0.5 ? [pick(ALL_LABELS)] : [])]
          : [];
      const hint = hintCards.length ? [...new Set(hintCards)].join(" · ") : undefined;
      out.push({
        id: `${z}:${action}`,
        speaker: z,
        input: {
          name: label(z),
          action,
          suspect: action === "scheme" ? "" : suspect,
          weapon: action === "scheme" ? "" : weapon,
          room: action === "scheme" ? "" : room,
          hint,
          persona: PERSONA[z],
          tone: v.tone,
          intro: v.intro,
          outro: v.outro,
          disproved: action === "suggest" ? rnd() < 0.34 : undefined,
        },
        allowed:
          action === "scheme"
            ? [...new Set(hintCards)]
            : [suspect, weapon, room],
      });
    }
  }
  return out;
};

/**
 * 결정론 딜 — C6가 대조할 `hands` 스냅샷. clue-room.ts 규칙부를 그대로 따른다
 * (덱 18장 = 용의자 5 · 장물 5 · 장소 8, 전부 비정답 / 6좌석 라운드로빈).
 * 이 스냅샷은 **검증기 로컬**이며 게임 상태를 만들지도 읽지도 않는다.
 */
const dealHands = (seed) => {
  const rnd = mulberry32(seed ^ 0x5eed);
  const shuffle = (a) => {
    const x = [...a];
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  const sol = {
    suspect: shuffle(CAT.suspect)[0],
    weapon: shuffle(CAT.weapon)[0],
    room: shuffle(CAT.room)[0],
  };
  const deck = shuffle(ALL_LABELS.filter((l) => !Object.values(sol).includes(l)));
  const hands = Array.from({ length: 6 }, () => []);
  deck.forEach((c, i) => hands[i % 6].push(c));
  return { solution: sol, hands, all: deck };
};

// ── 8. 폴백 전수 스윕 ────────────────────────────────────────────────
/**
 * `fallbackLine`은 내부에서 `rand()`(=Math.random) 한 번으로 문안을 고른다.
 * 전수 검증을 위해 Math.random을 **결정적으로 고정**해 각 분기의 모든 문안을 강제한다.
 * 분기별 문안 수는 소스에서 세는 게 아니라 **자연 샘플링과 대조해 검증**한다(P2).
 */
const VARIANTS = { accuse: 3, scheme: 4, disproved: 3, suggest: 4 };
const variantCount = (i) =>
  i.action === "accuse"
    ? VARIANTS.accuse
    : i.action === "scheme"
      ? VARIANTS.scheme
      : i.disproved
        ? VARIANTS.disproved
        : VARIANTS.suggest;

const forcedFallback = (input, k) => {
  const L = variantCount(input);
  const orig = Math.random;
  Math.random = () => (k + 0.5) / L;
  try {
    return fallbackLine(input);
  } finally {
    Math.random = orig;
  }
};

const budgetOf = (i) => (i.action === "suggest" ? LINE_BUDGET_SUGGEST : LINE_MAX);

// P2 — 강제 열거가 실제로 전수인지 확인(자연 랜덤 400회가 강제 집합 밖으로 안 나가야 한다)
{
  const rnd = mulberry32(OPT.seed ^ 0xa11);
  let escaped = 0;
  const probes = [];
  for (const action of ["suggest", "accuse", "scheme"])
    for (const d of action === "suggest" ? [false, true] : [false]) {
      const v = VOICE.rooster;
      probes.push({
        name: label("rooster"),
        action,
        suspect: action === "scheme" ? "" : label("snake"),
        weapon: action === "scheme" ? "" : label("liquor"),
        room: action === "scheme" ? "" : label("huwon"),
        hint: action === "scheme" ? "금고 · 서재" : undefined,
        persona: PERSONA.rooster,
        tone: v.tone,
        intro: v.intro,
        outro: v.outro,
        disproved: d,
      });
    }
  for (const p of probes) {
    const forced = new Set(
      Array.from({ length: variantCount(p) }, (_, k) => forcedFallback(p, k)),
    );
    const orig = Math.random;
    Math.random = rnd;
    for (let n = 0; n < 400; n++) if (!forced.has(fallbackLine(p))) escaped++;
    Math.random = orig;
  }
  preconditions.push({
    id: "P2",
    name: "폴백 문안 강제 열거가 전수다 (자연 샘플 2,000회 이탈 0)",
    pass: escaped === 0,
    detail: escaped === 0 ? "이탈 0 — 분기별 문안 수 가정 정확" : `이탈 ${escaped}건`,
  });
}

/** 한 문장에 대해 적용 가능한 규칙을 전부 돌린다. */
const judge = (text, ctx) => {
  const r = {
    C1: C1(text),
    C2: C2(text, ctx.budget),
    C3: C3(text),
    C4: C4(text, ctx.allowed),
    C5: C5(text, ctx.allowed),
  };
  if (ctx.action === "scheme" && ctx.hands) r.C6 = C6(text, ctx.allowed, ctx.hands);
  return r;
};

const newTally = () => ({
  total: 0,
  rules: {},
  failures: [],
  queued: [],
  lens: [],
  shortCount: 0,
  /** 길이 규약(제안 25 / 그 외 40)이 액션별로 지켜지는지 — ④ §6.2가 조인 값. */
  byAction: {},
});

const bump = (t, id, ok) => {
  const s = (t.rules[id] ??= { pass: 0, total: 0 });
  s.total++;
  if (ok) s.pass++;
};

const record = (t, text, ctx) => {
  t.total++;
  const r = judge(text, ctx);
  const n = [...text].length;
  t.lens.push(n);
  if (r.C2.short) t.shortCount++;
  const key = `${ctx.action}${ctx.disproved ? "(반증)" : ""}`;
  const ba = (t.byAction[key] ??= {
    budget: ctx.budget,
    n: 0,
    over: 0,
    sum: 0,
    max: 0,
    min: Infinity,
    deco: 0,
  });
  ba.n++;
  ba.sum += n;
  ba.max = Math.max(ba.max, n);
  ba.min = Math.min(ba.min, n);
  if (n > ctx.budget) ba.over++;
  // 추임새 부착률 — ④ §6.2가 88.6%라고 적은 값을 여기서 실측한다.
  if (
    (ctx.intro && ctx.intro.trim() && text.startsWith(ctx.intro.trim())) ||
    (ctx.outro && ctx.outro.trim() && text.endsWith(ctx.outro.trim()))
  )
    ba.deco++;
  for (const [id, v] of Object.entries(r)) {
    bump(t, id, v.pass);
    if (!v.pass && t.failures.length < 400)
      t.failures.push({ rule: id, case: ctx.id, text, why: v.why });
  }
  if (r.C5.queued?.length && t.queued.length < 200)
    t.queued.push({ case: ctx.id, text, labels: r.C5.queued });
  return r;
};

// ── 9. 스위트 A — §3.1의 36 케이스(오프라인은 폴백 경로로 판정) ───────
const CASES = buildCases(OPT.seed);
const DEAL = dealHands(OPT.seed);

const suiteA = newTally();
const sampleLines = [];
for (const c of CASES) {
  const L = variantCount(c.input);
  for (let k = 0; k < L; k++) {
    const text = forcedFallback(c.input, k);
    const r = record(suiteA, text, {
      id: `${c.id}#${k}`,
      action: c.input.action,
      disproved: c.input.disproved,
      allowed: c.allowed,
      budget: budgetOf(c.input),
      hands: c.input.action === "scheme" ? DEAL.all : null,
      intro: c.input.intro,
      outro: c.input.outro,
    });
    if (k === 0) sampleLines.push({ case: c.id, text, len: [...text].length, ok: Object.values(r).every((x) => x.pass) });
  }
}

// ── 10. 스위트 B — 폴백 **전수** 스윕 ────────────────────────────────
// 폴백은 실호출이 필요 없으므로 입력 공간을 통째로 돈다.
//   suggest/accuse : 화자12 × 용의자12 × 장물6 × 장소9 × 문안(4+3+3)
//   scheme         : 화자12 × hint(1장 27 + 2장 순서쌍 702) × 문안4
const suiteB = newTally();
if (!OPT.quick) {
  for (const z of SUSPECTS) {
    const v = VOICE[z];
    const base = { name: label(z), persona: PERSONA[z], tone: v.tone, intro: v.intro, outro: v.outro };
    for (const s of CAT.suspect)
      for (const w of CAT.weapon)
        for (const rm of CAT.room) {
          const A = [s, w, rm];
          for (const action of ["suggest", "accuse"])
            for (const d of action === "suggest" ? [false, true] : [false]) {
              const input = { ...base, action, suspect: s, weapon: w, room: rm, disproved: d };
              const L = variantCount(input);
              for (let k = 0; k < L; k++)
                record(suiteB, forcedFallback(input, k), {
                  id: `${z}/${action}${d ? "+dis" : ""}/${s}|${w}|${rm}#${k}`,
                  action,
                  disproved: d,
                  allowed: A,
                  budget: budgetOf(input),
                  hands: null,
                  intro: v.intro,
                  outro: v.outro,
                });
            }
        }
    // scheme
    for (const a of ALL_LABELS) {
      const combos = [[a], ...ALL_LABELS.filter((b) => b !== a).map((b) => [a, b])];
      for (const hc of combos) {
        const input = { ...base, action: "scheme", suspect: "", weapon: "", room: "", hint: hc.join(" · ") };
        const L = variantCount(input);
        for (let k = 0; k < L; k++)
          record(suiteB, forcedFallback(input, k), {
            id: `${z}/scheme/${hc.join("+")}#${k}`,
            action: "scheme",
            allowed: hc,
            budget: LINE_MAX,
            hands: DEAL.all,
            intro: v.intro,
            outro: v.outro,
          });
      }
    }
  }
}

// ── 11. 스위트 C — 실호출(--live) ────────────────────────────────────
const suiteC = newTally();
const latencies = [];
const paths = { llm: 0, cache: 0, fallback: 0, timeout: 0 };
const fbReasons = {};
let liveStatus = "미실행(기본 오프라인 모드 — 실호출은 --live로만)";
/**
 * 원문 계측 표본(④ §3.4 L1) — `{ id, rawLen, ops }`만 모은다.
 * **원문 텍스트는 담지 않는다**(narrate가 애초에 내보내지 않는다 — 계약대로다).
 * 폐기된 원문(`reason: "toolong"`)도 **분모에 넣는다**: 규약을 가장 크게 어긴 표본을
 * 빼고 준수율을 계산하면 그 숫자는 프롬프트를 고칠 근거가 되지 못한다.
 */
const rawSamples = [];

/**
 * `narrate()` 반환 형태 정규화.
 * 07-28 관측 가능성 작업(④ §4-1)으로 반환이 `string | null` → `NarrationResult`
 * (`{ text, source, ms, model, reason }`)로 바뀌었다. **둘 다 받는다** — 검증기가
 * 대상 코드의 리팩터링에 물려 죽으면 그날부터 아무도 안 돌린다.
 */
const asResult = (v, ms) => {
  if (v === null || v === undefined) return { text: null, source: "fallback", ms, reason: "legacy-null" };
  if (typeof v === "string") return { text: v, source: "llm", ms, reason: null };
  return {
    text: v.text ?? null,
    source: v.source ?? (v.text ? "llm" : "fallback"),
    ms: typeof v.ms === "number" ? v.ms : ms,
    reason: v.reason ?? null,
    // 07-28 L1 해소분. 없으면 `undefined` → C2raw/NORM은 **미판정**으로 남는다
    // (구버전 narrate와 물려도 검증기가 죽지 않고, 없는 값을 지어내지도 않는다).
    rawLen: typeof v.rawLen === "number" ? v.rawLen : undefined,
    norm: Array.isArray(v.norm) ? v.norm : undefined,
  };
};

if (OPT.live) {
  // 🔴 쿼터 안전장치. 실행 계획 §7.2 ⑤ — 심사 기간에 이 36콜은 심사자 몫을 먹는다.
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "[eval] --live 거부: GEMINI_API_KEY가 없다.\n" +
        "       키 없이 narrate()는 즉시 null을 돌려주므로 실호출 검사(C7)는 성립하지 않고,\n" +
        "       '전건 폴백'을 'LLM 실패'로 오기록하게 된다. 오프라인 모드로 실행하라.",
    );
    process.exit(2);
  }
  const planned = Math.max(0, Math.min(OPT.maxCalls, 36, CASES.length));
  if (!Number.isFinite(planned) || planned <= 0) {
    console.error("[eval] --max-calls 값이 잘못됐다(1~36).");
    process.exit(2);
  }
  console.error(
    `\n🔴 실호출 계획 — 이번 실행은 Gemini 무료 쿼터를 ${planned}콜 소모한다.\n` +
      `   모델 ${process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest"} · 캐시 미적중 전제(신규 프로세스 · 36키 전부 상이)\n` +
      `   심사 기간에는 이 쿼터가 심사자의 NPC 대사 몫과 같은 통이다(실행 계획 §7.2 ⑤).\n`,
  );
  if (!OPT.yes) {
    console.error("   5초 뒤 진행한다. 중단하려면 Ctrl-C. (--yes로 유예 생략)");
    await new Promise((r) => setTimeout(r, 5000));
  }
  const uniq = new Set(
    CASES.slice(0, planned).map((c) =>
      [c.input.action, c.input.suspect, c.input.weapon, c.input.room, c.input.persona, c.input.tone, c.input.disproved, c.input.hint].join("|"),
    ),
  );
  for (const c of CASES.slice(0, planned)) {
    const t0 = Date.now();
    let raw = null;
    try {
      raw = await narrate(c.input);
    } catch (e) {
      // narrate()는 throw하지 않는 계약이다(④ §4). 깨졌다면 그 자체가 결함이다.
      raw = null;
      fbReasons.threw = (fbReasons.threw ?? 0) + 1;
    }
    const r = asResult(raw, Date.now() - t0);
    latencies.push(r.ms);
    // 원문을 실제로 받은 건수만 표본이다(캐시 히트·키 없음은 원문이 없다).
    if (typeof r.rawLen === "number")
      rawSamples.push({ id: c.id, rawLen: r.rawLen, ops: r.norm ?? [], dropped: r.text === null });
    if (r.text === null) {
      paths.fallback++;
      const why = r.reason ?? "unknown";
      fbReasons[why] = (fbReasons[why] ?? 0) + 1;
      if (why === "timeout") paths.timeout++;
      continue;
    }
    if (r.source === "cache") paths.cache++;
    else paths.llm++;
    record(suiteC, r.text, {
      id: c.id,
      action: c.input.action,
      disproved: c.input.disproved,
      allowed: c.allowed,
      // LLM 경로의 상한은 `normalizeLine`이 강제하는 코드 상수다(문서 §3.2의 "≤80"은
      // 07-28 문장경계 절단 도입 전 값이라 낡았다 — §3.4 보고 시 함께 정정할 것).
      budget: LINE_MAX,
      hands: c.input.action === "scheme" ? DEAL.all : null,
      intro: c.input.intro,
      outro: c.input.outro,
    });
  }
  liveStatus = `실행 ${planned}콜 · 캐시키 유일성 ${uniq.size}/${planned}`;
}

// ── 12. 리포트 ───────────────────────────────────────────────────────
const pct = (p, t) => (t === 0 ? "—" : `${((p / t) * 100).toFixed(1)}%`);
const rate = (t, id) => {
  const s = t.rules[id];
  return s ? `${s.pass}/${s.total}` : "—";
};
const stats = (t) => {
  if (!t.lens.length) return null;
  const s = [...t.lens].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
    p95: s[Math.floor(s.length * 0.95)],
  };
};
const pctl = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

const RULE_META = {
  C1: "한 줄(개행 없음)",
  C2: "길이 규약(상한)",
  C3: "마크업·머리말 없음",
  C4: "진실값 치환 없음 (blocking)",
  C5: "미제공 카드·금지어 누출 없음 (blocking)",
  C6: "scheme — hint 외 손패 없음 (blocking)",
};

const suites = [
  ["A", "§3.1 36케이스 (오프라인 · 폴백 경로 전 문안)", suiteA],
  ["B", OPT.quick ? "폴백 전수 스윕 (--quick으로 생략)" : "폴백 전수 스윕", suiteB],
  ["C", `실호출 (${liveStatus})`, suiteC],
];

const failedRules = new Set();
for (const [, , t] of suites)
  for (const [id, s] of Object.entries(t.rules)) if (s.pass !== s.total) failedRules.add(id);
// 쿼터 하드 가드 결과를 전제 조건으로 인쇄한다.
if (!OPT.live || dryLive)
  preconditions.push({
    id: "P3",
    name: dryLive
      ? "AI_NARRATE=off 리허설에서 네트워크 호출 0건 (fetch 트랩)"
      : "오프라인 모드에서 네트워크 호출 0건 (fetch 트랩)",
    pass: netCalls === 0,
    detail:
      netCalls === 0
        ? "globalThis.fetch 트랩 발동 0 — Gemini 무료 쿼터 소모 없음"
        : `fetch 시도 ${netCalls}건 — 오프라인 규약 위반`,
  });

preconditions.sort((a, b) => a.id.localeCompare(b.id));
const preFail = preconditions.filter((p) => !p.pass);
const statFail = statics.filter((s) => !s.pass);

// C7 — 오프라인에서는 원리적으로 판정 불가
const attempted = paths.llm + paths.cache + paths.fallback;
const c7 = OPT.live
  ? {
      judged: true,
      llm: paths.llm,
      cache: paths.cache,
      fallback: paths.fallback,
      timeout: paths.timeout,
      fallbackReasons: fbReasons,
      successRate: attempted ? (paths.llm + paths.cache) / attempted : 0,
      p50: pctl(latencies, 0.5),
      p95: pctl(latencies, 0.95),
      pass:
        (paths.llm + paths.cache) / Math.max(1, attempted) >= 0.9 &&
        (pctl(latencies, 0.5) ?? 1e9) <= 1200 &&
        (pctl(latencies, 0.95) ?? 1e9) <= 2500 &&
        paths.timeout === 0,
    }
  : {
      judged: false,
      reason:
        "C7(경로·지연 분포)은 실제 왕복 없이는 판정할 수 없다 — 오프라인 모드에서는 미판정으로 남긴다(추정 금지).",
    };
if (c7.judged && !c7.pass) failedRules.add("C7");

// ── C2raw / 프롬프트 준수율 (④ §3.4 L1) ─────────────────────────────
// 07-28 `rawLen`·`norm` 계측이 붙어 **판정 가능해졌다.** 다만 원문은 실호출에서만
// 생기므로 오프라인에서는 표본이 0이고, 그때는 **미판정으로 남긴다**(추정 금지).
// 통과 기준은 ④ §3.4가 L1에 적어둔 «12~40, 기준 ≥33/36» = 91.7%를 비율로 옮긴 값이다.
const RAW_RATE_MIN = 33 / 36;
const c2raw = (() => {
  if (!OPT.live)
    return {
      judged: false,
      reason:
        "C2(원문 기준)·프롬프트 준수율은 LLM 원문이 있어야 성립한다 — 오프라인에는 원문 자체가 없다. 미판정으로 남긴다(계측은 부착 완료: SayAi.rawLen/norm).",
    };
  if (rawSamples.length === 0)
    return {
      judged: false,
      reason:
        "--live 실행이지만 원문 표본 0 — 전건이 폴백(AI_NARRATE=off 리허설/키 없음/HTTP/타임아웃)이라 원문이 생기지 않았다. C7의 폴백 사유를 보라.",
    };
  const n = rawSamples.length;
  const inRange = rawSamples.filter((s) => C2RAW(s.rawLen).pass).length;
  const clean = rawSamples.filter((s) => NORM(s.ops).pass).length;
  const ops = {};
  for (const s of rawSamples) for (const o of s.ops) ops[o] = (ops[o] ?? 0) + 1;
  const lens = rawSamples.map((s) => s.rawLen);
  const violations = rawSamples
    .filter((s) => !C2RAW(s.rawLen).pass || !NORM(s.ops).pass)
    .slice(0, 20)
    .map((s) => ({ case: s.id, rawLen: s.rawLen, ops: s.ops, dropped: s.dropped }));
  return {
    judged: true,
    samples: n,
    inRange,
    inRangeRate: +(inRange / n).toFixed(3),
    clean,
    // **프롬프트 준수율** — 정규화가 한 번도 발동하지 않은 비율.
    cleanRate: +(clean / n).toFixed(3),
    ops,
    dropped: rawSamples.filter((s) => s.dropped).length,
    minRawLen: Math.min(...lens),
    maxRawLen: Math.max(...lens),
    avgRawLen: +(lens.reduce((a, b) => a + b, 0) / n).toFixed(1),
    threshold: +RAW_RATE_MIN.toFixed(3),
    pass: inRange / n >= RAW_RATE_MIN,
    violations,
  };
})();
if (c2raw.judged && !c2raw.pass) failedRules.add("C2raw");

/**
 * 현재 코드로 **판정할 수 없는** 항목. 추정으로 채우지 않고 그대로 인쇄한다.
 * (문서에 검사 항목만 있고 실행체가 없던 것이 이 스크립트를 만든 이유다.
 *  실행체를 만들면서 "판정한 척"을 남기면 같은 문제를 반복한다.)
 */
const LIMITS = [
  // L1은 07-28에 **해소됐다**(`SayAi.rawLen`/`norm`). 다만 원문은 실호출에서만 생기므로
  // 오프라인 실행에서는 여전히 표본이 없다 — 그 사실을 "해소됨"으로 덮지 않는다.
  ...(c2raw.judged
    ? []
    : [
        {
          id: "L1",
          rule: "C2(원문) · 프롬프트 준수율",
          what: `LLM **원문**의 길이(${RAW_MIN}~${LINE_MAX}, 기준 ≥33/36)와 정규화 발동률(=프롬프트 준수율)`,
          why:
            typeof normalizeWithMeta === "function"
              ? `계측은 부착돼 있다(narrate → SayAi.rawLen·norm). 그러나 원문은 실호출에서만 생긴다 — ${OPT.live ? "이번 실행은 원문 표본이 0이었다." : "오프라인 실행에는 판정할 표본 자체가 없다."}`
              : "narrate()가 원문 길이를 내보내지 않는다 — 정규화본만 반환하므로 준수율의 분모가 없다.",
          unblock:
            "`--live`로 사람이 쿼터를 승인하고 실행하면 같은 실행에서 판정된다(원문 텍스트는 여전히 저장하지 않는다 — 길이·발동 종류만).",
        },
      ]),
  {
    id: "L2",
    rule: "C7",
    what: "경로·지연 분포(LLM 성공률 ≥90% · p50 ≤1200ms · p95 ≤2500ms · 타임아웃 0)",
    why: "실제 왕복 없이는 성립하지 않는다. 오프라인 모드에서는 미판정.",
    unblock: "`--live`로 사람이 쿼터를 승인하고 실행.",
  },
  {
    id: "L3",
    rule: "C2(하한)",
    what: "12자 하한",
    why: "코드에 강제 수단이 없다(④ §2.3 '최소 길이 미강제' — 알려진 간극). 비차단 계측만 한다.",
    unblock: "정규화에 하한 가드를 넣으면 차단 규칙으로 승격 가능.",
  },
  {
    id: "L4",
    rule: "C5 ①",
    what: "`후원`(장소 라벨 ∧ 일반 명사)의 자동 판정",
    why: "④ §3.2가 자동 FAIL이 아니라 수동 확인 큐로 격리하라고 규정했다.",
    unblock: "형태소 분석 없이는 자동화 불가 — 리포트 인쇄로 갈음(설계대로).",
  },
  {
    id: "L5",
    rule: "C6",
    what: "실서버 판의 `hands` 스냅샷과의 대조",
    why: "룸 인스턴스를 띄워야 하므로 이 스크립트 범위 밖이다. 대신 검증기 로컬 결정론 딜 + **27라벨 전체를 손패로 가정한 상위집합 검사(C5 ①)**로 판정했다 — 결론은 실제 hands 대조보다 강하다(어떤 딜이 나와도 성립).",
    unblock: "해소 불필요 — 상위집합 검사가 더 강한 명제다.",
  },
  {
    id: "L6",
    rule: "C2(상한 수치)",
    what: "문서 §3.2의 '정규화본 ≤80'",
    why: `07-28 문장경계 절단 도입 전 값이라 낡았다. 코드 상수 LINE_MAX=${LINE_MAX}로 판정했다(문서 쪽 정정 필요).`,
    unblock: "④ §3.2 표의 C2 기준을 LINE_MAX로 갱신.",
  },
];

const exitCode =
  failedRules.size || preFail.length || statFail.length ? 1 : 0;

const report = {
  tool: "eval-narrator",
  spec: "docs/design/20260720-ai-tech-doc.md §3",
  mode: OPT.live ? "live" : "offline",
  seed: OPT.seed,
  generatedAt: new Date().toISOString(),
  source: {
    narrator: "apps/server/src/ai/narrator.ts",
    cards: "packages/shared/src/cards.ts",
    LINE_MAX,
    LINE_BUDGET_SUGGEST,
  },
  preconditions,
  statics,
  suites: Object.fromEntries(
    suites.map(([k, name, t]) => [
      k,
      {
        name,
        total: t.total,
        rules: t.rules,
        lengthStats: stats(t),
        byAction: Object.fromEntries(
          Object.entries(t.byAction).map(([k2, v]) => [
            k2,
            {
              budget: v.budget,
              n: v.n,
              over: v.over,
              mean: +(v.sum / v.n).toFixed(2),
              min: v.min,
              max: v.max,
              decoRate: +((v.deco / v.n) * 100).toFixed(1),
            },
          ]),
        ),
        under12: t.shortCount,
        manualQueue: t.queued.slice(0, 20),
        failures: t.failures.slice(0, 50),
      },
    ]),
  ),
  C7: c7,
  C2raw: c2raw,
  salvage: {
    note: "합성 코퍼스 — 실측 표본이 아니다. 라이브가 관측한 형태(41~50자·종결부호 끝에만)의 재현.",
    ...salvage,
  },
  unjudgeable: LIMITS,
  exitCode,
};

if (OPT.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(exitCode);
}

const line = (n = 78) => "─".repeat(n);
log(`\n환각 검증 — ④ §3 C1~C7 · 모드 ${report.mode.toUpperCase()} · seed ${OPT.seed}`);
log(`대상 apps/server/src/ai/narrator.ts (실소스 import · 미러링 없음)`);
log(`상수 LINE_MAX=${LINE_MAX} · LINE_BUDGET_SUGGEST=${LINE_BUDGET_SUGGEST}\n`);

log("■ 전제 조건");
for (const p of preconditions) log(`  ${p.pass ? "PASS" : "FAIL"}  ${p.id} ${p.name}\n        ${p.detail}`);

log("\n■ 정적 검사 (§2.2 절대 넘기지 않는 값 — 런타임만으로는 '이번엔 안 샜다'까지만 말할 수 있다)");
for (const s of statics) log(`  ${s.pass ? "PASS" : "FAIL"}  ${s.id} ${s.name}\n        ${s.detail}`);

for (const [k, name, t] of suites) {
  if (t.total === 0) {
    log(`\n■ 스위트 ${k} — ${name}\n  (표본 0)`);
    continue;
  }
  const st = stats(t);
  log(`\n■ 스위트 ${k} — ${name}  ·  표본 ${t.total.toLocaleString()}문장`);
  log(`  ${line(70)}`);
  log(`  규칙  검사                                    통과/전체        비율`);
  for (const [id, desc] of Object.entries(RULE_META)) {
    if (!t.rules[id]) continue;
    const s = t.rules[id];
    log(
      `  ${id}    ${desc.padEnd(38)} ${rate(t, id).padStart(14)}  ${pct(s.pass, s.total).padStart(7)}`,
    );
  }
  log(`  ${line(70)}`);
  log(
    `  길이  평균 ${st.mean}자 · 최소 ${st.min} · p95 ${st.p95} · 최대 ${st.max} · 12자 미만 ${t.shortCount}건(§2.3 알려진 간극, 비차단)`,
  );
  log(`\n  길이 규약 준수 — 액션별 (제안 ${LINE_BUDGET_SUGGEST}자 · 그 외 ${LINE_MAX}자)`);
  log(`    액션            예산   표본       초과   평균   최소  최대   추임새부착`);
  for (const [act, v] of Object.entries(t.byAction))
    log(
      `    ${act.padEnd(14)} ${String(v.budget).padStart(4)} ${String(v.n).padStart(9)} ` +
        `${String(v.over).padStart(6)} ${(v.sum / v.n).toFixed(1).padStart(6)} ` +
        `${String(v.min).padStart(6)} ${String(v.max).padStart(5)} ` +
        `${`${((v.deco / v.n) * 100).toFixed(1)}%`.padStart(11)}`,
    );
  if (t.queued.length)
    log(`  수동확인 큐(§3.2 '후원' 오탐 격리): ${t.queued.length}건 — 아래 인쇄`);
  for (const q of t.queued.slice(0, 5)) log(`     · [${q.labels}] ${q.case} → ${q.text}`);
  if (t.failures.length) {
    log(`  실패 상세 (상위 ${Math.min(OPT.showFailures, t.failures.length)}건)`);
    for (const f of t.failures.slice(0, OPT.showFailures))
      log(`     ✗ ${f.rule} ${f.case}\n        "${f.text}"  → ${f.why}`);
  }
}

log(`\n■ C2raw 원문 길이 규약 · 프롬프트 준수율 (④ §3.4 L1 — 07-28 계측 부착)`);
if (c2raw.judged) {
  const ops = Object.entries(c2raw.ops)
    .map(([k, v]) => `${k}×${v}`)
    .join(" · ");
  log(
    `  ${c2raw.pass ? "PASS" : "FAIL"}  원문 표본 ${c2raw.samples}건 · 규약 ${RAW_MIN}~${LINE_MAX}자 ` +
      `${c2raw.inRange}/${c2raw.samples} (${(c2raw.inRangeRate * 100).toFixed(1)}%, 기준 ≥${(c2raw.threshold * 100).toFixed(1)}%)\n` +
      `        길이 평균 ${c2raw.avgRawLen} · 최소 ${c2raw.minRawLen} · 최대 ${c2raw.maxRawLen} · 폐기 ${c2raw.dropped}건\n` +
      `        프롬프트 준수율(정규화 무발동) ${c2raw.clean}/${c2raw.samples} (${(c2raw.cleanRate * 100).toFixed(1)}%)` +
      (ops ? ` · 발동 ${ops}` : " · 발동 0"),
  );
  for (const v of c2raw.violations.slice(0, OPT.showFailures))
    log(`     ✗ ${v.case} rawLen=${v.rawLen} ops=[${v.ops.join("+") || "-"}]${v.dropped ? " (폐기)" : ""}`);
} else {
  log(`  N/A  ${c2raw.reason}`);
}

log(`\n■ 상한 초과 구제 — 합성 코퍼스 (🔴 실측 아님. 라이브가 관측한 *형태*의 재현)`);
if (salvage.n) {
  const tierStr = Object.entries(salvage.tiers)
    .map(([k, v]) => `${k}×${v}`)
    .join(" · ");
  log(
    `  표본 ${salvage.n}종 · 이전 규칙(문장경계 1순위만) 생존 ${salvage.legacyKept}/${salvage.n}` +
      ` (${pct(salvage.legacyKept, salvage.n)}) → 현재 ${salvage.keptNow}/${salvage.n} (${pct(salvage.keptNow, salvage.n)})`,
  );
  log(`  절단 단계 누계(프로세스): ${tierStr || "—"}`);
  for (const r of salvage.rows.slice(0, 4))
    log(`     원문 ${r.rawLen}자 → 이전 ${r.old === null ? "폐기" : `${[...r.old].length}자`} · 현재 ${r.len}자  "${r.now}"`);
} else {
  log("  N/A  코퍼스 미실행");
}

log(`\n■ C7 경로·지연 분포`);
if (c7.judged) {
  log(
    `  ${c7.pass ? "PASS" : "FAIL"}  llm ${c7.llm} / cache ${c7.cache} / fallback ${c7.fallback} / timeout ${c7.timeout}` +
      ` · 성공률 ${(c7.successRate * 100).toFixed(1)}% (기준 ≥90%)` +
      ` · p50 ${c7.p50}ms (≤1200) · p95 ${c7.p95}ms (≤2500)` +
      (Object.keys(fbReasons).length
        ? `\n        폴백 사유 ${Object.entries(fbReasons).map(([k2, v]) => `${k2}×${v}`).join(" · ")}`
        : ""),
  );
} else {
  log(`  N/A  ${c7.reason}`);
}

log(`\n■ 현재 코드로 판정 불가 — 추정으로 채우지 않는다`);
for (const l of LIMITS)
  log(`  ${l.id} [${l.rule}] ${l.what}\n      사유: ${l.why}\n      해소: ${l.unblock}`);

log(`\n■ 표본 대사 (스위트 A, 문안 #0)`);
for (const s of sampleLines.slice(0, 6))
  log(`  ${s.ok ? "○" : "✗"} ${s.case.padEnd(16)} ${String(s.len).padStart(2)}자  ${s.text}`);

log(`\n${line()}`);
log(
  exitCode === 0
    ? "결과: PASS — 적용 가능한 규칙 전건 통과. (C2raw·C7은 실호출 모드에서만 판정된다)"
    : `결과: FAIL — 위반 규칙 [${[...failedRules].join(", ")}]${preFail.length ? ` · 전제 ${preFail.map((p) => p.id)}` : ""}${statFail.length ? ` · 정적 ${statFail.map((s) => s.id)}` : ""}`,
);
if (!OPT.live)
  log(
    "쿼터: 이번 실행의 Gemini 호출 0건. 실호출은 `--live`(+`--max-calls`)로 사람이 결정한다.",
  );
log(line());

// ── 리포트 파일 산출 ────────────────────────────────────────────────
// ④ §3·§10이 "이 스크립트가 리포트를 생성한다"고 명시하는데 실제로는 아무 파일도
// 남기지 않았다. 가장 강한 정량 주장(전수 스윕)의 **근거 파일이 리포에 없으면**
// 확인하러 온 사람이 못 찾고, 그 순간 나머지 참인 주장까지 함께 의심받는다.
// `--no-report`로 끌 수 있다(CI에서 워킹트리를 더럽히지 않으려면).
if (!has("--no-report")) {
  const md = [
    "# eval-narrator 리포트 (자동 생성)",
    "",
    "> 이 파일은 `node scripts/eval-narrator.mjs`가 매 실행마다 덮어쓴다. **직접 편집하지 마라.**",
    `> 생성 ${report.generatedAt} · 모드 **${report.mode}** · seed ${report.seed} · 명세 ④ §3`,
    "",
    `## 결과: ${exitCode === 0 ? "PASS" : "FAIL"}`,
    "",
    OPT.live
      ? "실호출 모드. Gemini 쿼터를 소모했다."
      : "오프라인 모드 — **Gemini 호출 0건**. 실호출이 필요한 규칙(C2raw·C7)은 미판정으로 남는다.",
    "",
    "## 스위트",
    "",
    "| 스위트 | 표본 | 통과 | 실패 |",
    "|---|---|---|---|",
    ...suites.map(
      ([, name, t]) =>
        `| ${name} | ${t.total} | ${t.total - (t.failed?.length ?? 0)} | ${t.failed?.length ?? 0} |`,
    ),
    "",
    "## 판정 불가로 남긴 것",
    "",
    ...LIMITS.map((l) => `- **${l.id} [${l.rule}]** ${l.what} — 사유: ${l.why}`),
    "",
    "## 기계 판독용",
    "",
    "```json",
    JSON.stringify(report, null, 2),
    "```",
    "",
  ].join("\n");
  try {
    writeFileSync("docs/design/eval-narrator-report.md", md);
    log("리포트: docs/design/eval-narrator-report.md 갱신됨");
  } catch (e) {
    log(`리포트 저장 실패: ${String(e)}`);
  }
}

process.exit(exitCode);
