// docs/ 트리를 훑어 docs/manifest.json 생성 (문서 브라우저 좌측 트리용).
// 규칙: design 폴더는 .html(수기 디자인)만, plans/logs는 .md만.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const GROUPS = [
  { dir: "submission", label: "📤 제출물", ext: "pair" },
  { dir: "design", label: "📐 설계", ext: ".html" },
  { dir: "assets", label: "🎨 에셋·컨셉", ext: "pair" },
  { dir: "plans/active", label: "🗂 플랜 · 진행", ext: ".md" },
  { dir: "plans/hold", label: "⏸ 플랜 · 보류", ext: ".md" },
  { dir: "plans/done", label: "✅ 플랜 · 완료", ext: ".md" },
  { dir: "logs", label: "📓 개발일지", ext: ".md" },
];

// pair 모드: 같은 basename의 .html이 있으면 .html만, 없으면 .md.
const pickPairFiles = (files) => {
  const htmls = new Set(
    files.filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, "")),
  );
  return files
    .filter(
      (f) =>
        f.endsWith(".html") ||
        (f.endsWith(".md") && !htmls.has(f.replace(/\.md$/, ""))),
    )
    .sort();
};

const titleOf = (abs, ext) => {
  try {
    const txt = readFileSync(abs, "utf8");
    if (ext === ".md") {
      const m = txt.match(/^#\s+(.+)$/m);
      return m ? m[1].trim() : null;
    }
    const m = txt.match(/<title>([^<]+)<\/title>/i);
    return m ? m[1].replace(/\s*[—-]\s*zodiac-clue\s*$/i, "").trim() : null;
  } catch {
    return null;
  }
};

const out = [];
for (const g of GROUPS) {
  const base = join("docs", g.dir);
  if (!existsSync(base)) continue;
  const all = readdirSync(base);
  const files =
    g.ext === "pair"
      ? pickPairFiles(all)
      : all.filter((f) => f.endsWith(g.ext)).sort().reverse(); // 최신 날짜 위로
  const items = files.map((f) => {
    const path = `${g.dir}/${f}`;
    const ext = f.endsWith(".html") ? ".html" : ".md";
    return { path, title: titleOf(join(base, f), ext) || f };
  });
  if (items.length) out.push({ label: g.label, dir: g.dir, items });
}

writeFileSync("docs/manifest.json", JSON.stringify(out, null, 2) + "\n");
console.log(
  `docs/manifest.json 생성: ${out.reduce((n, g) => n + g.items.length, 0)}개 문서`,
);
