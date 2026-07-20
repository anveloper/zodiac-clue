// NPC 대사 생성 — 결정(진실값)은 규칙엔진이 하고, 여기선 "표현(대사)"만 만든다.
// LLM은 주어진 '결정된 정보'만 사용해 한 문장 대사를 생성. 진실값을 만들거나 남의 패를
// 아는 척하지 않는다. 키(GEMINI_API_KEY)가 없거나 실패하면 규칙기반 폴백 대사로 대체.

export type NarrationInput = {
  /** 캐릭터 표시명 (예: "생쥐 서생") */
  name: string;
  action: "suggest" | "accuse";
  /** 라벨(한글) */
  suspect: string;
  weapon: string;
  room: string;
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

const SYSTEM =
  "너는 조선 사극풍 추리 보드게임 NPC다. 사용자가 주는 '결정된 행동'을 사극 말투 대사 " +
  "한 문장으로만 바꾼다. **주어진 NPC 성격이 말투와 태도에 뚜렷이 드러나야 한다.** " +
  "규칙: 오직 대사 한 문장만 출력. 머리말/설명/선택지/마크다운/따옴표 전부 금지. " +
  "12~40자. 게임의 정답이나 남의 손패를 아는 척 금지, 주어진 정보만 사용.";

const rand = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** 규칙기반 폴백 대사 (LLM 없이도 사극 말투 한 줄). intro/outro로 캐릭터색을 입힌다. */
export const fallbackLine = (i: NarrationInput): string => {
  const deco = (s: string): string =>
    `${i.intro ?? ""}${s}${i.outro ?? ""}`.trim().slice(0, 80);
  if (i.action === "accuse") {
    return deco(
      rand([
        `이건 필시 ${i.suspect}의 소행! ${i.weapon}로 ${i.room}에서 벌인 짓이야`,
        `범인은 ${i.suspect}! ${i.room}의 ${i.weapon}이 증거다`,
        `더 볼 것도 없다. ${i.suspect}, ${i.weapon}, ${i.room}`,
      ]),
    );
  }
  const base = rand([
    `흠… ${i.room}에서 ${i.suspect}가 ${i.weapon}로? 수상쩍구먼`,
    `내 짐작엔 ${i.suspect}, ${i.weapon}, ${i.room}`,
    `${i.room} 쪽을 살피니 ${i.weapon}이 눈에 밟히는걸`,
    `${i.suspect}, 자네 ${i.room}엔 왜 갔는가`,
  ]);
  return deco(i.disproved ? `${base} …아니라니 하나 지웠군` : base);
};

/**
 * LLM(Gemini) 대사 생성. 키가 없거나 오류/타임아웃이면 null 반환(→ 호출부에서 폴백).
 * 무료티어 안전: 이벤트당 1콜, 짧은 출력, 타임아웃.
 */
// 동일 상황 대사 캐시 (무료티어 호출 절약). 단순 LRU-ish, 상한 200.
const CACHE_MAX = 200;
const cache = new Map<string, string>();
const cacheKey = (i: NarrationInput): string =>
  [i.action, i.suspect, i.weapon, i.room, i.persona, i.tone, i.disproved].join(
    "|",
  );
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

export const narrate = async (i: NarrationInput): Promise<string | null> => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";

  // 캐시 히트 시 API 호출 없이 재사용
  const ck = cacheKey(i);
  const cached = cacheGet(ck);
  if (cached !== undefined) return cached;

  const act =
    i.action === "accuse"
      ? `행동: 고발 — 범인 ${i.suspect}, 흉기 ${i.weapon}, 장소 ${i.room}.`
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
            // flash 계열은 thinking 모델 → 끄지 않으면 생각 토큰이 예산을 먹고 빈 응답.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),

        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      console.warn(`[narrate] HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      console.warn("[narrate] empty text");
      return null;
    }
    // 안전: 한 줄만, 따옴표/과도한 길이 정리
    const line = text
      .split("\n")[0]
      .replace(/^["'*]+|["'*]+$/g, "")
      .slice(0, 80);
    cacheSet(ck, line);
    return line;
  } catch (e) {
    console.warn(`[narrate] err ${e instanceof Error ? e.name : String(e)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
};
