#!/usr/bin/env node
/**
 * 통합 회귀 게이트 — 흩어진 검증 스크립트를 **한 번에 돌리고 한 화면에 판정**한다.
 *
 * 왜 필요한가: 마감(2026-08-10)까지 되돌릴 수 없는 일정(촬영·제출)이 남아 있고,
 * 지금 검증 자산이 5종으로 흩어져 있어 "커밋 전에 무엇을 돌려야 하는지"를 사람이 기억해야 한다.
 * 기억에 의존하는 절차는 마감 주에 가장 먼저 무너진다.
 *
 * 설계 원칙
 *   ① 통과 기준은 **코드에 박는다.** 사람이 표를 보고 판단하는 게 아니라 PASS/FAIL + 종료코드로 끝난다.
 *   ② **조용한 건너뜀 금지.** 안 돌린 항목은 SKIP으로 **사유와 함께** 인쇄한다.
 *      (§9.6의 취지 — 은폐된 미측정이 회귀보다 위험하다. 측정 못 한 것을 통과로 세면
 *       "게이트가 초록불이었다"는 사실 자체가 거짓 안전판이 된다.)
 *   ③ Gemini 실호출 0. `eval-narrator.mjs`는 기본(오프라인) 모드로만 부른다 — 심사자 몫 무료 쿼터 보호.
 *   ④ 기준선은 스크립트가 아니라 `scripts/gate.baseline.json`에 있고, 갱신에는 사람이 쓴 사유가 필요하다.
 *
 * 모드
 *   --quick   커밋 전용. 초 단위로 끝나는 것만(typecheck · sim · narrator(quick) · gpu · docs).
 *   (기본)    전체. 위 + 빌드 + 번들 예산. push·촬영·제출 전에 돌린다.
 *
 * 실행
 *   node scripts/verify.mjs                # 전체
 *   node scripts/verify.mjs --quick        # 커밋 전
 *   node scripts/verify.mjs --json
 *   node scripts/verify.mjs --verbose      # 통과 항목의 원문 출력까지
 *   node scripts/verify.mjs --only=sim,docs
 *   node scripts/verify.mjs --list
 *
 * 종료코드: 0 전건 통과 / 1 하나라도 실패
 */

import { spawnSync } from "node:child_process";

import { ITEMS, RUNTIME_GATE } from "./gate.config.mjs";
import { ROOT } from "./gate-baseline.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (pfx) => {
  const a = argv.find((x) => x.startsWith(pfx));
  return a ? a.slice(pfx.length) : null;
};

const OPT = {
  quick: has("--quick"),
  json: has("--json"),
  verbose: has("--verbose"),
  only: (val("--only=") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  list: has("--list"),
};

// ── 항목 정의 (실행 방법) ───────────────────────────────────────────
// `jsonArgs`가 있으면 --json 모드에서 그것으로 바꿔 부르고 결과를 파싱해 끼워 넣는다.
const RUNNERS = {
  typecheck: { cmd: "pnpm", args: ["-r", "typecheck"] },
  build: { cmd: "pnpm", args: ["--filter", "@zodiac-clue/client", "build"] },
  bundle: {
    cmd: process.execPath,
    args: ["scripts/gate-bundle-budget.mjs"],
    jsonArgs: ["scripts/gate-bundle-budget.mjs", "--json"],
    // 3 = 측정 불가(dist 없음/낡음) → 실패가 아니라 SKIP으로 승격해 사유를 남긴다.
    skipCodes: { 3: "산출물 측정 불가 — 하위 게이트가 사유를 인쇄했다" },
  },
  sim: {
    cmd: process.execPath,
    args: ["scripts/sim-balance.mjs", "--gate"],
    jsonArgs: ["scripts/sim-balance.mjs", "--gate", "--json"],
  },
  narrator: {
    // ⚠️ `--live` 는 **절대** 붙이지 않는다. 기본이 오프라인 = Gemini 호출 0.
    cmd: process.execPath,
    args: ["scripts/eval-narrator.mjs"],
    // ⚠️ `--quick`은 폴백 전수 스윕(112,752문장)을 생략한다. 그런데 eval은 실행마다
    //    `docs/design/eval-narrator-report.md`를 덮어쓰므로, 그대로 두면 **커밋 전 게이트를
    //    돌 때마다 ④ §3.4의 최대 근거가 `112,752 → 0`으로 퇴화**한다.
    //    빠른 모드에서는 리포트를 쓰지 않는다 — 리포트는 전체 모드가 갱신한다.
    quickArgs: ["scripts/eval-narrator.mjs", "--quick", "--no-report"],
    jsonArgs: ["scripts/eval-narrator.mjs", "--json"],
    quickJsonArgs: ["scripts/eval-narrator.mjs", "--quick", "--json"],
    // 2 = 환경 오류(tsx 부재 등) = **판정 자체를 못 함.** 통과로 세지 않는다.
    errorCodes: { 2: "판정 불가(환경 오류) — `pnpm install` 후 재실행" },
  },
  gpu: {
    cmd: process.execPath,
    args: ["scripts/gate-gpu-baseline.mjs"],
    jsonArgs: ["scripts/gate-gpu-baseline.mjs", "--json"],
  },
  docs: {
    cmd: process.execPath,
    args: ["scripts/gate-docs-consistency.mjs"],
    jsonArgs: ["scripts/gate-docs-consistency.mjs", "--json"],
  },
};

const ORDER = ["typecheck", "docs", "gpu", "sim", "narrator", "build", "bundle"];

if (OPT.list) {
  console.log("항목            quick  근거");
  for (const id of ORDER) {
    const it = ITEMS[id];
    console.log(`  ${id.padEnd(12)} ${it.quick ? " ✓ " : " · "}   ${it.why}`);
  }
  console.log(`  ${RUNTIME_GATE.id.padEnd(12)}  -    ${RUNTIME_GATE.reason}`);
  process.exit(0);
}

// ── 실행 ────────────────────────────────────────────────────────────
const results = [];
let buildFailed = false;

const pickArgs = (r) => {
  if (OPT.json && OPT.quick && r.quickJsonArgs) return r.quickJsonArgs;
  if (OPT.json && r.jsonArgs) return r.jsonArgs;
  if (OPT.quick && r.quickArgs) return r.quickArgs;
  return r.args;
};

for (const id of ORDER) {
  const item = ITEMS[id];
  const runner = RUNNERS[id];

  // ── 건너뛸 이유들 — 전부 명시적으로 기록한다 ──
  if (OPT.only.length && !OPT.only.includes(id)) {
    results.push({ id, label: item.label, status: "SKIP", reason: `--only=${OPT.only.join(",")} 에 없음`, ms: 0 });
    continue;
  }
  if (!OPT.only.length && OPT.quick && !item.quick) {
    results.push({
      id,
      label: item.label,
      status: "SKIP",
      reason: `--quick 비포함 — ${item.why}`,
      ms: 0,
    });
    continue;
  }
  if (id === "bundle" && buildFailed) {
    results.push({
      id,
      label: item.label,
      status: "SKIP",
      reason: "빌드가 실패해 산출물을 신뢰할 수 없다 — 낡은 dist를 재면 예산 통과가 거짓이 된다",
      ms: 0,
    });
    continue;
  }

  const args = pickArgs(runner);
  // 진행 표시는 TTY에서만(파이프로 받으면 판정 표를 오염시킨다).
  const tty = !OPT.json && process.stderr.isTTY;
  if (tty) process.stderr.write(`  … ${item.label}\r`);
  const t0 = Date.now();
  const r = spawnSync(runner.cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  if (tty) process.stderr.write(`${" ".repeat(60)}\r`);

  const code = r.status;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

  let status;
  let reason = null;
  if (r.error) {
    status = "ERROR";
    reason = `실행 실패: ${r.error.message}`;
  } else if (code === 0) {
    status = "PASS";
  } else if (runner.skipCodes?.[code]) {
    status = "SKIP";
    reason = runner.skipCodes[code];
  } else if (runner.errorCodes?.[code]) {
    status = "ERROR";
    reason = runner.errorCodes[code];
  } else {
    status = "FAIL";
    reason = `종료코드 ${code}`;
  }

  if (id === "build" && status !== "PASS") buildFailed = true;

  let json = null;
  if (OPT.json && runner.jsonArgs) {
    try {
      json = JSON.parse(r.stdout);
    } catch {
      json = null;
    }
  }

  results.push({
    id,
    label: item.label,
    status,
    reason,
    ms,
    exitCode: code,
    cmd: `${runner.cmd === process.execPath ? "node" : runner.cmd} ${args.join(" ")}`,
    output: out,
    json,
  });
}

// §9.6 런타임 게이트 — 이 러너로는 원리적으로 측정 불가. 항상 명시한다.
results.push({
  id: RUNTIME_GATE.id,
  label: RUNTIME_GATE.label,
  status: "SKIP",
  reason: RUNTIME_GATE.reason,
  ms: 0,
});

const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
const bad = results.filter((r) => r.status === "FAIL" || r.status === "ERROR");
const exitCode = bad.length ? 1 : 0;

// ── 출력 ────────────────────────────────────────────────────────────
if (OPT.json) {
  console.log(
    JSON.stringify(
      {
        mode: OPT.quick ? "quick" : "full",
        status: exitCode ? "FAIL" : "PASS",
        geminiCalls: 0,
        counts,
        items: results.map(({ output, ...rest }) => ({
          ...rest,
          // 원문은 실패한 항목만 싣는다(통과 항목 원문이 JSON을 잠식하지 않도록).
          output: rest.status === "PASS" ? undefined : output?.slice(-4000),
        })),
        exitCode,
      },
      null,
      2,
    ),
  );
  process.exit(exitCode);
}

const ICON = { PASS: "PASS", FAIL: "FAIL", SKIP: "SKIP", ERROR: "ERR " };
const sec = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

console.log(
  `\n══ 회귀 게이트 · ${OPT.quick ? "QUICK(커밋 전)" : "FULL(push·촬영·제출 전)"} ` +
    "═".repeat(28),
);
for (const r of results) {
  console.log(
    `  ${ICON[r.status]}  ${r.label.padEnd(42)}${r.ms ? sec(r.ms).padStart(7) : "".padStart(7)}`,
  );
  if (r.reason) console.log(`          ↳ ${r.reason}`);
}

// 실패·오류 항목의 원문은 반드시 인쇄한다(사람이 다시 돌리게 만들지 않는다).
for (const r of results) {
  if (r.status === "PASS" && !OPT.verbose) continue;
  if (!r.output) continue;
  console.log(`\n${"─".repeat(72)}\n▸ ${r.label}  [${r.status}]  $ ${r.cmd}\n`);
  const lines = r.output.trimEnd().split("\n");
  const shown = r.status === "PASS" || OPT.verbose ? lines : lines.slice(-60);
  if (shown.length < lines.length) console.log(`  … (앞 ${lines.length - shown.length}행 생략)`);
  console.log(shown.join("\n"));
}

console.log(`\n${"═".repeat(72)}`);
console.log(
  `  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}` +
    `   ·   Gemini 실호출 0건(오프라인 고정)`,
);
console.log(
  exitCode === 0
    ? "  결과: PASS — 돌린 항목 전건 통과. SKIP 항목의 사유를 위에서 확인하라."
    : `  결과: FAIL — [${bad.map((r) => r.id).join(", ")}]`,
);
if (OPT.quick && exitCode === 0)
  console.log("  다음: push·촬영·제출 전에는 `node scripts/verify.mjs`(전체)를 한 번 더 돌린다.");
console.log("");
process.exit(exitCode);
