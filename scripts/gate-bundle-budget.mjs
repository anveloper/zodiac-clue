#!/usr/bin/env node
/**
 * 번들 예산 게이트 — roadmap §9.1 «첫 3초 — 번들 2,130 kB 단일 청크»
 *
 * 이 스크립트는 **읽기 전용**이다(기준선 파일 갱신 제외). 빌드를 실행하지 않는다 —
 * `apps/client/dist/`에 이미 있는 산출물을 읽는다. 빌드는 verify.mjs가 순서대로 돌린다.
 *
 * 재는 것:
 *   ① 초기 로드 = index.html이 **즉시 받는 것**
 *      = index.html 자체 + <script src> + <link rel=modulepreload|preload as=script>
 *        + <link rel=stylesheet>
 *      (Vite는 엔트리의 **정적** import 그래프를 modulepreload로 HTML에 박는다.
 *       동적 import()로 쪼갠 청크는 여기 안 들어온다 → 이 집합이 곧 "첫 3초에 받는 것"이다.)
 *   ② 청크별 크기 = dist/assets/*.js 전부 (초기/지연 구분)
 *   ③ raw · gzip 둘 다 (네트워크는 gzip, 파싱 비용은 raw에 비례한다)
 *
 * 판정:
 *   FAIL  초기 로드 JS가 기준선 × (1 + ratchetSlackPct/100) 초과   → 래칫 위반
 *   FAIL  dist 없음 + --require-dist                                → 측정 불가를 실패로
 *   SKIP  dist 없음 / dist가 소스보다 오래됨(--allow-stale 없이)    → 사유 명시
 *   PASS  그 외. 목표(§9.1 120 kB) 대비 진척과 기준선 갱신 권고를 함께 인쇄한다.
 *
 * 실행:
 *   node scripts/gate-bundle-budget.mjs
 *   node scripts/gate-bundle-budget.mjs --json
 *   node scripts/gate-bundle-budget.mjs --allow-stale        # 소스보다 오래된 dist도 측정
 *   node scripts/gate-bundle-budget.mjs --require-dist       # dist 없으면 SKIP 대신 FAIL
 *   node scripts/gate-bundle-budget.mjs --update-baseline --reason="Three 동적 import(§9.1)"
 *
 * 종료코드: 0 통과 / 1 예산 초과 / 3 측정 불가(SKIP)
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, extname } from "node:path";

import { BUNDLE } from "./gate.config.mjs";
import { ROOT, readBaseline, writeBaseline, parseReason } from "./gate-baseline.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const OPT = {
  json: has("--json"),
  allowStale: has("--allow-stale"),
  requireDist: has("--require-dist"),
  update: has("--update-baseline"),
};

const DIST = join(ROOT, BUNDLE.distDir);
const kb = (bytes) => +(bytes / 1000).toFixed(2); // Vite와 같은 표기(1 kB = 1000 B)

// ── 소스 최신 시각 (staleness 판정용) ──────────────────────────────
const SRC_ROOTS = [
  "apps/client/src",
  "apps/client/index.html",
  "apps/client/vite.config.ts",
  "packages/shared/src",
];
const newestMtime = (p) => {
  let out = 0;
  const walk = (f) => {
    let st;
    try {
      st = statSync(f);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const n of readdirSync(f)) walk(join(f, n));
      return;
    }
    out = Math.max(out, st.mtimeMs);
  };
  walk(p);
  return out;
};

const skip = (reason, extra = {}) => {
  const out = { status: "SKIP", reason, ...extra };
  if (OPT.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log("── 번들 예산 게이트 (roadmap §9.1) ─────────────────────");
    console.log(`  SKIP  ${reason}`);
  }
  process.exit(OPT.requireDist ? 1 : 3);
};

if (!existsSync(DIST)) {
  skip(
    `${BUNDLE.distDir} 없음 — 빌드 산출물이 있어야 잰다. ` +
      "`pnpm --filter @zodiac-clue/client build` 후 다시 실행하라.",
  );
}

const indexHtml = join(DIST, "index.html");
if (!existsSync(indexHtml)) skip(`${BUNDLE.distDir}/index.html 없음 — 빌드가 중단된 산출물이다.`);

const distMtime = statSync(indexHtml).mtimeMs;
const srcMtime = Math.max(...SRC_ROOTS.map((p) => newestMtime(join(ROOT, p))));
const stale = srcMtime > distMtime;
if (stale && !OPT.allowStale) {
  skip(
    "dist가 소스보다 오래됐다(빌드 이후 소스가 바뀌었다) — 낡은 산출물을 재면 " +
      "예산 통과가 거짓이 된다. 다시 빌드하거나 `--allow-stale`로 명시하라.",
    { distMtime: new Date(distMtime).toISOString(), srcMtime: new Date(srcMtime).toISOString() },
  );
}

// ── ① index.html이 즉시 받는 것 ────────────────────────────────────
const html = readFileSync(indexHtml, "utf8");
const initialRefs = new Set();

// <script ... src="...">  (type=module / classic 무관. 외부 URL은 제외 — 우리 예산이 아니다)
for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
  initialRefs.add(m[1]);
}
// <link rel="modulepreload"|"preload" as="script"|"stylesheet" href="...">
for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
  const tag = m[0];
  const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) ?? [])[1] ?? "";
  const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) ?? [])[1];
  if (!href) continue;
  const r = rel.toLowerCase();
  const isInitial =
    r === "modulepreload" ||
    r === "stylesheet" ||
    (r === "preload" && /\bas\s*=\s*["'](script|style)["']/i.test(tag));
  if (isInitial) initialRefs.add(href);
}

/** URL → dist 내 실제 파일 경로. 외부(http/data)면 null. */
const toFile = (url) => {
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) return null;
  const clean = url.split(/[?#]/)[0];
  const rel = clean.startsWith("/") ? clean.slice(1) : clean;
  const f = join(DIST, rel);
  return existsSync(f) ? f : null;
};

const measure = (file) => {
  const buf = readFileSync(file);
  return { file: relative(DIST, file), bytes: buf.length, gzip: gzipSync(buf).length };
};

const initial = [];
const unresolved = [];
for (const url of initialRefs) {
  const f = toFile(url);
  if (!f) {
    if (!/^(https?:)?\/\//i.test(url) && !url.startsWith("data:")) unresolved.push(url);
    continue;
  }
  initial.push({ ...measure(f), url });
}
// index.html 자체도 첫 왕복에 받는다.
const htmlSelf = { ...measure(indexHtml), url: "/index.html" };

const isJs = (f) => [".js", ".mjs"].includes(extname(f));
const isCss = (f) => extname(f) === ".css";

const initialJs = initial.filter((x) => isJs(x.file));
const initialCss = initial.filter((x) => isCss(x.file));

// ── ② 전체 청크 목록 ───────────────────────────────────────────────
const assetsDir = join(DIST, "assets");
const allChunks = existsSync(assetsDir)
  ? readdirSync(assetsDir)
      .filter((n) => isJs(n))
      .map((n) => measure(join(assetsDir, n)))
      .sort((a, b) => b.bytes - a.bytes)
  : [];
const initialFiles = new Set(initialJs.map((x) => x.file));
const lazyChunks = allChunks.filter((c) => !initialFiles.has(c.file));

const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);

const metrics = {
  initialJsBytes: sum(initialJs, "bytes"),
  initialJsGzip: sum(initialJs, "gzip"),
  initialCssBytes: sum(initialCss, "bytes"),
  initialCssGzip: sum(initialCss, "gzip"),
  htmlBytes: htmlSelf.bytes,
  htmlGzip: htmlSelf.gzip,
  chunkCount: allChunks.length,
  initialChunkCount: initialJs.length,
  lazyChunkCount: lazyChunks.length,
  totalJsBytes: sum(allChunks, "bytes"),
  totalJsGzip: sum(allChunks, "gzip"),
};
metrics.initialTotalBytes = metrics.initialJsBytes + metrics.initialCssBytes + metrics.htmlBytes;
metrics.initialTotalGzip = metrics.initialJsGzip + metrics.initialCssGzip + metrics.htmlGzip;

// ── ③ 판정 ─────────────────────────────────────────────────────────
const baseline = readBaseline().bundle ?? null;
const checks = [];

if (OPT.update) {
  const rec = writeBaseline(
    "bundle",
    {
      initialJsBytes: metrics.initialJsBytes,
      initialJsGzip: metrics.initialJsGzip,
      initialTotalBytes: metrics.initialTotalBytes,
      chunkCount: metrics.chunkCount,
      initialChunkCount: metrics.initialChunkCount,
      note: `초기 로드 JS ${kb(metrics.initialJsBytes)} kB (gzip ${kb(metrics.initialJsGzip)} kB) · 청크 ${metrics.chunkCount}개`,
    },
    parseReason(argv),
  );
  console.log(`기준선 갱신 완료 → scripts/gate.baseline.json\n  ${rec.note}\n  사유: ${rec.reason}`);
  process.exit(0);
}

let limitBytes = null;
if (baseline) {
  limitBytes = Math.round(baseline.initialJsBytes * (1 + BUNDLE.ratchetSlackPct / 100));
  checks.push({
    id: "B1 초기 로드 JS 래칫",
    got: `${kb(metrics.initialJsBytes)} kB`,
    want: `≤ ${kb(limitBytes)} kB (기준선 ${kb(baseline.initialJsBytes)} kB +${BUNDLE.ratchetSlackPct}%)`,
    pass: metrics.initialJsBytes <= limitBytes,
    why: `기준선 기록 ${baseline.recordedAt} — "${baseline.reason}"`,
  });
} else {
  checks.push({
    id: "B1 초기 로드 JS 래칫",
    got: `${kb(metrics.initialJsBytes)} kB`,
    want: "기준선 미기록",
    pass: null, // SKIP
    why:
      "gate.baseline.json에 bundle 기준선이 없다. " +
      '`node scripts/gate-bundle-budget.mjs --update-baseline --reason="..."` 로 현재 값을 기록하라.',
  });
}

const biggest = allChunks[0];
if (biggest) {
  checks.push({
    id: "B2 최대 청크 크기",
    got: `${biggest.file} ${kb(biggest.bytes)} kB`,
    want: `≤ ${BUNDLE.warnChunkKb} kB (경고선)`,
    pass: biggest.bytes / 1000 <= BUNDLE.warnChunkKb ? true : "warn",
    why: "지연 청크라도 하나가 1.6 MB면 그 뷰 진입에서 통째로 멎는다(§9.1 phaser 1,479 kB).",
  });
}

const targetBytes = BUNDLE.targetInitialJsKb * 1000;
const towardTarget = metrics.initialJsBytes <= targetBytes;
checks.push({
  id: "B3 §9.1 목표 도달",
  got: `${kb(metrics.initialJsBytes)} kB`,
  want: `≤ ${BUNDLE.targetInitialJsKb} kB`,
  pass: towardTarget ? true : "warn",
  why: BUNDLE.targetSource + " — 목표 미달은 FAIL이 아니다(진척 지표).",
});

const failed = checks.filter((c) => c.pass === false);
const skipped = checks.filter((c) => c.pass === null);
const exitCode = failed.length ? 1 : 0;

const result = {
  status: failed.length ? "FAIL" : skipped.length ? "PASS_WITH_SKIP" : "PASS",
  stale,
  metrics,
  metricsKb: {
    initialJs: kb(metrics.initialJsBytes),
    initialJsGzip: kb(metrics.initialJsGzip),
    initialTotal: kb(metrics.initialTotalBytes),
    initialTotalGzip: kb(metrics.initialTotalGzip),
    totalJs: kb(metrics.totalJsBytes),
  },
  baseline,
  limitBytes,
  target: { kb: BUNDLE.targetInitialJsKb, source: BUNDLE.targetSource, reached: towardTarget },
  initial: [htmlSelf, ...initial].map((x) => ({ ...x, kb: kb(x.bytes), gzipKb: kb(x.gzip) })),
  lazyChunks: lazyChunks.map((x) => ({ ...x, kb: kb(x.bytes), gzipKb: kb(x.gzip) })),
  unresolved,
  checks,
  exitCode,
};

if (OPT.json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode);
}

const pad = (s, n) => String(s).padEnd(n);
console.log("── 번들 예산 게이트 (roadmap §9.1) ─────────────────────────────");
console.log(`  산출물 ${BUNDLE.distDir}${stale ? "  ⚠ 소스보다 오래됨(--allow-stale)" : ""}`);
console.log("\n  ▸ 초기 로드 — index.html이 즉시 받는 것");
for (const x of [htmlSelf, ...initial])
  console.log(`      ${pad(x.url, 34)} ${String(kb(x.bytes)).padStart(9)} kB   gzip ${String(kb(x.gzip)).padStart(8)} kB`);
console.log(
  `      ${pad("합계", 34)} ${String(kb(metrics.initialTotalBytes)).padStart(9)} kB   gzip ${String(kb(metrics.initialTotalGzip)).padStart(8)} kB` +
    `   (JS만 ${kb(metrics.initialJsBytes)} kB)`,
);
if (unresolved.length) console.log(`      ⚠ dist에서 찾지 못한 참조: ${unresolved.join(", ")}`);

console.log(`\n  ▸ 청크 ${metrics.chunkCount}개 (초기 ${metrics.initialChunkCount} / 지연 ${metrics.lazyChunkCount})`);
for (const c of allChunks.slice(0, 12))
  console.log(
    `      ${initialFiles.has(c.file) ? "초기" : "지연"} ${pad(c.file, 40)} ${String(kb(c.bytes)).padStart(9)} kB   gzip ${String(kb(c.gzip)).padStart(8)} kB`,
  );
if (allChunks.length > 12) console.log(`      … 외 ${allChunks.length - 12}개`);

console.log("\n  ▸ 판정");
for (const c of checks) {
  const tag = c.pass === true ? "PASS" : c.pass === false ? "FAIL" : c.pass === "warn" ? "WARN" : "SKIP";
  console.log(`      ${tag}  ${c.id}: ${c.got}  (기준 ${c.want})`);
  if (c.pass !== true) console.log(`            ↳ ${c.why}`);
}

if (baseline) {
  const delta = metrics.initialJsBytes - baseline.initialJsBytes;
  const pctDelta = (delta / baseline.initialJsBytes) * 100;
  console.log(
    `\n  기준선 대비 ${delta >= 0 ? "+" : ""}${kb(delta)} kB (${pctDelta >= 0 ? "+" : ""}${pctDelta.toFixed(1)}%)` +
      /* 🔴 뺄셈이 뒤집혀 있었다 — `초기 − 목표`를 `max(0, …)`로 감싸는 바람에 **목표 아래일 때
         언제나 «0 kB 남음»**이 찍혔다. 여유가 가장 많은 상태가 «여유 없음»으로 읽힌다.
         실측 53.8 kB / 목표 120 kB인데 여러 회차의 머지 보고가 이 문장을 그대로 인용했다.
         목표를 넘었을 때는 «남음»이 아니라 «초과»라고 말해야 뜻이 맞는다. */
      ` · §9.1 목표 ${BUNDLE.targetInitialJsKb} kB` +
      (metrics.initialJsBytes <= targetBytes
        ? `까지 ${kb(targetBytes - metrics.initialJsBytes)} kB 남음`
        : ` ${kb(metrics.initialJsBytes - targetBytes)} kB 초과`),
  );
  if (-pctDelta >= BUNDLE.ratchetTightenPct)
    console.log(
      `  ▸ 번들이 기준선보다 ${(-pctDelta).toFixed(1)}% 줄었다. **기준선을 조여라** —\n` +
        `    node scripts/gate-bundle-budget.mjs --update-baseline --reason="…"\n` +
        "    (조이지 않으면 다음 커밋이 되돌려놔도 게이트가 통과시킨다)",
    );
}
console.log("");
process.exit(exitCode);
