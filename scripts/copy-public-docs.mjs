// docs/ → apps/client/dist/docs 복사. 내부 문서(scripts/docs-private.mjs)는 제외한다.
// 기존 `cp -r docs ...`는 전부 복사해, 트리 목록에 없어도 직접 URL로 접근이 가능했다.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { isPrivateDocPath } from "./docs-private.mjs";

const SRC = "docs";
const DEST = join("apps", "client", "dist", "docs");

if (!existsSync(SRC)) {
  console.error(`[docs] ${SRC} 없음 — 복사 생략`);
  process.exit(0);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

let skipped = 0;
let copied = 0;

cpSync(SRC, DEST, {
  recursive: true,
  filter: (src) => {
    const rel = relative(SRC, src);
    if (!rel) return true; // 루트
    if (isPrivateDocPath(rel)) {
      skipped += 1;
      return false;
    }
    copied += 1;
    return true;
  },
});

console.log(`[docs] 공개 복사 ${copied}건 · 내부 제외 ${skipped}건 → ${DEST}`);
