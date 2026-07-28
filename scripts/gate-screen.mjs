#!/usr/bin/env node
/**
 * 화면 게이트 — **실제 브라우저를 띄워** 기계가 판정할 수 있는 화면 사고만 판정한다.
 *
 * 왜 필요한가(07-28에 실제로 놓친 것들 — 게이트가 390×844를 재고 있었는데도):
 *   ① 상단 좌측 액션 바 6개 중 [제안] 말고 전부가 턴 배너에 가려졌다.
 *      우리가 물은 것은 «6개 버튼이 DOM에 있고 뷰포트 안인가»였고 답은 **참**이었다.
 *      **가려진 요소도 `getBoundingClientRect()`는 정상 크기를, `visibility`는 `visible`을
 *      그대로 보고한다.** 가림은 요소의 속성이 아니라 **요소 쌍의 관계**라서
 *      두 요소를 비교한 코드가 없으면 영원히 안 보인다.
 *   ② 문서가 세로로 스크롤돼 화면이 통째로 밀려 올라갔다.
 *      우리가 잰 것은 `scrollWidth vs innerWidth`(**가로**)뿐이었다. 세로는 잰 적이 없다.
 *      게다가 **전체 페이지 캡처는 밀린 화면을 정상으로 렌더한다** — 스크린샷으로도 안 잡힌다.
 *   ③ 터치 타깃이 전반적으로 44px 미달이었다([방 만들기] 32 · 문서 링크 18 · [↻] 17 · select 31).
 *
 * 자동 판정(기계)
 *   S1 겹침·가림   화면별 «가려지면 안 되는 요소»와 «서로 가리면 안 되는 쌍».
 *                  판정은 **기하 교차 + `elementFromPoint` 히트 테스트** 2단이다.
 *                  기하만 보면 오탐이 난다(의도된 겹침·투명 컨테이너·`pointer-events:none` 래퍼).
 *                  히트 테스트는 브라우저 자신의 스택 순서(z-index·페인트 순서·pointer-events)를
 *                  그대로 쓰므로 «실제로 가려졌는가»에 가장 가깝다.
 *   S2 스크롤      게임 화면: `scrollHeight <= innerHeight` **그리고** `scrollTo(0,9999)` 후 `scrollY === 0`.
 *                  랜딩·대기실은 세로 스크롤이 **정상**이라 기대값을 다르게 둔다(gate.config.mjs).
 *                  가로 스크롤은 어느 화면에서도 사고다 — 전 화면 공통으로 잠근다.
 *   S3 터치 타깃   `pointer: coarse` 에뮬레이션에서 조작 가능한 요소의 최소 변 ≥ 44px.
 *                  숨김·비활성·문서 밖은 제외하고, **제외한 개수도 인쇄한다.**
 *
 * ⚠️ 이 게이트는 **화면이 좋다고 증명하지 않는다.** 미(美)·정렬·읽힘은 기계가 못 잰다.
 *    마지막에 §사람 확인을 항상 인쇄한다(verify-print.mjs와 같은 규약). 그 목록을 지우지 마라.
 *
 * 실행
 *   node scripts/gate-screen.mjs                    # 전체(화면 5종 × 뷰포트 2종)
 *   node scripts/gate-screen.mjs --json
 *   node scripts/gate-screen.mjs --only=game,landing
 *   node scripts/gate-screen.mjs --viewport=phone
 *   node scripts/gate-screen.mjs --keep             # 캡처 PNG를 남긴다(사람 확인용)
 *   node scripts/gate-screen.mjs --self-test        # **음성 테스트** — 일부러 깨뜨려 게이트가 잡는지 본다
 *
 * 포트: 서버·클라·CDP 모두 **빈 포트를 스스로 고른다.** 2567·5173은 남의 것이므로 쓰지 않는다.
 *       끝날 때 자기가 띄운 프로세스 그룹만 종료한다(다른 프로세스는 건드리지 않는다).
 * LLM: `AI_NARRATE=off` + 빈 키로 서버를 띄우고, 끝난 뒤 `/health`의 `llmCalls`가 0인지 확인한다.
 *
 * 종료코드: 0 통과 / 1 실패 / 3 판정 불가(SKIP — Chrome·서버·클라 기동 실패, 사유 인쇄)
 */

import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { SCREEN } from "./gate.config.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (pfx) => {
  const a = argv.find((x) => x.startsWith(pfx));
  return a ? a.slice(pfx.length) : null;
};
const OPT = {
  json: has("--json"),
  keep: has("--keep"),
  verbose: has("--verbose"),
  selfTest: has("--self-test"),
  only: (val("--only=") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  viewport: val("--viewport=") ?? "",
  out: val("--out=") ?? join(tmpdir(), "zodiac-screen-gate"),
};

const CHROME =
  process.env.CHROME_BIN ??
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => existsSync(p));

/** 남의 것 — 절대 쓰지 않는다. */
const RESERVED = new Set([2567, 5173]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 판정 불가로 끝낸다. **실패가 아니라 SKIP** — 은폐된 미측정이 가장 위험하므로 사유를 남긴다. */
const skipOut = (reason, detail = "") => {
  if (OPT.json) {
    console.log(JSON.stringify({ status: "SKIP", reason, detail }, null, 2));
  } else {
    console.log(`\n══ 화면 게이트 ${"═".repeat(52)}`);
    console.log(`  SKIP  판정 불가 — ${reason}`);
    if (detail) console.log(`        ↳ ${detail.trim().split("\n").slice(-8).join("\n          ")}`);
    console.log("  이것은 «통과»가 아니다. 화면은 **재지 못했다.**\n");
  }
  process.exit(3);
};

// ── 최소 WebSocket 클라이언트 ───────────────────────────────────────
// 왜 직접 쓰는가: Node 20에는 전역 `WebSocket`이 없고, `ws` 패키지는 이 저장소의
// **어느 워크스페이스의 직접 의존성도 아니다**(pnpm 엄격 해석에서 경로가 깨진다).
// 게이트가 남의 설치 상태에 의존하면 «게이트를 못 돌려서 안 돌렸다»가 된다.
// CDP는 압축 확장을 협상하지 않으므로 텍스트 프레임만 다루면 충분하다.
class MiniWs {
  constructor(sock, rest) {
    this.sock = sock;
    this.buf = rest;
    this.onmessage = null;
    this.frags = [];
    this.fragOp = 0;
    this.dead = false;
    sock.on("data", (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.drain();
    });
    sock.on("close", () => {
      this.dead = true;
    });
    sock.on("error", () => {
      this.dead = true;
    });
  }
  drain() {
    for (;;) {
      const f = this.parse();
      if (!f) return;
      const { op, payload, fin } = f;
      if (op === 0x8) {
        this.dead = true;
        this.sock.end();
        return;
      }
      if (op === 0x9) {
        this.send(payload, 0xa);
        continue;
      }
      if (op === 0xa) continue;
      if (op === 0x0) {
        this.frags.push(payload);
        if (fin) {
          const all = Buffer.concat(this.frags);
          this.frags = [];
          this.emit(this.fragOp, all);
        }
        continue;
      }
      if (!fin) {
        this.frags = [payload];
        this.fragOp = op;
        continue;
      }
      this.emit(op, payload);
    }
  }
  emit(op, p) {
    if (op === 0x1 && this.onmessage) this.onmessage(p.toString("utf8"));
  }
  parse() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      len = Number(b.readBigUInt64BE(2));
      off = 10;
    }
    let mask = null;
    if (masked) {
      if (b.length < off + 4) return null;
      mask = b.subarray(off, off + 4);
      off += 4;
    }
    if (b.length < off + len) return null;
    let p = b.subarray(off, off + len);
    if (mask) {
      p = Buffer.from(p);
      for (let i = 0; i < p.length; i++) p[i] ^= mask[i % 4];
    }
    this.buf = b.subarray(off + len);
    return { fin, op, payload: p };
  }
  send(data, op = 0x1) {
    const p = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    const mask = randomBytes(4);
    let hdr;
    if (p.length < 126) {
      hdr = Buffer.from([0x80 | op, 0x80 | p.length]);
    } else if (p.length < 65536) {
      hdr = Buffer.alloc(4);
      hdr[0] = 0x80 | op;
      hdr[1] = 0x80 | 126;
      hdr.writeUInt16BE(p.length, 2);
    } else {
      hdr = Buffer.alloc(10);
      hdr[0] = 0x80 | op;
      hdr[1] = 0x80 | 127;
      hdr.writeBigUInt64BE(BigInt(p.length), 2);
    }
    const m = Buffer.from(p);
    for (let i = 0; i < m.length; i++) m[i] ^= mask[i % 4];
    this.sock.write(Buffer.concat([hdr, mask, m]));
  }
}

const wsConnect = (url) =>
  new Promise((ok, no) => {
    const u = new URL(url);
    const key = randomBytes(16).toString("base64");
    const sock = connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}:${u.port}\r\n` +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    sock.once("error", no);
    let acc = Buffer.alloc(0);
    const onData = (d) => {
      acc = Buffer.concat([acc, d]);
      const i = acc.indexOf("\r\n\r\n");
      if (i < 0) return;
      const head = acc.subarray(0, i).toString("latin1");
      sock.removeListener("data", onData);
      if (!/^HTTP\/1\.1 101/.test(head))
        return no(new Error(`CDP 업그레이드 실패: ${head.split("\r\n")[0]}`));
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      if (!head.includes(accept)) return no(new Error("Sec-WebSocket-Accept 불일치"));
      ok(new MiniWs(sock, acc.subarray(i + 4)));
    };
    sock.on("data", onData);
  });

// ── 포트 / 프로세스 ─────────────────────────────────────────────────
const freePort = () =>
  new Promise((ok, no) => {
    const s = createServer();
    s.once("error", no);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      if (RESERVED.has(p)) {
        s.close(() => freePort().then(ok, no));
        return;
      }
      s.close(() => ok(p));
    });
  });

/** 우리가 띄운 것만 담는다. 다른 프로세스는 절대 건드리지 않는다(`pkill` 금지). */
const spawned = [];
const launch = (cmd, args, opts) => {
  // 프로세스 그룹을 따로 만든다 → 손자 프로세스까지 **우리 그룹만** 정확히 정리할 수 있다.
  const child = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const cap = (d) => {
    log += d;
    if (log.length > 20000) log = log.slice(-20000);
  };
  child.stdout.on("data", cap);
  child.stderr.on("data", cap);
  const rec = { child, spawnError: null, get log() { return log; } };
  // 실행 파일 자체가 없을 때(ENOENT) `error` 이벤트를 안 받으면 **프로세스가 그대로 죽는다.**
  // 그러면 «판정 불가(SKIP)»여야 할 상황이 스택 트레이스와 종료코드 1(=실패)로 나온다.
  child.on("error", (e) => {
    rec.spawnError = e;
    log += `\n[spawn 실패] ${e.message}`;
  });
  spawned.push(rec);
  return rec;
};
const cleanup = () => {
  for (const { child } of spawned) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* 이미 죽었다 */
    }
  }
  // 그룹이 안 죽으면 한 번 더. 남의 프로세스는 대상이 아니다(-pid = 우리 그룹).
  setTimeout(() => {
    for (const { child } of spawned) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* ok */
      }
    }
  }, 1500).unref();
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}

/** `rec`이 죽으면 기다리지 않고 즉시 끝낸다 — 40초를 헛되이 세지 않는다. */
const waitHttp = async (url, ms, rec) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (rec?.spawnError) return null;
    try {
      const r = await fetch(url);
      if (r.ok) return await r.text();
    } catch {
      /* 아직 */
    }
    await sleep(250);
  }
  return null;
};

// ── 페이지 안에서 도는 계측 ─────────────────────────────────────────
// **이 함수는 문자열로 직렬화돼 브라우저에서 실행된다.** 바깥 스코프를 참조하면 안 된다.
// 판정(PASS/FAIL)은 하지 않는다 — 관측치만 돌려주고 판정은 Node 쪽 한 곳에서 한다.
function pageProbe(cfg) {
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const de = document.scrollingElement || document.documentElement;

  const path = (el) => {
    if (!el) return null;
    if (el === document.documentElement) return "html";
    if (el === document.body) return "body";
    const t = (el.tagName || "?").toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls =
      typeof el.className === "string" && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
        : "";
    return t + id + cls;
  };
  const round = (n) => Math.round(n * 10) / 10;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: round(r.width), h: round(r.height) };
  };
  const shown = (el) => {
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }))
        return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    return true;
  };
  /** 뷰포트와의 교차(= 지금 화면에서 실제로 보이는 부분). */
  const visBox = (el) => {
    const r = el.getBoundingClientRect();
    const l = Math.max(0, r.left);
    const t = Math.max(0, r.top);
    const rr = Math.min(VW, r.right);
    const bb = Math.min(VH, r.bottom);
    return { l, t, r: rr, b: bb, w: rr - l, h: bb - t };
  };
  const hitInfo = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { by: path(el), z: cs.zIndex, position: cs.position, pointerEvents: cs.pointerEvents };
  };

  // ── S1 ① 보호 대상: «가려지면 안 되는 것» ──
  const protect = [];
  for (const p of cfg.protect) {
    const all = Array.from(document.querySelectorAll(p.sel));
    const vis = all.filter(shown);
    const items = [];
    for (const el of vis) {
      const v = visBox(el);
      if (v.w < 1 || v.h < 1) {
        items.push({ path: path(el), rect: rectOf(el), offscreen: true, blocked: [] });
        continue;
      }
      const ins = cfg.sampleInsetPct;
      const pts = [
        { x: (v.l + v.r) / 2, y: (v.t + v.b) / 2 }, // 0 = 중심
        { x: v.l + v.w * ins, y: v.t + v.h * ins },
        { x: v.r - v.w * ins, y: v.t + v.h * ins },
        { x: v.l + v.w * ins, y: v.b - v.h * ins },
        { x: v.r - v.w * ins, y: v.b - v.h * ins },
      ];
      const blocked = [];
      let ancestorHits = 0;
      pts.forEach((pt, i) => {
        const x = Math.min(VW - 1, Math.max(0, pt.x));
        const y = Math.min(VH - 1, Math.max(0, pt.y));
        const hit = document.elementFromPoint(x, y);
        // self     = 자신 또는 자기 자손이 잡혔다 → 안 가려졌다
        // ancestor = 조상이 잡혔다(자신이 pointer-events:none) → **남이 덮은 것은 아니다**
        // foreign  = 남이 덮었다 → 이것만 «가림»이다
        const kind = !hit
          ? "none"
          : hit === el || el.contains(hit)
            ? "self"
            : hit.contains(el)
              ? "ancestor"
              : "foreign";
        if (kind === "ancestor") ancestorHits++;
        if (kind === "foreign" || kind === "none")
          blocked.push({ i, at: [Math.round(x), Math.round(y)], ...(hitInfo(hit) ?? { by: null }) });
      });
      items.push({ path: path(el), rect: rectOf(el), samples: pts.length, ancestorHits, blocked });
    }
    protect.push({
      sel: p.sel,
      why: p.why,
      min: p.min ?? 1,
      optional: !!p.optional,
      found: all.length,
      visible: vis.length,
      items,
    });
  }

  // ── S1 ② 쌍: «서로 가리면 안 되는 것» ──
  // 기하 교차만으로는 오탐이 난다 → 교차 영역에서 **히트 테스트로 실제 가림을 확인**한다.
  const pairs = [];
  for (const [aSel, bSel, why] of cfg.pairs) {
    const A = Array.from(document.querySelectorAll(aSel)).filter(shown);
    const B = Array.from(document.querySelectorAll(bSel)).filter(shown);
    const overlaps = [];
    for (const a of A) {
      for (const b of B) {
        if (a === b || a.contains(b) || b.contains(a)) continue; // 포함 관계는 «겹침»이 아니다
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const l = Math.max(ra.left, rb.left);
        const t = Math.max(ra.top, rb.top);
        const r = Math.min(ra.right, rb.right);
        const bo = Math.min(ra.bottom, rb.bottom);
        const iw = Math.max(0, r - l);
        const ih = Math.max(0, bo - t);
        const area = iw * ih;
        if (area < cfg.minOverlapPx2) continue;
        const cx = Math.min(VW - 1, Math.max(0, (l + r) / 2));
        const cy = Math.min(VH - 1, Math.max(0, (t + bo) / 2));
        const inView = cx >= l && cx <= r && cy >= t && cy <= bo;
        const hit = inView ? document.elementFromPoint(cx, cy) : null;
        const inA = !!hit && (hit === a || a.contains(hit));
        const inB = !!hit && (hit === b || b.contains(hit));
        let verdict = "geometry-only"; // 겹치지만 실제로 덮은 것은 제3자 or 판정 불가
        // 서브픽셀 접선(예: 0.6px × 163px = 98px²)은 «덮음»이 아니다 — 가로·세로 양쪽이
        // 최소 변을 넘어야 겹침으로 센다. 이 가드가 없으면 맞닿은 HUD가 매번 오탐이 된다.
        if (iw < cfg.minOverlapEdgePx || ih < cfg.minOverlapEdgePx) verdict = "edge-touch";
        else if (!inView) verdict = "offscreen";
        else if (inA && !inB) verdict = "a-covers-b";
        else if (inB && !inA) verdict = "b-covers-a";
        overlaps.push({
          a: path(a),
          b: path(b),
          area: Math.round(area),
          iw: Math.round(iw * 10) / 10,
          ih: Math.round(ih * 10) / 10,
          at: [Math.round(cx), Math.round(cy)],
          verdict,
          hit: path(hit),
        });
      }
    }
    pairs.push({ a: aSel, b: bSel, why, overlaps });
  }

  // ── S2 스크롤 ──
  const before = { x: window.scrollX, y: window.scrollY };
  window.scrollTo({ top: 9999, left: 0, behavior: "instant" });
  const afterY = window.scrollY;
  window.scrollTo({ top: 0, left: 9999, behavior: "instant" });
  const afterX = window.scrollX;
  window.scrollTo({ top: before.y, left: before.x, behavior: "instant" });
  const scroll = {
    scrollH: de.scrollHeight,
    innerH: VH,
    scrollW: de.scrollWidth,
    innerW: VW,
    bodyH: document.body.scrollHeight,
    afterY,
    afterX,
    overflowY: getComputedStyle(document.body).overflowY,
  };

  // ── S3 터치 타깃 ──
  const OPERABLE = [
    "button",
    "a[href]",
    "select",
    "input:not([type=hidden])",
    "textarea",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="switch"]',
  ].join(",");
  const excluded = { hidden: 0, disabled: 0, outsideDoc: 0, exempt: 0 };
  const small = [];
  let counted = 0;
  const docW = de.scrollWidth;
  const docH = de.scrollHeight;
  for (const el of Array.from(document.querySelectorAll(OPERABLE))) {
    if (cfg.touchExempt.length && cfg.touchExempt.some((s) => el.matches(s))) {
      excluded.exempt++;
      continue;
    }
    if (!shown(el)) {
      excluded.hidden++;
      continue;
    }
    if (el.disabled === true) {
      // `disabled`는 «지금은 조작 대상이 아니다». `aria-disabled`(.is-off)는 클릭이 살아 있으므로 센다.
      excluded.disabled++;
      continue;
    }
    const r = el.getBoundingClientRect();
    const ax = r.left + window.scrollX;
    const ay = r.top + window.scrollY;
    // 문서 밖(스크롤해도 닿지 않는 곳)만 제외한다. **폴드 아래는 제외하지 않는다** —
    // 스크롤이 허용된 화면에서는 손가락이 닿는 자리다.
    if (ax + r.width <= 0 || ay + r.height <= 0 || ax >= docW || ay >= docH) {
      excluded.outsideDoc++;
      continue;
    }
    counted++;
    const side = Math.min(r.width, r.height);
    if (side < cfg.minTouchPx - 0.5)
      small.push({
        path: path(el),
        text: (el.textContent || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 20),
        w: round(r.width),
        h: round(r.height),
        side: round(side),
      });
  }
  small.sort((x, y) => x.side - y.side);

  return {
    url: location.href,
    vw: VW,
    vh: VH,
    coarse: window.matchMedia("(pointer: coarse)").matches,
    protect,
    pairs,
    scroll,
    touch: { counted, excluded, small },
  };
}

// ── 판정 (Node 쪽 한 곳에서만) ──────────────────────────────────────
const judge = (screen, viewport, data) => {
  const checks = [];
  const add = (id, status, detail, extra) => checks.push({ id, status, detail, ...extra });

  // S1
  const s1 = [];
  let s1bad = 0;
  for (const p of data.protect) {
    if (p.visible < p.min) {
      if (p.optional && p.visible === 0) {
        s1.push(`· ${p.sel} — 이 화면/뷰포트에 없음(optional) — 건너뜀`);
        continue;
      }
      s1bad++;
      s1.push(`✗ ${p.sel} — 보이는 요소 ${p.visible}개 (기대 ${p.min}개, DOM ${p.found}개) · ${p.why}`);
      continue;
    }
    for (const it of p.items) {
      if (it.offscreen) {
        s1bad++;
        s1.push(`✗ ${it.path} — 뷰포트 밖 (rect ${it.rect.x},${it.rect.y} ${it.rect.w}×${it.rect.h}) · ${p.why}`);
        continue;
      }
      const centerBlocked = it.blocked.some((b) => b.i === 0);
      if (centerBlocked || it.blocked.length >= SCREEN.blockedFailCount) {
        s1bad++;
        const by = it.blocked[0];
        s1.push(
          `✗ ${it.path} — ${it.blocked.length}/${it.samples}점이 가려짐` +
            `${centerBlocked ? "(중심 포함)" : ""} · 덮은 것 ${by.by} [z=${by.z} ${by.position}] · ${p.why}`,
        );
      } else if (it.blocked.length) {
        s1.push(
          `· ${it.path} — ${it.blocked.length}/${it.samples}점만 가려짐 → 통과(모서리 겹침 허용). 덮은 것 ${it.blocked[0].by}`,
        );
      }
    }
  }
  for (const pr of data.pairs) {
    for (const o of pr.overlaps) {
      if (o.verdict === "a-covers-b" || o.verdict === "b-covers-a") {
        s1bad++;
        const [top, bottom] = o.verdict === "a-covers-b" ? [o.a, o.b] : [o.b, o.a];
        s1.push(
          `✗ 쌍 겹침 — ${top} 이(가) ${bottom} 을(를) 덮는다 ` +
            `(교차 ${o.iw}×${o.ih} = ${o.area}px², 히트 ${o.hit}) · ${pr.why}`,
        );
      } else if (o.verdict === "edge-touch") {
        s1.push(
          `· 쌍 접선 ${o.a} ∩ ${o.b} ${o.iw}×${o.ih}px — 최소 교차 변 ${SCREEN.minOverlapEdgePx}px 미만(서브픽셀) → 통과`,
        );
      } else if (o.verdict === "geometry-only") {
        s1.push(`· 쌍 기하 교차 ${o.a} ∩ ${o.b} ${o.area}px² — 히트 테스트로는 서로 덮지 않음(${o.hit}) → 통과`);
      }
    }
  }
  add("S1", s1bad ? "FAIL" : "PASS",
    s1bad
      ? `가림 ${s1bad}건`
      : `보호 ${data.protect.reduce((a, p) => a + p.items.length, 0)}개 · 쌍 ${data.pairs.length}종 — 실제 가림 없음`,
    { lines: s1 });

  // S2
  const sc = data.scroll;
  const tol = SCREEN.scrollTolPx;
  const vOver = sc.scrollH > sc.innerH + tol;
  const vMoved = sc.afterY !== 0;
  const hOver = sc.scrollW > sc.innerW + tol;
  const hMoved = sc.afterX !== 0;
  const vFail = screen.vscroll === "locked" && (vOver || vMoved);
  const hFail = hOver || hMoved; // 가로는 어느 화면에서도 사고다
  add("S2", vFail || hFail ? "FAIL" : "PASS",
    (vFail
      ? `세로 스크롤 발생 — scrollHeight ${sc.scrollH} > innerHeight ${sc.innerH}${vMoved ? ` · scrollTo(0,9999) 후 scrollY=${sc.afterY}` : ""} (이 화면은 잠겨 있어야 한다)`
      : screen.vscroll === "allow"
        ? `세로 ${vOver || vMoved ? `스크롤 있음(허용) scrollH ${sc.scrollH}/${sc.innerH}` : "스크롤 없음"} — 이 화면은 스크롤이 정상`
        : `세로 잠김 확인 scrollH ${sc.scrollH} ≤ innerH ${sc.innerH} · scrollTo 후 scrollY=0`) +
      (hFail ? ` · **가로** scrollWidth ${sc.scrollW} > innerWidth ${sc.innerW} (scrollX=${sc.afterX})` : ""),
    {});

  // S3
  if (!viewport.coarse) {
    add("S3", "SKIP",
      `터치 타깃은 \`pointer: coarse\`(손가락)에서만 판정한다 — ${viewport.label}는 마우스 전제라 44px 하한을 적용하지 않는다`,
      {});
  } else if (!data.coarse) {
    add("S3", "SKIP", "coarse 에뮬레이션이 페이지에 적용되지 않았다(matchMedia false) — 판정 불가", {});
  } else {
    const t = data.touch;
    const ex = t.excluded;
    add("S3", t.small.length ? "FAIL" : "PASS",
      `${t.counted}개 검사 · 미달 ${t.small.length}개 (하한 ${SCREEN.minTouchPx}px)` +
        ` · 제외 숨김 ${ex.hidden} · 비활성 ${ex.disabled} · 문서 밖 ${ex.outsideDoc} · 면제 ${ex.exempt}`,
      { lines: t.small.map((s) => `✗ ${s.path} ${s.w}×${s.h} (최소변 ${s.side}px) "${s.text}"`) });
  }
  return checks;
};

// ── 실행 ────────────────────────────────────────────────────────────
if (!CHROME) skipOut("Chrome/Chromium을 찾지 못했다 — CHROME_BIN 환경변수로 경로를 지정하라");

const serverBin = join(ROOT, "apps/server/node_modules/.bin/tsx");
const clientBin = join(ROOT, "apps/client/node_modules/.bin/vite");
if (!existsSync(serverBin) || !existsSync(clientBin))
  skipOut("의존성이 설치돼 있지 않다(tsx·vite 실행 파일 없음) — `pnpm install` 후 재실행");

const outDir = OPT.out;
try {
  rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  /* 지난 실행의 크롬 프로필이 남아 있어도 아래 mkdir로 이어간다 */
}
mkdirSync(outDir, { recursive: true });
const profile = join(outDir, "chrome-profile");

const tty = !OPT.json && process.stderr.isTTY;
const step = (s) => {
  if (tty) process.stderr.write(`  … ${s}${" ".repeat(40)}\r`);
};

const serverPort = await freePort();
const clientPort = await freePort();
const cdpPort = await freePort();

step(`서버 기동 :${serverPort}`);
const server = launch(serverBin, ["src/index.ts"], {
  cwd: join(ROOT, "apps/server"),
  env: {
    ...process.env,
    PORT: String(serverPort),
    // 심사자 몫 무료 쿼터 보호 — 이 게이트는 **Gemini를 한 번도 부르지 않는다.**
    // (`process.loadEnvFile()`은 이미 설정된 환경변수를 덮어쓰지 않는다 — 실측 확인)
    AI_NARRATE: "off",
    GEMINI_API_KEY: "",
  },
});
const health = await waitHttp(`http://127.0.0.1:${serverPort}/health`, 40_000, server);
if (!health)
  skipOut(`Colyseus 서버가 40초 안에 :${serverPort}에서 뜨지 않았다`, server.log);

step(`클라 기동 :${clientPort}`);
const client = launch(clientBin, ["--host", "127.0.0.1", "--port", String(clientPort), "--strictPort"], {
  cwd: join(ROOT, "apps/client"),
  env: { ...process.env, VITE_SERVER_URL: `ws://127.0.0.1:${serverPort}` },
});
const BASE = `http://127.0.0.1:${clientPort}`;
if (!(await waitHttp(`${BASE}/`, 40_000, client)))
  skipOut(`Vite 개발 서버가 40초 안에 :${clientPort}에서 뜨지 않았다`, client.log);

step("Chrome 기동");
const chrome = launch(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${cdpPort}`,
    "about:blank",
  ],
  { cwd: ROOT },
);
let version = null;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000 && !version && !chrome.spawnError) {
    try {
      version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
}
if (!version)
  skipOut(
    chrome.spawnError
      ? `Chrome을 실행하지 못했다 — ${chrome.spawnError.message}`
      : "Chrome이 30초 안에 CDP 포트를 열지 않았다",
    chrome.log,
  );

const ws = await wsConnect(version.webSocketDebuggerUrl).catch((e) => {
  skipOut(`CDP 연결 실패 — ${e.message}`, chrome.log);
});
let msgId = 0;
const pending = new Map();
ws.onmessage = (txt) => {
  const m = JSON.parse(txt);
  if (m.id && pending.has(m.id)) {
    const { ok, no } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) no(new Error(`${m.error.message} (${m.error.code})`));
    else ok(m.result);
  }
};
const cmd = (method, params = {}, sessionId) =>
  new Promise((ok, no) => {
    const id = ++msgId;
    const t = setTimeout(() => {
      pending.delete(id);
      no(new Error(`CDP 응답 없음: ${method}`));
    }, 30_000);
    pending.set(id, {
      ok: (r) => {
        clearTimeout(t);
        ok(r);
      },
      no: (e) => {
        clearTimeout(t);
        no(e);
      },
    });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const evalIn = async (sid, expression) => {
  const r = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails)
    throw new Error(`페이지 예외: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const waitFor = async (sid, expr, ms) => {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try {
      v = await evalIn(sid, `!!(${expr})`);
    } catch {
      v = false;
    }
    if (v) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(200);
  }
};

/** 한 화면 × 한 뷰포트를 연다. 반환: { data } 또는 { unreachable } */
const openScreen = async (screen, vp, faultJs) => {
  const { targetId } = await cmd("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  const close = async () => {
    try {
      await cmd("Target.closeTarget", { targetId });
    } catch {
      /* ok */
    }
  };
  try {
    await cmd("Page.enable", {}, sid);
    await cmd("Runtime.enable", {}, sid);
    await cmd(
      "Emulation.setDeviceMetricsOverride",
      {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.dsf,
        mobile: vp.mobile,
        screenWidth: vp.width,
        screenHeight: vp.height,
        screenOrientation: vp.mobile
          ? { angle: 0, type: "portraitPrimary" }
          : { angle: 0, type: "landscapePrimary" },
      },
      sid,
    );
    if (vp.coarse) {
      // ⚠️ 이 저장소의 D-패드·44px 하한은 전부 `@media (pointer: coarse)` 안에 있다.
      //    이걸 켜지 않으면 **심사자가 보는 화면과 다른 화면**을 재게 된다.
      await cmd("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sid);
      await cmd("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" }, sid);
      await cmd(
        "Emulation.setEmulatedMedia",
        {
          features: [
            { name: "pointer", value: "coarse" },
            { name: "any-pointer", value: "coarse" },
            { name: "hover", value: "none" },
            { name: "any-hover", value: "none" },
          ],
        },
        sid,
      );
    }
    await cmd("Page.navigate", { url: BASE + screen.url }, sid);
    if (!(await waitFor(sid, "document.readyState === 'complete'", SCREEN.readyTimeoutMs)))
      return { unreachable: "문서 로드가 끝나지 않았다", close };

    for (const s of screen.steps ?? []) {
      if (s.waitFor) {
        if (!(await waitFor(sid, s.waitFor, SCREEN.readyTimeoutMs)))
          return { unreachable: `대기 조건 미충족: ${s.waitFor}`, close };
      }
      if (s.click) {
        if (!(await waitFor(sid, `document.querySelector(${JSON.stringify(s.click)})`, SCREEN.readyTimeoutMs)))
          return { unreachable: `클릭 대상 없음: ${s.click}`, close };
        await evalIn(sid, `document.querySelector(${JSON.stringify(s.click)}).click()`);
      }
    }
    if (!(await waitFor(sid, screen.ready, SCREEN.readyTimeoutMs)))
      return { unreachable: `준비 조건 미충족: ${screen.ready}`, close };
    await sleep(SCREEN.settleMs);

    // 캡처는 **뷰포트만** 찍는다. 전체 페이지 캡처는 밀려 올라간 화면을 정상으로 렌더한다.
    try {
      const shot = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sid);
      writeFileSync(join(outDir, `${screen.id}-${vp.id}.png`), Buffer.from(shot.data, "base64"));
    } catch {
      /* 캡처 실패는 판정에 영향 없음 */
    }

    if (faultJs) await evalIn(sid, faultJs);

    const cfg = {
      protect: screen.protect,
      pairs: screen.pairs,
      touchExempt: screen.touchExempt ?? [],
      minTouchPx: SCREEN.minTouchPx,
      sampleInsetPct: SCREEN.sampleInsetPct,
      minOverlapPx2: SCREEN.minOverlapPx2,
      minOverlapEdgePx: SCREEN.minOverlapEdgePx,
    };
    const data = await evalIn(sid, `(${pageProbe.toString()})(${JSON.stringify(cfg)})`);
    return { data, close };
  } catch (e) {
    return { unreachable: `실행 오류 — ${e.message}`, close };
  }
};

const screens = SCREEN.screens.filter((s) => !OPT.only.length || OPT.only.includes(s.id));
const viewports = SCREEN.viewports.filter((v) => !OPT.viewport || v.id === OPT.viewport);
if (!screens.length) skipOut(`--only=${OPT.only.join(",")} 에 해당하는 화면이 없다`);

// ── 음성 테스트(--self-test) ────────────────────────────────────────
// 전건 PASS 리포트는 «아무것도 안 잡는 검사기»와 구분되지 않는다.
// 그래서 **일부러 깨뜨려** 게이트가 FAIL을 내는지 확인한다. 앱 코드는 건드리지 않는다 —
// 결함은 CDP로 **런타임에만** 주입되고 탭을 닫으면 사라진다(원상복구가 필요 없다).
// `signature` = 결함이 만든 **바로 그 위반**의 지문.
// 상태만 보면 안 된다 — S3는 지금 코드에서 이미 FAIL이라 «FAIL이 나왔다»로는
// 게이트가 내 결함을 잡은 것인지 원래 있던 위반을 다시 센 것인지 구분되지 않는다.
// 그래서 «기준선에 없던 지문이 새로 나타났는가»로 판정한다.
const FAULTS = [
  {
    id: "F1-겹침",
    expect: "S1",
    signature: /zc-fault-overlay/,
    why: "액션 바 위에 불투명 오버레이를 덮는다 — 07-28 턴 배너 사고의 재현",
    js: `(() => {
      const r = document.querySelector('.hud-ctrl').getBoundingClientRect();
      const d = document.createElement('div');
      d.id = 'zc-fault-overlay';
      d.style.cssText = 'position:fixed;z-index:99999;background:rgba(255,0,0,.5);' +
        'left:' + (r.left-4) + 'px;top:' + (r.top-4) + 'px;width:' + (r.width+8) + 'px;height:' + (r.height+8) + 'px';
      document.body.appendChild(d);
      return 'injected';
    })()`,
  },
  {
    id: "F2-무해한겹침",
    expect: "S1",
    signature: /zc-fault-ghost/,
    shouldPass: true, // **오탐 방지 시험** — 이건 잡히면 안 된다
    why: "같은 자리에 `pointer-events:none` 투명 래퍼를 덮는다 — 기하만 보면 오탐, 히트 테스트는 통과해야 한다",
    js: `(() => {
      const r = document.querySelector('.hud-ctrl').getBoundingClientRect();
      const d = document.createElement('div');
      d.id = 'zc-fault-ghost';
      d.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;background:transparent;' +
        'left:' + (r.left-4) + 'px;top:' + (r.top-4) + 'px;width:' + (r.width+8) + 'px;height:' + (r.height+8) + 'px';
      document.body.appendChild(d);
      return 'injected';
    })()`,
  },
  {
    id: "F3-세로스크롤",
    expect: "S2",
    signature: /세로 스크롤 발생/,
    why: "게임 화면의 스크롤 잠금을 풀고 문서를 뷰포트보다 길게 만든다 — 화면이 통째로 밀려 올라간 사고",
    js: `(() => {
      document.body.classList.remove('no-scroll');
      document.body.style.overflow = 'visible';
      document.body.style.height = 'auto';
      const d = document.createElement('div');
      d.id = 'zc-fault-tall';
      d.style.cssText = 'height:1200px;width:1px';
      document.body.appendChild(d);
      return 'injected';
    })()`,
  },
  {
    id: "F4-작은버튼",
    expect: "S3",
    signature: /#endTurn/,
    why: "[턴 종료] 버튼을 20×20으로 줄인다 — 44px 하한 미달",
    js: `(() => {
      const b = document.getElementById('endTurn');
      b.style.cssText = 'min-height:0;height:20px;width:20px;padding:0;font-size:8px';
      return 'injected';
    })()`,
  },
];

if (OPT.selfTest) {
  const screen = SCREEN.screens.find((s) => s.id === "game");
  const vp = SCREEN.viewports.find((v) => v.id === "phone");
  const rows = [];
  // 기준선 — 결함 없이 통과하는가(통과해야 «FAIL이 결함 때문»이라고 말할 수 있다)
  const base = await openScreen(screen, vp, null);
  if (base.unreachable) {
    await base.close?.();
    skipOut(`음성 테스트 기준선 도달 실패 — ${base.unreachable}`, client.log);
  }
  const baseChecks = judge(screen, vp, base.data);
  await base.close();
  rows.push({
    id: "기준선(무결함)",
    expect: "-",
    got: baseChecks.map((c) => `${c.id}:${c.status}`).join(" "),
    ok: true,
    note: "결함 주입 전 상태. 여기서 이미 FAIL이면 아래 판정은 결함 때문이 아니다",
    checks: baseChecks,
  });
  /** 한 검사의 판정 문장 전부(요약 + 위반 줄). 지문 대조용. */
  const violations = (checks, id) => {
    const c = checks.find((x) => x.id === id);
    if (!c || c.status !== "FAIL") return [];
    return [c.detail, ...(c.lines ?? []).filter((l) => l.startsWith("✗"))];
  };

  for (const f of FAULTS) {
    step(`음성 테스트 ${f.id}`);
    const r = await openScreen(screen, vp, f.js);
    if (r.unreachable) {
      await r.close?.();
      rows.push({ id: f.id, expect: f.expect, got: "도달 실패", ok: false, note: r.unreachable });
      continue;
    }
    const checks = judge(screen, vp, r.data);
    await r.close();
    const target = checks.find((c) => c.id === f.expect);
    // **지문으로 판정한다.** 상태(FAIL)만 보면 «원래 있던 위반»과 «내가 주입한 결함»이
    // 구분되지 않는다(지금 S3는 결함 없이도 FAIL이다).
    const hits = violations(checks, f.expect).filter((l) => f.signature.test(l));
    const baseHits = violations(baseChecks, f.expect).filter((l) => f.signature.test(l));
    const caught = hits.length > 0 && baseHits.length === 0;
    const ok = f.shouldPass ? hits.length === 0 : caught;
    rows.push({
      id: f.id,
      expect: f.shouldPass ? `${f.expect} 무반응` : `${f.expect} 신규 FAIL`,
      got: `${f.expect}:${target?.status} · 지문 ${hits.length}건(기준선 ${baseHits.length}건)`,
      ok,
      note: f.why,
      detail: hits.slice(0, 3),
    });
  }

  const bad = rows.filter((r) => !r.ok);
  if (OPT.json) {
    console.log(JSON.stringify({ mode: "self-test", status: bad.length ? "FAIL" : "PASS", rows }, null, 2));
  } else {
    if (tty) process.stderr.write(`${" ".repeat(70)}\r`);
    console.log(`\n══ 화면 게이트 · 음성 테스트(일부러 깨뜨려 본다) ${"═".repeat(24)}`);
    console.log("   대상: 게임 뷰1 · 폰 390×844 · 결함은 런타임 주입이라 앱 코드는 그대로다\n");
    for (const r of rows) {
      console.log(`  ${r.ok ? "OK  " : "MISS"}  ${r.id.padEnd(16)} 기대 ${String(r.expect).padEnd(14)} 실제 ${r.got}`);
      console.log(`          ↳ ${r.note}`);
      for (const d of r.detail ?? []) console.log(`            ${d}`);
    }
    console.log(`\n${"═".repeat(72)}`);
    console.log(
      bad.length
        ? `  결과: FAIL — 게이트가 놓친 결함: [${bad.map((b) => b.id).join(", ")}]`
        : "  결과: PASS — 주입한 결함을 전부 잡았고, 무해한 겹침은 오탐하지 않았다.",
    );
    console.log("");
  }
  process.exit(bad.length ? 1 : 0);
}

// ── 본 실행 ─────────────────────────────────────────────────────────
const results = [];
for (const vp of viewports) {
  for (const screen of screens) {
    step(`${screen.label} · ${vp.label}`);
    const t0 = Date.now();
    const r = await openScreen(screen, vp, null);
    const ms = Date.now() - t0;
    if (r.unreachable) {
      await r.close?.();
      results.push({ screen: screen.id, label: screen.label, vp: vp.id, vpLabel: vp.label, ms, unreachable: r.unreachable });
      continue;
    }
    const checks = judge(screen, vp, r.data);
    await r.close();
    results.push({
      screen: screen.id,
      label: screen.label,
      vp: vp.id,
      vpLabel: vp.label,
      ms,
      checks,
      shot: join(outDir, `${screen.id}-${vp.id}.png`),
    });
  }
}
if (tty) process.stderr.write(`${" ".repeat(70)}\r`);

// Gemini 실호출 0 확인 — 이 게이트가 심사자 몫 쿼터를 먹지 않았다는 근거.
let llmCalls = null;
try {
  const h = JSON.parse(await (await fetch(`http://127.0.0.1:${serverPort}/health`)).text());
  llmCalls = h.llmCalls;
} catch {
  /* 서버가 이미 내려갔다 */
}

try {
  await cmd("Browser.close");
} catch {
  /* 강제 종료는 cleanup이 한다 */
}

const allChecks = results.flatMap((r) => r.checks ?? []);
const failed = allChecks.filter((c) => c.status === "FAIL");
const unreachable = results.filter((r) => r.unreachable);
// 도달 못 한 화면이 있으면 «전건 통과»라고 말할 수 없다 → FAIL이 아니라 SKIP(3)으로 끝낸다.
const exitCode = failed.length ? 1 : unreachable.length ? 3 : 0;

if (OPT.json) {
  console.log(
    JSON.stringify(
      {
        status: exitCode === 0 ? "PASS" : exitCode === 1 ? "FAIL" : "SKIP",
        mode: "full",
        geminiCalls: llmCalls,
        ports: { server: serverPort, client: clientPort, cdp: cdpPort },
        chrome: version.Browser,
        outDir,
        counts: {
          screens: results.length,
          PASS: allChecks.filter((c) => c.status === "PASS").length,
          FAIL: failed.length,
          SKIP: allChecks.filter((c) => c.status === "SKIP").length,
          unreachable: unreachable.length,
        },
        results,
        unmeasured: SCREEN.unreachable,
        humanRequired: SCREEN.human.map(([item, why]) => ({ item, why })),
        note:
          "자동 판정은 «화면이 좋다»를 증명하지 않는다. humanRequired 와 unmeasured 는 사람이 봐야 한다.",
        exitCode,
      },
      null,
      2,
    ),
  );
  process.exit(exitCode);
}

// ── 출력 ────────────────────────────────────────────────────────────
console.log(`\n══ 화면 게이트 ${"═".repeat(52)}`);
console.log(
  `   ${version.Browser} · 서버 :${serverPort} · 클라 :${clientPort} · Gemini 실호출 ${llmCalls ?? "?"}건`,
);
console.log(`   캡처(뷰포트만) ${outDir}\n`);

for (const r of results) {
  if (r.unreachable) {
    console.log(`  SKIP  ${r.label} · ${r.vpLabel}`);
    console.log(`         ↳ 도달 실패 — ${r.unreachable}`);
    continue;
  }
  const bad = r.checks.filter((c) => c.status === "FAIL");
  console.log(
    `  ${bad.length ? "FAIL" : "PASS"}  ${r.label} · ${r.vpLabel}  (${(r.ms / 1000).toFixed(1)}s)`,
  );
  for (const c of r.checks) {
    if (c.status === "PASS" && !OPT.verbose) continue;
    console.log(`         ${c.status === "FAIL" ? "✗" : c.status === "SKIP" ? "-" : "·"} ${c.id}  ${c.detail}`);
    for (const l of c.lines ?? []) {
      if (!OPT.verbose && !l.startsWith("✗")) continue;
      console.log(`             ${l}`);
    }
  }
}

console.log(`\n${"─".repeat(72)}`);
console.log("  § 측정하지 못한 화면 — 조용히 빼지 않는다");
for (const u of SCREEN.unreachable) console.log(`      □ ${u.label}\n          ${u.why}`);

console.log(`\n${"─".repeat(72)}`);
console.log("  § 사람 확인 — 아래는 이 게이트가 **판정하지 못한다.** 캡처를 열어 눈으로 봐라.");
console.log(`    PNG: ${outDir}`);
for (const [k, v] of SCREEN.human) console.log(`      □ ${k.padEnd(16)} ${v}`);

console.log(`\n${"═".repeat(72)}`);
console.log(
  `  PASS ${allChecks.filter((c) => c.status === "PASS").length} · FAIL ${failed.length} · ` +
    `SKIP ${allChecks.filter((c) => c.status === "SKIP").length} · 도달 실패 ${unreachable.length}`,
);
console.log(
  exitCode === 0
    ? "  결과: PASS — 기계가 잴 수 있는 항목은 전건 통과. **위 § 사람 확인은 아직 남아 있다.**"
    : exitCode === 3
      ? "  결과: SKIP — 도달하지 못한 화면이 있다. 통과가 아니라 **미측정**이다."
      : `  결과: FAIL — [${[...new Set(results.filter((r) => r.checks?.some((c) => c.status === "FAIL")).map((r) => `${r.screen}/${r.vp}`))].join(", ")}]`,
);
console.log("  음성 테스트: node scripts/gate-screen.mjs --self-test  (게이트가 정말 잡는지 확인)");
console.log("");

if (!OPT.keep) {
  // 캡처는 사람이 볼 것이므로 남긴다. 크롬 프로필만 지운다.
  // (Chrome이 종료 직후에도 프로필을 쓰고 있을 수 있다 — 못 지워도 판정과 무관하다.)
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* 다음 실행이 어차피 지운다 */
  }
}
process.exit(exitCode);
