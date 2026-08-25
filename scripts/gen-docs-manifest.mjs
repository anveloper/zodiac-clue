// docs/ 트리를 훑어 마니페스트 2종 생성 (문서 브라우저 좌측 트리용).
// 규칙: design 폴더는 .html(수기 디자인)만, plans/logs는 .md만.
//
// ⚠️ `readdirSync`는 **재귀하지 않는다.** `archive/planning/{brainstorming,meetings}` 같은 중첩은
//    목록에 잡히지 않는다 — 그 디렉토리는 비공개(docs-private.mjs)라 종전에도 트리에 없었다.
//
// ── 왜 2종인가 ────────────────────────────────────────────────
//   docs/manifest.json        **공개본.** 내부 문서(scripts/docs-private.mjs)를 뺀 목록.
//                             배포 산출물에 복사된다. 지금까지와 동일한 내용이다.
//   docs/manifest.local.json  **로컬 전용.** 내부 문서까지 포함한 전체 목록(`private:true` 표시).
//                             `copy-public-docs.mjs`가 복사에서 제외하므로 **배포본에 존재하지 않는다.**
//
// CLAUDE.md는 `docs/index.html`을 「설계·플랜·로그를 한눈에 링크하는 사람용 진입점」으로 규정하는데,
// 내부 문서가 마니페스트에서 통째로 빠져 있어 **로컬에서도** 트리·대시보드 어디에도 뜨지 않았다
// (경로를 외운 사람만 볼 수 있었다). 진입점의 구멍을 «데이터를 나누는 방식»으로 메운다 —
// 공개본은 한 글자도 바뀌지 않으므로 공개 사이트의 노출 범위는 그대로다.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isPrivateDocPath, LOCAL_MANIFEST } from "./docs-private.mjs";

const GROUPS = [
  { dir: "design", label: "📐 설계", ext: ".html" },
  { dir: "assets", label: "🎨 에셋·컨셉", ext: "pair" },
  { dir: "plans/active", label: "🗂 플랜 · 진행", ext: ".md" },
  { dir: "plans/hold", label: "⏸ 플랜 · 보류", ext: ".md" },
  { dir: "plans/done", label: "✅ 플랜 · 완료", ext: ".md" },
  { dir: "logs", label: "📓 개발일지", ext: ".md" },
  // ── 아카이브(2026-08-25) — 해커톤 시기 문서. **현재 상태의 출처가 아니다.**
  //    맨 아래에 두고 라벨에 📦를 붙여 현행 문서와 시각적으로 가른다.
  //    `archive` 그룹은 README 한 장(= 아카이브 안내)만 잡힌다 — 하위 디렉토리는 별도 그룹이다.
  { dir: "archive", label: "📦 아카이브 안내", ext: ".md" },
  {
    dir: "archive/submission",
    label: "📦 아카이브 · 과제 제출물",
    ext: "pair",
    links: [{ title: "플레이 영상 (YouTube · 2026-08 제출본)", url: "https://youtu.be/s-YfjsEzDHk" }],
    order: ["03-game-intro", "04-ai-tech", "05-team-roles"],
  },
  { dir: "archive/design", label: "📦 아카이브 · 설계", ext: "pair" },
  { dir: "archive/plans", label: "📦 아카이브 · 플랜", ext: ".md" },
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

// 전체 목록을 한 번만 훑고, 공개본은 여기서 걸러 만든다(두 목록이 갈라질 수 없게).
const all_ = [];
for (const g of GROUPS) {
  const base = join("docs", g.dir);
  if (!existsSync(base)) continue;
  const all = readdirSync(base);
  const files =
    g.ext === "pair"
      ? pickPairFiles(all)
      : all.filter((f) => f.endsWith(g.ext)).sort().reverse(); // 최신 날짜 위로
  // 명시 순서가 있으면(제출물) 그 순서로 — 없는 파일은 뒤로.
  if (g.order) {
    const rank = (f) => {
      const i = g.order.indexOf(f.replace(/\.(md|html)$/, ""));
      return i === -1 ? g.order.length : i;
    };
    files.sort((a, b) => rank(a) - rank(b));
  }
  const items = files
    .map((f) => `${g.dir}/${f}`)
    .map((path) => {
      const ext = path.endsWith(".html") ? ".html" : ".md";
      const item = { path, title: titleOf(join("docs", path), ext) || path };
      // 내부 문서는 **지우지 않고 표시**한다 — 로컬 뷰어가 자물쇠로 구분해 그린다.
      if (isPrivateDocPath(path)) item.private = true;
      return item;
    });
  // 외부 링크(빌드·영상 등)는 파일이 아니므로 그룹 맨 위에 주입한다. `url`만 있고 `path`는 없다.
  if (g.links) items.unshift(...g.links.map((l) => ({ title: l.title, url: l.url, external: true })));
  if (items.length) all_.push({ label: g.label, dir: g.dir, items });
}

/** 내부 문서를 제거한 공개본(항목이 하나도 안 남는 그룹은 그룹째 사라진다 — 종전 동작 그대로). */
const publicOnly = all_
  .map((g) => ({ ...g, items: g.items.filter((it) => !it.private) }))
  .filter((g) => g.items.length);

const count = (groups) => groups.reduce((n, g) => n + g.items.length, 0);

writeFileSync("docs/manifest.json", JSON.stringify(publicOnly, null, 2) + "\n");
writeFileSync(`docs/${LOCAL_MANIFEST}`, JSON.stringify(all_, null, 2) + "\n");
console.log(
  `docs/manifest.json 생성: ${count(publicOnly)}개 문서(공개) · ` +
    `docs/${LOCAL_MANIFEST}: ${count(all_)}개(내부 ${count(all_) - count(publicOnly)}건 포함 · 배포 제외)`,
);
