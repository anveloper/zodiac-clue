// 규칙 밸런스 회귀 판정 — sim-balance.mjs 의 `--gate` 모드 구현부.
//
// 왜 별도 파일인가: `sim-balance.mjs`는 **규칙의 이식본**이라 이번 라운드에 다른 작업자가
// 계속 손댄다. 판정 로직·기준선을 그 파일에 섞으면 규칙 수정과 게이트 수정이 같은 hunk에서
// 충돌한다. 규칙(시뮬) / 판정(여기) / 기준선(gate.baseline.json)을 3분리한다.
//
// 시드는 고정이다(sim-balance.mjs: SEED = 20260728, mulberry32 단일 스트림).
// → **같은 코드면 결과가 완전히 같다.** 따라서 허용 밴드는 잡음 흡수용이 아니라
//   "이 정도 움직이면 의도된 밸런스 변경이다"의 선이다(gate.config.mjs SIM 주석 참조).

import { SIM } from "./gate.config.mjs";
import { readBaseline, writeBaseline, parseReason } from "./gate-baseline.mjs";

const METRIC_LABEL = {
  humanWinPct: "사람 승률",
  avgRounds: "평균 라운드",
  p95Suggestions: "제안 p95",
  avgHumanRooms: "방문 방/9",
  capHitPct: "상한 도달률",
  drawPct: "무승부율",
};

/**
 * @param {object} ctx
 * @param {Function} ctx.run          sim-balance.mjs 의 run(name, opts, games, seed)
 * @param {object}   ctx.rules        현재 규칙 opts (sim-balance.mjs CURRENT_VARIANT)
 * @param {string}   ctx.variantName  그 변형의 표기명 — 잘못된 변형을 재는 사고를 눈에 띄게 한다
 * @param {string[]} ctx.argv         process.argv.slice(2)
 * @returns {number} 종료 코드 (0 통과 / 1 회귀 / 2 사용법 오류)
 */
export const runSimGate = ({ run, rules, variantName = "(이름 없음)", argv }) => {
  const json = argv.includes("--json");
  const update = argv.includes("--update-baseline");

  const r = run("current", rules, SIM.games, SIM.seed);
  const measured = {
    humanWinPct: +r.humanWinPct.toFixed(3),
    avgRounds: +r.avgRounds.toFixed(3),
    p95Suggestions: r.p95Suggestions,
    avgHumanRooms: +r.avgHumanRooms.toFixed(3),
    capHitPct: +r.capHitPct.toFixed(3),
    drawPct: +r.drawPct.toFixed(3),
    avgSuggestions: +r.avgSuggestions.toFixed(3),
    maxSuggestions: r.maxSuggestions,
  };

  if (update) {
    let rec;
    try {
      rec = writeBaseline(
        "sim",
        { variant: variantName, seed: SIM.seed, games: SIM.games, rules, metrics: measured },
        parseReason(argv),
      );
    } catch (e) {
      console.error(`\n기준선 갱신 거부: ${e.message}\n`);
      return 2;
    }
    console.log(
      `기준선 갱신 완료 → scripts/gate.baseline.json\n` +
        `  ${SIM.games}판 · 시드 ${SIM.seed} · 사람 승률 ${measured.humanWinPct}% · ` +
        `${measured.avgRounds}라운드 · 제안 p95 ${measured.p95Suggestions}\n  사유: ${rec.reason}`,
    );
    return 0;
  }

  const base = readBaseline().sim ?? null;
  const rows = [];

  // ① 밴드 검사 (기준선 필요)
  for (const [key, spec] of Object.entries(SIM.bands)) {
    const cur = measured[key];
    if (!base) {
      rows.push({ key, label: METRIC_LABEL[key], cur, verdict: "SKIP", detail: "기준선 미기록" });
      continue;
    }
    const b = base.metrics[key];
    if (b === undefined) {
      rows.push({ key, label: METRIC_LABEL[key], cur, verdict: "SKIP", detail: "기준선에 이 지표 없음" });
      continue;
    }
    const delta = cur - b;
    rows.push({
      key,
      label: METRIC_LABEL[key],
      base: b,
      cur,
      delta: +delta.toFixed(3),
      band: spec.band,
      unit: spec.unit,
      verdict: Math.abs(delta) <= spec.band ? "PASS" : "FAIL",
    });
  }

  // ② 절대 상한 검사 (기준선 불필요 — 설계 의도가 "0에 가깝다"인 지표)
  for (const [key, spec] of Object.entries(SIM.ceilings)) {
    const cur = measured[key];
    rows.push({
      key,
      label: METRIC_LABEL[key],
      cur,
      max: spec.max,
      unit: spec.unit,
      verdict: cur <= spec.max ? "PASS" : "FAIL",
      ceiling: true,
    });
  }

  // ③ 규칙 opts 자체가 바뀌었는가 (기준선이 다른 규칙을 잰 것이면 비교가 무효)
  let rulesChanged = false;
  if (base?.rules) {
    rulesChanged = JSON.stringify(base.rules) !== JSON.stringify(rules);
  }
  // ④ 표본 크기·시드가 기준선과 다르면 비교 자체가 성립하지 않는다
  const configMismatch =
    base && (base.games !== SIM.games || base.seed !== SIM.seed);

  const failed = rows.filter((x) => x.verdict === "FAIL");
  const skipped = rows.filter((x) => x.verdict === "SKIP");
  const exitCode = failed.length || configMismatch ? 1 : 0;

  const out = {
    status: exitCode ? "FAIL" : skipped.length ? "PASS_WITH_SKIP" : "PASS",
    variant: variantName,
    games: SIM.games,
    seed: SIM.seed,
    seedFixed: true,
    rules,
    rulesChangedSinceBaseline: rulesChanged,
    configMismatch,
    measured,
    baseline: base,
    rows,
    exitCode,
  };

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return exitCode;
  }

  const pad = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);
  console.log("\n── 규칙 밸런스 회귀 게이트 ─────────────────────────────────────");
  console.log(
    `  잰 변형: ${variantName}\n` +
      `  ${SIM.games.toLocaleString()}판 · 시드 ${SIM.seed} (고정 → 같은 코드면 결과가 비트 단위로 같다)`,
  );
  if (!base) {
    console.log(
      "\n  ⚠ 기준선 미기록. 아래로 현재 값을 기록하라 —\n" +
        '    node scripts/sim-balance.mjs --gate --update-baseline --reason="최초 기준선"',
    );
  } else {
    console.log(`  기준선 ${base.recordedAt} — "${base.reason}"`);
    if (configMismatch)
      console.log(
        `  ✗ 기준선이 다른 조건에서 측정됐다(기준선 ${base.games}판/시드 ${base.seed} vs 현재 ${SIM.games}판/시드 ${SIM.seed}).` +
          " 비교 무효 → 기준선을 다시 기록해야 한다.",
      );
    if (rulesChanged)
      console.log(
        "  ⚠ 규칙 opts가 기준선 기록 시점과 다르다 — 밸런스가 움직인 것이 **의도된 변경**일 수 있다.\n" +
          `      기준선 ${JSON.stringify(base.rules)}\n      현재   ${JSON.stringify(rules)}`,
      );
    if (base.variant && base.variant !== variantName)
      console.log(`  ⚠ 기준선이 기록한 변형명은 "${base.variant}" — 지금 잰 것과 다르다.`);
  }
  console.log(
    `\n  ${pad("지표", 14)}${rpad("기준선", 10)}${rpad("현재", 10)}${rpad("변화", 10)}  허용`,
  );
  console.log("  " + "-".repeat(62));
  for (const x of rows) {
    const tol = x.ceiling ? `≤ ${x.max}${x.unit}` : x.band !== undefined ? `±${x.band}${x.unit}` : "-";
    console.log(
      `  ${pad(x.label, 14)}${rpad(x.base ?? "-", 10)}${rpad(x.cur, 10)}` +
        `${rpad(x.delta === undefined ? "-" : (x.delta >= 0 ? "+" : "") + x.delta, 10)}  ${pad(tol, 12)}${x.verdict}`,
    );
  }
  if (failed.length) {
    console.log(
      "\n  FAIL — 밸런스가 기준선에서 벗어났다. 둘 중 하나다:\n" +
        "    (a) 회귀다 → 규칙 변경을 되돌린다.\n" +
        "    (b) 의도된 변경이다 → **사유를 적고** 기준선을 갱신한다:\n" +
        '        node scripts/sim-balance.mjs --gate --update-baseline --reason="봇 확률적 오답 고발 도입(§5)"',
    );
  }
  console.log("");
  return exitCode;
};
