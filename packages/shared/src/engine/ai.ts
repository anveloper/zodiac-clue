// AI 계측(관측 가능성) 타입 — **엔진 층.** 주제를 하나도 모른다.
//
// 원래 `packages/shared/src/types.ts`에 클루 프로토콜과 같은 파일에 섞여 있었다
// (docs/design/20260729-mafia-content-design.md §1.2-④ 마지막 문장:
//  "같은 파일 24-92행의 `AiSource`/`SayAi`/`AiStats`는 진짜 엔진 타입인데 같은 파일에 섞여 있다").
// 값·주석은 그대로 옮기기만 했다.

// ── AI 계측(관측 가능성) — ④ §4 ──────────────────────
/**
 * 한 문장이 **어느 경로로 왔는가**. 진실값이 아니라 운영 메타데이터다
 * (④ §4 "추가 필드는 전부 운영 메타데이터이며 게임 상태가 아니다").
 * - `llm`: Gemini 실호출 성공
 * - `cache`: 같은 진실값 조합의 LRU 캐시 히트 (API 호출 0)
 * - `fallback`: 규칙 폴백 대사 — **왜 폴백인지는 `AiFallbackReason`**
 */
export type AiSource = "llm" | "cache" | "fallback";

/**
 * 폴백 사유. 2026-07-27 장애(전 대사가 조용히 규칙 폴백)를 **즉시** 잡았을 값이다 —
 * 그때 로그에는 `HTTP 400`밖에 없었고 화면에는 아무 신호도 없었다(④ §4.1).
 * - `timeout`  : 4000ms `AbortController` 만료
 * - `http`     : 200이 아닌 응답(429 쿼터 초과 포함)
 * - `empty`    : 200이지만 후보 텍스트가 비어 있음
 * - `toolong`  : 길이 규약 초과 + 문장 경계 없음 → 폐기
 * - `nokey`    : `GEMINI_API_KEY` 미설정
 * - `disabled` : 키는 있으나 운영상 LLM 경로를 끈 상태
 */
export type AiFallbackReason =
  | "timeout"
  | "http"
  | "empty"
  | "toolong"
  | "nokey"
  | "disabled";

/**
 * 사후 정규화가 **무엇을 발동시켰는가**(④ §2.3 "사후 정규화" ①②③).
 * 하나라도 붙었다는 것은 **LLM이 출력 계약을 지키지 않았다**는 뜻이다 —
 * 이 배열이 비어 있는 비율이 곧 **프롬프트 준수율**이다(④ §3.4 L1).
 * - `oneline`  : 개행이 있어 첫 줄만 취함
 * - `markup`   : 따옴표·별표·밑줄·해시·백틱 제거(양끝 + **문장 중간**, §3 C3)
 * - `truncate` : 상한 초과 → 문장 경계에서 절단
 * - `drop`     : 상한 초과인데 경계가 없음(또는 정규화 후 공백) → 폐기 후 규칙 폴백
 */
export type AiNormalizeOp = "oneline" | "markup" | "truncate" | "drop";

/** `say` 메시지에 동봉되는 경로·지연·모델 메타. */
export type SayAi = {
  source: AiSource;
  /** `narrate()` 왕복 소요(ms). 폴백이면 0 또는 실제 소요. */
  ms: number;
  /** 실호출 모델명. 폴백이면 `""` — **키 값은 어떤 필드에도 담기지 않는다.** */
  model: string;
  /** `source === "fallback"`일 때만. */
  reason?: AiFallbackReason;
  /**
   * **LLM 원문의 길이(문자 수)만.** 실호출로 텍스트를 받은 경우에만 채워진다
   * (`source: "llm"` · `reason: "toolong"`). 캐시 히트·키 없음 등 원문이 없는 경로는 `undefined`.
   *
   * ⚠️ **원문 텍스트 자체는 어떤 계측 필드에도 담지 않는다.** 대사는 이미 `text`로 방송되고
   * 로그에도 남는다. 계측이 필요로 하는 것은 «규약(12~40자)을 지켰는가»라는 **메타**뿐이며,
   * 폐기된 원문까지 저장하면 방송되지 않은 문장이 계측 채널로 새어 나간다.
   */
  rawLen?: number;
  /** 정규화 발동 종류. **빈 배열 = 원문 그대로 통과 = 프롬프트 준수.** 원문이 없으면 `undefined`. */
  norm?: AiNormalizeOp[];
};

/** 이번 판 누적 경로 집계 — AI 카운터 칩(`✨LLM n · ♻캐시 n · ⚙폴백 n`)용. */
export type AiStats = {
  llm: number;
  cache: number;
  fallback: number;
  /** 전 경로 평균 왕복(ms, 반올림). */
  avgMs: number;
};
