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
 *   S4 뷰 간 HUD   뷰2·3·4로 **실제 전환**한 뒤 뷰1과 HUD 상자를 대조한다.
 *                  4뷰는 캔버스만 다르고 HUD는 같은 DOM 한 벌이라는 것이 **가설**이고,
 *                  이 검사가 그 가설을 실측으로 확인한다(어긋나면 그 자체가 결함).
 *                  캔버스 픽셀은 재지 않는다 — 헤드리스 WebGL은 실기 GPU가 아니다.
 *
 * 측정 대상 화면
 *   랜딩 · 대기실 · 게임 뷰1 · **게임 뷰2·3·4(HUD만)** · 안내 카드 · 고발 모달
 *   · **결과 화면 4행**(❌ 고발 실패 / 🏅 최후의 1인 / 🎉 사건 해결 / 🔍 사건 종결)
 *
 *   결과 화면은 **6개 탭으로 실판을 돌려** 도달한다(gate.config.mjs `SCREEN.result`).
 *   좌석을 전부 사람으로 채우면 손패 합집합이 «정답 아닌 카드 전부»가 되어
 *   «반드시 오답»(남의 패)과 «반드시 정답»(소거의 여집합)이 **규칙상** 정해진다 —
 *   확률이 아니라 **실패가 불가능**하다. 서버에는 아무것도 추가하지 않았다.
 *
 * ⚠️ 이 게이트는 **화면이 좋다고 증명하지 않는다.** 미(美)·정렬·읽힘은 기계가 못 잰다.
 *    마지막에 §사람 확인을 항상 인쇄한다(verify-print.mjs와 같은 규약). 그 목록을 지우지 마라.
 *
 * 실행
 *   node scripts/gate-screen.mjs                    # 기본 대상(실측 ≈40s)
 *   node scripts/gate-screen.mjs --full             # 기본에서 뺀 것까지 전부(실측 ≈53s)
 *   node scripts/gate-screen.mjs --json
 *   node scripts/gate-screen.mjs --only=game,landing
 *   node scripts/gate-screen.mjs --only=result      # 결과 화면 6인 실판만(≈18s)
 *   node scripts/gate-screen.mjs --viewport=phone
 *   node scripts/gate-screen.mjs --keep             # 캡처 PNG를 남긴다(사람 확인용)
 *   node scripts/gate-screen.mjs --self-test        # **음성 테스트** — 일부러 깨뜨려 게이트가 잡는지 본다
 *
 * ⚠️ 기본에서 뺀 것은 **항상 SKIP + 사유로 인쇄된다**(§기본 대상에서 뺀 화면).
 *    조용히 빠지는 것은 없다 — 은폐된 미측정이 회귀보다 위험하다.
 *
 * 자원: 서버 1개 · Vite 1개 · Chrome 1개를 **끝까지 재사용**한다(화면마다 탭만 새로 연다).
 *       화면별 소요는 §소요에 인쇄된다.
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
  /** 기본에서 뺀 화면까지 전부 돈다. 뺀 것은 기본 모드에서도 **SKIP + 사유로 인쇄**된다. */
  full: has("--full"),
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
    // 뷰2·3은 three.js = **WebGL 컨텍스트가 있어야 전환 자체가 성립한다.**
    // `--disable-gpu` 헤드리스에서 Chrome은 SwiftShader(소프트웨어 GL)로 떨어지는데,
    // 최근 빌드는 이 경로를 기본 차단한다("WebGL: Unavailable ... unsafe SwiftShader").
    // 그러면 `new IsoView(...)`가 컨텍스트를 못 얻어 뷰 전환이 실패하고, 게이트는
    // 그것을 «앱 결함»이 아니라 **환경 결함**으로 잘못 보고하게 된다.
    // ⚠️ 이 플래그로 켜지는 것은 **소프트웨어 래스터라이저**다 — 그래서 이 게이트는
    //    캔버스 픽셀을 판정하지 않고 HUD(DOM)만 판정한다(gate.config.mjs `viewScreen` 주석).
    "--enable-unsafe-swiftshader",
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

/**
 * 탭 하나를 연다. `vp`가 `null`이면 **에뮬레이션을 걸지 않는다** —
 * 결과 흐름의 조력 탭(계측하지 않는 5좌석)은 뷰포트가 판정에 쓰이지 않으므로
 * 여기에 시간을 쓰지 않는다(6탭 전부 에뮬레이션하면 그만큼 느려진다).
 */
const newTab = async (vp) => {
  const { targetId } = await cmd("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  const close = async () => {
    try {
      await cmd("Target.closeTarget", { targetId });
    } catch {
      /* ok */
    }
  };
  await cmd("Page.enable", {}, sid);
  await cmd("Runtime.enable", {}, sid);
  if (vp) {
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
  }
  return { targetId, sid, vp, close };
};

/** 계측 설정(pageProbe 인자) — 화면 정의에서 그대로 뽑는다. */
const probeCfg = (screen) => ({
  protect: screen.protect,
  pairs: screen.pairs,
  touchExempt: screen.touchExempt ?? [],
  minTouchPx: SCREEN.minTouchPx,
  sampleInsetPct: SCREEN.sampleInsetPct,
  minOverlapPx2: SCREEN.minOverlapPx2,
  minOverlapEdgePx: SCREEN.minOverlapEdgePx,
});

/** 한 탭에서 계측 + 캡처. */
const probeTab = async (sid, screen, shotName) => {
  try {
    const shot = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sid);
    writeFileSync(join(outDir, `${shotName}.png`), Buffer.from(shot.data, "base64"));
  } catch {
    /* 캡처 실패는 판정에 영향 없음 */
  }
  return evalIn(sid, `(${pageProbe.toString()})(${JSON.stringify(probeCfg(screen))})`);
};

/** 한 화면 × 한 뷰포트를 연다. 반환: { data } / { unreachable } / { skip } */
const openScreen = async (screen, vp, faultJs) => {
  const { sid, close } = await newTab(vp);
  try {
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

    // ── 뷰 전환(뷰2·3·4) ──
    // 전환은 **실제 UI 조작**으로만 한다: 좌하단 드롭다운의 n번째 항목을 클릭한다.
    // 전환 실패(청크 로드 실패·WebGL 컨텍스트 없음)는 **FAIL이 아니라 SKIP**이다 —
    // 그건 앱 화면의 결함이 아니라 «이 환경에서 재지 못했다»이기 때문이다.
    if (typeof screen.view === "number") {
      const li = `document.querySelectorAll('#viewList li')[${screen.view}]`;
      const n = await evalIn(sid, `document.querySelectorAll('#viewList li').length`);
      if (n <= screen.view)
        return { skip: `뷰 드롭다운 항목이 ${n}개뿐이라 #${screen.view}를 못 고른다`, close };
      const want = String(await evalIn(sid, `${li}.textContent`));
      await evalIn(sid, `${li}.click()`);
      // 전환 완료의 정의: ① 드롭다운 항목에 `.active`가 붙고(applyStage가 마지막에 한다)
      //                  ② 버튼 라벨이 그 뷰가 되고 ③ 청크 로딩 오버레이가 닫혔다.
      // 청크를 못 받으면 `setStage`가 **뷰1로 되돌린다** → ①이 영원히 붙지 않는다 → SKIP.
      const ok = await waitFor(
        sid,
        `${li}.classList.contains('active')` +
          ` && document.getElementById('viewToggle').textContent.indexOf(${JSON.stringify(want)}) === 0` +
          " && document.getElementById('viewLoad').classList.contains('hidden')",
        SCREEN.readyTimeoutMs,
      );
      if (!ok) {
        const now = await evalIn(sid, "document.getElementById('viewToggle').textContent").catch(() => "?");
        return {
          skip:
            `«${want}»로 전환되지 않았다(현재 «${now}»). 청크 로드 실패 또는 WebGL 컨텍스트 없음 — ` +
            "헤드리스 WebGL은 `--enable-unsafe-swiftshader`가 필요하다(이 게이트는 이미 켠다)",
          close,
        };
      }
      await sleep(SCREEN.settleMs);
    }

    if (faultJs) await evalIn(sid, faultJs);

    // 캡처는 **뷰포트만** 찍는다. 전체 페이지 캡처는 밀려 올라간 화면을 정상으로 렌더한다.
    const data = await probeTab(sid, screen, `${screen.id}-${vp.id}`);
    return { data, close };
  } catch (e) {
    return { unreachable: `실행 오류 — ${e.message}`, close };
  }
};

// ── 결과 화면(종료 오버레이) — 6인 실판을 정상 조작해서 도달한다 ──────────
//
// **실패 확률이 0인 이유**(gate.config.mjs `SCREEN.result` 주석의 코드 쪽 짝):
//   덱 = 참가자 용의자 6 + 장물 6 + 장소 9 − 정답 3 = 18장, 6인 × 3장으로 딱 나뉜다.
//   → 어떤 카드가 **누군가의 손에 있다**는 것은 «그 카드는 정답이 아니다»와 동치다.
//   → 남의 손패 카드로 고발하면 **반드시 오답**(확률 0이 아니라 규칙상 불가능).
//   → 6명의 손패 합집합의 여집합이 **정답 봉투**(각 카테고리에 정확히 1장) → 반드시 정답.
// 두 사실 모두 «클라가 아는 정보»(자기 손패 = 서버가 개별 전송한 것)만으로 나온다.
// 서버에 새 경로도, 테스트 플래그도 만들지 않았다.

/** 탭의 현재 상태 한 줌 — DOM만 읽는다(내부 상태에 손대지 않는다). */
const TAB_STATE_JS = `(() => {
  const g = (id) => document.getElementById(id);
  const gs = g('gameScreen'), end = g('endOverlay'), acc = g('accuse'), ti = g('turnInfo');
  return {
    inGame: !!gs && !gs.classList.contains('hidden'),
    turnShown: !!ti && !ti.classList.contains('hidden'),
    ended: !!end && !end.classList.contains('hidden'),
    endTitle: g('endTitle') ? (g('endTitle').textContent || '') : '',
    endSub: g('endSub') ? (g('endSub').textContent || '') : '',
    myTurn: !!acc && acc.getAttribute('aria-disabled') === 'false',
    modal: !!document.querySelector('.overlay .modal select'),
  };
})()`;

/** 고발 모달의 select 3개에서 «전체 후보»와 «내 패(=disabled)»를 읽는다. */
const READ_PICKER_JS = `(() => {
  const s = Array.prototype.slice.call(document.querySelectorAll('.overlay .modal select'));
  if (s.length !== 3) return null;
  return s.map((sel) => ({
    all: Array.prototype.map.call(sel.options, (o) => o.value),
    mine: Array.prototype.filter.call(sel.options, (o) => o.disabled).map((o) => o.value),
  }));
})()`;

const CANCEL_JS = `(() => {
  const b = document.querySelector('.overlay .modal .actions button.ghost');
  if (!b) return false;
  b.click();
  return true;
})()`;

/**
 * 고발 실행. **잠긴 옵션(내 패)을 고르면 스스로 실패한다** — 이 가드가
 * "UI 잠금을 우회하지 않았다"의 기계적 증명이다(§6.2 잠금은 그대로 살아 있다).
 */
const accuseJs = (triple) => `(() => {
  const sels = Array.prototype.slice.call(document.querySelectorAll('.overlay .modal select'));
  if (sels.length !== 3) return { ok: false, why: 'select가 3개가 아니다(' + sels.length + ')' };
  const want = ${JSON.stringify([triple.suspect, triple.weapon, triple.room])};
  for (let i = 0; i < 3; i++) {
    sels[i].value = want[i];
    if (sels[i].value !== want[i]) return { ok: false, why: 'select[' + i + '] 값 지정 실패: ' + want[i] };
    const o = sels[i].options[sels[i].selectedIndex];
    if (o.disabled) return { ok: false, why: 'select[' + i + ']에서 잠긴 옵션(내 패)을 골랐다: ' + want[i] };
  }
  const b = document.querySelector('.overlay .modal .actions button.danger');
  if (!b) return { ok: false, why: '[고발한다] 버튼이 없다' };
  b.click();
  return { ok: true, picked: want };
})()`;

const clickJs = (sel) => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return false;
  e.click();
  return true;
})()`;

/** 결과 흐름 전체. 실패는 전부 `{ skip: 사유 }`로 돌려준다(FAIL이 아니다). */
const runResultFlow = async () => {
  const R = SCREEN.result;
  const vpOf = (id) => (id ? SCREEN.viewports.find((v) => v.id === id) ?? null : null);
  const tabs = [];
  const notes = [];
  const t0 = Date.now();
  const bail = async (why) => {
    for (const t of tabs) await t.close();
    return { skip: why, ms: Date.now() - t0, notes };
  };

  for (const spec of R.tabs) {
    const t = await newTab(vpOf(spec.vp));
    tabs.push({ ...t, id: spec.id, role: spec.role, vpId: spec.vp });
  }
  const byId = (id) => tabs.find((t) => t.id === id);
  const host = tabs[0];

  // ① 방장 탭이 **비공개 방**을 만든다(기존 랜딩 UI 그대로).
  step("결과 흐름 · 방 만들기");
  await cmd("Page.navigate", { url: `${BASE}/?demo=1` }, host.sid);
  // `readyState === 'complete'` 까지 기다린다 — 버튼 **DOM**은 정적 HTML에 이미 있지만
  // `onclick`은 모듈 스크립트가 실행돼야 붙는다. 그 전에 누르면 **아무 일도 일어나지 않는다**.
  if (!(await waitFor(host.sid, "document.readyState === 'complete' && !!document.getElementById('createBtn')", SCREEN.readyTimeoutMs)))
    return bail("랜딩이 뜨지 않았다");
  await evalIn(host.sid, clickJs('#visSeg .seg-btn[data-pub="0"]'));
  await evalIn(host.sid, clickJs("#createBtn"));
  if (!(await waitFor(host.sid, "!document.getElementById('lobby').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
    return bail("대기실에 들어가지 못했다(방 생성 실패)");
  const code = String(await evalIn(host.sid, "(location.pathname.match(/\\/room\\/([^/?]+)/) || [])[1] || ''"));
  if (!code) return bail("초대 코드를 읽지 못했다");

  // ② 나머지 5탭이 **초대 코드**로 참가한다.
  step(`결과 흐름 · 5탭 참가 (${code})`);
  for (const t of tabs.slice(1)) {
    await cmd("Page.navigate", { url: `${BASE}/?room=${encodeURIComponent(code)}&demo=1` }, t.sid);
    if (!(await waitFor(t.sid, "document.readyState === 'complete' && !!document.getElementById('joinBtn')", SCREEN.readyTimeoutMs)))
      return bail(`탭 ${t.id}: 랜딩이 뜨지 않았다`);
    await evalIn(t.sid, clickJs("#joinBtn"));
    if (!(await waitFor(t.sid, "!document.getElementById('lobby').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
      return bail(`탭 ${t.id}: 대기실 참가 실패`);
  }
  if (!(await waitFor(host.sid, `document.getElementById('playerCount').textContent === '${R.seats}'`, SCREEN.readyTimeoutMs)))
    return bail(`좌석 ${R.seats}개가 사람으로 차지 않았다 — 서버가 NPC를 채우면 «전원 사람» 전제가 깨진다`);

  // ③ 잔치 시작. 이 시점에 빈 자리가 없으므로 **NPC는 한 명도 들어오지 않는다.**
  step("결과 흐름 · 잔치 시작");
  await evalIn(host.sid, clickJs("#startBtn"));
  for (const t of tabs)
    if (!(await waitFor(t.sid, "!document.getElementById('gameScreen').classList.contains('hidden') && !document.getElementById('turnInfo').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
      return bail(`탭 ${t.id}: 게임 화면에 들어가지 못했다`);

  /** 지금 차례인 탭을 찾는다(없으면 null). */
  const activeTab = async () => {
    const st = await Promise.all(tabs.map((t) => evalIn(t.sid, TAB_STATE_JS).catch(() => null)));
    for (let i = 0; i < tabs.length; i++) if (st[i]?.ended) return { ended: true, states: st };
    const i = st.findIndex((s) => s?.myTurn);
    return { tab: i < 0 ? null : tabs[i], states: st };
  };
  /** 행동 뒤 «차례가 넘어갔다»를 서버 상태로 확인한다(클라 낙관 갱신에 기대지 않는다). */
  const waitTurnLeft = (t) =>
    waitFor(t.sid, "document.getElementById('accuse').getAttribute('aria-disabled') !== 'false'", 8000);

  /** 한 바퀴 돌며 6탭의 손패를 읽는다(고발 모달을 열고 **[취소]** — 판을 건드리지 않는다). */
  const readAllHands = async (game) => {
    const hands = new Map();
    for (let i = 0; i < R.maxTurns && hands.size < tabs.length; i++) {
      const a = await activeTab();
      if (a.ended) return { skip: `${game}판: 손패를 다 읽기 전에 판이 끝났다` };
      if (!a.tab) {
        await sleep(120);
        continue;
      }
      const t = a.tab;
      if (!hands.has(t.id)) {
        await evalIn(t.sid, clickJs("#accuse"));
        if (!(await waitFor(t.sid, "!!document.querySelector('.overlay .modal select')", 8000)))
          return { skip: `${game}판: 탭 ${t.id}의 고발 모달이 열리지 않았다` };
        const cats = await evalIn(t.sid, READ_PICKER_JS);
        await evalIn(t.sid, CANCEL_JS);
        if (!cats) return { skip: `${game}판: 탭 ${t.id}의 고발 모달 select 3개를 읽지 못했다` };
        hands.set(t.id, cats);
      }
      await evalIn(t.sid, clickJs("#endTurn"));
      if (!(await waitTurnLeft(t))) return { skip: `${game}판: 탭 ${t.id}의 [턴 종료]가 반영되지 않았다` };
    }
    if (hands.size < tabs.length) return { skip: `${game}판: ${R.maxTurns}턴 안에 6탭 손패를 못 읽었다` };
    return { hands };
  };

  /**
   * 손패 합집합에서 **정답 봉투**를 소거로 구한다. 각 카테고리에 정확히 1장이 남아야 한다 —
   * 안 남거나 둘 이상 남으면 «전원 사람 6인 · 공통 단서 0» 전제가 깨진 것이므로 SKIP.
   */
  const solve = (hands, game) => {
    const cats = [...hands.values()];
    const all = cats[0].map((c) => c.all);
    const known = all.map((_, i) => new Set(cats.flatMap((c) => c[i].mine)));
    const left = all.map((vals, i) => vals.filter((v) => !known[i].has(v)));
    const names = ["용의자", "훔친 것", "장소"];
    for (let i = 0; i < 3; i++)
      if (left[i].length !== 1)
        return {
          skip:
            `${game}판: 소거 후 ${names[i]} 후보가 ${left[i].length}개 남았다(1개여야 한다) — ` +
            "좌석에 NPC가 섞였거나 공통 단서가 나갔다는 뜻이라 «반드시 정답/오답» 전제가 깨진다",
        };
    return {
      solution: { suspect: left[0][0], weapon: left[1][0], room: left[2][0] },
      known,
      all,
    };
  };

  /** 탭 T가 «반드시 틀리는» 조합 — 세 칸 모두 **남의 손패**에 있는 카드로 채운다. */
  const wrongFor = (hands, known, tabId) => {
    const mine = hands.get(tabId).map((c) => new Set(c.mine));
    const pick = (i) => [...known[i]].find((v) => !mine[i].has(v));
    const s = pick(0), w = pick(1), r = pick(2);
    if (!s || !w || !r) return null;
    return { suspect: s, weapon: w, room: r };
  };

  const doAccuse = async (t, triple, why) => {
    await evalIn(t.sid, clickJs("#accuse"));
    if (!(await waitFor(t.sid, "!!document.querySelector('.overlay .modal select')", 8000)))
      return `탭 ${t.id}: 고발 모달이 열리지 않았다`;
    const r = await evalIn(t.sid, accuseJs(triple));
    if (!r?.ok) return `탭 ${t.id}: 고발 실행 실패 — ${r?.why ?? "?"} (${why})`;
    notes.push(`${t.id} 고발 [${triple.suspect} · ${triple.weapon} · ${triple.room}] — ${why}`);
    return null;
  };

  /** 종료까지 몰고 간다. `mode`: "survivor"(5명 오답 탈락) / "win"(keeper가 정답 고발). */
  const driveToEnd = async (hands, solved, mode, game) => {
    for (let i = 0; i < R.maxTurns; i++) {
      const a = await activeTab();
      if (a.ended) return null;
      if (!a.tab) {
        await sleep(120);
        continue;
      }
      const t = a.tab;
      const keeper = t.role === "keeper";
      if (mode === "survivor" ? keeper : !keeper) {
        await evalIn(t.sid, clickJs("#endTurn"));
        if (!(await waitTurnLeft(t))) return `${game}판: 탭 ${t.id}의 [턴 종료]가 반영되지 않았다`;
        continue;
      }
      const triple =
        mode === "win" ? solved.solution : wrongFor(hands, solved.known, t.id);
      if (!triple) return `${game}판: 탭 ${t.id}의 «반드시 오답» 조합을 만들지 못했다`;
      const err = await doAccuse(t, triple, mode === "win" ? "정답 봉투(소거 결과)" : "남의 손패 = 정답 불가");
      if (err) return `${game}판: ${err}`;
      if (!(await waitTurnLeft(t))) {
        const st = await evalIn(t.sid, TAB_STATE_JS).catch(() => null);
        if (!st?.ended) return `${game}판: 탭 ${t.id}의 고발이 반영되지 않았다`;
      }
    }
    return `${game}판: ${R.maxTurns}턴 안에 판이 끝나지 않았다`;
  };

  /** 종료 오버레이를 계측한다. 도달한 **행이 맞는지** 제목 지문으로 확인한다. */
  const measured = [];
  const grab = async (game) => {
    for (const s of R.screens.filter((x) => x.game === game)) {
      for (const tabId of s.tab) {
        const t = byId(tabId);
        if (!t?.vp) continue; // 계측하지 않는 조력 탭
        if (!viewports.some((v) => v.id === t.vpId)) {
          // `--viewport=`로 걸러진 탭. 판은 6좌석이 다 필요하므로 **탭은 그대로 돌리고**
          // 계측만 건너뛴다 — 빠진 사실은 여기서 사유와 함께 남는다.
          measured.push({ id: s.id, label: s.label, vp: t.vpId, skip: `--viewport=${OPT.viewport} 로 제외된 뷰포트` });
          continue;
        }
        const g0 = Date.now();
        if (!(await waitFor(t.sid, "!document.getElementById('endOverlay').classList.contains('hidden')", 10_000))) {
          measured.push({ id: s.id, label: s.label, vp: t.vpId, skip: `탭 ${tabId}에 결과 오버레이가 뜨지 않았다` });
          continue;
        }
        await sleep(SCREEN.settleMs);
        const st = await evalIn(t.sid, TAB_STATE_JS);
        if (!String(st.endTitle).includes(s.title)) {
          measured.push({
            id: s.id,
            label: s.label,
            vp: t.vpId,
            skip: `기대한 행이 아니다 — 제목 «${st.endTitle}»에 «${s.title}»이 없다(다른 행을 조용히 재지 않는다)`,
          });
          continue;
        }
        const data = await probeTab(t.sid, R, `${s.id}-${t.vpId}`);
        measured.push({
          id: s.id,
          label: `${s.label} — 탭 ${tabId}`,
          vp: t.vpId,
          vpLabel: t.vp.label,
          ms: Date.now() - g0,
          title: st.endTitle,
          sub: st.endSub,
          data,
          vpObj: t.vp,
        });
      }
    }
  };

  // ── 1판: 5명 오답 탈락 → `survivor` 종료 ──
  step("결과 흐름 · 1판 손패 읽기");
  const h1 = await readAllHands(1);
  if (h1.skip) return bail(h1.skip);
  const s1 = solve(h1.hands, 1);
  if (s1.skip) return bail(s1.skip);
  notes.push(`1판 정답 봉투(소거) — ${s1.solution.suspect} · ${s1.solution.weapon} · ${s1.solution.room}`);
  step("결과 흐름 · 1판 오답 고발 5회");
  const e1 = await driveToEnd(h1.hands, s1, "survivor", 1);
  if (e1) return bail(e1);
  await grab(1);

  // ── 2판: [다시 하기] → keeper가 정답 봉투로 고발 → `accuse` 종료 ──
  step("결과 흐름 · 다시 하기");
  await evalIn(host.sid, clickJs("#endRematch"));
  for (const t of tabs)
    if (!(await waitFor(t.sid, "document.getElementById('endOverlay').classList.contains('hidden') && !document.getElementById('turnInfo').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
      return bail(`탭 ${t.id}: 다시 하기 후 새 판에 들어가지 못했다`);
  step("결과 흐름 · 2판 손패 읽기");
  const h2 = await readAllHands(2);
  if (h2.skip) return bail(h2.skip);
  const s2 = solve(h2.hands, 2);
  if (s2.skip) return bail(s2.skip);
  notes.push(`2판 정답 봉투(소거) — ${s2.solution.suspect} · ${s2.solution.weapon} · ${s2.solution.room}`);
  step("결과 흐름 · 2판 정답 고발");
  const e2 = await driveToEnd(h2.hands, s2, "win", 2);
  if (e2) return bail(e2);
  await grab(2);

  for (const t of tabs) await t.close();
  return { measured, ms: Date.now() - t0, notes };
};

/** 뷰1 대비 HUD 상자 이동 비교용 — 보호 대상의 rect를 키로 뽑는다. */
const hudRectMap = (data) => {
  const m = new Map();
  for (const p of data.protect)
    p.items.forEach((it, i) => m.set(`${p.sel}[${i}]`, it.rect));
  return m;
};

/**
 * S4 — 뷰 간 HUD 동일성.
 * 4뷰는 같은 HUD DOM 한 벌을 공유한다. 그런데 뷰2·3은 three 캔버스가 위에 얹히고
 * `hud-inset.ts`가 인셋을 잡으므로 **위치가 달라질 여지**가 있다. 달라졌다면 그것
 * 자체가 결함이다(같은 화면이 뷰에 따라 다른 자리에 있다 = 조작 위치가 흔들린다).
 * "같은 DOM이니 같을 것"은 가설이고, 게이트는 그 가설을 실측으로 확인하는 자리다.
 */
const judgeHudShift = (base, data) => {
  if (!base)
    return { id: "S4", status: "SKIP", detail: "뷰1 기준선이 없다(`--only`로 뷰1을 뺐다) — 대조 불가", lines: [] };
  const now = hudRectMap(data);
  const moved = [];
  for (const [k, b] of base) {
    const n = now.get(k);
    if (!n) {
      moved.push(`✗ ${k} — 뷰1에는 있고 이 뷰에는 없다`);
      continue;
    }
    // 크기 면제(사유는 gate.config.mjs `hudShiftSizeExempt`) — **위치는 면제하지 않는다.**
    const sizeFree = SCREEN.hudShiftSizeExempt.some((e) => k.startsWith(`${e.sel}[`));
    const d = sizeFree
      ? Math.max(Math.abs(n.x - b.x), Math.abs(n.y - b.y))
      : Math.max(Math.abs(n.x - b.x), Math.abs(n.y - b.y), Math.abs(n.w - b.w), Math.abs(n.h - b.h));
    if (d > SCREEN.hudShiftTolPx)
      moved.push(`✗ ${k} — 뷰1 (${b.x},${b.y} ${b.w}×${b.h}) → 이 뷰 (${n.x},${n.y} ${n.w}×${n.h})`);
  }
  const exempt = SCREEN.hudShiftSizeExempt.map((e) => e.sel).join(", ");
  return {
    id: "S4",
    status: moved.length ? "FAIL" : "PASS",
    detail: moved.length
      ? `뷰1 대비 HUD 상자 ${moved.length}개가 ${SCREEN.hudShiftTolPx}px 넘게 움직였다 — 같은 DOM인데 자리가 다르다`
      : `뷰1과 HUD 상자 ${base.size}개가 ${SCREEN.hudShiftTolPx}px 이내로 동일 — «HUD는 뷰와 무관»이 실측으로 성립` +
        ` (크기만 면제: ${exempt})`,
    lines: moved,
  };
};

const inTier = (tier) => OPT.full || (tier ?? "default") === "default";
const wanted = (id) => !OPT.only.length || OPT.only.includes(id);
const screens = SCREEN.screens.filter((s) => wanted(s.id) && inTier(s.tier));
const viewports = SCREEN.viewports.filter((v) => !OPT.viewport || v.id === OPT.viewport);
if (!screens.length && !OPT.only.includes("result"))
  skipOut(`--only=${OPT.only.join(",")} 에 해당하는 화면이 없다`);

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
  {
    id: "F5-뷰간HUD이동",
    expect: "S4",
    screen: "game-v2", // 뷰1이 아니라 **뷰2**에 주입해야 «뷰 간 차이»가 된다
    signature: /#turnInfo/,
    why:
      "뷰2에서만 턴 배너를 인라인 `transform`으로 밀어낸다(중앙 정렬 transform을 덮으므로 " +
      "실제 이동량은 40px보다 크다) — 같은 HUD DOM인데 뷰에 따라 자리가 다른 상태. " +
      "«뷰2·3은 three 캔버스라 HUD 위치가 달라질 수 있다»가 실제로 일어났을 때의 모양이다",
    js: `(() => {
      const e = document.getElementById('turnInfo');
      e.style.transform = 'translate(40px, 40px)';
      return 'injected';
    })()`,
  },
];

if (OPT.selfTest) {
  const vp = SCREEN.viewports.find((v) => v.id === "phone");
  const scr = (id) => SCREEN.screens.find((s) => s.id === id);
  const rows = [];
  /** 화면 하나를 열고 판정한다(뷰 화면이면 S4까지 붙인다). */
  let hudBaseST = null;
  const run = async (screen, faultJs) => {
    const r = await openScreen(screen, vp, faultJs);
    if (r.unreachable || r.skip) {
      await r.close?.();
      return { fail: r.unreachable ?? r.skip };
    }
    const checks = judge(screen, vp, r.data);
    if (screen.id === "game" && !faultJs) hudBaseST = hudRectMap(r.data);
    else if (typeof screen.view === "number") checks.push(judgeHudShift(hudBaseST, r.data));
    await r.close();
    return { checks };
  };

  // 기준선 — 결함 없이 통과하는가(통과해야 «FAIL이 결함 때문»이라고 말할 수 있다).
  // 화면마다 따로 필요하다: F5는 뷰2에 주입하므로 «뷰2의 무결함 상태»가 기준선이다.
  const baselines = new Map();
  const baselineOf = async (id) => {
    if (baselines.has(id)) return baselines.get(id);
    step(`음성 테스트 기준선 ${id}`);
    const r = await run(scr(id), null);
    if (r.fail) skipOut(`음성 테스트 기준선(${id}) 도달 실패 — ${r.fail}`, client.log);
    baselines.set(id, r.checks);
    rows.push({
      id: `기준선(${id})`,
      expect: "-",
      got: r.checks.map((c) => `${c.id}:${c.status}`).join(" "),
      ok: true,
      note: "결함 주입 전 상태. 여기서 이미 FAIL이면 아래 판정은 결함 때문이 아니다",
      checks: r.checks,
    });
    return r.checks;
  };
  // 뷰1 기준선을 먼저 만든다 — S4의 대조 기준(`hudBaseST`)이 여기서 생긴다.
  await baselineOf("game");
  /** 한 검사의 판정 문장 전부(요약 + 위반 줄). 지문 대조용. */
  const violations = (checks, id) => {
    const c = checks.find((x) => x.id === id);
    if (!c || c.status !== "FAIL") return [];
    return [c.detail, ...(c.lines ?? []).filter((l) => l.startsWith("✗"))];
  };

  for (const f of FAULTS) {
    const screen = scr(f.screen ?? "game");
    const baseChecks = await baselineOf(screen.id);
    step(`음성 테스트 ${f.id}`);
    const r = await run(screen, f.js);
    if (r.fail) {
      rows.push({ id: f.id, expect: f.expect, got: "도달 실패", ok: false, note: r.fail });
      continue;
    }
    const checks = r.checks;
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
/** 뷰포트별 뷰1 HUD 상자 — 뷰2·3·4가 «같은 HUD»인지 대조할 기준선. */
const hudBase = new Map();
const runStart = Date.now();
/**
 * 기본 모드에서 **의도적으로 뺀** 것. «도달 실패»가 아니므로 종료코드를 흔들지 않지만
 * 실행할 때마다 사유와 함께 인쇄한다 — 은폐된 미측정이 회귀보다 위험하다.
 */
const tierSkips = SCREEN.screens
  .filter((s) => wanted(s.id) && !inTier(s.tier))
  .flatMap((s) =>
    viewports.map((v) => ({
      screen: s.id,
      label: s.label,
      vpLabel: v.label,
      why: `기본 대상에서 제외됨(tier=${s.tier}) — \`--full\`에서 돈다`,
    })),
  );
for (const vp of viewports) {
  for (const screen of screens) {
    if (!OPT.full && screen.viewportsDefault && !screen.viewportsDefault.includes(vp.id)) {
      tierSkips.push({
        screen: screen.id,
        label: screen.label,
        vpLabel: vp.label,
        why: `기본 대상은 이 화면을 ${screen.viewportsDefault.join("·")} 뷰포트로만 잰다(뷰 전환은 청크 로드라 비싸다) — \`--full\`에서 돈다`,
      });
      continue;
    }
    step(`${screen.label} · ${vp.label}`);
    const t0 = Date.now();
    const r = await openScreen(screen, vp, null);
    const ms = Date.now() - t0;
    if (r.unreachable || r.skip) {
      await r.close?.();
      results.push({
        screen: screen.id,
        label: screen.label,
        vp: vp.id,
        vpLabel: vp.label,
        ms,
        ...(r.skip ? { skip: r.skip } : { unreachable: r.unreachable }),
      });
      continue;
    }
    const checks = judge(screen, vp, r.data);
    if (screen.id === "game") hudBase.set(vp.id, hudRectMap(r.data));
    else if (typeof screen.view === "number") checks.push(judgeHudShift(hudBase.get(vp.id), r.data));
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

// ── 결과 화면(6인 실판) ──
const RESULT_TIER = SCREEN.result.tier ?? "default";
let resultFlow = null;
if (!wanted("result")) {
  /* `--only=`가 결과 화면을 부르지 않았다 — 아무것도 인쇄하지 않는다 */
} else if (inTier(RESULT_TIER) || OPT.only.includes("result")) {
  resultFlow = await runResultFlow();
  if (resultFlow.skip) {
    results.push({ screen: "result", label: SCREEN.result.label, vp: "-", vpLabel: "6탭 세션", ms: resultFlow.ms, skip: resultFlow.skip });
  } else {
    for (const m of resultFlow.measured) {
      if (m.skip) {
        results.push({ screen: m.id, label: m.label, vp: m.vp, vpLabel: m.vp, ms: 0, skip: m.skip });
        continue;
      }
      const checks = judge(SCREEN.result, m.vpObj, m.data);
      results.push({
        screen: m.id,
        label: m.label,
        vp: m.vp,
        vpLabel: m.vpLabel,
        ms: m.ms,
        checks,
        endTitle: m.title,
        endSub: m.sub,
        shot: join(outDir, `${m.id}-${m.vp}.png`),
      });
    }
  }
} else {
  results.push({
    screen: "result",
    label: SCREEN.result.label,
    vp: "-",
    vpLabel: "6탭 세션",
    ms: 0,
    skip: `기본 대상에서 제외됨(tier=${RESULT_TIER}) — \`--full\`에서 돈다`,
  });
}
const totalMs = Date.now() - runStart;
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
const skipped = results.filter((r) => r.skip);
// 도달 못 한 화면이 있으면 «전건 통과»라고 말할 수 없다 → FAIL이 아니라 SKIP(3)으로 끝낸다.
// `skip`(환경 사유·의도적 제외)은 여기 넣지 않는다 — 그건 «못 쟀다»의 **사유가 밝혀진** 쪽이다.
const exitCode = failed.length ? 1 : unreachable.length ? 3 : 0;
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

if (OPT.json) {
  console.log(
    JSON.stringify(
      {
        status: exitCode === 0 ? "PASS" : exitCode === 1 ? "FAIL" : "SKIP",
        mode: OPT.full ? "full" : "default",
        geminiCalls: llmCalls,
        ports: { server: serverPort, client: clientPort, cdp: cdpPort },
        chrome: version.Browser,
        outDir,
        totalMs,
        counts: {
          screens: results.length,
          PASS: allChecks.filter((c) => c.status === "PASS").length,
          FAIL: failed.length,
          SKIP: allChecks.filter((c) => c.status === "SKIP").length,
          unreachable: unreachable.length,
          skipped: skipped.length + tierSkips.length,
        },
        results,
        tierSkipped: tierSkips,
        resultFlow: resultFlow ? { ms: resultFlow.ms, skip: resultFlow.skip ?? null, notes: resultFlow.notes } : null,
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
  if (r.unreachable || r.skip) {
    console.log(`  SKIP  ${r.label} · ${r.vpLabel}  (${secs(r.ms)})`);
    console.log(`         ↳ ${r.unreachable ? `도달 실패 — ${r.unreachable}` : r.skip}`);
    continue;
  }
  const bad = r.checks.filter((c) => c.status === "FAIL");
  console.log(
    `  ${bad.length ? "FAIL" : "PASS"}  ${r.label} · ${r.vpLabel}  (${secs(r.ms)})`,
  );
  if (r.endTitle) console.log(`         · 화면 «${r.endTitle}» / ${r.endSub}`);
  for (const c of r.checks) {
    if (c.status === "PASS" && !OPT.verbose) continue;
    console.log(`         ${c.status === "FAIL" ? "✗" : c.status === "SKIP" ? "-" : "·"} ${c.id}  ${c.detail}`);
    for (const l of c.lines ?? []) {
      if (!OPT.verbose && !l.startsWith("✗")) continue;
      console.log(`             ${l}`);
    }
  }
}

if (tierSkips.length) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  § 기본 대상에서 뺀 화면 — **은폐하지 않는다.** 전부 보려면 \`--full\``);
  for (const t of tierSkips) console.log(`      SKIP  ${t.label} · ${t.vpLabel}\n            ↳ ${t.why}`);
}

if (resultFlow?.notes?.length && OPT.verbose) {
  console.log(`\n${"─".repeat(72)}`);
  console.log("  § 결과 흐름 조작 기록(정상 UI 조작만 — 서버에 테스트 경로 없음)");
  for (const n of resultFlow.notes) console.log(`      · ${n}`);
}

console.log(`\n${"─".repeat(72)}`);
console.log("  § 측정하지 못한 화면 — 조용히 빼지 않는다");
for (const u of SCREEN.unreachable) console.log(`      □ ${u.label}\n          ${u.why}`);

console.log(`\n${"─".repeat(72)}`);
console.log("  § 사람 확인 — 아래는 이 게이트가 **판정하지 못한다.** 캡처를 열어 눈으로 봐라.");
console.log(`    PNG: ${outDir}`);
for (const [k, v] of SCREEN.human) console.log(`      □ ${k.padEnd(16)} ${v}`);

console.log(`\n${"─".repeat(72)}`);
console.log(`  § 소요 — 총 ${secs(totalMs)} (모드 ${OPT.full ? "--full" : "기본"})`);
{
  const rows = results.filter((r) => r.ms > 0).sort((a, b) => b.ms - a.ms);
  for (const r of rows.slice(0, 6))
    console.log(`      ${secs(r.ms).padStart(6)}  ${r.screen} · ${r.vpLabel}`);
  if (resultFlow && !resultFlow.skip)
    console.log(`      ${secs(resultFlow.ms).padStart(6)}  결과 흐름 6탭 세션 전체(위 결과 화면들의 상위 비용)`);
  if (rows.length > 6) console.log(`      … 나머지 ${rows.length - 6}건`);
}

console.log(`\n${"═".repeat(72)}`);
console.log(
  `  PASS ${allChecks.filter((c) => c.status === "PASS").length} · FAIL ${failed.length} · ` +
    `SKIP ${allChecks.filter((c) => c.status === "SKIP").length} · 도달 실패 ${unreachable.length} · ` +
    `미측정(사유 있음) ${skipped.length + tierSkips.length}`,
);
console.log(
  exitCode === 0
    ? "  결과: PASS — 기계가 잴 수 있는 항목은 전건 통과. **위 § 사람 확인은 아직 남아 있다.**"
    : exitCode === 3
      ? "  결과: SKIP — 도달하지 못한 화면이 있다. 통과가 아니라 **미측정**이다."
      : `  결과: FAIL — [${[...new Set(results.filter((r) => r.checks?.some((c) => c.status === "FAIL")).map((r) => `${r.screen}/${r.vp}`))].join(", ")}]`,
);
console.log("  음성 테스트: node scripts/gate-screen.mjs --self-test  (게이트가 정말 잡는지 확인)");
console.log("  전부 보기:  node scripts/gate-screen.mjs --full");
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
