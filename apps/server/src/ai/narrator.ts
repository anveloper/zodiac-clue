// NPC 대사 생성 — 결정(진실값)은 규칙엔진이 하고, 여기선 "표현(대사)"만 만든다.
// LLM은 주어진 '결정된 정보'만 사용해 한 문장 대사를 생성. 진실값을 만들거나 남의 패를
// 아는 척하지 않는다. 키(GEMINI_API_KEY)가 없거나 실패하면 규칙기반 폴백 대사로 대체.

import type {
  AiFallbackReason,
  AiNormalizeOp,
  SayAi,
} from "@zodiac-clue/shared";
import { josa } from "../util/josa";
import { recordQuotaError } from "./telemetry";

export type NarrationInput = {
  /** 캐릭터 표시명 (예: "생쥐 서생") */
  name: string;
  action: "suggest" | "accuse" | "scheme";
  /** 라벨(한글) */
  suspect: string;
  weapon: string;
  room: string;
  /** 계략(귓속말) 시 은밀히 흘릴 단서(엿본 카드 라벨 등) */
  hint?: string;
  /** 캐릭터 성격 (말투에 반영) */
  persona?: string;
  /** 말투 지시 (LLM 프롬프트용, 예: "훈계조로 꾸짖듯") */
  tone?: string;
  /** 폴백 대사 앞 추임새 (예: "쯧쯧, ") */
  intro?: string;
  /** 폴백 대사 끝 추임새 (예: " 마땅히 그러하렷다.") */
  outro?: string;
  /** 제안이 반증되었는지 */
  disproved?: boolean;
};

const NARRATE_TIMEOUT_MS = 4000;

/**
 * 디렉팅 명세(제출물 ④ §2.3)가 정한 대사 길이 상한.
 * **프롬프트·폴백·LLM 사후 정규화가 이 상수 하나를 본다.** 예전에는 프롬프트에만
 * "12~40자"라고 적혀 있고 코드 상한은 80자였다 — 강제 수단이 없으니 폴백 평균이 47자였고
 * `bubbleLifeMs`가 그만큼 길어져 판 길이를 지배했다(로드맵 §7.5 2차 실측).
 */
export const LINE_MAX = 40;

/**
 * 규약 **하한**. 코드가 강제하지는 않는다(④ §2.3 "최소 길이 미강제" — 강제 여부는 사람 판단
 * 대기 중이라 임의로 정하지 않는다). 다만 프롬프트 문안과 계측이 **같은 숫자**를 봐야
 * "LLM이 12~40자 규약을 얼마나 지키는가"를 셀 수 있으므로 상수로 올린다.
 */
export const LINE_MIN = 12;

/**
 * **제안 대사 전용** 페이싱 예산. 봇 1턴의 임계경로에 있는 대사는 제안뿐이다
 * (고발·계략 대사에는 홀드 타이머를 걸지 않는다 — `clue-room.ts` `afterBotSpeak`/`helperWhisper`).
 *
 * 역산: 봇 1턴 = npcDelay(하한 800) + BOT_ACT_GAP(600) + bubbleLifeMs(len)
 *              = 1400 + len×TYPE_MS(55) + BUBBLE_HOLD_MS(1200) ≤ 4000
 *              ⇒ len ≤ (4000 − 1400 − 1200) / 55 = 25.4
 * 고발·계략은 `LINE_MAX`(40)까지 허용해 클라이맥스 대사의 캐릭터색을 지킨다.
 */
export const LINE_BUDGET_SUGGEST = 25;

/**
 * 고발·계략의 **목표** 길이. 상한(`LINE_MAX`)이 아니라 프롬프트가 모델에게 요구하는 값이다.
 *
 * 유도: 07-28 라이브 실측에서 모델의 최대 원문이 50자였다 — 상한 40 대비 **초과율 1.25배**.
 * 같은 초과율이 유지된다면 목표를 `LINE_MAX / 1.25 = 32`로 내렸을 때 최악의 원문이 40자에
 * 들어온다. **상한은 그대로 두고 목표만 내린다** — "못 지켰는데 통과시키는 것"이 아니라
 * "지키기 쉬운 목표를 주는 것"이다. 제안은 페이싱 예산(§6.2)이 더 빡빡하므로 25를 쓴다.
 */
export const LINE_TARGET_LOUD = 32;

/** 액션별 목표 길이. 홀드 타이머가 걸리는 제안만 페이싱 예산(25)까지 조인다. */
const targetLen = (action: NarrationInput["action"]): number =>
  action === "suggest" ? LINE_BUDGET_SUGGEST : LINE_TARGET_LOUD;

/**
 * 목표 글자 수를 **어절 수**로도 준다. 모델은 글자를 잘 못 세지만 띄어쓰기 단위는 센다
 * (07-28 실측: "12~40자"라고만 적었을 때 원문 22%가 40자를 넘겼다).
 * 한국어 어절 평균 ≈ 3자 + 공백 1 = 4자 → `target / 4`.
 */
const targetWords = (n: number): number => Math.max(3, Math.round(n / 4));

const SYSTEM =
  "너는 조선 사극풍 추리 보드게임 NPC다. 배경: 호랑이 대감의 생신 잔치에서 누군가 잔치 음식·선물을 훔쳤다. " +
  "누가(도둑)·무엇을(훔친 것)·어디서(장소)를 추리한다. " +
  "사용자가 주는 '결정된 행동'을 사극 말투 대사 한 문장으로만 바꾼다. " +
  "**주어진 NPC 성격이 말투와 태도에 뚜렷이 드러나야 한다.** " +
  "규칙: 오직 대사 한 문장만 출력. 머리말/설명/선택지/마크다운/따옴표 전부 금지. " +
  // 길이는 **사용자 턴이 액션별로 지정**한다(제안은 페이싱 예산이 더 빡빡하다).
  // 여기서는 지키는 방법과 감각만 준다 — 숫자만 반복해 봐야 모델은 글자를 못 센다.
  `길이는 사용자가 지정한 값 이내로 맞춘다. 짧을수록 좋다. ${LINE_MAX}자를 넘으면 그 대사는 버려진다. ` +
  "짧게 쓰는 법: ① 접속어(그리고·하니·하며·인데)로 문장을 잇지 마라 " +
  "② 쉼표는 많아야 하나 ③ 수식어와 설명을 빼고 핵심만 남겨라. " +
  // ⚠️ 여기서 «세 요소를 다 읊지 말고 한둘만 집어라»까지만 적었더니 8콜 중 2콜이
  // 라벨을 **하나도** 넣지 않아 §3 C4(진실값 유지)가 6/8로 떨어졌다(07-28 실측).
  // 짧게 쓰라는 압력과 «결정된 값을 말하라»는 계약은 같은 문장에서 못을 박아야 한다.
  "다만 주어진 이름·물건·장소 중 **최소 하나는 준 글자 그대로** 문장에 넣는다 — " +
  "줄여 부르거나 다른 말로 바꾸면 안 된다. 나머지는 생략해도 좋다. " +
  "길이 감각(문구를 베끼지 말고 길이만 참고하라): " +
  "그 셈속이 훤히 보이는구먼 = 14자 / 쯧쯧, 어림도 없는 수작일세 = 15자 / " +
  "낱낱이 밝혀 두는 게 좋을 게요 = 17자. " +
  "게임의 정답이나 남의 손패를 아는 척 금지, 주어진 정보만 사용.";

const rand = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/**
 * 예산 안에서 **캐릭터색을 최대한** 붙인다.
 * 추임새(intro/outro)는 `cards.ts`의 `VOICE` 단일 소스이며 인물을 식별하는 유일한 표식이라
 * "길어서 통째로 버린다"가 아니라 **들어가는 만큼 넣는다**:
 *   둘 다 → 후렴(outro, 인물 고유 문구라 색이 더 진하다) → 머리말(intro) → 없음.
 * 마지막 폴백에서도 규약 상한(`LINE_MAX`)은 지킨다.
 */
const fit = (body: string, i: NarrationInput, budget: number): string => {
  const intro = i.intro ?? "";
  const outro = i.outro ?? "";
  for (const cand of [intro + body + outro, body + outro, intro + body, body]) {
    const s = cand.trim();
    if (s.length <= budget) return s;
  }
  return body.trim().slice(0, LINE_MAX);
};

/**
 * 규칙기반 폴백 대사 (LLM 없이도 사극 말투 한 줄). intro/outro로 캐릭터색을 입힌다.
 * 문안 원본은 `20260727-ui-copy.md` §8.2 — **길이 규약(④ §2.3)에 맞춰 압축**했다.
 * 조사는 여전히 회피하거나 `josa()`로 고른다(§7.14 `떡시루이` 재발 방지).
 */
export const fallbackLine = (i: NarrationInput): string => {
  const budget = i.action === "suggest" ? LINE_BUDGET_SUGGEST : LINE_MAX;
  const deco = (s: string): string => fit(s, i, budget);
  if (i.action === "accuse") {
    return deco(
      rand([
        `도둑은 ${i.suspect}! ${i.room}의 「${i.weapon}」`,
        `${i.suspect}, 「${i.weapon}」, ${i.room} — 끝일세`,
        `더 볼 것 없다. ${i.suspect}, ${i.weapon}, ${i.room}`,
      ]),
    );
  }
  if (i.action === "scheme") {
    const h = i.hint ?? "";
    return deco(
      rand([
        `쉿… ${h}, 자네만 알게`,
        `가까이 오게. ${h} — 못 들은 걸로`,
        `은밀히 이르네. ${h}`,
        `${h}… 내 입에서 난 말은 아닐세`,
      ]),
    );
  }
  // 반증당한 뒤에는 3요소를 다시 읊지 않는다 — 제안 내용은 이미 로그 한 줄에 다 있고,
  // 여기서 필요한 것은 "지웠다"는 반응이다(길이를 8~10자 줄이는 가장 싼 레버).
  if (i.disproved) {
    return deco(
      rand([
        `${i.suspect}, 「${i.weapon}」… 아니군`,
        `${i.room}의 「${i.weapon}」${josa(i.weapon, "이", "가")} 아니라니`,
        `${i.suspect}도 ${i.weapon}도 아니군`,
      ]),
    );
  }
  return deco(
    rand([
      `${i.room}의 ${i.suspect}, 「${i.weapon}」`,
      `${i.suspect}, ${i.room}의 「${i.weapon}」`,
      `${i.room}에서 ${i.suspect}, ${i.weapon}`,
      `${i.suspect}, 자네 ${i.room}엔 왜 갔는가`,
    ]),
  );
};

/**
 * 문장 **어디에 있든** 지우는 마크업·인용부호(④ §2.3 "마크업 제거가 양끝 한정" 간극 해소).
 * §3 C3의 판정 사전(`따옴표 · 별표·밑줄·해시`)과 **같은 집합**을 지운다 — 검사기가 잡는
 * 문자를 정규화가 남기면 그 검사는 실호출에서 상시 FAIL을 뜻하게 된다.
 *
 * **남기는 것과 그 근거**
 * - `「」` 낫표 — 폴백 문안이 실제로 쓰는 **대사 인용부호**이고(`${i.room}의 「${i.weapon}」`)
 *   C3 사전에 없다(eval P4의 양성 케이스 "정상(낫표)"). 마크업이 아니다.
 * - `…` 말줄임표 · `~` 물결 — **문장 종결부호**로 아래 절단 로직이 경계로 삼는 문자다.
 *   뱀 무녀 `스으…, ` 처럼 페르소나 추임새의 일부이기도 하다.
 * - `—` 줄표 · `·` 가운뎃점 — 폴백 문안·`hint` 구분자로 쓰인다.
 */
const MARKUP_RE = /[*_`#"'“”‘’«»]/g;

/**
 * **완결 문장 경계**(절단 1순위). 여기서 자르면 문장이 끝난 자리이므로 그대로 쓴다.
 */
const SENTENCE_END = [".", "!", "?", "…", "~"];

/**
 * **절 경계**(절단 2순위). 자르면 문장이 미완결이므로 말줄임표로 닫는다.
 */
const CLAUSE_END = [",", "·", "—", ";", ":"];

/**
 * 미완결 절단을 닫는 부호. 한국어에서 **말끝을 흐리는 것은 자연스러운 화법**이라
 * 어절 경계에서 끊고 `…`를 붙이면 문장이 뭉개지지 않고 페르소나도 덜 다친다
 * (뱀 무녀 `스으…` 처럼 추임새로도 쓰이는 문자다). C3 판정 사전에 없다.
 */
const ELLIPSIS = "…";

const lastIndexOfAny = (s: string, chars: string[]): number =>
  chars.reduce((m, c) => Math.max(m, s.lastIndexOf(c)), -1);

/** 끝에 남은 구분부호·공백을 턴다 — `쯧쯧,…` 같은 이중 부호를 막는다. */
const trimTail = (s: string): string => s.replace(/[\s.,!?~…·—;:]+$/u, "");

/**
 * `limit` 이내에서 **어절이 온전히 끝나는** 가장 긴 앞부분.
 * ⚠️ **어절 중간에서는 절대 자르지 않는다** — 그것이 80자 하드컷을 버렸던 이유다.
 * 마지막에 1글자 토막(`그…`·`저…`)이 남으면 그 어절도 버린다.
 * 공백이 하나도 없으면 `""`(→ 폐기).
 */
const wordCut = (full: string, limit: number): string => {
  let end = -1;
  for (let i = 0; i <= Math.min(limit, full.length - 1); i++)
    if (full[i] === " ") end = i;
  if (end < 0) return "";
  let kept = trimTail(full.slice(0, end));
  const tail = kept.slice(kept.lastIndexOf(" ") + 1);
  if (tail.length <= 1) {
    const prev = kept.lastIndexOf(" ");
    kept = prev > 0 ? trimTail(kept.slice(0, prev)) : "";
  }
  return kept;
};

/**
 * 절단 단계별 발동 횟수. `AiNormalizeOp`는 `packages/shared` 계약이라 새 값을 넣을 수 없어
 * (클라가 읽는 필드다 — 추가만 허용) 세 단계 모두 `truncate` 한 칸으로 나간다.
 * **어느 단계가 문장을 살렸는지**는 서버 로컬 계측으로만 센다 → `GET /health`.
 */
const tiers = { sentence: 0, clause: 0, word: 0, drop: 0 };
export type NormalizeTiers = typeof tiers;

/** `GET /health`용 스냅샷 — 절단 단계별 누적(프로세스 단위). */
export const normalizeStats = (): NormalizeTiers => ({ ...tiers });

/** 정규화 결과 — 문장 + **무엇이 발동했는가**(④ §3.4 L1: 프롬프트 준수율의 분모/분자). */
export type NormalizeResult = {
  text: string | null;
  /** 원문 길이(문자 수). **원문 텍스트는 담지 않는다.** */
  rawLen: number;
  ops: AiNormalizeOp[];
};

/**
 * LLM 응답 사후 정규화 — 프롬프트를 신뢰하지 않고 코드로 강제한다(④ §2.3).
 * ① 첫 줄만 ② 따옴표·별표 제거(**양끝 + 문장 중간**) ③ **길이 규약 강제**.
 *
 * ②를 "양끝 한정"에서 바꾼 이유(④ §2.3 알려진 간극):
 * - 이전 정규식은 `^["'*]+|["'*]+$`라 `**뱀 무녀**가 훔쳤다`의 가운데 `**`가 그대로 남았다.
 *   §3 C3가 바로 그것을 FAIL로 잡는 규칙이므로, 프롬프트가 한 번 흔들리면 **검사기가
 *   잡되 코드는 못 고치는** 상태가 된다. 지우는 문자 집합을 C3 사전과 일치시킨다.
 *
 * ③의 처리를 "80자 하드컷"에서 바꾼 이유:
 * - 하드컷은 문장을 중간에서 자른다(④ §2.3이 80자 여유를 둔 이유). 그런데 잘리지 않은
 *   41~80자 문장은 그대로 `bubbleLifeMs`에 들어가 봇 1턴을 1.5~2초씩 늘린다.
 * - **재시도는 하지 않는다** — 왕복 4초 타임아웃을 한 번 더 무는 것이 바로 지금 고치려는
 *   페이싱 문제이고, 무료티어 호출 예산(이벤트당 1콜)도 규약이다.
 * - 대신 **문장 경계에서만 줄인다**: 상한 안에 완결된 문장이 있으면 그것을 쓰고,
 *   없으면 `null`(→ 호출부가 규칙 폴백으로 대체). 폴백은 길이 규약을 항상 지킨다.
 *
 * `ops`가 **빈 배열이면 LLM이 출력 계약을 그대로 지킨 것**이다. 그 비율이 프롬프트 준수율이며,
 * 계측에 남기는 값은 길이·발동 종류뿐 — **원문 문자열은 여기서 밖으로 나가지 않는다.**
 */
export const normalizeWithMeta = (raw: string): NormalizeResult => {
  const ops: AiNormalizeOp[] = [];
  const rawLen = raw.length;

  const nl = raw.indexOf("\n");
  const first = nl < 0 ? raw : raw.slice(0, nl);
  // 뒤에 **내용이 있을 때만** 발동으로 센다 — 끝의 개행 하나까지 위반으로 세면
  // 준수율이 실제보다 낮게 나오고, 그 숫자는 프롬프트를 고칠 근거가 되지 못한다.
  if (nl >= 0 && raw.slice(nl + 1).trim() !== "") ops.push("oneline");

  // 마크업은 문장 어디에 있든 제거한다. 제거 후 생기는 이중 공백만 접는다
  // (어절을 붙여버리면 `**뱀 무녀**가` → `뱀 무녀가`가 아니라 문장이 뭉개진다).
  const demarked = first.replace(MARKUP_RE, "");
  if (demarked !== first) ops.push("markup");
  const stripped = demarked.replace(/ {2,}/g, " ");

  const one = stripped.trim();
  if (!one) {
    ops.push("drop");
    return { text: null, rawLen, ops };
  }
  if (one.length <= LINE_MAX) return { text: one, rawLen, ops };

  // ── 상한 초과 — **3단 절단**. 어느 단계든 어절 중간은 자르지 않는다.
  //
  // 07-28 라이브에서 폐기 9건 중 `truncate` 발동이 **0건**이었다. 원인은 우연이 아니라
  // 구조다: 프롬프트가 «한 문장만»을 요구하므로 종결부호는 **문장 맨 끝에 하나뿐**이고,
  // 원문이 상한을 넘었다는 것은 그 하나가 상한 밖에 있다는 뜻이다 → 1순위는 원리적으로
  // 발동할 수 없고 전부 폐기로 떨어졌다. 그래서 경계 후보를 절·어절까지 넓힌다.
  //
  // ⚠️ 넓히는 것은 **경계 후보**이지 규약이 아니다. 결과 문장은 여전히 `LINE_MAX` 이내이고
  // `ops`에 `truncate`가 남아 준수율(cleanRate)의 분자에서 빠진다 — 통과시킨 것이 아니라
  // **못 지킨 사실을 기록한 채 문장을 살린 것**이다.

  // ① 완결 문장 경계 — 상한 안에 종결부호가 있으면 거기까지가 완성된 문장이다.
  const head = one.slice(0, LINE_MAX);
  const cut = lastIndexOfAny(head, SENTENCE_END);
  if (cut >= LINE_MIN - 1) {
    tiers.sentence += 1;
    ops.push("truncate");
    return { text: head.slice(0, cut + 1).trim(), rawLen, ops }; // 최소 12자 유지
  }

  // ②③ 미완결 절단 — 말줄임표 한 칸을 빼고 자리를 잡는다.
  const room = LINE_MAX - ELLIPSIS.length;
  const clauseAt = lastIndexOfAny(one.slice(0, room), CLAUSE_END);
  const byClause = clauseAt >= LINE_MIN ? trimTail(one.slice(0, clauseAt)) : "";
  const byWord = wordCut(one, room);
  // 둘 다 어절 경계지만 **더 많이 살리는 쪽**을 쓴다 — 잘려나간 뒷부분에 3요소 라벨이
  // 들어 있으면 C4(진실값 유지)가 흔들린다. 남는 글자가 많을수록 라벨이 남는다.
  const kept = byWord.length >= byClause.length ? byWord : byClause;
  if (kept.length >= LINE_MIN) {
    if (kept === byWord) tiers.word += 1;
    else tiers.clause += 1;
    ops.push("truncate");
    return { text: kept + ELLIPSIS, rawLen, ops };
  }

  // 공백조차 없는 한 덩어리 — 여기서 자르면 어절 중간이므로 폐기한다(규칙 폴백으로).
  tiers.drop += 1;
  ops.push("drop");
  return { text: null, rawLen, ops };
};

/**
 * 정규화본만 필요한 호출부를 위한 얇은 래퍼. 계측(`rawLen`·`ops`)이 필요하면
 * `normalizeWithMeta()`를 쓴다 — 메타를 버리는 경로를 기본으로 두면
 * "정규화가 몇 번 발동했는가"를 다시 셀 수 없게 된다(④ §3.4 L1이 그렇게 생겼다).
 */
export const normalizeLine = (raw: string): string | null =>
  normalizeWithMeta(raw).text;

/**
 * `narrate()` 반환 — **문장 + 그 문장이 온 경로**(④ §4-1).
 * `text === null`이면 반드시 `source === "fallback"`이고 `reason`이 채워진다.
 * 호출부는 `fallbackLine()`으로 문장을 채우되 **메타는 이 값을 그대로 방송한다.**
 */
export type NarrationResult = SayAi & { text: string | null };

/**
 * LLM(Gemini) 대사 생성. 키가 없거나 오류/타임아웃이면 `text: null`(→ 호출부에서 폴백).
 * 무료티어 안전: 이벤트당 1콜, 짧은 출력, 타임아웃.
 *
 * **절대 throw하지 않는다** — 모든 실패는 `reason`이 붙은 폴백 결과로 환원된다.
 * 예외로 새면 호출부의 `catch`가 사유를 삼켜 07-27 장애가 그대로 재현된다.
 */
// 동일 상황 대사 캐시 (무료티어 호출 절약). 단순 LRU-ish, 상한 200.
const CACHE_MAX = 200;
const cache = new Map<string, string>();
const cacheKey = (i: NarrationInput): string =>
  [
    i.action,
    i.suspect,
    i.weapon,
    i.room,
    i.persona,
    i.tone,
    i.disproved,
    i.hint,
  ].join("|");
const cacheGet = (k: string): string | undefined => {
  const v = cache.get(k);
  if (v !== undefined) {
    cache.delete(k); // 최근 사용으로 갱신
    cache.set(k, v);
  }
  return v;
};
const cacheSet = (k: string, v: string): void => {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
};

/** 조회 시도 수 — **적중률의 분모**. 이게 없으면 `cacheHits 0`이 "캐시가 고장" 인지
 *  "칠 일이 없었다" 인지 구분되지 않는다(07-28 실측 0/32가 정확히 그 상태였다). */
let cacheLookups = 0;

/**
 * 캐시 키 공간의 크기 — `cacheKey`가 진실값 조합(용의자12×장물6×장소9)에 페르소나12와
 * `disproved` 2를 곱한 값이다. **한 판의 발화 수(≈30)로는 원리적으로 못 맞힌다**는 사실을
 * `/health`가 숫자로 말하게 한다. (라벨 수는 여기서 상수로 적지 않고 계산식만 남긴다 —
 * `packages/shared`를 import하면 §3 S2의 의존 경계를 흐린다.)
 */
export const cacheInfo = (): {
  size: number;
  max: number;
  lookups: number;
  keyFields: string[];
} => ({
  size: cache.size,
  max: CACHE_MAX,
  lookups: cacheLookups,
  keyFields: [
    "action",
    "suspect",
    "weapon",
    "room",
    "persona",
    "tone",
    "disproved",
    "hint",
  ],
});

/** 현재 설정된 모델명(키 값이 아니다 — `/health`가 그대로 노출해도 안전). */
export const currentModel = (): string =>
  process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";

/** 키 **보유 여부**만 — 값은 어디에도 반환하지 않는다. */
export const hasApiKey = (): boolean => !!process.env.GEMINI_API_KEY;

/** `AI_NARRATE=off`로 LLM 경로를 끈다(폴백 대사 회귀 확인용). */
const isDisabled = (): boolean =>
  (process.env.AI_NARRATE ?? "").toLowerCase() === "off";

const fb = (reason: AiFallbackReason, ms = 0): NarrationResult => ({
  text: null,
  source: "fallback",
  ms,
  model: "", // 폴백은 모델을 쓰지 않았다 → 빈 문자열(계약)
  reason,
});

export const narrate = async (i: NarrationInput): Promise<NarrationResult> => {
  const started = Date.now();
  const key = process.env.GEMINI_API_KEY;
  if (isDisabled()) return fb("disabled");
  if (!key) return fb("nokey");
  const model = currentModel();

  // 캐시 히트 시 API 호출 없이 재사용
  const ck = cacheKey(i);
  cacheLookups += 1;
  const cached = cacheGet(ck);
  if (cached !== undefined) {
    return {
      text: cached,
      source: "cache",
      ms: Date.now() - started, // 0~1ms. 왕복이 사라졌다는 사실 자체가 계측값이다.
      model,
    };
  }

  const act =
    i.action === "accuse"
      ? `행동: 고발 — 도둑 ${i.suspect}, 훔친 것 ${i.weapon}, 장소 ${i.room}.`
      : i.action === "scheme"
        ? `행동: 계략(귓속말) — 은밀히 정보를 흘린다. 단서: ${i.hint ?? ""}. 상대에게만 소곤대듯 한 문장.`
        : `행동: 제안 — ${i.suspect} / ${i.weapon} / ${i.room}${
            i.disproved ? " (반증당함)" : ""
          }.`;
  // 길이 목표는 **액션마다 다르다**(제안만 홀드 타이머의 임계경로에 있다 — §6.2).
  // 시스템 지시가 아니라 사용자 턴에 붙이는 이유: 시스템 문자열을 액션별로 갈라 만들면
  // 네트워크 payload의 텍스트 출처가 늘어나 §3 S5(출처 2개)의 검사 대상이 흐려진다.
  const tgt = targetLen(i.action);
  const userText =
    `NPC: ${i.name} (성격: ${i.persona ?? "무난함"}` +
    `${i.tone ? `; 말투: ${i.tone}` : ""}). ${act}` +
    ` 길이: ${tgt}자 이내(어절 ${targetWords(tgt)}개 이하).`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NARRATE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: {
            temperature: 0.95,
            maxOutputTokens: 64,
            // thinkingConfig는 보내지 않는다.
            // `gemini-flash-lite-latest` 별칭이 신세대 모델로 이동하면서
            // `thinkingBudget: 0`이 400 INVALID_ARGUMENT로 거부된다(2026-07-28 실측).
            // 그 400이 조용히 폴백으로 흡수돼 전 대사가 규칙 대사로 나가고 있었다.
            // 미지정 시 정상 응답하며 64토큰 예산도 충분하다(5/5 검증).
          },
        }),

        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      // 상태코드만 남기면 원인이 묻힌다 — 실제로 400의 사유가 로그에 없어
      // "LLM이 조용히 폴백되는" 상태를 오래 못 알아챘다. 본문 앞부분까지 남긴다.
      const detail = await res.text().catch(() => "");
      console.warn(`[narrate] HTTP ${res.status} ${detail.slice(0, 200)}`);
      if (res.status === 429) recordQuotaError(); // 쿼터 소진은 별도로 센다(④ §4-4)
      return fb("http", Date.now() - started);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      console.warn("[narrate] empty text");
      return fb("empty", Date.now() - started);
    }
    // 안전: 한 줄만, 마크업 제거, 길이 규약 강제(초과분은 문장 경계 절단 또는 폐기).
    // `rawLen`·`ops`는 여기서만 생긴다 — **원문 문자열은 이 스코프 밖으로 나가지 않는다.**
    const norm = normalizeWithMeta(text);
    if (!norm.text) {
      console.warn(
        `[narrate] dropped (rawLen=${norm.rawLen} ops=${norm.ops.join("+")}) → fallback`,
      );
      return {
        ...fb("toolong", Date.now() - started),
        rawLen: norm.rawLen,
        norm: norm.ops,
      };
    }
    cacheSet(ck, norm.text);
    return {
      text: norm.text,
      source: "llm",
      ms: Date.now() - started,
      model,
      rawLen: norm.rawLen,
      norm: norm.ops,
    };
  } catch (e) {
    const name = e instanceof Error ? e.name : String(e);
    console.warn(`[narrate] err ${name}`);
    // AbortError = 4000ms 초과. 그 외 네트워크 오류도 왕복 실패이므로 같은 칸에 넣되
    // 사유는 구분한다(타임아웃과 DNS 실패는 대응이 다르다).
    return fb(name === "AbortError" ? "timeout" : "http", Date.now() - started);
  } finally {
    clearTimeout(timer);
  }
};
