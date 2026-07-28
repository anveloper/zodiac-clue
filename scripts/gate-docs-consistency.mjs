#!/usr/bin/env node
/**
 * 문서·코드 상수 정합 검사 — **읽기 전용.**
 *
 * 이 저장소는 문서가 상수 값을 본문에 박아두는 스타일이라, 코드만 고치고 문서를 안 고치는
 * 갈라짐이 반복 발생했다(예: ai-tech-doc «12~40자» vs 코드 상한 80자 — 07-28 해소).
 * 심사 제출물이 그 문서들이므로, 갈라진 채 제출하면 그대로 감점 근거가 된다.
 *
 * 설계 원칙 — **오탐 0을 우선한다.** 검사는 두 종류뿐이다.
 *   code-vs-code : 미러 관계인 두 상수(서버 규칙 ↔ 시뮬 이식본). 앵커가 확실하다.
 *   code-vs-doc  : 문서가 값을 **숫자로** 박아둔 문장 하나. 그 문장을 못 찾으면 FAIL이 아니라
 *                  **SKIP**이다 — "문서가 리라이트됐다"와 "값이 갈라졌다"는 다른 사건이고,
 *                  전자를 FAIL로 만들면 게이트가 곧 무시된다.
 * 대상 항목은 scripts/gate.config.mjs 의 DOC_CHECKS 에 있다(현재 4건).
 *
 * 실행: node scripts/gate-docs-consistency.mjs [--json]
 * 종료코드: 0 통과(SKIP 포함) / 1 갈라짐
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { DOC_CHECKS } from "./gate.config.mjs";
import { ROOT } from "./gate-baseline.mjs";

const argv = process.argv.slice(2);
const json = argv.includes("--json");

const readIf = (rel) => {
  const f = join(ROOT, rel);
  return existsSync(f) ? readFileSync(f, "utf8") : null;
};

/** 파일에서 정규식 캡처를 뽑는다. 파일 없음/미매치는 null. */
const extract = (rel, re) => {
  const src = readIf(rel);
  if (src === null) return { ok: false, why: `파일 없음: ${rel}` };
  const m = src.match(re);
  if (!m) return { ok: false, why: `앵커 미발견: ${rel} ← ${re}` };
  return { ok: true, groups: m.slice(1) };
};

const results = [];

for (const c of DOC_CHECKS) {
  if (c.kind === "code-vs-code") {
    const a = extract(c.a.file, c.a.re);
    const b = extract(c.b.file, c.b.re);
    if (!a.ok || !b.ok) {
      results.push({
        id: c.id,
        label: c.label,
        verdict: "SKIP",
        detail: !a.ok ? a.why : b.why,
        why: c.why,
      });
      continue;
    }
    const av = a.groups[0];
    const bv = b.groups[0];
    results.push({
      id: c.id,
      label: c.label,
      verdict: av === bv ? "PASS" : "FAIL",
      detail: `${c.a.file} = ${av}   vs   ${c.b.file} = ${bv}`,
      why: c.why,
    });
    continue;
  }

  // code-vs-doc
  const codeVals = {};
  let codeMiss = null;
  for (const s of c.code) {
    const r = extract(s.file, s.re);
    if (!r.ok) {
      codeMiss = r.why;
      break;
    }
    codeVals[s.name] = r.groups[0];
  }
  if (codeMiss) {
    results.push({ id: c.id, label: c.label, verdict: "SKIP", detail: `코드 상수 ${codeMiss}`, why: c.why });
    continue;
  }
  const d = extract(c.doc.file, c.doc.re);
  if (!d.ok) {
    results.push({
      id: c.id,
      label: c.label,
      verdict: "SKIP",
      detail:
        `문서 ${d.why}\n            (문서 리라이트일 수 있다 — 값 갈라짐과 구분하기 위해 FAIL로 올리지 않는다. ` +
        "앵커가 영구히 사라졌으면 gate.config.mjs DOC_CHECKS를 고쳐라.)",
      why: c.why,
    });
    continue;
  }
  const mismatches = [];
  c.doc.names.forEach((name, i) => {
    const docVal = d.groups[i];
    if (String(codeVals[name]) !== String(docVal))
      mismatches.push(`${name}: 코드 ${codeVals[name]} ≠ 문서 ${docVal}`);
  });
  results.push({
    id: c.id,
    label: c.label,
    verdict: mismatches.length ? "FAIL" : "PASS",
    detail: mismatches.length
      ? `${c.doc.file} — ${mismatches.join(" · ")}`
      : c.doc.names.map((n) => `${n}=${codeVals[n]}`).join(" · ") + `  (문서 ${c.doc.file} 일치)`,
    why: c.why,
  });
}

const failed = results.filter((r) => r.verdict === "FAIL");
const skipped = results.filter((r) => r.verdict === "SKIP");
const exitCode = failed.length ? 1 : 0;

if (json) {
  console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", results, exitCode }, null, 2));
  process.exit(exitCode);
}

console.log("── 문서·코드 상수 정합 ─────────────────────────────────────────");
for (const r of results) {
  console.log(`  ${r.verdict.padEnd(4)}  ${r.id} ${r.label}`);
  console.log(`          ${r.detail}`);
  if (r.verdict === "FAIL") console.log(`          ↳ ${r.why}`);
}
console.log(
  `\n  ${results.length - failed.length - skipped.length} PASS · ${failed.length} FAIL · ${skipped.length} SKIP\n`,
);
process.exit(exitCode);
