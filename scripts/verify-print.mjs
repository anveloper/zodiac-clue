#!/usr/bin/env node
/**
 * 인쇄(PDF) 검증 게이트 — `docs/**\/*.html` 을 **실제로 PDF로 뽑아** 기계가 잡을 수 있는 것만 판정한다.
 *
 * 왜 필요한가: 제출물 ③④⑤는 브라우저 인쇄로 PDF를 만들어 낸다. 이 저장소 문서는 **다크 테마 고정**이라
 * `@media print` 라이트 팔레트가 한 군데라도 새면 **흰 종이에 흰 글자** 또는 **검은 배지에 검은 글자**가 된다.
 * 화면에서는 멀쩡해 보이므로 화면 검토로는 절대 걸리지 않는다. 뽑아 봐야 안다.
 *
 * ⚠️ 이 게이트는 **인쇄가 안전하다고 증명하지 않는다.** 기계가 셀 수 있는 것만 센다.
 *    레이아웃·미감·문맥은 **사람이 PDF를 눈으로 봐야** 한다. 스크립트는 마지막에 사람이 볼 항목을
 *    체크리스트로 반드시 인쇄한다(§사람 확인). 그 목록을 지우지 마라 — 지우면 거짓 안전판이 된다.
 *
 * 자동 판정(기계)
 *   render     PDF가 생성되는가 · 크기 > 8KB
 *   pagesize   A4 인가 (`@page { size: A4 }` 누락 시 Letter로 나온다)
 *   pages      페이지 수가 1 이상이고 상한 이내인가
 *   text       텍스트가 추출되는가(글자가 이미지로 굳지 않았는가)
 *   contrast   **모든 낱말의 배경↔글자 명도차** — 흰 글자/흰 배경, 검은 배지/검은 글자를 잡는다
 *   clip       낱말이 **페이지 폭을 넘어 잘리지** 않는가
 *   blank      **빈 페이지**가 없는가 (`break-inside:avoid` 남용의 신호)
 *   csslint    `@media print` 블록에 `@page size` · `print-color-adjust` · `break-inside` · 링크 URL 규칙이 있는가
 *
 * 사람 확인(기계로 대체 불가) — 실행 후 항상 인쇄된다. §사람 확인 참고.
 *
 * 실행
 *   node scripts/verify-print.mjs                 # 전체
 *   node scripts/verify-print.mjs --only=submission   # 경로에 문자열이 들어간 문서만
 *   node scripts/verify-print.mjs --json
 *   node scripts/verify-print.mjs --keep          # PNG 미리보기까지 남긴다(눈 검증용)
 *   node scripts/verify-print.mjs --out=<dir>     # 기본 $TMPDIR/zodiac-print-verify
 *
 * 산출물은 **저장소 밖**(임시 디렉터리)에만 쓴다. 커밋 대상이 아니다.
 * 종료코드: 0 전건 통과 / 1 실패 / 2 판정 불가(Chrome·poppler 부재)
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (pfx) => {
  const a = argv.find((x) => x.startsWith(pfx));
  return a ? a.slice(pfx.length) : null;
};
const OPT = {
  json: has("--json"),
  keep: has("--keep"),
  only: (val("--only=") ?? "").trim(),
  out: val("--out=") ?? join(tmpdir(), "zodiac-print-verify"),
};

// ── 판정 기준 (코드에 박는다) ───────────────────────────────────────
const TH = {
  minBytes: 8 * 1024,
  maxPages: 60,
  minChars: 200,
  // 낱말 상자 안 배경(중앙값) ↔ 글자(하위 5%) 명도차. 흰 글자/흰 배경이면 0에 가깝고,
  // 검은 배지 위 검은 글자도 0에 가깝다. 정상 본문(검정/흰 배경)은 200 이상 나온다.
  minContrast: 55,
  // 명도차가 이 아래인 낱말이 페이지당 이만큼 넘으면 실패(안티에일리어싱·장식 문자 오검출 흡수).
  maxLowContrastWords: 4,
  // A4 = 595 x 842 pt. Letter = 612 x 792.
  a4: { w: 595, h: 842, tol: 3 },
  // 페이지 가장자리 이 안쪽(pt)까지 글자가 들어오면 잘림 위험.
  edgePt: 6,
  // 잉크가 이 비율 미만이면 사실상 빈 페이지.
  blankInk: 0.0015,
  // 144dpi = 1pt 당 2px. 72dpi 로 구우면 가운뎃점·마침표 같은 가는 글자가 안티에일리어싱에
  // 묻혀 "명도차 없음"으로 오검출된다(실측). bbox 는 pt 단위이므로 배율은 코드가 자동 보정한다.
  renderDpi: 144,
  renderTimeoutMs: 90_000,
  renderTries: 3,
  // 이모지 개수 임계 — 실측 경계는 78(성공) ~ 196(실패) 사이에 있다. 성공한 최대치 위에 경고선을,
  // 실패한 최소치 아래에 실패선을 둔다. 정확한 경계는 이모지 종류·문서 길이에 함께 좌우된다.
  emojiWarn: 90,
  emojiFail: 150,
};

// ── 외부 도구 ───────────────────────────────────────────────────────
const CHROME =
  process.env.CHROME_BIN ??
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => existsSync(p));

const bin = (name) => {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};
const POPPLER = { pdfinfo: bin("pdfinfo"), pdftotext: bin("pdftotext"), pdftoppm: bin("pdftoppm") };

const fail = (msg, code = 2) => {
  if (OPT.json) console.log(JSON.stringify({ status: "ERROR", reason: msg }, null, 2));
  else console.error(`\n  ERR  인쇄 검증 불가 — ${msg}\n`);
  process.exit(code);
};

if (!CHROME) fail("Chrome/Chromium 을 찾지 못했다. CHROME_BIN 환경변수로 경로를 지정하라.");
const missingPoppler = Object.entries(POPPLER).filter(([, v]) => !v).map(([k]) => k);
if (missingPoppler.length)
  fail(`poppler 도구 부재: ${missingPoppler.join(", ")} — macOS: \`brew install poppler\``);

// ── 대상 수집 ───────────────────────────────────────────────────────
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : extname(e.name) === ".html" ? [p] : [];
  });

let targets = walk(DOCS).map((p) => relative(ROOT, p)).sort();
if (OPT.only) targets = targets.filter((p) => p.includes(OPT.only));
if (!targets.length) fail(`대상 문서가 없다 (--only=${OPT.only})`, 2);

// ── 정적 서버 (빈 포트를 스스로 고른다 — 2567·5173은 건드리지 않는다) ──
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".woff2": "font/woff2",
};
const RESERVED = new Set([2567, 5173]);

const handler = (req, res) => {
  const p = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  createReadStream(f).pipe(res);
};

// 빈 포트를 스스로 고른다. 2567(서버)·5173(클라)은 남의 것이므로 건너뛴다.
const serve = () =>
  new Promise((ok, no) => {
    let n = 0;
    const attempt = () => {
      if (n > 40) return no(new Error("빈 포트를 찾지 못했다"));
      const port = 8300 + n++;
      if (RESERVED.has(port)) return attempt();
      const s = createServer(handler);
      s.once("error", (e) => (e.code === "EADDRINUSE" ? attempt() : no(e)));
      s.once("listening", () => ok({ srv: s, port }));
      s.listen(port, "127.0.0.1");
    };
    attempt();
  });

// ── PGM(P5) 파서 ────────────────────────────────────────────────────
const readPGM = (path) => {
  const buf = readFileSync(path);
  let i = 0;
  const tok = () => {
    while (i < buf.length) {
      const c = buf[i];
      if (c === 0x23) { while (i < buf.length && buf[i] !== 0x0a) i++; continue; } // '#' 주석
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) { i++; continue; }
      break;
    }
    const s = i;
    while (i < buf.length && ![0x20, 0x09, 0x0a, 0x0d].includes(buf[i])) i++;
    return buf.slice(s, i).toString("ascii");
  };
  if (tok() !== "P5") return null;
  const w = +tok(), h = +tok();
  tok(); // maxval
  i++; // 헤더 뒤 공백 1
  return { w, h, px: buf.slice(i, i + w * h) };
};

/**
 * 낱말 상자 안의 **배경 ↔ 글자 명도차**.
 *   배경 = 중앙값(상자의 대부분은 배경이다)
 *   글자 = 어두운 쪽 3번째 픽셀 **또는** 밝은 쪽 3번째 픽셀 중 배경에서 더 멀리 떨어진 쪽
 *          (양 끝 1~2px 은 이웃 요소가 번진 것일 수 있어 버린다)
 *
 * **양방향으로 재야 한다.** 글자가 배경보다 어둡다고 가정하면(검정 글자/흰 종이) 의도적으로
 * 어둡게 남긴 목업·강조 배지의 **밝은 글자**를 전부 거짓 실패로 잡는다(실측: 3개 문서 오검출).
 * 읽을 수 있다는 것은 "어둡다"가 아니라 "배경과 다르다"는 뜻이다.
 *
 * 이 한 숫자로 두 가지 사고를 잡는다 — **흰 배경의 흰 글자**(양쪽 다 255 → Δ0)와
 * **검은 배지 위의 검은 글자**(양쪽 다 어둠 → Δ작음). 정상 본문은 Δ200 이상 나온다.
 * 하위 백분위(p5)를 쓰면 마침표·가운뎃점처럼 획이 가는 글자가 배경에 묻혀 거짓 실패를 낸다.
 */
const boxContrast = (img, x0, y0, x1, y1) => {
  const xa = Math.max(0, Math.floor(x0)), ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(img.w, Math.ceil(x1)), yb = Math.min(img.h, Math.ceil(y1));
  if (xb - xa < 2 || yb - ya < 2) return null; // 너무 작아 측정 불가
  const v = [];
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) v.push(img.px[y * img.w + x]);
  if (v.length < 12) return null;
  v.sort((a, b) => a - b);
  const bg = v[Math.floor(v.length * 0.5)];
  return Math.max(bg - v[2], v[v.length - 3] - bg);
};

const inkFraction = (img) => {
  let n = 0;
  for (let k = 0; k < img.px.length; k++) if (img.px[k] < 245) n++;
  return n / img.px.length;
};

// Chrome 이 렌더한 오류 화면의 지문. 하나라도 나오면 그 PDF 는 문서가 아니다.
const ERROR_PAGE = [
  "ERR_CONNECTION", "ERR_NAME_NOT_RESOLVED", "ERR_EMPTY_RESPONSE", "ERR_FILE_NOT_FOUND",
  "사이트에 연결할 수 없음", "This site can", "not found",
];

// ── @media print 정적 점검 ──────────────────────────────────────────
const CSS_RULES = [
  { id: "@page size", why: "누락하면 A4가 아니라 Letter로 나온다", test: (s) => /@page[^}]*\bsize\s*:/i.test(s) },
  { id: "print-color-adjust", why: "누락하면 배지·칩의 배경색이 인쇄에서 빠져 글자만 남는다", test: (s) => /print-color-adjust\s*:\s*exact/i.test(s) },
  { id: "break-inside", why: "표·카드가 페이지 경계에서 반쪽으로 끊긴다", test: (s) => /break-inside\s*:\s*avoid/i.test(s) },
  { id: "링크 URL 노출", why: "종이에서는 링크를 누를 수 없다 — URL이 본문에 찍혀야 한다", test: (s) => /a\[href\^="http"\]::after/i.test(s) },
];

const printBlock = (html) => {
  // @media print { ... } 을 중괄호 균형으로 잘라낸다(중첩 @page 포함).
  const out = [];
  const re = /@media\s+print\s*\{/gi;
  let m;
  while ((m = re.exec(html))) {
    let d = 1, i = m.index + m[0].length;
    while (i < html.length && d > 0) {
      if (html[i] === "{") d++;
      else if (html[i] === "}") d--;
      i++;
    }
    out.push(html.slice(m.index, i));
  }
  return out.join("\n");
};

/**
 * 원본 HTML만 보면 되는 검사. **렌더 성공 여부와 무관하게** 돌린다 — 인쇄가 죽었을 때
 * 그 원인을 같은 화면에서 보여 주기 위해서다.
 */
const staticChecks = (srcHtml, add) => {
  // emoji — 이 저장소에서 실제로 인쇄를 죽인 원인.
  // Chrome 은 컬러 이모지를 PDF 안에 **Type 3 글리프 프로시저**로 하나씩 심는다. 한 문서에
  // 이게 많이 쌓이면 인쇄 파이프라인이 통째로 죽는다("Requested printing multiple times").
  // 실측 — 229개·196개 문서 2편은 3회 시도 전부 실패, 78개 이하 문서는 전부 성공.
  // 같은 문서에서 **이모지만** 3/4 지우면 즉시 성공했다(다른 것은 아무것도 바꾸지 않았다).
  // 이 값은 헤드리스에서 잰 것이다. 사람이 Cmd+P 로 뽑는 경로는 OS 인쇄 스택을 타므로
  // 다르게 나올 수 있다 — 그래서 §사람 확인에도 같은 항목을 남긴다.
  const emojiAll = (srcHtml.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
  add("emoji", emojiAll >= TH.emojiFail ? "FAIL" : "PASS",
    `${emojiAll}개` +
    (emojiAll >= TH.emojiFail
      ? ` — 헤드리스 인쇄가 깨지는 구간(${TH.emojiFail}개 이상). 이모지를 줄이거나, Cmd+P 로 뽑아 사람이 직접 확인하라`
      : emojiAll >= TH.emojiWarn ? ` — 임계(${TH.emojiFail})에 근접. 더 늘리지 마라` : ""));

  // csslint — @media print 블록이 갖춰야 할 최소 규칙.
  const pb = printBlock(srcHtml);
  if (!pb.trim()) add("csslint", "FAIL", "@media print 블록이 없다 — 다크 팔레트 그대로 인쇄된다");
  else {
    const miss = CSS_RULES.filter((r) => !r.test(pb));
    add("csslint", miss.length ? "FAIL" : "PASS",
      miss.length ? miss.map((m) => `${m.id}(${m.why})`).join(" · ") : `규칙 ${CSS_RULES.length}종 충족`);
  }
};

// ── 실행 ────────────────────────────────────────────────────────────
const { srv, port } = await serve();
const outDir = OPT.out;
mkdirSync(outDir, { recursive: true });
const profRoot = mkdtempSync(join(tmpdir(), "zc-chrome-"));

const slug = (p) => p.replace(/\//g, "__").replace(/\.html$/, "");

/**
 * Chrome 을 띄워 PDF 하나를 굽는다.
 *
 * 실측으로 확인한 두 가지 함정을 여기서 흡수한다.
 *   ① `--user-data-dir` 를 공유하면 동시 실행이 싱글턴 락에서 **무한 대기**한다 → 문서마다 프로필을 나눈다.
 *   ② Chrome 이 PDF 를 다 쓰고도 **종료하지 않는 경우**가 있다(실측 12분 이상 잔류).
 *      → 파일이 나타나고 크기가 멎으면 우리가 먼저 죽인다. 프로세스 종료를 기다리지 않는다.
 */
const renderPdf = (rel, name, pdf, attempt) =>
  new Promise((done) => {
    const prof = join(profRoot, `${name}-${attempt}`);
    const child = spawn(CHROME, [
      "--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${prof}`,
      "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--virtual-time-budget=4000", "--no-pdf-header-footer",
      `--print-to-pdf=${pdf}`, `http://127.0.0.1:${port}/${rel}`,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    let err = "";
    child.stderr.on("data", (d) => { err += d; });

    let settled = false, lastSize = -1, stable = 0, waited = 0;
    const finish = (killed, reason) => {
      if (settled) return;
      settled = true;
      clearInterval(iv);
      try { child.kill("SIGKILL"); } catch { /* 이미 죽었다 */ }
      done({ killed, reason });
    };

    const iv = setInterval(() => {
      waited += 400;
      if (existsSync(pdf)) {
        const s = statSync(pdf).size;
        // 두 번 연속 크기가 같으면 쓰기가 끝난 것으로 본다.
        if (s > 0 && s === lastSize) { if (++stable >= 2) return finish(true, "ok"); }
        else stable = 0;
        lastSize = s;
      }
      if (waited >= TH.renderTimeoutMs)
        finish(true, `${TH.renderTimeoutMs / 1000}s 내에 PDF 가 완성되지 않았다 ${err.trim().slice(-160)}`);
    }, 400);

    child.on("exit", (code) => {
      // Chrome 이 스스로 끝난 경우 — 파일 유무는 호출부가 판정한다.
      setTimeout(() => finish(false, `Chrome 종료코드 ${code} ${err.trim().slice(-160)}`), 300);
    });
    child.on("error", (e) => finish(false, `실행 실패: ${e.message}`));
  });
const results = [];
const tty = !OPT.json && process.stderr.isTTY;

for (const rel of targets) {
  const name = slug(rel);
  const pdf = join(outDir, `${name}.pdf`);
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  if (tty) process.stderr.write(`  … ${rel}${" ".repeat(20)}\r`);
  rmSync(pdf, { force: true });

  // 렌더는 흔들린다(포트 경합·Chrome 인쇄 실패). 한 번의 실패로 문서를 탓하지 않도록 재시도한다.
  const t0 = Date.now();
  let r = await renderPdf(rel, name, pdf, 0);
  let tries = 1;
  while (!(existsSync(pdf) && statSync(pdf).size >= TH.minBytes) && tries < TH.renderTries) {
    rmSync(pdf, { force: true });
    r = await renderPdf(rel, name, pdf, tries);
    tries++;
  }
  const ms = Date.now() - t0;

  // ① render
  const ok = existsSync(pdf) && statSync(pdf).size >= TH.minBytes;
  add("render", ok ? "PASS" : "FAIL",
    ok ? `${(statSync(pdf).size / 1024).toFixed(0)} kB · ${(ms / 1000).toFixed(1)}s · ${tries}회차` +
         `${r.killed ? " (write 후 Chrome 미종료 → 강제종료)" : ""}`
       : `PDF 미생성/과소 · ${tries}회 시도 — ${r.reason}` +
         (/Printing failed|printing multiple times/i.test(r.reason)
           ? "\n           ↳ Chrome 인쇄 파이프라인이 죽었다. 이 저장소에서 확인된 원인은 **컬러 이모지 과다**다 — 아래 emoji 항목을 보라."
           : ""));

  // 정적 검사(원본 HTML만 보면 되는 것)는 **렌더가 실패해도 반드시 돌린다.**
  // 인쇄가 죽었을 때야말로 그 이유를 알려 줘야 하는데, 여기서 건너뛰면 화면에 남는 건
  // "PDF 미생성" 한 줄뿐이고 사람은 원인을 처음부터 다시 찾아야 한다.
  const srcHtml = readFileSync(join(ROOT, rel), "utf8");
  staticChecks(srcHtml, add);

  if (!ok) { results.push({ rel, checks, pages: 0 }); continue; }

  // ② pagesize · ③ pages
  const info = spawnSync(POPPLER.pdfinfo, [pdf], { encoding: "utf8" }).stdout ?? "";
  const pages = +(info.match(/^Pages:\s*(\d+)/m)?.[1] ?? 0);
  const size = info.match(/^Page size:\s*([\d.]+) x ([\d.]+)/m);
  const pw = size ? +size[1] : 0, ph = size ? +size[2] : 0;
  const isA4 = Math.abs(pw - TH.a4.w) <= TH.a4.tol && Math.abs(ph - TH.a4.h) <= TH.a4.tol;
  add("pagesize", isA4 ? "PASS" : "FAIL",
    isA4 ? "A4" : `${pw.toFixed(0)}x${ph.toFixed(0)}pt — A4(595x842)가 아니다. @media print 안에 \`@page { size: A4 }\` 가 있는지 보라`);
  add("pages", pages >= 1 && pages <= TH.maxPages ? "PASS" : "FAIL", `${pages}쪽 (상한 ${TH.maxPages})`);

  // ④ text
  const txt = spawnSync(POPPLER.pdftotext, [pdf, "-"], { encoding: "utf8" }).stdout ?? "";
  const chars = txt.replace(/\s/g, "").length;
  add("text", chars >= TH.minChars ? "PASS" : "FAIL", `추출 ${chars}자 (하한 ${TH.minChars})`);

  // ⑤ content — **Chrome 오류 페이지를 정상 PDF로 세지 않는다.**
  // 로컬 서버가 잠깐 흔들리면 Chrome 은 "사이트에 연결할 수 없음" 화면을 얌전히 인쇄한다.
  // 그 PDF 는 페이지 수·크기·텍스트 검사를 **전부 통과**한다(실측). 문서 고유 문자열로 못을 박는다.
  const errSig = ERROR_PAGE.find((s) => txt.includes(s));
  const title = (srcHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/&[a-z]+;/g, " ");
  // 제목을 토막 내 2자 이상인 조각만 남긴다(구분자·이모지 제거).
  const tokens = title.split(/[\s—·\-–|,()[\]:/]+/).map((s) => s.replace(/[^\p{L}\p{N}]/gu, "")).filter((s) => s.length >= 2);
  const hit = tokens.filter((t) => txt.includes(t));
  add("content",
    errSig ? "FAIL" : tokens.length && !hit.length ? "FAIL" : "PASS",
    errSig ? `Chrome 오류 페이지가 인쇄됐다 ("${errSig}") — 서버·네트워크 문제이지 문서 문제가 아니다. 재실행하라`
      : !tokens.length ? "제목 토큰 없음 — 대조 생략"
        : `제목 토큰 ${hit.length}/${tokens.length} 일치`);

  // ⑤⑥⑦ 픽셀·낱말 검사 — 페이지를 회색조로 굽고 낱말 상자와 대조한다.
  const rasterDir = join(outDir, `.raster-${name}`);
  mkdirSync(rasterDir, { recursive: true });
  spawnSync(POPPLER.pdftoppm, ["-gray", "-r", String(TH.renderDpi), pdf, join(rasterDir, "p")]);
  const bbox = spawnSync(POPPLER.pdftotext, ["-bbox", pdf, "-"], { encoding: "utf8" }).stdout ?? "";

  const pageBlocks = bbox.split(/<page\b/).slice(1);
  const lowContrast = [];
  const clipped = [];
  const blanks = [];

  const pgms = readdirSync(rasterDir).filter((f) => f.endsWith(".pgm")).sort();
  for (let pi = 0; pi < pgms.length; pi++) {
    const img = readPGM(join(rasterDir, pgms[pi]));
    if (!img) continue;
    if (inkFraction(img) < TH.blankInk) blanks.push(pi + 1);

    const block = pageBlocks[pi] ?? "";
    const pwPt = +(block.match(/width="([\d.]+)"/)?.[1] ?? pw);
    const scale = img.w / pwPt;
    let lowOnPage = 0;
    const wre = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/g;
    let w;
    while ((w = wre.exec(block))) {
      const [x0, y0, x1, y1] = [+w[1], +w[2], +w[3], +w[4]].map((v) => v * scale);
      const text = w[5].replace(/&[a-z]+;/g, "").trim();
      if (!text) continue;
      if (x1 > pwPt * scale - TH.edgePt * scale || x0 < TH.edgePt * scale)
        clipped.push({ page: pi + 1, text });
      const c = boxContrast(img, x0, y0, x1, y1);
      if (c !== null && c < TH.minContrast) {
        lowOnPage++;
        if (lowContrast.length < 24) lowContrast.push({ page: pi + 1, text, contrast: c });
      }
    }
    if (lowOnPage > TH.maxLowContrastWords) {
      // 페이지 단위 초과만 별도 표시(전체 합산은 아래 detail 에서).
    }
  }
  if (!OPT.keep) rmSync(rasterDir, { recursive: true, force: true });

  const contrastBad = lowContrast.length > TH.maxLowContrastWords;
  add("contrast", contrastBad ? "FAIL" : "PASS",
    lowContrast.length === 0
      ? "모든 낱말이 배경과 구분된다"
      : `명도차 ${TH.minContrast} 미만 낱말 ${lowContrast.length}개 (허용 ${TH.maxLowContrastWords}) — ` +
        lowContrast.slice(0, 6).map((x) => `p${x.page}"${x.text}"(Δ${x.contrast})`).join(" · "));

  add("clip", clipped.length ? "FAIL" : "PASS",
    clipped.length
      ? `페이지 폭을 넘는 낱말 ${clipped.length}개 — ` + clipped.slice(0, 5).map((x) => `p${x.page}"${x.text}"`).join(" · ")
      : "페이지 폭 안에 들어온다");

  add("blank", blanks.length ? "FAIL" : "PASS",
    blanks.length ? `사실상 빈 페이지 ${blanks.join(",")}쪽 — break-inside:avoid 과다 의심` : "빈 페이지 없음");

  results.push({ rel, checks, pages });
}

if (tty) process.stderr.write(`${" ".repeat(70)}\r`);
srv.close();
if (!OPT.keep) rmSync(profRoot, { recursive: true, force: true });

// ── 사람이 봐야 하는 것 (기계로 대체 불가) ─────────────────────────
const HUMAN = [
  ["제출물 ③④⑤ 전 페이지", "심사자가 실제로 보는 문서다. **전 페이지를 한 장씩** 넘겨 봐라. 나머지는 사내 문서다."],
  ["Cmd+P 실경로 1회", "이 게이트는 **헤드리스**로 뽑는다. 제출은 사람이 브라우저 인쇄로 뽑는다 — 경로가 다르다. ③④⑤만은 실제 Cmd+P 로 한 번 뽑아 비교하라."],
  ["저대비 배지·칩", "contrast 검사는 **흰 글자/흰 배경**은 확실히 잡지만, 어두운 배지 위 어두운 글자는 테두리 색에 가려 통과할 수 있다. 배지·칩·태그는 눈으로 봐라."],
  ["페이지 나눔의 의미", "표·카드가 끊기지 않았는지는 기계가 셌지만, **제목만 남고 내용이 다음 장으로** 넘어갔는지는 사람이 봐야 안다."],
  ["표의 가독성", "폭 안에 들어왔는지는 셌다. 그러나 **열이 한 글자씩 세로로 접혀** 읽을 수 없게 됐는지는 못 센다."],
  ["링크 URL의 적절성", "URL이 찍히는지는 봤다. **본문 흐름을 끊을 만큼 길어졌는지**는 사람 판단이다."],
  ["화면 전용 UI 잔존", "내비게이션·토글·스크롤바가 종이에 찍혔는지 — 잉크가 있으면 통과하므로 기계는 구분 못 한다."],
  ["색의 의미 보존", "빨강=위험 / 초록=완료 같은 **의미가 인쇄 팔레트에서도 구분되는지**."],
];

// ── 출력 ────────────────────────────────────────────────────────────
const allChecks = results.flatMap((r) => r.checks);
const failed = results.filter((r) => r.checks.some((c) => c.status === "FAIL"));
const exitCode = failed.length ? 1 : 0;

if (OPT.json) {
  console.log(JSON.stringify({
    status: exitCode ? "FAIL" : "PASS",
    outDir, port, chrome: CHROME,
    counts: {
      docs: results.length,
      pages: results.reduce((a, r) => a + r.pages, 0),
      PASS: allChecks.filter((c) => c.status === "PASS").length,
      FAIL: allChecks.filter((c) => c.status === "FAIL").length,
    },
    docs: results,
    humanRequired: HUMAN.map(([k, v]) => ({ item: k, why: v })),
    note: "자동 판정은 인쇄 안전을 증명하지 않는다. humanRequired 는 반드시 사람이 PDF를 열어 확인해야 한다.",
    exitCode,
  }, null, 2));
  process.exit(exitCode);
}

console.log(`\n══ 인쇄(PDF) 검증 ${"═".repeat(46)}`);
console.log(`   출력 ${outDir}   ·   문서 ${results.length}편 · ${results.reduce((a, r) => a + r.pages, 0)}쪽\n`);

for (const r of results) {
  const bad = r.checks.filter((c) => c.status === "FAIL");
  console.log(`  ${bad.length ? "FAIL" : "PASS"}  ${r.rel}  (${r.pages}쪽)`);
  for (const c of r.checks) {
    if (c.status === "PASS" && !bad.length) continue; // 통과 문서는 접는다
    console.log(`         ${c.status === "FAIL" ? "✗" : "·"} ${c.id.padEnd(9)} ${c.detail}`);
  }
}

console.log(`\n${"─".repeat(72)}`);
console.log("  § 사람 확인 — 아래는 이 스크립트가 **판정하지 못한다.** PDF를 열어 눈으로 봐라.");
console.log(`    PDF: ${outDir}`);
for (const [k, v] of HUMAN) console.log(`      □ ${k.padEnd(18)} ${v}`);

console.log(`\n${"═".repeat(72)}`);
console.log(`  PASS ${allChecks.filter((c) => c.status === "PASS").length} · FAIL ${allChecks.filter((c) => c.status === "FAIL").length}`);
console.log(exitCode === 0
  ? "  결과: PASS — 기계가 셀 수 있는 항목은 전건 통과. **위 § 사람 확인은 아직 남아 있다.**"
  : `  결과: FAIL — [${failed.map((f) => f.rel).join(", ")}]`);
console.log("");
process.exit(exitCode);
