// GPU 자원 회귀 게이트 — 정적 계측 (roadmap §9.3 · §9.6)
//
// 왜 정적인가:
//   §9.6이 정의한 수용 게이트는 "뷰1→2→3→4→1 10회 순회 후 `renderer.info.memory`가
//   초기값 ±5 이내"다. 이 값은 **살아 있는 WebGL 컨텍스트**에서만 나온다.
//   CI/에이전트 환경에는 브라우저가 없으므로 그 수치는 이 스크립트가 만들 수 없다.
//   → 대신 **누수가 생길 수 있는 코드 구조**를 센다. 두 지표는 다음 관계로 묶인다.
//        런타임 카운터 우상향 ⟸ (매 오브젝트마다 새 geometry/material) ∧ (dispose 0건)
//     그래서 "공유 지오메트리로 상수화됐는가 · dispose가 배선됐는가"를 통과 조건으로 둔다.
//   런타임 수치는 `--print-runtime-gate`가 출력하는 절차로 **사람이 1회** 측정한다.
//
// 실행: node scripts/gate-gpu-baseline.mjs [--json] [--print-runtime-gate]
// 종료코드: 0 통과 / 1 실패(누수 구조 잔존)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 계측 대상 — 뷰1~4 렌더러 + three 자원 헬퍼. */
const TARGETS = [
  { file: "apps/client/src/scenes/game-scene.ts", view: "뷰1 2d-emoji", engine: "phaser" },
  { file: "apps/client/src/scenes/iso-view.ts", view: "뷰2·3 three-*", engine: "three" },
  { file: "apps/client/src/scenes/pixel-scene.ts", view: "뷰4 pixel", engine: "phaser" },
  { file: "apps/client/src/scenes/three-res.ts", view: "(공용 three 자원)", engine: "three" },
];

const RE = {
  geometry: /new\s+THREE\.[A-Za-z0-9_]*Geometry\s*\(/g,
  material: /new\s+THREE\.[A-Za-z0-9_]*Material\s*\(/g,
  texture: /new\s+THREE\.(?:Canvas|Data|Video|Compressed)?Texture\s*\(/g,
  dispose: /\.dispose\s*\(\s*\)/g,
  // Phaser 절차적 텍스처(뷰4 잔디 등) — 텍스처 매니저에 영구 등록된다.
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
const three = report.filter((r) => !r.missing && r.engine === "three");
const all = report.filter((r) => !r.missing);
const sum = (rs, k, f) => rs.reduce((a, r) => a + r.metrics[k][f], 0);

const geoRuntime = sum(three, "geometry", "runtime");
const geoShared = sum(three, "geometry", "shared");
const disposeCalls = sum(all, "dispose", "total");
const cacheEnabled = /THREE\.Cache\.enabled\s*=\s*true/.test(
  three.map((r) => readFileSync(join(ROOT, r.file), "utf8")).join("\n"),
);
const phaserGen = sum(all, "phaserTexGen", "total");
const phaserRemove = sum(all, "phaserTexRemove", "total");

const checks = [
  {
    id: "G1 three 런타임 geometry 생성",
    got: geoRuntime,
    want: "0 (전부 모듈 공유 상수)",
    pass: geoRuntime === 0,
    why: "토큰·NPC마다 새 geometry를 만들면 왕복마다 GPU에 쌓인다(§9.3).",
  },
  {
    id: "G2 dispose() 호출",
    got: disposeCalls,
    want: "> 0",
    pass: disposeCalls > 0,
    why: "Three는 geometry/material/texture를 GC하지 않는다. 0건이면 확정 누수(§9.3).",
  },
  {
    id: "G3 THREE.Cache.enabled",
    got: cacheEnabled ? "true" : "미설정",
    want: "true",
    pass: cacheEnabled,
    why: "뷰3 재진입마다 같은 SVG 10장을 재디코드+GPU 재업로드(§9.3).",
  },
  {
    id: "G4 Phaser 절차 텍스처 회수",
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
  console.log("── GPU 자원 정적 계측 (roadmap §9.3 · §9.6) ──────────────");
  for (const r of report) {
    if (r.missing) {
      console.log(`\n${r.view.padEnd(16)} ${relative(ROOT, r.file)}  ⚠ 파일 없음`);
      continue;
    }
    const m = r.metrics;
    console.log(`\n${r.view}  (${r.file}, ${r.loc}행)`);
    if (r.engine === "three") {
      console.log(
        `  geometry  공유 ${m.geometry.shared} / 런타임 ${m.geometry.runtime}` +
          `   material 공유 ${m.material.shared} / 런타임 ${m.material.runtime}` +
          `   texture ${m.texture.total}`,
      );
    }
    console.log(
      `  dispose() ${m.dispose.total}건` +
        (r.engine === "phaser"
          ? `   generateTexture ${m.phaserTexGen.total} / textures.remove ${m.phaserTexRemove.total}` +
            `   setText ${m.setText.total} / 마스크 타자기 ${m.maskedType.total}`
          : ""),
    );
  }

  // 공유 상수화의 귀결: three 쪽 고유 BufferGeometry 수가 **보드/액터 수와 무관**해진다.
  // (= 공유 상수 N + GridHelper 자체 1 + THREE.Sprite 모듈 전역 1)
  console.log(
    `\n▸ three 고유 geometry 상한 = ${geoShared} 공유 + 1 GridHelper + 1 Sprite전역` +
      ` = ${geoShared + 2}개 — 방 9개·토큰 6개·NPC 6개와 **무관**하게 고정.`,
  );

  console.log("\n── 게이트 ─────────────────────────────────────────────");
  for (const c of checks) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.id}: ${c.got}  (기준 ${c.want})`);
    if (!c.pass) console.log(`         ↳ ${c.why}`);
  }
}

if (args.has("--print-runtime-gate")) {
  console.log(`
── 런타임 게이트 (§9.6) — 브라우저에서 사람이 1회 측정 ──────────
이 스크립트로는 측정 불가(WebGL 컨텍스트 필요). 절차:
 1) pnpm dev → /?solo=1 진입 → 뷰2로 한 번 들어간다(IsoView 생성 시점)
 2) DevTools 콘솔에서 기준선 스냅샷
      const base = __zcIso.debugInfo()   // { geometries, textures, programs, calls, triangles }
    (__zcIso 는 IsoView 생성자가 걸어두는 계측 훅 — main.ts 수정 없이 읽힌다)
 3) 뷰 드롭다운으로 뷰1→2→3→4→1 을 10회 순회
 4) const after = __zcIso.debugInfo()
    → after.geometries - base.geometries, after.textures - base.textures 가
      각각 **±5 이내**면 §9.3 통과
 5) 뷰2·3에서 game.loop.actualFps ≈ 0 (Phaser 루프 정지)은 §9.2 담당(별도 작업)
`);
}

process.exit(checks.every((c) => c.pass) ? 0 : 1);
