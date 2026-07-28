// NPC 대사 생성 — 결정(진실값)은 규칙엔진이 하고, 여기선 "표현(대사)"만 만든다.
// LLM은 주어진 '결정된 정보'만 사용해 한 문장 대사를 생성. 진실값을 만들거나 남의 패를
// 아는 척하지 않는다. 키(GEMINI_API_KEY)가 없거나 실패하면 규칙기반 폴백 대사로 대체.

import type { AiFallbackReason, SayAi } from "@zodiac-clue/shared";
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
 * **제안 대사 전용** 페이싱 예산. 봇 1턴의 임계경로에 있는 대사는 제안뿐이다
 * (고발·계략 대사에는 홀드 타이머를 걸지 않는다 — `clue-room.ts` `afterBotSpeak`/`helperWhisper`).
 *
 * 역산: 봇 1턴 = npcDelay(하한 800) + BOT_ACT_GAP(600) + bubbleLifeMs(len)
 *              = 1400 + len×TYPE_MS(55) + BUBBLE_HOLD_MS(1200) ≤ 4000
 *              ⇒ len ≤ (4000 − 1400 − 1200) / 55 = 25.4
 * 고발·계략은 `LINE_MAX`(40)까지 허용해 클라이맥스 대사의 캐릭터색을 지킨다.
 */
export const LINE_BUDGET_SUGGEST = 25;

const SYSTEM =
  "너는 조선 사극풍 추리 보드게임 NPC다. 배경: 호랑이 대감의 생신 잔치에서 누군가 잔치 음식·선물을 훔쳤다. " +
  "누가(도둑)·무엇을(훔친 것)·어디서(장소)를 추리한다. " +
  "사용자가 주는 '결정된 행동'을 사극 말투 대사 한 문장으로만 바꾼다. " +
  "**주어진 NPC 성격이 말투와 태도에 뚜렷이 드러나야 한다.** " +
  "규칙: 오직 대사 한 문장만 출력. 머리말/설명/선택지/마크다운/따옴표 전부 금지. " +
  `12~${LINE_MAX}자 — 짧을수록 좋다(20자 내외 권장). ${LINE_MAX}자를 넘으면 폐기된다. ` +
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
 * LLM 응답 사후 정규화 — 프롬프트를 신뢰하지 않고 코드로 강제한다(④ §2.3).
 * ① 첫 줄만 ② 앞뒤 따옴표·별표 제거 ③ **길이 규약 강제**.
 *
 * ③의 처리를 "80자 하드컷"에서 바꾼 이유:
 * - 하드컷은 문장을 중간에서 자른다(④ §2.3이 80자 여유를 둔 이유). 그런데 잘리지 않은
 *   41~80자 문장은 그대로 `bubbleLifeMs`에 들어가 봇 1턴을 1.5~2초씩 늘린다.
 * - **재시도는 하지 않는다** — 왕복 4초 타임아웃을 한 번 더 무는 것이 바로 지금 고치려는
 *   페이싱 문제이고, 무료티어 호출 예산(이벤트당 1콜)도 규약이다.
 * - 대신 **문장 경계에서만 줄인다**: 상한 안에 완결된 문장이 있으면 그것을 쓰고,
 *   없으면 `null`(→ 호출부가 규칙 폴백으로 대체). 폴백은 길이 규약을 항상 지킨다.
 */
export const normalizeLine = (raw: string): string | null => {
  const one = raw
    .split("\n")[0]
    .replace(/^["'*]+|["'*]+$/g, "")
    .trim();
  if (!one) return null;
  if (one.length <= LINE_MAX) return one;
  // 상한 안에서 마지막 문장 끝(종결부호)까지만 남긴다 — 어절 중간 절단 금지.
  const head = one.slice(0, LINE_MAX);
  const cut = Math.max(
    head.lastIndexOf("."),
    head.lastIndexOf("!"),
    head.lastIndexOf("?"),
    head.lastIndexOf("…"),
    head.lastIndexOf("~"),
  );
  if (cut >= 11) return head.slice(0, cut + 1).trim(); // 최소 12자 유지
  return null;
};

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
  const userText =
    `NPC: ${i.name} (성격: ${i.persona ?? "무난함"}` +
    `${i.tone ? `; 말투: ${i.tone}` : ""}). ${act}`;

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
    // 안전: 한 줄만, 따옴표 제거, 길이 규약 강제(초과분은 문장 경계 절단 또는 폐기).
    const line = normalizeLine(text);
    if (!line) {
      console.warn(`[narrate] over-length dropped (${text.length}) → fallback`);
      return fb("toolong", Date.now() - started);
    }
    cacheSet(ck, line);
    return { text: line, source: "llm", ms: Date.now() - started, model };
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
