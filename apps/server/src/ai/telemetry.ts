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
  AiSource,
  AiStats,
  SayAi,
} from "@zodiac-clue/shared";

/** 폴백 사유별 건수(0인 사유는 스냅샷에서 생략). */
export type ReasonCounts = Partial<Record<AiFallbackReason, number>>;

/**
 * 경로별 건수·지연 누적기. **판 단위**(방)와 **프로세스 단위**(/health)가 같은 클래스를 쓴다.
 * 따로 짜면 두 곳의 정의가 갈라져 "칩과 헬스가 다른 숫자를 말하는" 상태가 된다.
 */
export class AiCounter {
  private counts: Record<AiSource, number> = { llm: 0, cache: 0, fallback: 0 };
  private msSum: Record<AiSource, number> = { llm: 0, cache: 0, fallback: 0 };
  private reasons: ReasonCounts = {};

  record(ai: SayAi): void {
    this.counts[ai.source] += 1;
    this.msSum[ai.source] += ai.ms;
    if (ai.source === "fallback" && ai.reason) {
      this.reasons[ai.reason] = (this.reasons[ai.reason] ?? 0) + 1;
    }
  }

  reset(): void {
    this.counts = { llm: 0, cache: 0, fallback: 0 };
    this.msSum = { llm: 0, cache: 0, fallback: 0 };
    this.reasons = {};
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

  /** 판 종료 집계 한 줄(경로별 건수 + 평균 지연 + 폴백 사유 분포). */
  summaryLine(): string {
    const s = this.snapshot();
    const r = Object.entries(this.reasons)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return (
      `llm=${s.llm}(avg ${this.avgOf("llm")}ms) ` +
      `cache=${s.cache}(avg ${this.avgOf("cache")}ms) ` +
      `fallback=${s.fallback}(avg ${this.avgOf("fallback")}ms) ` +
      `total=${this.total} avgMs=${s.avgMs}` +
      (r ? ` reasons[${r}]` : "")
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
    uptimeSec: Math.round(process.uptime()),
  };
};

// ── 서버 로그 한 줄 ───────────────────────────────────────────────────
/**
 * 문장 1건을 **한 줄**로 남긴다. 이 한 줄이 있었으면 07-27 장애는 첫 판에서 드러났다.
 * 예) `[ai] say fallback(http) 412ms model=- 잔나비 광대/suggest len=21 seat=bot-3`
 */
export const logAi = (
  ctx: { seat: string; name: string; action: string; textLen: number },
  ai: SayAi,
): void => {
  const path = ai.source === "fallback" ? `fallback(${ai.reason ?? "?"})` : ai.source;
  console.log(
    `[ai] say ${path} ${ai.ms}ms model=${ai.model || "-"} ` +
      `${ctx.name}/${ctx.action} len=${ctx.textLen} seat=${ctx.seat}`,
  );
};
