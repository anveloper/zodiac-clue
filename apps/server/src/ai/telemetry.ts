// AI 계측 — "LLM이 실제로 돌았는가"를 사람 눈이 아니라 숫자로 판정한다(④ §4).
//
// 2026-07-27 장애: 전 대사가 조용히 규칙 폴백으로 나갔는데 화면에도 로그에도 신호가 없었다.
// 폴백은 §2.5 설계대로 "캐릭터색 유지"가 목표라 **육안으로 구분되지 않는다.**
// 그래서 경로(llm/cache/fallback)·지연·모델·**폴백 사유**를 문장 단위로 남기고,
// 판 단위 집계와 프로세스 단위 분포(`GET /health`)로 올린다.
//
// ⚠️ 경계: 여기 들어오는 값은 전부 **운영 메타데이터**다. 진실값(정답·판정·결정)은
// 규칙 엔진에만 있고 이 모듈은 그것을 읽지도 쓰지도 않는다.

import type {
  AiFallbackReason,
  AiNormalizeOp,
  AiSource,
  AiStats,
  SayAi,
} from "@zodiac-clue/shared";

// 규약 구간(12~40자)은 `narrator.ts`가 단일 소스다 — 프롬프트 문안·정규화·계측이 같은 상수를 본다.
// 두 파일이 서로를 import하지만 **참조가 전부 함수 안**이라 로드 순환에 걸리지 않는다.
import { cacheInfo, LINE_MAX, LINE_MIN, normalizeStats } from "./narrator";

/** 폴백 사유별 건수(0인 사유는 스냅샷에서 생략). */
export type ReasonCounts = Partial<Record<AiFallbackReason, number>>;

/** 정규화 종류별 발동 건수(0인 종류는 스냅샷에서 생략). */
export type NormCounts = Partial<Record<AiNormalizeOp, number>>;

/**
 * **프롬프트 준수율** — "LLM이 12~40자 규약을 얼마나 지키는가"(④ §3.4 L1).
 *
 * 분모 `samples`는 **원문을 실제로 받은 건수**다(캐시 히트·키 없음은 원문이 없으므로 제외).
 * `clean`은 정규화가 **한 번도 발동하지 않은** 건수 — 즉 LLM이 계약을 그대로 지킨 문장이다.
 * `inRange`는 원문 길이가 규약 구간(12~`LINE_MAX`)에 들어온 건수.
 * ⚠️ 여기 어떤 필드에도 **원문 텍스트는 없다.** 길이·발동 종류라는 메타뿐이다.
 */
export type PromptCompliance = {
  samples: number;
  clean: number;
  cleanRate: number;
  inRange: number;
  inRangeRate: number;
  avgRawLen: number;
  minRawLen: number;
  maxRawLen: number;
  ops: NormCounts;
};

/**
 * 경로별 건수·지연 누적기. **판 단위**(방)와 **프로세스 단위**(/health)가 같은 클래스를 쓴다.
 * 따로 짜면 두 곳의 정의가 갈라져 "칩과 헬스가 다른 숫자를 말하는" 상태가 된다.
 */
export class AiCounter {
  private counts: Record<AiSource, number> = { llm: 0, cache: 0, fallback: 0 };
  private msSum: Record<AiSource, number> = { llm: 0, cache: 0, fallback: 0 };
  private reasons: ReasonCounts = {};
  // ── 프롬프트 준수 계측(④ §3.4 L1) — 길이·발동 종류만. 원문 텍스트는 받지 않는다.
  private rawN = 0;
  private rawSum = 0;
  private rawMin = Infinity;
  private rawMax = 0;
  private rawClean = 0;
  private rawInRange = 0;
  private ops: NormCounts = {};

  record(ai: SayAi): void {
    this.counts[ai.source] += 1;
    this.msSum[ai.source] += ai.ms;
    if (ai.source === "fallback" && ai.reason) {
      this.reasons[ai.reason] = (this.reasons[ai.reason] ?? 0) + 1;
    }
    // `rawLen`이 있는 건수 = **LLM 원문을 실제로 받은 건수**. 캐시 히트·키 없음은
    // 원문이 없으므로 분모에 넣지 않는다(넣으면 준수율이 캐시 적중률에 오염된다).
    if (typeof ai.rawLen === "number") {
      this.rawN += 1;
      this.rawSum += ai.rawLen;
      this.rawMin = Math.min(this.rawMin, ai.rawLen);
      this.rawMax = Math.max(this.rawMax, ai.rawLen);
      if (ai.rawLen >= LINE_MIN && ai.rawLen <= LINE_MAX) this.rawInRange += 1;
      const ops = ai.norm ?? [];
      if (ops.length === 0) this.rawClean += 1;
      for (const op of ops) this.ops[op] = (this.ops[op] ?? 0) + 1;
    }
  }

  reset(): void {
    this.counts = { llm: 0, cache: 0, fallback: 0 };
    this.msSum = { llm: 0, cache: 0, fallback: 0 };
    this.reasons = {};
    this.rawN = 0;
    this.rawSum = 0;
    this.rawMin = Infinity;
    this.rawMax = 0;
    this.rawClean = 0;
    this.rawInRange = 0;
    this.ops = {};
  }

  get total(): number {
    return this.counts.llm + this.counts.cache + this.counts.fallback;
  }

  /** 경로별 평균 왕복(ms, 반올림). 표본이 없으면 0. */
  avgOf(source: AiSource): number {
    const n = this.counts[source];
    return n === 0 ? 0 : Math.round(this.msSum[source] / n);
  }

  /** 클라 계약(`AiStats`) 형태 — AI 카운터 칩이 그리는 값. */
  snapshot(): AiStats {
    const total = this.total;
    const sum = this.msSum.llm + this.msSum.cache + this.msSum.fallback;
    return {
      llm: this.counts.llm,
      cache: this.counts.cache,
      fallback: this.counts.fallback,
      avgMs: total === 0 ? 0 : Math.round(sum / total),
    };
  }

  reasonCounts(): ReasonCounts {
    return { ...this.reasons };
  }

  /**
   * **프롬프트 준수율 스냅샷**(④ §3.4 L1 해소). 표본이 0이면 비율은 0이고
   * `samples: 0`이 함께 나간다 — "지킨 적 없음"과 "잰 적 없음"은 다른 사건이므로
   * 비율만 보고 판단할 수 없게 분모를 항상 같이 낸다.
   */
  compliance(): PromptCompliance {
    const n = this.rawN;
    return {
      samples: n,
      clean: this.rawClean,
      cleanRate: n === 0 ? 0 : +(this.rawClean / n).toFixed(3),
      inRange: this.rawInRange,
      inRangeRate: n === 0 ? 0 : +(this.rawInRange / n).toFixed(3),
      avgRawLen: n === 0 ? 0 : Math.round(this.rawSum / n),
      minRawLen: n === 0 ? 0 : this.rawMin,
      maxRawLen: this.rawMax,
      ops: { ...this.ops },
    };
  }

  /** 판 종료 집계 한 줄(경로별 건수 + 평균 지연 + 폴백 사유 분포 + 프롬프트 준수). */
  summaryLine(): string {
    const s = this.snapshot();
    const r = Object.entries(this.reasons)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const c = this.compliance();
    const ops = Object.entries(c.ops)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return (
      `llm=${s.llm}(avg ${this.avgOf("llm")}ms) ` +
      `cache=${s.cache}(avg ${this.avgOf("cache")}ms) ` +
      `fallback=${s.fallback}(avg ${this.avgOf("fallback")}ms) ` +
      `total=${this.total} avgMs=${s.avgMs}` +
      (r ? ` reasons[${r}]` : "") +
      // 규약 준수 — 분모(원문 표본)를 항상 같이 인쇄한다.
      ` raw=${c.samples}` +
      (c.samples
        ? ` len(avg ${c.avgRawLen} min ${c.minRawLen} max ${c.maxRawLen}) ` +
          `규약${LINE_MIN}~${LINE_MAX}=${c.inRange}/${c.samples}(${(c.inRangeRate * 100).toFixed(1)}%) ` +
          `무정규화=${c.clean}/${c.samples}(${(c.cleanRate * 100).toFixed(1)}%)` +
          (ops ? ` norm[${ops}]` : "")
        : "")
    );
  }
}

// ── 프로세스 단위 계측 (GET /health) ──────────────────────────────────
/** 프로세스 시작 이후 전체 누적. */
const totals = new AiCounter();
/** 최근 N건 — "지금 LLM이 살아 있는가"는 누적 평균이 아니라 최근 분포가 답한다. */
const RECENT_MAX = 50;
const recent: SayAi[] = [];
/** 429(쿼터 초과) 건수 — ④ §4 요구 필드. 심사 기간 쿼터 소진 감시용. */
let quotaErrors = 0;

export const recordQuotaError = (): void => {
  quotaErrors += 1;
};

/** 문장 1건의 계측을 프로세스 누적에 반영한다(방 단위 누적은 방이 따로 한다). */
export const recordAi = (ai: SayAi): void => {
  totals.record(ai);
  recent.push(ai);
  if (recent.length > RECENT_MAX) recent.shift();
};

const recentSnapshot = (): AiStats & {
  window: number;
  reasons: ReasonCounts;
} => {
  const c = new AiCounter();
  recent.forEach((a) => c.record(a));
  return { ...c.snapshot(), window: recent.length, reasons: c.reasonCounts() };
};

/**
 * `GET /health` 본문.
 * ⚠️ **키 값 자체는 어떤 필드에도 담지 않는다** — 보유 여부(boolean)만 노출한다.
 */
export const healthSnapshot = (env: {
  hasKey: boolean;
  model: string;
}): Record<string, unknown> => {
  const t = totals.snapshot();
  return {
    ok: true,
    // ④ §4-4가 지정한 필드명 그대로.
    ai: env.hasKey, // 키 **보유 여부**만. 값은 절대 노출하지 않는다.
    model: env.model,
    llmCalls: t.llm,
    cacheHits: t.cache,
    fallbackCalls: t.fallback,
    quotaErrors,
    avgMs: t.avgMs,
    // 최근 경로 분포 — 누적 평균은 장애를 희석시킨다(07-27이 그랬다).
    recent: recentSnapshot(),
    fallbackReasons: totals.reasonCounts(),
    /**
     * **프롬프트 준수율**(④ §3.4 L1) — "LLM이 `${LINE_MIN}~${LINE_MAX}자` 규약을 얼마나 지키는가".
     * 길이·정규화 발동 종류만 담는다. **원문 텍스트는 어떤 필드에도 없다.**
     */
    promptCompliance: {
      contract: { min: LINE_MIN, max: LINE_MAX },
      ...totals.compliance(),
    },
    /**
     * **상한 초과분을 어느 단계가 살렸는가**(07-28 후속). `norm`은 `packages/shared`의
     * `AiNormalizeOp` 계약이라 세 단계가 전부 `truncate` 한 칸으로 방송된다 — 단계 구분은
     * 서버 로컬 계측인 여기서만 보인다. `drop`이 곧 **화면에서 규칙 폴백으로 대체된 건수**다.
     */
    normalizeTiers: normalizeStats(),
    /**
     * **캐시 적중률의 분모와 키 공간.** `cacheHits: 0`만으로는 "고장"과 "칠 일이 없었다"가
     * 구분되지 않는다 — `lookups`(조회 시도)와 `size`(적재된 항목)를 같이 낸다.
     * `size > 0 ∧ hits == 0` = 저장은 되는데 같은 키가 다시 오지 않았다는 뜻이다.
     */
    cache: cacheInfo(),
    uptimeSec: Math.round(process.uptime()),
  };
};

// ── 서버 로그 한 줄 ───────────────────────────────────────────────────
/**
 * 문장 1건을 **한 줄**로 남긴다. 이 한 줄이 있었으면 07-27 장애는 첫 판에서 드러났다.
 * 예) `[ai] say llm 923ms model=… 잔나비 광대/suggest len=21 raw=34 norm=truncate seat=bot-3`
 *
 * `raw`/`norm`은 **길이와 발동 종류**다 — 원문 문장은 남기지 않는다(방송된 대사는 이미
 * `text`로 나가고, 폐기된 원문까지 로그에 적으면 계측이 유출 경로가 된다).
 */
export const logAi = (
  ctx: { seat: string; name: string; action: string; textLen: number },
  ai: SayAi,
): void => {
  const path = ai.source === "fallback" ? `fallback(${ai.reason ?? "?"})` : ai.source;
  const raw =
    typeof ai.rawLen === "number"
      ? ` raw=${ai.rawLen} norm=${ai.norm?.length ? ai.norm.join("+") : "none"}`
      : "";
  console.log(
    `[ai] say ${path} ${ai.ms}ms model=${ai.model || "-"} ` +
      `${ctx.name}/${ctx.action} len=${ctx.textLen}${raw} seat=${ctx.seat}`,
  );
};
