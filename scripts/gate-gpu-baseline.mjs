// GPU 자원 회귀 게이트 — 정적 계측
//
// 왜 정적인가:
//   런타임 수치(`renderer.info.memory`)는 **살아 있는 WebGL 컨텍스트**에서만 나온다.
//   CI/에이전트 환경에는 브라우저가 없으므로 이 스크립트가 만들 수 없다.
//   → 대신 **누수가 생길 수 있는 코드 구조**를 센다.
//
// 📍 2026-08-25 축소 — 원래 이 게이트의 축은 "뷰1→2→3→4→1 10회 순회 후 자원 카운터가
//    ±5 이내"였고, 검사 4개 중 3개(G1 three 런타임 geometry · G2 dispose · G3 THREE.Cache)가
//    **Three.js 전용**이었다. 뷰2·3·4를 제거하면서 그 셋은 **잴 대상이 사라졌다** —
//    측정 대상이 없는 검사를 PASS로 남기면 «검사했다»는 거짓 신호가 된다.
//    남긴 것은 렌더러가 하나여도 여전히 성립하는 두 축이다:
//      · Phaser 절차 텍스처(`generateTexture`)는 TextureManager에 **영구 등록**된다.
//      · 씬 종료 경로에 `dispose()`가 배선돼 있는가(타이머·트윈·텍스처 회수).
//    근거: docs/design/20260825-roadmap-1y.md §1.2
//
// 실행: node scripts/gate-gpu-baseline.mjs [--json] [--print-runtime-gate]
// 종료코드: 0 통과 / 1 실패(누수 구조 잔존)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 계측 대상 — 이 게임의 유일한 렌더러. */
const TARGETS = [
  { file: "apps/client/src/scenes/game-scene.ts", view: "2d-emoji", engine: "phaser" },
];

const RE = {
  dispose: /\.dispose\s*\(\s*\)/g,
  // Phaser 절차적 텍스처 — 텍스처 매니저에 영구 등록된다.
  phaserTexGen: /\.generateTexture\s*\(/g,
  phaserTexRemove: /textures\.remove\s*\(/g,
  // 타자기 setText = 매 틱 캔버스 재렌더 + 텍스처 재업로드(§9.3 뷰1 부수).
  // 마스크 방식(`beginReveal`)은 텍스트를 1회만 그린다.
  setText: /\.setText\s*\(/g,
  maskedType: /\bbeginReveal\s*\(/g,
};

/** 줄 단위 중괄호 깊이. 깊이 0에서 생성된 자원 = 모듈 상수(프로세스당 1회). */
const scanDepths = (src) => {
  const lines = src.split("\n");
  const depths = [];
  let depth = 0;
  let inBlockComment = false;
  for (const line of lines) {
    depths.push(depth);
    let l = line;
    if (inBlockComment) {
      const end = l.indexOf("*/");
      if (end < 0) continue;
      l = l.slice(end + 2);
      inBlockComment = false;
    }
    l = l.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const open = l.indexOf("/*");
    if (open >= 0) {
      inBlockComment = true;
      l = l.slice(0, open);
    }
    for (const ch of l) {
      if (ch === "{" || ch === "(" || ch === "[") depth += 1;
      if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    }
  }
  return { lines, depths };
};

const countBy = (lines, depths, re) => {
  let shared = 0;
  let runtime = 0;
  const sites = [];
  lines.forEach((line, i) => {
    re.lastIndex = 0;
    const n = (line.match(re) ?? []).length;
    if (n === 0) return;
    // 깊이 0~1 = 모듈 최상위(선언 1줄이 괄호를 열어둔 상태 포함) → 공유 상수.
    const isShared = depths[i] <= 1;
    if (isShared) shared += n;
    else runtime += n;
    sites.push({ line: i + 1, n, shared: isShared, text: line.trim().slice(0, 90) });
  });
  return { shared, runtime, total: shared + runtime, sites };
};

const report = [];
for (const t of TARGETS) {
  let src;
  try {
    src = readFileSync(join(ROOT, t.file), "utf8");
  } catch {
    report.push({ ...t, missing: true });
    continue;
  }
  const { lines, depths } = scanDepths(src);
  const m = {};
  for (const [k, re] of Object.entries(RE)) m[k] = countBy(lines, depths, re);
  report.push({ ...t, metrics: m, loc: lines.length });
};

// ── 게이트 판정 ────────────────────────────────────────────
const all = report.filter((r) => !r.missing);
const sum = (rs, k, f) => rs.reduce((a, r) => a + r.metrics[k][f], 0);

const disposeCalls = sum(all, "dispose", "total");
const phaserGen = sum(all, "phaserTexGen", "total");
const phaserRemove = sum(all, "phaserTexRemove", "total");

const checks = [
  {
    id: "G1 dispose() 배선",
    got: disposeCalls,
    want: "> 0",
    pass: disposeCalls > 0,
    why: "씬 종료 경로에 회수가 없으면 타이머·트윈·절차 텍스처가 그대로 남는다.",
  },
  {
    id: "G2 Phaser 절차 텍스처 회수",
    got: `${phaserGen}건 생성 / ${phaserRemove}건 제거`,
    want: "제거 ≥ 생성",
    pass: phaserRemove >= phaserGen,
    why: "generateTexture는 TextureManager에 영구 등록된다 — 씬 종료 시 remove 필요.",
  },
];

const args = new Set(process.argv.slice(2));

if (args.has("--json")) {
  console.log(JSON.stringify({ report, checks }, null, 2));
} else {
  console.log("── GPU 자원 정적 계측 (Phaser) ────────────────────────────");
  for (const r of report) {
    if (r.missing) {
      console.log(`\n${r.view.padEnd(16)} ${relative(ROOT, r.file)}  ⚠ 파일 없음`);
      continue;
    }
    const m = r.metrics;
    console.log(`\n${r.view}  (${r.file}, ${r.loc}행)`);
    console.log(
      `  dispose() ${m.dispose.total}건` +
        `   generateTexture ${m.phaserTexGen.total} / textures.remove ${m.phaserTexRemove.total}` +
        `   setText ${m.setText.total} / 마스크 타자기 ${m.maskedType.total}`,
    );
  }

  console.log("\n── 게이트 ─────────────────────────────────────────────");
  for (const c of checks) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.id}: ${c.got}  (기준 ${c.want})`);
    if (!c.pass) console.log(`         ↳ ${c.why}`);
  }
}

if (args.has("--print-runtime-gate")) {
  console.log(`
── 런타임 게이트 — 브라우저에서 사람이 1회 측정 ──────────────────
이 스크립트로는 측정 불가(WebGL 컨텍스트 필요). 절차:
 1) pnpm dev → /?solo=1 진입 → 판을 시작한다
 2) DevTools 콘솔에서 기준선 스냅샷
      const t = __zcGame.renderer                 // Phaser.Renderer.WebGL.WebGLRenderer
      const base = { tex: __zcGame.textures.list && Object.keys(__zcGame.textures.list).length }
    (__zcGame 은 enterGame()이 걸어두는 계측 훅)
 3) 판을 끝까지 진행 → [다시 하기]로 리매치를 10회 반복한다
    (뷰 순회가 사라진 지금, 자원이 쌓일 수 있는 유일한 왕복은 **리매치**다)
 4) 같은 스냅샷을 다시 떠 텍스처 수가 **±5 이내**면 통과
 5) 프레임은 __zcGame.loop.actualFps 로 함께 확인한다
`);
}

process.exit(checks.every((c) => c.pass) ? 0 : 1);
