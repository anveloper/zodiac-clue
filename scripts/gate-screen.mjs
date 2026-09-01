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
 *                  ⚠️ **가림만이 아니다** — 보호 대상은 «잘려도» 안 된다:
 *                    · 41회차 «뷰포트에 잘림» — 「뷰포트 밖」(넓이 0)과 「멀쩡함」 사이가
 *                      통째로 사각지대였다(실측 11.6px 잘림이 초록이었다).
 *                    · 45회차 «상자 안에서 접힘 아래» — `overflow: auto`인 **조상**이 자른 것.
 *                      뷰포트로는 멀쩡해 보인다(실측 모달 주 행동 1.8px · 손패 줄 2px).
 *                  판정문이 원인을 구분한다 — 처방이 다르기 때문이다.
 *   S2 스크롤      게임 화면: `scrollHeight <= innerHeight` **그리고** `scrollTo(0,9999)` 후 `scrollY === 0`.
 *                  랜딩·대기실은 세로 스크롤이 **정상**이라 기대값을 다르게 둔다(gate.config.mjs).
 *                  가로 스크롤은 어느 화면에서도 사고다 — 전 화면 공통으로 잠근다.
 *   S3 타깃 크기   조작 가능한 요소의 최소 변. **하한이 포인터마다 다르다** —
 *                  손가락 **44px** · 마우스 **24px**(WCAG 2.2 §2.5.8 **AA**).
 *                  ⚠️ **«2.5.8만 포인터 무관»이 아니다.** 2.5.5(44)도 포인터를 안 가린다 —
 *                  등급이 AAA일 뿐이다. 44를 **손가락에만** 요구하는 근거는 Apple HIG 하나다.
 *                  ⚠️ 27회차까지 마우스 뷰포트는 **통째로 SKIP**이었다. 「44를 마우스에
 *                  요구하지 않는다」는 옳지만 그 결론이 **「아무것도 안 잰다」**가 된 것이
 *                  구멍이었고, 그래서 `.evi-hit` 83×20 · `.evi-memo-btn` 11.5×12가
 *                  **한 번도 계측되지 않았다**(28회차 검출 — `game/desktop` 42건 + 랜딩 1건).
 *                  숨김·비활성·문서 밖은 제외하고, **제외한 개수도 인쇄한다.**
 *                  4뷰는 캔버스만 다르고 HUD는 같은 DOM 한 벌이라는 것이 **가설**이고,
 *                  이 검사가 그 가설을 실측으로 확인한다(어긋나면 그 자체가 결함).
 *                  캔버스 픽셀은 재지 않는다 — 헤드리스 WebGL은 실기 GPU가 아니다.
 *   S5 글자 크기   손가락 뷰포트에서 실제로 그려진 `font-size` ≥ `SCREEN.minFontPx`.
 *   S6 명암비      글자색 ↔ **합성된 실제 배경색**의 명암비 ≥ WCAG 2.1 AA(4.5 / 큰 글자 3.0).
 *   S8 컬럼 배분   **판 중반** 우측 컬럼(AI 대사·증거 노트·제안 기록표·기록/알림)이 높이 하나를
 *                  나눠 갖는데, 맨 아래 `📜 기록/알림`이 **몇 줄을 보여줄 수 있는가**.
 *                  S1은 원리적으로 침묵한다 — 이건 «남에게 덮였는가»가 아니라
 *                  **자기 몫이 0으로 수렴하는 것**이고, 덮이지 않은 요소는 S1의 관심 밖이다.
 *                  두 수치를 갈라 잰다: 지금 **받은** 몫(회귀 감시=래칫)과 이 화면이
 *                  **보장하는** 몫(`min-height`에서 머리글·패딩을 뺀 값 → 기능 하한).
 *                  ⚠️ **현재 값은 결함이다**(보장 0줄). 그래서 하한으로 FAIL을 내지 않고
 *                  번들 예산 게이트와 같은 **래칫**으로 «더 나빠지면 FAIL»만 한다 —
 *                  대신 매 실행 «결함 확인»을 인쇄한다. 통과가 «정상»으로 읽히면 안 된다.
 *   S7 목록 배지   랜딩 공개방 목록 한 줄이 **방 상태를 옳게 적는가**(ui-copy §8.5).
 *                  «요소가 있는가»로는 절대 안 잡힌다 — 요소는 늘 있고 틀리는 것은 글자다.
 *                  판을 새로 돌리지 않는다: 아래 6탭 실판에 **관측 탭 하나**를 붙여
 *                  같은 세션의 세 시점(대기 중 / 정원 초과 / 종료됨)에서 목록을 읽는다.
 *   S9 상태 대비   **`:hover`에서** 색이 바뀐 글자의 명암비. 하한은 S6와 같은 함수다.
 *                  25회차에 전역 `button:hover`가 커스텀 버튼으로 새어 대비가 1.16:1이
 *                  됐는데 S6는 **원리적으로 못 봤다**(평상 상태만 잰다) — 그 구멍이다.
 *                  JS로는 `:hover`를 못 만들므로 **진짜 마우스를 움직인다**
 *                  (`Input.dispatchMouseEvent` · 브라우저 자신의 히트 테스트를 쓴다).
 *                  전이·애니메이션은 계측 동안 **끈다** — 안 끄면 0.18s 전이 색을 못 잡고
 *                  잔상이 다음 후보에 섞인다.
 *                  ⚠️ **마우스 뷰포트에서만** 돈다(폰은 `hover: none` 에뮬 → SKIP + 사유).
 *                  ⚠️ 후보는 **조작 요소**뿐이다 — `.hud-turn`처럼 조작 요소가 아닌 주체의
 *                     hover, 그리고 `opacity`·`filter`·배경 이미지 축은 **아직 못 본다**(플랜 47 큐).
 *   S10 프레이밍  추적 대상이 «보이는 영역» 중앙에 오는가(`camFrame: true`인 화면만).
 *                 **DOM으로는 안 보이는 축**이다 — 34회차가 카메라를 «고쳐» 내 말을
 *                 화면 80%(D패드 뒤)로 밀어 놓았는데 S1~S9는 전건 PASS였다.
 *                 좌표는 **씬이 낸다**(`camFraming()`) — 재는 쪽이 식을 쓰면 오진한다.
 *   S11 잘림       고를 수 있는 최장 옵션이 컨트롤 안에 들어가는가.
 *                 폭은 **브라우저가 낸다**(사본의 폭 제약을 풀고 잰다) — S10과 같은 이유로
 *                 재는 쪽이 글자 폭을 계산하지 않는다. `disabled` 옵션은 표시되지 않으므로 뺀다.
 *   S12 조판 분기  **의도한 조판이 섰는가**(`gate.config.mjs`의 `layoutRules`가 선언한다).
 *                 S1~S11은 「들어가는가·가려졌는가·읽히는가」만 재므로 **분기 경계의 회귀를
 *                 원리적으로 못 본다** — 47회차 실증: 카드 가드를 되돌려도 «더 작아질» 뿐
 *                 여전히 들어가서 전건 PASS였다. 39~47회차가 다툰 것이 그 경계값들이다.
 *                 조건은 CSS 문자열 그대로 `matchMedia`에 묻고, 값은 계산된 스타일을 **읽기만** 한다.
 *                 ⚠️ **경계값 자체는 아직 못 잡는다** — 조건이 CSS와 같아 규칙이 경계를 따라간다.
 *                    그래서 **경계 그 자체를 뷰포트로** 둔다(`cardGuard` · `tierTop`).
 *   S13 hover 기하 **hover에서 «커지는» 것이 남을 덮는가**(`hoverPairs`가 선언한다).
 *                 S1은 평상 상태만, S9는 **색**만 잰다 — 그 사이가 사각지대였고 실측으로
 *                 배너 이름 펼침(**106px** @1360)이 거기 있었다 — 마우스를 진짜로 움직이는
 *                 장치는 S9가 이미 갖고 있었는데 **색만 읽고 있었다.**
 *                 ⚠️ **아직 못 보는 것**: `:focus-within`(마우스 hover만 만든다)과
 *                    **손가락 뷰포트**(hover가 없어 SKIP) — 그 교집합은 S14가 맡는다.
 *   S14 포커스 기하 **포커스에서 «커지는» 것이 남을 덮는가**(`focusPairs`가 선언한다).
 *                 S13이 원리적으로 못 보는 축이다 — 축이 `:focus-within`이고 결함이
 *                 **coarse에만** 나는데 S13은 coarse를 SKIP한다. **포커스는 손가락에도 있다.**
 *                 마우스를 안 쓰고 `focus()`만 부르므로 **모든 뷰포트에서 돈다.**
 *   S15 글자 의도  **요소를 겨냥한 글자 크기가 «타입만 겨냥한» 선언에 졌는가.**
 *                 S5는 «하한»(10px)만 재고 coarse에서만 돈다 — 15px은 하한을 안 어긴다.
 *                 어긴 것은 하한이 아니라 **의도**다. 이 사고는 **세 번** 났고
 *                 (`.char` · `.inv-code-v` · `.full`) 앞의 둘은 **사람이 눈으로** 찾았다.
 *                 특이도는 **안 계산한다** — 승자는 `getComputedStyle`이 알려 준다.
 *
 *   ⚠️ S5·S6·S9는 §사람 확인 «읽히는가»에서 **기계가 잴 수 있는 조각만** 떼어낸 것이다.
 *      줄바꿈·서체·행간, 그리고 **`:active`·`:focus` 상태의 색**은 여전히 사람 몫이고
 *      §사람 확인에 그대로 남아 있다. 이들이 통과했다고 «읽힌다»가 증명되지 않는다.
 *      배경 이미지·그라디언트·캔버스 위의 글자는 뒤 색이 한 값이 아니라 **판정 불가**로
 *      세어 인쇄한다 — 조용히 통과시키지 않는다.
 *
 * 측정 대상 화면
 *   랜딩 · 대기실 · 게임 뷰1 · **게임 뷰2·3·4(HUD만)** · 안내 카드 · 신고 모달
 *   · **결과 화면 4행**(❌ 신고 실패 / 🏅 최후의 1인 / 🎉 사건 해결 / 🔍 사건 종결)
 *
 *   · **공개방 목록 3행**(대기 중 / 정원 초과 / 종료됨 — ui-copy §8.5, `SCREEN.roomList`)
 *
 *   · **판 중반 우측 컬럼 배분 1건**(S8 — 위 6탭 세션의 **3판**에 얹혀 돈다, `SCREEN.rightColumn`)
 *
 *   결과 화면은 **6개 탭으로 실판을 돌려** 도달한다(gate.config.mjs `SCREEN.result`).
 *   좌석을 전부 사람으로 채우면 손패 합집합이 «정답 아닌 카드 전부»가 되어
 *   «반드시 오답»(남의 패)과 «반드시 정답»(소거의 여집합)이 **규칙상** 정해진다 —
 *   확률이 아니라 **실패가 불가능**하다. 서버에는 아무것도 추가하지 않았다.
 *
 *   목록 배지(S7)는 그 세션에 **관측 탭 하나**를 얹어 «대기 중»·«정원 초과»를 공짜로 읽고,
 *   «종료됨»만 3막(사람 5 + NPC 1)을 더 돈다 — 6인 방은 좌석이 차는 순간 Colyseus가
 *   잠가(`locked`) 목록에서 사라지고, 그 잠금은 120초 재접속 창 뒤에야 풀리기 때문이다.
 *   3막의 종료도 확률이 아니다: 다섯 탭이 **남의 손패**로 고발해 전원 탈락하면 남는 것은
 *   NPC 하나뿐이라 서버가 그 자리에서 판을 끝낸다(고발 5회 상한이 규칙으로 확정).
 *
 * ⚠️ 이 게이트는 **화면이 좋다고 증명하지 않는다.** 미(美)·정렬·읽힘은 기계가 못 잰다.
 *    마지막에 §사람 확인을 항상 인쇄한다(verify-print.mjs와 같은 규약). 그 목록을 지우지 마라.
 *
 * 실행
 *   node scripts/gate-screen.mjs                    # 기본 대상(실측 ≈54s)
 *   node scripts/gate-screen.mjs --full             # 기본에서 뺀 것까지 전부(실측 ≈69s)
 *   node scripts/gate-screen.mjs --json
 *   node scripts/gate-screen.mjs --only=game,landing
 *   node scripts/gate-screen.mjs --only=result      # 결과 화면 6인 실판 + S8만(≈30s)
 *   node scripts/gate-screen.mjs --viewport=phone
 *   node scripts/gate-screen.mjs --keep             # 캡처 PNG를 남긴다(사람 확인용)
 *   node scripts/gate-screen.mjs --self-test        # **음성 테스트** — 일부러 깨뜨려 게이트가 잡는지 본다
 *   node scripts/gate-screen.mjs --only=result --update-baseline --reason="…"   # S8 래칫 기준선 갱신
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
import { readBaseline, writeBaseline, parseReason } from "./gate-baseline.mjs";

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
  /** S8(판 중반 우측 컬럼 배분) 래칫 기준선 갱신. 번들 예산 게이트와 같은 규약 — 사유 필수. */
  update: has("--update-baseline"),
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
  /**
   * 요소를 자르는 **조상**들의 클립 상자.
   *
   * 🔴 44회차까지 `visBox`는 **뷰포트만** 잘랐다. 그래서 모달처럼
   *    `max-height: 100%` + `overflow-y: auto`인 상자 «안»에서 접힘 아래로 내려간 것은
   *    **원리적으로 안 보였다** — 실측 `620×340`에서 `[신고한다]`가 1.8px 모자랐는데
   *    S1은 전건 PASS였고, 44회차는 캡처를 **눈으로 보고** 「전부 보인다」고 닫았다.
   *
   * **포함 블록 규칙을 지킨다**(검수 지적 — 초안은 둘 다 틀렸다):
   *   · `static`/`relative` … : 모든 조상이 자른다.
   *   · `absolute` : 포함 블록(= 가장 가까운 위치 지정 조상) **부터** 바깥으로 자른다.
   *     초안은 「static 조상은 전부 건너뛴다」였는데, 포함 블록 **위**의 static +
   *     `overflow:hidden` 조상은 그 포함 블록을 자르므로 절대 요소도 잘린다(크롬 실측).
   *   · `fixed` : 보통은 아무도 못 자르지만, `transform`·`filter`·`backdrop-filter`·
   *     `perspective`·`will-change`·`contain`이 걸린 조상은 **포함 블록이 되어 자른다**
   *     (크롬 실측 6000px² → 2000px²). 초안은 「fixed는 조상 클립을 안 받는다」였다.
   *
   * ⚠️ 클립 영역은 **padding box에서 스크롤바를 뺀 것**이지 border box가 아니다.
   *    `getBoundingClientRect()`를 쓰면 테두리+스크롤바만큼 **매번 낙관적**이다
   *    (실측 `.modal`: 테두리 1+1 · 스크롤바 9). `client*`로 정확히 잡는다.
   * ⚠️ `<body>`/`<html>`의 computed `overflow`는 **used 값이 아니다**(루트로 전파된다) —
   *    자르지 않으므로 건너뛴다.
   * ⚠️ 아직 안 보는 것: `contain: paint` · `clip-path`. 지금 저장소에 해당 경로는 없다.
   */
  const CB_MAKERS = /(transform|filter|backdrop-filter|perspective|will-change|contain)/;
  const makesFixedCB = (cs) =>
    cs.transform !== "none" ||
    cs.filter !== "none" ||
    cs.backdropFilter !== "none" ||
    cs.perspective !== "none" ||
    (cs.willChange && CB_MAKERS.test(cs.willChange)) ||
    (cs.contain && cs.contain !== "none");
  const clipBoxes = (el) => {
    const pos = getComputedStyle(el).position;
    const out = [];
    let reachedCB = pos !== "absolute" && pos !== "fixed"; // 흐름 안이면 처음부터 다 센다
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (a === document.body || a === document.documentElement) continue;
      const cs = getComputedStyle(a);
      if (!reachedCB) {
        const isCB = pos === "fixed" ? makesFixedCB(cs) : cs.position !== "static" || makesFixedCB(cs);
        if (!isCB) continue;
        reachedCB = true; // 포함 블록 «자신»부터 자른다
      }
      const ox = cs.overflowX;
      const oy = cs.overflowY;
      if (ox === "visible" && oy === "visible") continue;
      const r = a.getBoundingClientRect();
      const pl = r.left + a.clientLeft;
      const pt = r.top + a.clientTop;
      out.push({
        l: ox === "visible" ? -Infinity : pl,
        r: ox === "visible" ? Infinity : pl + a.clientWidth,
        t: oy === "visible" ? -Infinity : pt,
        b: oy === "visible" ? Infinity : pt + a.clientHeight,
      });
    }
    return out;
  };
  const clampBox = (r, boxes) => {
    let l = r.left;
    let t = r.top;
    let rr = r.right;
    let bb = r.bottom;
    for (const c of boxes) {
      l = Math.max(l, c.l);
      t = Math.max(t, c.t);
      rr = Math.min(rr, c.r);
      bb = Math.min(bb, c.b);
    }
    return { l, t, r: rr, b: bb, w: Math.max(0, rr - l), h: Math.max(0, bb - t) };
  };
  const VIEWPORT_BOX = [{ l: 0, t: 0, r: VW, b: VH }];
  const visBox = (el) => clampBox(el.getBoundingClientRect(), [...VIEWPORT_BOX, ...clipBoxes(el)]);
  /**
   * 뷰포트가 잘랐는가, 조상 스크롤 상자가 잘랐는가, 둘 다인가.
   * 🔴 초안은 「요소가 뷰포트 안이면 조상」이라는 **추정식**이었다 — 둘 다 자르면
   *    무조건 «뷰포트»라 적고 수치에는 조상 몫이 섞였다(검수 지적). 각각 따로 잰다.
   */
  const cutOf = (el) => {
    const r = el.getBoundingClientRect();
    const v = clampBox(r, VIEWPORT_BOX);
    const a = clampBox(r, clipBoxes(el));
    const dv = Math.max(r.width - v.w, r.height - v.h);
    const da = Math.max(r.width - a.w, r.height - a.h);
    const both = clampBox(r, [...VIEWPORT_BOX, ...clipBoxes(el)]);
    return {
      w: round(Math.max(0, r.width - both.w)),
      h: round(Math.max(0, r.height - both.h)),
      by: dv > 1 && da > 1 ? "both" : da > 1 ? "ancestor" : "viewport",
    };
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
        /* 🔴 **완전히 접힌 것을 «뷰포트 밖»이라 적으면 안 된다.** 초안은 그랬고,
           실측에서 **844px 뷰포트의 y=642에 있는 버튼**을 «뷰포트 밖»으로 인쇄했다 —
           이번 회차가 없애려던 오해 그 자체다(검수 지적). 원인을 함께 낸다. */
        items.push({ path: path(el), rect: rectOf(el), offscreen: true, blocked: [], cut: cutOf(el) });
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
      /*
       * 🔴 **부분 잘림은 여기서만 보인다.** 위 `pts`는 «보이는 상자»(`visBox`) 안에서만
       *    찍히므로, 요소의 절반이 뷰포트 밖이어도 나머지 절반에서 전부 self가 잡혀 **PASS**다.
       *    41회차 실측: 1280×450에서 `[잔치 시작]`이 아래 **11.6px** 잘린 채로 게이트를 통과했다 —
       *    «뷰포트 밖»(넓이 0)과 «멀쩡함» 사이가 통째로 사각지대였다.
       *    `protect`는 「이건 반드시 쓸 수 있어야 한다」는 선언이므로, 잘린 것도 위반이다.
       */
      // 🔴 **레이아웃은 한 번만 읽는다.** 초안은 `visBox`·`rectOf`·여기서 각각
      //    `getBoundingClientRect()`를 불러 **서로 다른 순간의 값**이 될 수 있었고,
      //    그러면 `rect`와 `cut`이 원리적으로 어긋난다(검수 지적).
      const rr = el.getBoundingClientRect();
      const cut = cutOf(el);
      const rect = { x: Math.round(rr.x), y: Math.round(rr.y), w: round(rr.width), h: round(rr.height) };
      items.push({ path: path(el), rect, samples: pts.length, ancestorHits, blocked, cut });
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
    // 🔴 **포커스 가능한 `separator`는 조작 요소다**(ARIA window splitter).
    //    `role="separator"`는 `tabindex`가 있을 때만 «조작 가능»이다 — 없으면 그냥 구분선이다.
    //    49회차 전에는 리사이저 4개가 `<div aria-hidden>`이라 **한 번도 계측되지 않았다**
    //    (11×868 · 260×14 · 폰 9px). 플랜 45가 `.evi-row`에서 고친 구멍의 재발이었다.
    '[role="separator"][tabindex]:not([tabindex="-1"])',
  ].join(",");
  const excluded = { hidden: 0, disabled: 0, outsideDoc: 0, exempt: 0 };
  const touchAll = []; // 하한 적용 전 **전부** — 판정은 Node 쪽에서(포인터마다 하한이 다르다)
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
    // ⚠️ **여기서 거르지 않는다.** 하한이 포인터마다 다르므로(손가락 44 · 마우스 24)
    //    판정은 Node 쪽 한 곳에서 한다 — 이 파일의 「관측치만 돌려준다」 규약 그대로다.
    touchAll.push({
      path: path(el),
      text: (el.textContent || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 20),
      w: round(r.width),
      h: round(r.height),
      side: round(side),
    });

  }
  touchAll.sort((x, y) => x.side - y.side);

  // ── S5·S6 글자 크기 · 대비 ──
  // §사람 확인 «읽히는가»에서 **기계가 잴 수 있는 두 조각**만 떼어낸 것이다.
  // 여기서도 판정은 하지 않는다 — 관측치(픽셀 크기·명암비)만 돌려준다.
  const parseRgb = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 };
  };
  /** `fg`(반투명 가능)를 `bg`(불투명) 위에 얹은 결과 색. */
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const relLum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => {
    const l1 = relLum(a);
    const l2 = relLum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  /**
   * 글자 뒤의 **실제 색**. 조상을 거슬러 올라가며 배경색 층을 모아 아래에서 위로 합성한다.
   * 배경 이미지/그라디언트를 만나면 «한 값이 아니다» → 판정 불가로 표시한다(넘겨짚지 않는다).
   */
  const bgBehind = (el) => {
    const layers = [];
    let img = null;
    let opaque = false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (!img && cs.backgroundImage && cs.backgroundImage !== "none") img = path(n);
      const c = parseRgb(cs.backgroundColor);
      if (c && c.a > 0) layers.push(c);
      if (c && c.a >= 0.999) {
        opaque = true;
        break;
      }
    }
    if (!opaque) return { color: null, img, reason: "bgAlpha" };
    if (img) return { color: null, img, reason: "bgImage" };
    let bg = layers[layers.length - 1];
    for (let i = layers.length - 2; i >= 0; i--) bg = over(layers[i], bg);
    return { color: bg, img: null, reason: null };
  };

  const textItems = [];
  const textExcluded = { noLetters: 0, hidden: 0, exempt: 0, bgImage: 0, bgAlpha: 0 };
  const HAS_LETTER = /[\p{L}\p{N}]/u;
  const all = document.querySelectorAll("body *");
  for (const el of Array.from(all)) {
    // **직계 텍스트 노드만** 본다. 조상까지 세면 같은 문장을 여러 번 재게 된다.
    let own = "";
    for (const n of Array.from(el.childNodes))
      if (n.nodeType === 3) own += n.nodeValue;
    own = own.trim();
    if (!own) continue;
    // 이모지·기호·구두점만 있는 줄은 «글자»가 아니다 — 색이 글리프에 적용되지 않아
    // 대비를 재는 것 자체가 무의미하다(🎲 · 🚪 같은 접두 기호).
    if (!HAS_LETTER.test(own)) {
      textExcluded.noLetters++;
      continue;
    }
    if (cfg.textExempt.length && cfg.textExempt.some((s) => el.matches(s))) {
      textExcluded.exempt++;
      continue;
    }
    if (!shown(el)) {
      textExcluded.hidden++;
      continue;
    }
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize) || 0;
    const weight = Number(cs.fontWeight) || (cs.fontWeight === "bold" ? 700 : 400);
    const item = {
      path: path(el),
      text: own.replace(/\s+/g, " ").slice(0, 24),
      px: round(px),
      weight,
      rect: rectOf(el),
    };
    // 대비: 글자색(`-webkit-text-fill-color`가 있으면 그쪽이 이긴다) 위에 배경을 깐다.
    const fillRaw = cs.webkitTextFillColor && cs.webkitTextFillColor !== "currentcolor"
      ? cs.webkitTextFillColor
      : cs.color;
    const fg = parseRgb(fillRaw);
    const bg = bgBehind(el);
    if (!fg || !bg.color) {
      item.contrast = null;
      item.why = !fg ? "글자색 파싱 불가" : bg.reason === "bgImage"
        ? `배경 이미지/그라디언트(${bg.img}) — 뒤 색이 한 값이 아니다`
        : "불투명 배경을 못 찾음(캔버스 위 글자 등)";
      textExcluded[bg.reason === "bgImage" ? "bgImage" : "bgAlpha"]++;
    } else {
      item.contrast = Math.round(contrast(over(fg, bg.color), bg.color) * 100) / 100;
      item.fg = fillRaw;
      item.bg = `rgb(${Math.round(bg.color.r)}, ${Math.round(bg.color.g)}, ${Math.round(bg.color.b)})`;
    }
    textItems.push(item);
  }

  // ── S9 상태 대비를 위한 내보내기 ────────────────────────────────
  // **JS로는 `:hover`를 만들 수 없다.** 그래서 색 계산 도구만 여기서 내주고,
  // 실제 hover는 Node 쪽이 `Input.dispatchMouseEvent`로 **진짜 마우스를 움직여** 만든다
  // (`CSS.forcePseudoState`보다 실제에 가깝다 — 브라우저 자신의 히트 테스트를 쓴다).
  // ⚠️ 색 계산은 S6와 **같은 함수**다(`bgBehind`/`over`/`contrast`) — 복붙하면 갈라진다.
  //    다만 **대상 선별은 S6와 다르다**(S6는 직계 텍스트 노드 전부, S9는 커서 밑 하나) —
  //    그래서 S6의 **면제 규칙만큼은 그대로 물려받는다**(아래 `textOK`).
  const textOK = (el) => {
    let own = "";
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) own += n.nodeValue;
    own = own.trim();
    if (!own || !HAS_LETTER.test(own)) return null; // 이모지·기호만 → 색이 글리프에 안 붙는다
    if (cfg.textExempt.length && cfg.textExempt.some((sel) => el.matches(sel))) return null;
    return own.replace(/\s+/g, " ").slice(0, 24);
  };
  /** 커서 밑 요소의 «글자색 + 합성 배경». `rest`와 `measure`가 **같은 방식**으로 떠야 한다. */
  const colorAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const bg = bgBehind(el);
    const fillRaw =
      cs.webkitTextFillColor && cs.webkitTextFillColor !== "currentcolor"
        ? cs.webkitTextFillColor
        : cs.color;
    return {
      el,
      key: `${fillRaw}|${bg.color ? `${bg.color.r},${bg.color.g},${bg.color.b}` : bg.reason}`,
      fillRaw,
      bg,
      cs,
    };
  };
  const stateCand = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const x = Math.min(window.innerWidth - 1, Math.max(0, Math.round(r.left + r.width / 2)));
    const y = Math.min(window.innerHeight - 1, Math.max(0, Math.round(r.top + r.height / 2)));
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === el || el.contains(hit))) return null; // 중심이 남에게 가려짐
    // ⚠️ **쉬는 값은 «커서 밑 요소»에서 뜬다.** 초안은 조작 요소(`el`)에서 떴는데,
    //    `measure`는 `elementFromPoint`가 준 안쪽 span을 잰다 — **다른 요소를 비교**하니
    //    정적인 색 차이가 «hover에서 바뀌었다»로 잡혔다(검수 실증: 12건 오탐).
    const c = colorAt(x, y);
    return c ? { path: path(el), x, y, rest: c.key } : null;
  };
  window.__zcState = {
    /** 이 뷰포트에서 hover가 성립하는가. 손가락 화면에서는 «잴 수 없다»가 정답이다. */
    hoverable: () => window.matchMedia("(hover: hover)").matches,
    /** 전이·애니메이션을 끈다. 안 끄면 ① 0.18s 전이 색을 못 잡고 ② 잔상이 **다음** 후보에 섞인다. */
    freeze: (on) => {
      const id = "zc-state-freeze";
      document.getElementById(id)?.remove();
      if (!on) return true;
      const st = document.createElement("style");
      st.id = id;
      st.textContent = "*,*::before,*::after{transition:none !important;animation:none !important}";
      document.head.appendChild(st);
      return true;
    },
    candidates: () =>
      Array.from(document.querySelectorAll(OPERABLE)).filter(shown).map(stateCand).filter(Boolean),
    /** 지금(=hover 중) 커서 밑 글자의 대비. **쉬는 상태와 달라졌을 때만** 돌려준다. */
    measure: (x, y, rest) => {
      const c = colorAt(x, y);
      if (!c || c.key === rest) return null; // 안 변했다 → S6가 이미 쟀다
      const text = textOK(c.el);
      if (text === null) return null; // 글자가 아니거나 §면제 — S6와 같은 기준
      if (!c.bg.color) return { path: path(c.el), why: c.bg.reason ?? "bgUnknown", contrast: null };
      const fg = parseRgb(c.fillRaw);
      if (!fg) return null;
      return {
        path: path(c.el),
        contrast: Math.round(contrast(over(fg, c.bg.color), c.bg.color) * 100) / 100,
        px: round(parseFloat(c.cs.fontSize) || 0),
        weight: Number(c.cs.fontWeight) || 400,
        text,
      };
    },
    done: () => {
      document.getElementById("zc-state-freeze")?.remove();
      delete window.__zcState; // 계측 도구를 페이지에 남기지 않는다
      return true;
    },
  };

  return {
    url: location.href,
    vw: VW,
    vh: VH,
    coarse: window.matchMedia("(pointer: coarse)").matches,
    protect,
    pairs,
    scroll,
    touch: { counted, excluded, all: touchAll },
    text: { items: textItems, excluded: textExcluded },
    /**
     * S10 — 카메라 프레이밍. **씬이 계산한 값을 그대로 받는다.**
     * 여기서 `(world − scroll) × zoom` 같은 식을 쓰면 안 된다 — Phaser의 실제 매핑은
     * `z·(world − scroll − size/2) + size/2`라 줌이 1이 아니면 틀리고,
     * 34회차가 정확히 그 식으로 오진해 **멀쩡한 카메라를 «고쳐서» 망가뜨렸다.**
     * 좌표를 만드는 쪽이 좌표를 알려 준다.
     */
    /**
     * S11 — 선택 컨트롤 잘림. **브라우저에게 자연폭을 물어본다.**
     * `<select>`는 원래 «가장 긴 옵션에 맞춰» 커진다. 그 기본 동작을
     * `.modal select { min-width: 0 }`이 끈다(38회차가 세 줄의 좌측 모서리를
     * 맞추려고 넣었고, 그건 그것대로 옳다) — 그러자 **잘림이 가능해졌는데
     * 그 대가를 재는 검사가 없었다.** 39회차가 실제로 그 구멍에 빠졌다.
     *
     * 🔴 여기서 글자 폭을 **직접 계산하지 않는다.** 화살표·패딩·서체 폴백까지
     *    맞히려면 브라우저를 흉내 내야 하고, 34·37·38회차가 «재는 쪽이 식을 쓰면
     *    틀린다»를 세 번 증명했다. 대신 **같은 부모 안에** 사본을 놓고
     *    폭 제약만 풀어 `offsetWidth`를 읽는다 — 계산은 브라우저가 한다.
     *    같은 부모라야 `.modal select` 같은 후손 선택자가 동일하게 걸린다.
     */
    /**
     * S12 — **조판이 «어느 분기로» 섰는가.**
     *
     * 🔴 47회차가 이 사각지대를 실증했다: `.card`의 데스크톱 가드를 600 → 660으로 **되돌려도
     *    게이트가 침묵한다.** 카드가 «더 작은» 폰 조판으로 떨어질 뿐 **여전히 들어가기** 때문이다.
     *    S1~S11은 전부 「들어가는가 · 가려졌는가 · 읽히는가」를 재고, **«의도한 조판이 섰는가»는
     *    아무도 안 잰다.** 그래서 분기 경계(가드·tier)의 회귀는 원리적으로 안 보였다 —
     *    이 저장소가 39~47회차 내내 다툰 것이 정확히 그 경계값들이다.
     *
     * 규칙은 `gate.config.mjs`의 `layoutRules`가 선언한다: 「이 뷰포트 조건에서 이 선택자의
     * 이 속성은 이 값이어야 한다」. 재는 쪽은 **계산된 스타일을 읽기만** 한다 —
     * 34·37·38회차가 「재는 쪽이 식을 쓰면 틀린다」를 세 번 증명했다.
     */
    /**
     * S15 — **글자 크기의 «의도»가 이겼는가.**
     *
     * 🔴 56회차가 이 사각지대를 실증했다: `#roomCode`를 `<strong>` → `<button>`으로 바꾸자
     *    데스크톱 tier의 `.card button:not(.char)`가 `.inv-code-v`를 이겨 코드가
     *    **20px → 15px**로 깎였는데 **게이트가 전건 초록**이었다. S5는 «하한»(10px)이고
     *    coarse에서만 돌며, 15px은 하한을 안 어긴다 — 어긴 것은 하한이 아니라 **의도**다.
     *    같은 함정이 `.char`(캐릭터 칸)에 이미 한 번 있었다. 즉 **두 번째**다.
     *
     * **특이도를 계산하지 않는다.** 계산하면 「재는 쪽이 식을 쓰면 틀린다」(34·37·38회차)를
     * 또 하게 된다. 승자는 `getComputedStyle`이 알려 주고, 우리는 **«주어»만** 본다:
     * 진 선언이 클래스/ID로 이 요소를 겨냥했는데 이긴 선언은 **타입만**(`button`·`input`)
     * 겨냥했다면, 그것은 캐스케이드가 아니라 **의도가 새어 나간 것**이다.
     * 반대(더 구체적인 클래스 규칙이 이기는 것)는 정상이므로 안 잡는다.
     */
    typeIntent: (() => {
      /* 선택자 리스트를 **괄호를 세며** 자른다.
         🔴 초안은 `sel.split(",")`이었다 — `:not(a, b)` 하나에 규칙이 조각나
         `el.matches`가 던지고 `catch → false`로 **통째로 사라졌다**(검수 실측: 같은 결함을
         `:not(.a):not(.b)`로 쓰면 FAIL, `:not(.a, .b)`로 쓰면 PASS).
         하필 `index.html`의 이번 회차 주석이 **그 리팩터를 다음 사람에게 권한다.** */
      const branches = (sel) => {
        const out = [];
        let depth = 0;
        let cur = "";
        for (const ch of sel) {
          if (ch === "(" || ch === "[") depth++;
          else if (ch === ")" || ch === "]") depth--;
          if (ch === "," && depth === 0) {
            out.push(cur);
            cur = "";
          } else cur += ch;
        }
        if (cur.trim()) out.push(cur);
        return out.map((b) => b.trim()).filter(Boolean);
      };
      /* 선택자의 **마지막 컴파운드**(주어)를 뽑고 `:not(...)`·`:is(...)` 속을 걷어낸다 —
         `.card button:not(.char)`의 주어는 `button`이지 `.char`가 아니다. */
      const subject = (branch) => {
        /* 결합자 분리도 괄호를 세야 한다 — `:not(a + b)`의 `+`는 결합자가 아니다. */
        let depth = 0;
        let last = "";
        for (const ch of branch) {
          if (ch === "(" || ch === "[") depth++;
          else if (ch === ")" || ch === "]") depth--;
          if (depth === 0 && (ch === " " || ch === ">" || ch === "+" || ch === "~")) last = "";
          else last += ch;
        }
        let out = last;
        for (let i = 0; i < 5; i++) out = out.replace(/:(?:not|is|where|has)\([^()]*\)/g, "");
        return out;
      };
      const targetsElement = (sub) => /[.#\[]/.test(sub);
      /* 🔴 **px 리터럴만 판정한다.** 초안은 선언 문자열과 계산값을 그대로 비교해서
         ① `0.9375rem`(=15px)으로 쓰면 **못 잡고**(검수 실측)
         ② `font: inherit`처럼 px가 아닌 값은 «진 선언»으로 오인했다
            (이 저장소에 이미 `.evi-hit { font: inherit }`가 21개 있다 — 값이 안 겹쳐서
             오늘만 조용할 뿐, `.evi-chip`을 한 글자 바꾸면 무의미한 FAIL이 난다).
         못 재는 것은 **«못 잰다»고 센다.** */
      const pxOf = (v) => {
        const m = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(v ?? "");
        return m ? Number(m[1]) : null;
      };
      /* 🔴 **상대 단위를 «못 읽는다»로 넘기면 그것이 우회로가 된다** — 검수가 `0.9375rem`(=15px)로
         같은 결함을 만들어 통과시켰다. 단위는 푼다. 푸는 데 필요한 기준(root·부모)은
         **브라우저에게 묻는다**(계산하지 않는다 — 이 저장소가 세 번 배운 규칙). */
      const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const resolve = (raw, el) => {
        const v = (raw ?? "").trim();
        const px = pxOf(v);
        if (px !== null) return px;
        const m = /^(-?\d+(?:\.\d+)?)(rem|em|%|pt)$/.exec(v);
        if (!m) return null;
        const n = Number(m[1]);
        const parentPx = () =>
          parseFloat(getComputedStyle(el.parentElement ?? document.documentElement).fontSize) || rootPx();
        if (m[2] === "rem") return n * rootPx();
        if (m[2] === "pt") return (n * 96) / 72;
        if (m[2] === "em") return n * parentPx();
        return (n / 100) * parentPx();
      };
      const found = [];
      const skipped = { nonPx: 0, nested: 0, badSel: 0, cond: 0 };
      /* 🔴 **조건은 누적한다.** 초안은 안쪽 조건이 바깥을 **대체**해서, 바깥이 거짓인데
         안쪽만 참이면 적용되지도 않는 선언을 잡았고(오탐), `@supports`를 `matchMedia`에
         넣어 진짜 결함을 놓쳤다(미탐 — 둘 다 검수 실측). 이 저장소에 중첩 `@media`가
         이미 둘 있고 `gap 720×620`에서 「바깥 거짓·안쪽 참」이 실제로 성립한다. */
      const condOk = (conds) =>
        conds.every((c) =>
          c.kind === "supports" ? CSS.supports(c.text) : matchMedia(c.text).matches,
        );
      const walk = (list, conds) => {
        for (const rule of list) {
          const isMedia = typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule;
          const isSupports = typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule;
          if (isMedia || isSupports) {
            walk(rule.cssRules ?? [], [
              ...conds,
              { kind: isSupports ? "supports" : "media", text: rule.conditionText ?? rule.media?.mediaText ?? "all" },
            ]);
            continue;
          }
          if (rule.selectorText && rule.style) {
            /* 중첩 CSS(`& button`)는 부모를 합성해야 매치된다 — 안 하면 조용히 샌다.
               초안 주석은 「그 안도 본다」고 적었지만 **실제로는 던지고 버려졌다**(검수 실측).
               합성은 안 한다(규칙이 는다) — 대신 **못 쟀다고 센다.** */
            if (rule.selectorText.includes("&")) {
              skipped.nested++;
            } else {
              const raw = rule.style.getPropertyValue("font-size");
              if (raw) {
                if (!condOk(conds)) skipped.cond++;
                else found.push({ sel: rule.selectorText, raw });
              }
            }
          }
          if (rule.cssRules?.length && !isMedia && !isSupports) walk(rule.cssRules, conds);
        }
      };
      for (const sheet of document.styleSheets) {
        let list;
        try {
          list = sheet.cssRules;
        } catch {
          /* 교차 오리진 시트는 못 읽는다 — 이 저장소의 스타일은 인라인 `<style>`이라 전부 읽힌다 */
          skipped.badSel++;
          continue;
        }
        walk(list, []);
      }
      const out = [];
      const seen = { checked: 0, zero: 0 };
      for (const el of document.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) {
          seen.zero++;
          continue;
        }
        seen.checked++;
        const now = pxOf(getComputedStyle(el).fontSize);
        if (now === null) continue;
        let lost = null;
        let wonType = null;
        let wonClass = false;
        for (const f of found) {
          /* 🔴 **매치되는 «모든» 가지를 본다.** 초안은 `find()`로 첫 가지만 봐서,
             `button, .card .full`은 FAIL이고 `.card .full, button`은 PASS였다 —
             **순서만 뒤집으면 판정이 갈렸다**(검수 실측). */
          let bs;
          try {
            bs = branches(f.sel).filter((b) => el.matches(b));
          } catch {
            skipped.badSel++;
            continue;
          }
          if (!bs.length) continue;
          /* 단위는 이 요소 기준으로 푼다(`em`·`%`는 부모에 딸린다). 못 푸는 값
             (`inherit`·`smaller` 등)은 **판정에서 빼고 «못 읽었다»로 센다.** */
          const val = resolve(f.raw, el);
          if (val === null) {
            skipped.nonPx++;
            continue;
          }
          const same = Math.abs(val - now) < 0.5;
          for (const b of bs) {
            const mine = targetsElement(subject(b));
            if (!same && mine) lost = { sel: b, px: `${f.raw}` };
            if (same && mine) wonClass = true;
            if (same && !mine) wonType = { sel: b, px: `${f.raw}` };
          }
        }
        if (lost && wonType && !wonClass) {
          out.push({
            path: path(el),
            want: lost.px,
            got: `${now}px`,
            intent: lost.sel,
            leak: wonType.sel,
            text: (el.textContent ?? "").trim().slice(0, 20),
          });
        }
      }
      return { leaks: out, seen, skipped };
    })(),
    layout: (cfg.layoutRules ?? [])
      /* 🔴 **조건은 CSS 문자열 그대로 `matchMedia`에 묻는다.** 초안은 `minW/maxH` 같은 **숫자로
         재구현**했는데, 그건 34·37·38회차가 세 번 지적받은 「재는 쪽이 식을 쓰면 오진한다」다.
         게다가 `innerWidth`와 CSS의 레이아웃 뷰포트는 스크롤바가 있으면 갈린다.
         문자열로 두면 **검수자가 CSS와 문자 단위로 대조**할 수도 있다. */
      .filter((r) => matchMedia(r.when).matches)
      .filter((r) => !r.screen || r.screen.includes(cfg.screenId))
      .map((r) => {
        const all = [...document.querySelectorAll(r.sel)];
        if (!all.length) return { ...r, missing: true };
        const rendered = (e) => {
          const b = e.getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        };
        /* 🔴 **렌더 게이트는 `equal-tracks`에만 건다.** 초안은 모든 규칙에 걸었는데,
           `display: none` 요소도 `width`·`top` 같은 **절대 길이는 계산값이 그대로 나온다**
           (배치가 필요 없다 — 검수 실측). 전부에 걸었더니 같은 화면에서 측정이
           **3/3 → 2/3 + notRendered 1**로 줄었다. **자기가 만든 구멍을 자기 안에서 메운 것**이다.
           배치가 끝나야 값이 생기는 것은 grid 트랙뿐이다. */
        const needsLayout = r.expect === "equal-tracks" || r.expect === "below" || r.expect === "same-row";
        const el = needsLayout ? all.find(rendered) : all[0];
        if (!el) return { sel: r.sel, prop: r.prop, why: r.why, notRendered: true };
        if (r.expect === "same-row") {
          /* 🔴 **`below`의 거울상.** 「위에 있어야 한다」가 아니라 「**같은 줄**에 있어야 한다」다.
             50회차 검수가 잡았다: 상한(`max-width: 1359`)을 1500으로 올려도 **전건 PASS**였다 —
             규칙이 경계를 따라가서 침묵하기 때문이다. 「배너는 넓은 화면에서 상단 줄에 선다」는
             이번 회차가 되돌린 «의도»인데 **아무도 주장하지 않고 있었다.** */
          const other = document.querySelector(r.with);
          if (!other || !rendered(other)) return { sel: r.sel, prop: r.prop, why: r.why, notRendered: true };
          const a = el.getBoundingClientRect();
          const b = other.getBoundingClientRect();
          const overlap = Math.round((Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) * 10) / 10;
          return {
            sel: r.sel, prop: `${r.with}와 세로 교차`, why: r.why,
            expect: `> 0(같은 줄)`, got: `${overlap}px`, ok: overlap > 0,
          };
        }
        if (r.expect === "below") {
          /* 🔴 **관계는 관계로 적는다.** 초안은 `top: 62px`이라는 **결과값**을 박았는데,
             액션 바 높이가 44 → 52로 바뀌면 **규칙은 그대로 통과하면서 겹침이 자란다**(검수 지적).
             재는 쪽은 두 사각형을 읽어 비교만 한다 — 식을 쓰지 않는다. */
          const above = document.querySelector(r.after);
          if (!above || !rendered(above)) return { sel: r.sel, prop: r.prop, why: r.why, notRendered: true };
          const gap = Math.round((el.getBoundingClientRect().top - above.getBoundingClientRect().bottom) * 10) / 10;
          return {
            sel: r.sel, prop: `${r.after} 아래 여유`, why: r.why,
            expect: `≥ ${r.gap}px`, got: `${gap}px`, ok: gap >= r.gap,
          };
        }
        const got = getComputedStyle(el)[r.prop];
        if (r.expect === "equal-tracks") {
          const t = got.split(/\s+/).map(parseFloat).filter((n) => !Number.isNaN(n));
          const spread = t.length ? Math.max(...t) - Math.min(...t) : Infinity;
          return {
            sel: r.sel, prop: r.prop, why: r.why, expect: `균등 ${r.tracks}칸`,
            got: `${t.length}칸 · 최대-최소 ${Math.round(spread * 10) / 10}px`,
            ok: t.length === r.tracks && spread <= 0.5,
          };
        }
        return { sel: r.sel, prop: r.prop, expect: r.expect, why: r.why, got, ok: got === r.expect };
      }),
    clip: (() => {
      const out = [];
      let hidden = 0;
      for (const sel of document.querySelectorAll("select")) {
        const r = sel.getBoundingClientRect();
        if (!r.width || !r.height) { hidden++; continue; }
        /*
         * 🔴 **선택 «가능한» 옵션만 잰다.**
         *    초안은 select 전체의 자연폭을 한 번에 읽었는데, 신고 모달에서 가장 긴 옵션
         *    (`— 내 패 (정답 아님)`)은 **전부 `disabled`다** — `openPicker(lockKnown:true)`가
         *    `myCards`를 잠그고, 접미가 붙는 것이 정확히 그 `myCards`다(main.ts).
         *    disabled 옵션은 선택될 수 없고, 닫힌 컨트롤에 표시되는 것은 **선택된 옵션뿐**이며
         *    펼친 팝업은 컨트롤 폭과 무관하게 자기 크기를 잡는다.
         *    → 그 폭으로 낸 FAIL은 **사용자가 볼 수 없는 잘림**이었다(검수 지적, 코드로 확인).
         *
         * 🔴 그리고 「최장」을 **글자 수**로 고르지 않는다. 이모지·한글·라틴이 섞이면
         *    글자 수와 폭은 다르고, 그건 이 파일이 금지한 「재는 쪽이 식을 쓴다」 그 자체다.
         *    옵션마다 사본을 하나씩 만들어 **브라우저가 낸 폭**을 비교한다.
         */
        // 「기본 라벨 + 최악 접미」로 잰다 — 이번 판이 아니라 **최악의 판**에 대한 계약이다.
        // 옵션 글자에 이미 붙어 있는 접미(` — …`)는 떼고 다시 붙인다. `disabled`도 뺴지 않는다:
        // 신고 모달에서 잠긴 카드가 제안 모달에서는 **선택된다**(같은 CSS를 공유한다).
        const worst = [...sel.options].map((o) => o.text.split(" — ")[0] + cfg.clipWorstSuffix);
        if (!worst.length) { hidden++; continue; } // 옵션이 없으면 폭 계약이 없다
        let need = 0;
        let longest = "";
        for (const t of worst) {
          const probeEl = sel.cloneNode(false); // 옵션 없이 껍데기만 — 아래에서 하나만 넣는다
          const only = document.createElement("option");
          only.textContent = t;
          probeEl.appendChild(only);
          // `id`/`name`은 `cloneNode`가 복제한다 — 사본이 DOM에 있는 동안 `getElementById`가
          // 앞엣것을 돌려주고 같은 `name`은 폼을 오염시킨다. 계측기가 페이지를 바꾸면 안 된다.
          probeEl.removeAttribute("id");
          probeEl.removeAttribute("name");
          probeEl.setAttribute("data-zc-clip-probe", "1");
          /*
           * 🔴 **`cssText`에 대입하지 않는다** — 원본이 인라인 스타일을 갖는 순간
           *    그것까지 지워져 **존재하지 않는 컨트롤을 재게 된다.** 속성만 덧건다.
           * 🔴 **`!important`로 건다** — 자기시험 F16이 `width: 90px !important`로 결함을
           *    만들자 사본까지 묶여 «필요폭 = 실제폭»이 나왔고 게이트가 결함을 놓쳤다.
           * 🔴 **`position: absolute`가 핵심이다.** 흐름에서 빠지므로 부모의 flex/grid 배치를
           *    흔들지 않는다 — 즉 **계측이 계측 대상을 교란하지 않는다.** 이 줄을 지우면
           *    조용히 오염된다. (부수로 abspos의 shrink-to-fit이 자연폭을 만든다.)
           */
          for (const [k, v] of [
            ["position", "absolute"], ["left", "-99999px"], ["top", "0"],
            ["visibility", "hidden"], ["width", "auto"], ["min-width", "auto"], ["max-width", "none"],
          ]) probeEl.style.setProperty(k, v, "important");
          sel.parentNode.insertBefore(probeEl, sel.nextSibling);
          const w = probeEl.getBoundingClientRect().width;
          probeEl.remove();
          if (w > need) { need = w; longest = t; }
        }
        // 라벨로 어느 줄인지 말한다 — select에는 `id`도 `name`도 없다(`openPicker`가 안 붙인다).
        const rowLabel = sel.closest(".modal-row")?.querySelector("label")?.textContent?.trim();
        out.push({
          path: sel.id ? `select#${sel.id}` : rowLabel ? `select「${rowLabel}」` : "select[무명]",
          have: r.width,
          need,
          total: sel.options.length,
          longest,
        });
      }
      return { items: out, hidden };
    })(),
    cam: (() => {
      const g = window.__zcGame;
      if (!g) return null;
      const sc = g.scene.getScenes(true).find((x) => typeof x.camFraming === "function");
      return sc ? sc.camFraming() : null;
    })(),
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
      const WHERE = { ancestor: "상자 안에서 접힘 아래(스크롤 상자가 자름)", both: "뷰포트·스크롤 상자 둘 다 자름", viewport: "뷰포트 밖" };
      if (it.offscreen) {
        s1bad++;
        s1.push(
          `✗ ${it.path} — ${it.cut ? WHERE[it.cut.by] : "뷰포트 밖"}(통째로) ` +
          `(rect ${it.rect.x},${it.rect.y} ${it.rect.w}×${it.rect.h}) · ${p.why}`);
        continue;
      }
      // 잘림 — 「보이는데 못 쓴다」의 다른 얼굴이다. 한계 1px은 서브픽셀 몫.
      if (it.cut && (it.cut.w > 1 || it.cut.h > 1)) {
        s1bad++;
        s1.push(
          `✗ ${it.path} — ${it.cut.by === "viewport" ? "뷰포트에 잘림" : WHERE[it.cut.by]} ` +
          `(밖으로 ${it.cut.w}×${it.cut.h}px · rect ${it.rect.x},${it.rect.y} ${it.rect.w}×${it.rect.h}) · ${p.why}`);
        continue; // `offscreen` 분기와 대칭 — 안 그러면 잘림+가림인 요소를 두 번 센다
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

  // S3 — 타깃 크기. **하한이 포인터마다 다르다**(손가락 44 = HIG/2.5.5 · 마우스 24 = WCAG 2.5.8 AA).
  // 🔴 27회차까지 마우스 뷰포트는 **통째로 SKIP**이었다 — 「44를 마우스에 요구하지 않는다」는
  //    옳지만 그 결론이 「아무것도 안 잰다」가 된 것이 구멍이었다. 2.5.8은 AA이고 포인터를 안 가린다.
  // ⚠️ **양쪽 다 확인한다.** 예전에는 `!viewport.coarse`면 즉시 SKIP이라 문제가 없었지만,
  //    이제 마우스 뷰포트도 판정하므로 **에뮬이 새면 조용한 위양성**이 난다 —
  //    페이지는 44px CSS로 그려지는데 판정은 24로 통과한다(검수 지적).
  if (viewport.coarse !== data.coarse) {
    add("S3", "SKIP",
      `\`pointer: coarse\` 에뮬레이션이 뷰포트 설정과 어긋난다(기대 ${viewport.coarse} · 페이지 ${data.coarse}) — 판정 불가`,
      {});
  } else {
    const floor = viewport.coarse ? SCREEN.minTouchPx : SCREEN.minPointerPx;
    const t = data.touch;
    const ex = t.excluded;
    const small = t.all.filter((s) => s.side < floor - 0.5);
    add("S3", small.length ? "FAIL" : "PASS",
      `${t.counted}개 검사 · 미달 ${small.length}개 (하한 ${floor}px — ` +
        `${viewport.coarse ? "손가락 · HIG 44" : "마우스 · WCAG 2.5.8 AA 24"})` +
        ` · 제외 숨김 ${ex.hidden} · 비활성 ${ex.disabled} · 문서 밖 ${ex.outsideDoc} · 면제 ${ex.exempt}`,
      { lines: small.map((s) => `✗ ${s.path} ${s.w}×${s.h} (최소변 ${s.side}px) "${s.text}"`) });
  }

  // ── S5 글자 크기 하한 ──
  // «읽히는가»의 전부가 아니라 **하한 하나**다. 손가락 뷰포트에서만 잰다(S3와 같은 규약).
  const tx = data.text ?? { items: [], excluded: {} };
  if (!viewport.coarse) {
    add("S5", "SKIP",
      `글자 크기 하한은 \`pointer: coarse\`(폰)에서만 판정한다 — ${viewport.label}는 시거리·확대 전제가 다르다`,
      {});
  } else {
    const tiny = tx.items.filter((i) => i.px < SCREEN.minFontPx - 0.01).sort((a, b) => a.px - b.px);
    const ex = tx.excluded;
    add("S5", tiny.length ? "FAIL" : "PASS",
      `글자 ${tx.items.length}줄 검사 · 하한 ${SCREEN.minFontPx}px 미달 ${tiny.length}건` +
        ` · 제외 글자없음(이모지·기호만) ${ex.noLetters ?? 0} · 숨김 ${ex.hidden ?? 0} · 면제 ${ex.exempt ?? 0}`,
      { lines: tiny.map((i) => `✗ ${i.path} ${i.px}px "${i.text}"`) });
  }

  // 큰 글자 판정과 하한 — **S6와 S9가 같은 함수를 쓴다.** 상태가 바뀐다고 읽기 기준이
  // 느슨해지지 않으므로, 갈라 두면 언젠가 한쪽만 고쳐진다.
  const isLarge = (i) =>
    i.px >= SCREEN.largeFontPx || (i.weight >= 700 && i.px >= SCREEN.largeBoldFontPx);
  const floorOf = (i) => (isLarge(i) ? SCREEN.minContrastLarge : SCREEN.minContrast);

  // ── S6 명암비(WCAG 2.1 AA) ──
  // 뷰포트와 무관한 성질이지만 화면마다 나오는 글자가 다르므로 화면·뷰포트마다 잰다.
  {
    const measured = tx.items.filter((i) => typeof i.contrast === "number");
    const unmeasured = tx.items.filter((i) => typeof i.contrast !== "number");
    const dim = measured
      .filter((i) => i.contrast < floorOf(i) - 0.005)
      .sort((a, b) => a.contrast - b.contrast);
    const worst = measured.length ? Math.min(...measured.map((i) => i.contrast)) : null;
    add("S6", dim.length ? "FAIL" : "PASS",
      `글자 ${measured.length}줄 판정 · AA 미달 ${dim.length}건` +
        `${worst === null ? "" : ` · 최저 ${worst}:1`}` +
        ` · 판정 불가 ${unmeasured.length}건(배경 이미지·캔버스 위 — 사람 몫)`,
      {
        lines: [
          ...dim.map(
            (i) =>
              `✗ ${i.path} ${i.contrast}:1 < ${floorOf(i)}:1 (${i.px}px w${i.weight}) ` +
              `${i.fg} on ${i.bg} "${i.text}"`,
          ),
          ...unmeasured.map((i) => `· ${i.path} 판정 불가 — ${i.why} "${i.text}"`),
        ],
      });
  }

  // ── S10 카메라 프레이밍 ──
  // 추적 대상이 «보이는 영역» 중앙에 오는가. **DOM으로는 안 보이는 축**이라,
  // 게이트가 전건 PASS를 찍는 동안 34회차가 내 말을 화면 80% 지점(D패드 뒤)으로
  // 밀어 놓고도 몰랐다 — 서브에이전트 검수가 캡처를 보고서야 잡았다.
  // 그래서 **씬이 자기 좌표를 직접 낸다**(`camFraming()`). 재는 쪽은 식을 쓰지 않는다.
  {
    const cm = data.cam;
    if (!screen.camFrame) {
      // 🔴 **조용히 빼지 않는다.** 이 축은 «평상 판»에서만 계약이 성립한다 —
      //    모달이 열려 있거나(목표 카드·신고 모달) 판이 끝난 화면은 카메라가
      //    추적 대상을 중앙에 둘 이유가 없고, 턴 전환 `pan` 도중이면 정의상 어긋나 있다.
      //    실측으로 그 화면들에서 16~213px 어긋난다 — **결함이 아니라 다른 상태**다.
      add("S10", "SKIP",
        "이 화면은 «평상 판»이 아니다(모달·종료·전환 중) — 프레이밍 계약이 성립하지 않는다. " +
        (cm
          ? `참고 실측: 대상 (${cm.x}, ${cm.y}) · 중앙 (${cm.wantX}, ${cm.wantY})`
          : "보드 씬 없음"));
    } else if (!cm) {
      add("S10", "SKIP", "이 화면에는 추적 중인 보드 씬이 없다 — 프레이밍은 판정 대상이 아니다");
    } else {
      const dx = Math.abs(cm.x - cm.wantX);
      const dy = Math.abs(cm.y - cm.wantY);
      const tol = SCREEN.camCenterTolPx;
      const bad = dx > tol || dy > tol;
      add("S10", bad ? "FAIL" : "PASS",
        `추적 대상 화면 (${cm.x}, ${cm.y}) · 보이는 영역 중앙 (${cm.wantX}, ${cm.wantY}) · ` +
        `어긋남 (${dx.toFixed(1)}, ${dy.toFixed(1)}) ≤ ${tol}px · zoom ${cm.zoom}` +
        (bad ? " — **프레이밍이 어긋났다**" : ""),
        {});
    }
  }

  // ── S15 글자 크기 의도 ──
  // 「요소를 겨냥한 선언이 타입만 겨냥한 선언에 졌는가」. S5는 **하한**만 재므로
  // 「하한은 지켰는데 의도가 뒤집힌」 회귀는 원리적으로 안 보였다(56회차 실증 · `.char`가 첫 번째).
  {
    const ti = data.typeIntent ?? { leaks: [], seen: { checked: 0, zero: 0 }, skipped: {} };
    const sk = ti.skipped ?? {};
    const unmeasured = (sk.nonPx ?? 0) + (sk.nested ?? 0) + (sk.badSel ?? 0);
    add("S15", ti.leaks.length ? "FAIL" : "PASS",
      /* 🔴 **은폐된 미측정을 만들지 않는다.** 초안은 크기 0인 요소를 조용히 건너뛰고
         (랜딩 140개 중 100개!) 못 읽은 선언도 안 셌다 — 이 파일이 스스로 「은폐된 미측정이
         가장 위험하다」고 적어 둔 규약을 어겼다(검수 지적). S5·S11이 이미 제외 수를 인쇄한다. */
      `요소 ${ti.seen.checked}개 검사 · 안 그려져 제외 ${ti.seen.zero}개 · ` +
        `«타입 선언에 진 글자 크기» ${ti.leaks.length}건 · ` +
        `못 읽은 선언 ${unmeasured}건(px 아님 ${sk.nonPx ?? 0} · 중첩 ${sk.nested ?? 0} · 해석 실패 ${sk.badSel ?? 0}) · ` +
        `조건 불일치로 건너뜀 ${sk.cond ?? 0}건`,
      {
        always: true,
        lines: ti.leaks.length
          ? ti.leaks.map(
              (l) =>
                `✗ ${l.path} — \`${l.intent}\`의 **${l.want}** 의도가 \`${l.leak}\`에 져서 ` +
                `**${l.got}**로 그려진다 "${l.text}"`,
            )
          : [
              "□ 이 검사가 없던 시절 **세 번** 새어 나갔다 — `.char`(12 → 15px) · " +
                "`.inv-code-v`(20 → 15px) · `.full`(16 → 15px). 셋 다 `.card button`이 이겼고, " +
                "앞의 둘은 **사람이 눈으로** 찾았다(게이트는 전건 초록이었다). 셋째는 이 검사가 찾았다",
              "□ **못 읽은 선언은 «괜찮다»가 아니다** — px 리터럴이 아니거나(`rem`·`inherit`) " +
                "CSS 중첩(`&`)이면 이 검사는 그 선언을 못 본다. 그 수가 늘면 검사가 조용해진다",
            ],
      });
  }

  // ── S12 조판 분기 ──
  // 「의도한 조판이 섰는가」. S1~S11은 «들어가는가»만 재므로 분기 경계의 회귀를 못 본다
  // (47회차 실증: 가드를 되돌려도 카드가 더 작아질 뿐이라 전건 PASS였다).
  {
    const rules = data.layout ?? [];
    if (!rules.length) {
      add("S12", "SKIP", "이 뷰포트에 걸리는 조판 규칙이 없다 — 선언은 `gate.config.mjs`의 `layoutRules`에 있다");
    } else {
      const bad = rules.filter((r) => r.missing || r.ok === false);
      const skipped = rules.filter((r) => r.notRendered).length;
      add("S12", bad.length ? "FAIL" : "PASS",
        `조판 규칙 ${rules.length}건 · 어긋남 ${bad.length}건 · 안 그려져 못 잼 ${skipped}건`,
        {
          /* 🔴 **PASS여도 접지 않는다.** 초안은 접혀서, 규칙 88건 중 **50건이 «안 그려져 못 잼»**인
             사실이 사람 눈에 한 번도 안 닿았다(검수 실측) — 이 파일이 S8에 `always`를 박아 둔
             이유(「통과가 «정상»이 아니라 «안 나빠졌다»는 뜻이라 접히는 순간 게이트가 거짓말을
             시작한다」)와 같다. */
          always: true,
          lines: rules.map((r) =>
            r.missing
              ? `✗ ${r.sel} — 이 화면에 없다(규칙이 낡았거나 선택자가 죽었다) · ${r.why}`
              : r.notRendered
                ? `- ${r.sel} { ${r.prop} } — 이 화면에서는 안 그려진다(배치 전 값이라 못 잰다) · ${r.why}`
              : r.ok === false
                ? `✗ ${r.sel} { ${r.prop} } — 기대 «${r.expect}» · 실제 «${r.got}» · ${r.why}`
                : `· ${r.sel} { ${r.prop} } = ${r.got} · ${r.why}`),
        });
    }
  }

  // ── S11 선택 컨트롤 잘림 ──
  // 「고를 수 있는 옵션이 컨트롤 안에 들어가는가」. 필요폭은 **브라우저가 낸 자연폭**이다.
  // 이 축이 없어서 39회차 결함(창을 세로로 줄인 데스크톱 전부에서 옵션이 잘림)이 세 회차를 살았다.
  // ⚠️ **뷰포트를 늘리는 것만으로는 안 잡힌다** — 40회차가 결함을 되주입해 확인했다
  //    (빈 구간에서도 S1~S10 전건 PASS). 상태를 만드는 것과 재는 것은 다른 일이다.
  {
    const items = data.clip?.items ?? [];
    const hidden = data.clip?.hidden ?? 0;
    if (!items.length) {
      add("S11", "SKIP",
        `이 화면에 폭 계약을 가진 \`<select>\`가 없다 — 제외 ${hidden}개(숨김·선택 가능한 옵션 0)`);
    } else {
      const tol = SCREEN.clipTolPx;
      const px = (n) => Math.round(n * 10) / 10;      // 표시용 — **비교는 원값으로 한다**
      const bad = items.filter((it) => it.need > it.have + tol);
      const line = (it) =>
        `${it.path} — 폭 ${px(it.have)}px · 고를 수 있는 최장 옵션에 필요한 폭 ${px(it.need)}px ` +
        `(선택 가능 ${it.usable}/${it.total}개 · 최장 「${it.longest}」)`;
      add("S11", bad.length ? "FAIL" : "PASS",
        // **판정 기준을 판정문에 적는다.** 「이번 판」이 아니라 「최악의 판」이다 —
        // 모든 옵션에 `clipWorstSuffix`를 붙여 재므로 딜과 무관하고 실행마다 같은 값이 나온다
        // (실측: 같은 결함을 2회 연속 동일하게 잡는다). 그전 초안은 그 판에 있는 글자를 그대로
        // 재서 필요폭이 209~219px로 흔들렸고, **아슬아슬한 회귀가 운으로 통과할 수 있었다.**
        `선택 컨트롤 ${items.length}개 · 잘림 ${bad.length}개 (한계 ${tol}px · 제외 ${hidden}개) — ` +
        `기준은 **최악의 판**이다(모든 옵션에 「${SCREEN.clipWorstSuffix.trim()}」를 붙여 잰다 · 딜 무관)`,
        {
          lines: items.map((it) =>
            it.need > it.have + tol
              ? `✗ ${line(it)} — **${px(it.need - it.have)}px 모자라 잘린다**`
              : `· ${line(it)}`),
        });
    }
  }

  // ── S14 포커스 기하 ──
  // 「포커스에서 커지는 것이 남을 덮는가」. S13은 마우스 hover만 만들고 coarse를 SKIP하는데,
  // **포커스는 손가락에도 있다** — 43회차가 큐에 남긴 배경음 슬라이더가 그 교집합에 있었다.
  {
    const f = data.focusGeo;
    if (!SCREEN.focusPairs?.length) {
      add("S14", "SKIP", "선언된 focus 쌍이 없다 — 선언은 `gate.config.mjs`의 `focusPairs`에 있다");
    } else if (!f) {
      add("S14", "SKIP", "이 화면은 포커스 계측 경로를 안 탄다(결과 흐름은 `grab()`이 본 계측만 부른다)");
    } else if (f.unavailable) {
      add("S14", "SKIP", `계측 도구를 못 불렀다 — ${f.unavailable}`);
    } else if (f.fail) {
      add("S14", "FAIL", `포커스를 못 쟀다 — ${f.fail}. **조용히 넘어가지 않는다.**`);
    } else {
      const seen = f.items.filter((x) => !x.missing);
      /* 🔴 **상대가 0개면 «괜찮다»가 아니라 «안 쟀다»다.** 초안은 게임 화면에서 `상대 0개`인데
         PASS를 찍었다 — 바로 옆 hover 프로브가 「PASS로 찍으면 «쟀는데 괜찮다»로 읽힌다」고
         적어 둔 그 함정이다(검수 지적). */
      const noPartner = seen.filter((x) => (x.seen ?? 0) === 0);
      const over = (x) => x.w >= SCREEN.minOverlapEdgePx && x.h >= SCREEN.minOverlapEdgePx;
      const notApplied = seen.filter((x) => !x.applied);
      const bad = seen.filter(over);
      add("S14",
        bad.length || notApplied.length ? "FAIL" : noPartner.length === seen.length && seen.length ? "SKIP" : "PASS",
        `focus 쌍 ${f.items.length}개 · 덮음 ${bad.length}개 · 포커스가 안 걸림 ${notApplied.length}개 · ` +
        `상대가 이 화면에 없음 ${noPartner.length}개 · 대상이 없음 ${f.items.length - seen.length}개`,
        {
          always: true,
          lines: f.items.map((x) =>
            x.missing
              ? `□ ${x.focus} — 이 화면에 없다(또는 안 그려졌다) · ${x.why}`
              : !x.applied
                ? `✗ ${x.focus} — **포커스가 안 걸렸다** — 못 잰 것이지 «안 덮는» 것이 아니다 · ${x.why}`
                : over(x)
                  ? `✗ ${x.focus}에 포커스 → ${x.vs}를 **${x.w}×${x.h}px 덮는다**(그때 폭 ${x.on}) · ${x.why}`
                  : (x.seen ?? 0) === 0
                    ? `□ ${x.focus} — **상대가 이 화면에 하나도 없다** — 쟀는데 괜찮은 것이 아니라 잴 대상이 없었다 · ${x.why}`
                    : `□ ${x.focus}에 포커스 → 안 덮는다 · 가장 가까운 ${x.near}까지 ` +
                      `${x.gap == null ? "?" : x.gap}px 남음 · 그때 폭 ${x.on} · 상대 ${x.seen}개 · ${x.why}`),
        });
    }
  }

  // ── S13 hover 기하 ──
  // 「hover에서 커지는 것이 남을 덮는가」. S1은 평상 상태만, S9는 색만 잰다 —
  // 그 사이가 사각지대였고 실측으로 배너(106px)·배경음(97px)이 거기 있었다.
  {
    const g = data.hover?.geo;
    if (!SCREEN.hoverPairs?.length) {
      add("S13", "SKIP", "선언된 hover 쌍이 없다 — 선언은 `gate.config.mjs`의 `hoverPairs`에 있다");
    } else if (!data.hover) {
      add("S13", "SKIP", "이 화면은 hover 계측 경로를 안 탄다(결과 흐름은 `grab()`이 본 계측만 부른다)");
    } else if (data.hover.skip) {
      add("S13", "SKIP", data.hover.skip);
    } else if (data.hover.geoFail) {
      add("S13", "FAIL", `기하를 못 쟀다 — ${data.hover.geoFail}. **«쌍 0개»로 조용히 넘어가지 않는다.**`);
    } else if (data.hover.unavailable) {
      /* 🔴 초안은 이 경우에도 「색 계측은 돌았으므로」라고 적었는데 **거짓**이다 —
         계측 도구 자체를 못 불렀으면 색도 안 돌았다(검수 지적). */
      add("S13", "SKIP", `계측 도구를 못 불렀다 — ${data.hover.unavailable}(색 계측도 함께 못 돌았다)`);
    } else if (!g) {
      add("S13", "SKIP", "기하 계측이 안 돌았다 — 사유가 없으므로 «못 쟀다»로 남긴다");
    } else {
      const seen = g.filter((x) => !x.missing);
      const over = (x) => x.w >= SCREEN.minOverlapEdgePx && x.h >= SCREEN.minOverlapEdgePx;
      /* 🔴 **hover가 안 걸린 것은 «통과»가 아니다.** 초안은 그것을 «덮음 0»으로 찍어
         「안 덮는다」처럼 읽혔다 — 실제로는 아무것도 안 잰 것이었다(검수가 되주입으로 증명). */
      const notHovered = seen.filter((x) => !x.applied && !x.blocked);
      const bad = seen.filter(over);
      add("S13", bad.length || notHovered.length ? "FAIL" : "PASS",
        `hover 쌍 ${g.length}개 · 덮음 ${bad.length}개 · **사유 없이 hover 안 걸림 ${notHovered.length}개** · ` +
        `덮여서 불가 ${seen.filter((x) => !x.applied && x.blocked).length}개 · ` +
        `이 화면에 없음 ${g.length - seen.length}개`,
        {
          always: true,
          /* 🔴 PASS 줄은 **`□`로 시작해야 인쇄된다** — 인쇄부가 `✗`/`□` 아닌 줄을 버린다.
             초안은 `·`라 `always: true`가 **무력**했고 계측 수치가 한 줄도 안 나왔다. */
          lines: g.map((x) =>
            x.missing
              ? `□ ${x.hover} — 이 화면에 없다(또는 안 그려졌다) · ${x.why}`
              : !x.applied
                ? x.blocked
                  ? `□ ${x.hover} — **${x.blocked}이 덮고 있어 hover가 원리적으로 불가능**하다(모달 등) — 결함이 아니라 다른 상태다 · ${x.why}`
                  : `✗ ${x.hover} — **hover가 한 번도 안 걸렸다**(${x.tried}개 시도) — 못 잰 것이지 «안 덮는» 것이 아니다 · ${x.why}`
                : over(x)
                  ? `✗ ${x.hover}에 hover → ${x.vs}를 **${x.w}×${x.h}px 덮는다**(그때 폭 ${x.on} · ${x.applied}/${x.tried}칸) · ${x.why}`
                  : `□ ${x.hover}에 hover → ${x.vs}와 교차 ${x.w}×${x.h} · 최악 칸의 폭 ${x.on} · ${x.applied}/${x.tried}칸 · ${x.why}`),
        });
    }
  }

  // ── S9 상태(hover) 대비 ──
  // 하한은 S6와 **같다**(AA 4.5 / 큰 글자 3.0) — 상태가 바뀐다고 읽기 기준이 느슨해지지 않는다.
  // 🔴 **«없음»으로 조용히 빠지지 않는다.** 이 파일 머리글이 「은폐된 미측정이 회귀보다
  //    위험하다」고 못 박는데, 초안은 `data.hover`가 없으면 **체크를 아예 안 만들었다** —
  //    결과 흐름 6화면이 그렇게 빠져 있었다(`grab()`이 `probeHoverStates`를 안 부른다).
  if (!data.hover) {
    add("S9", "SKIP", "이 화면은 상태(hover) 계측 경로를 안 탄다 — 결과 흐름은 `grab()`이 본 계측만 부른다(플랜 47 큐)");
  } else if (data.hover.skip) {
    add("S9", "SKIP", data.hover.skip);
  } else if (data.hover.unavailable) {
    add("S9", "SKIP", data.hover.unavailable);
  } else if (data.hover.candidates === 0) {
    // 선택자가 죽거나 화면이 안 그려져도 초록이 되면 안 된다.
    add("S9", "SKIP", "조작 요소가 0개다 — 잴 것이 없는 것인지 못 찾은 것인지 기계가 구분 못 한다");
  } else {
    const hv = data.hover;
    const measured = hv.items.filter((i) => typeof i.contrast === "number");
    const unmeasured = hv.items.filter((i) => typeof i.contrast !== "number");
    const bad = measured
      .filter((i) => i.contrast < floorOf(i) - 0.005)
      .sort((a, b) => a.contrast - b.contrast);
    add("S9", bad.length ? "FAIL" : "PASS",
      `조작 요소 ${hv.candidates}개에 hover · 색이 바뀐 것 ${hv.items.length}건 · ` +
        `AA 미달 ${bad.length}건` +
        (unmeasured.length ? ` · 판정 불가 ${unmeasured.length}건` : ""),
      {
        lines: [
          // `on`(마우스를 올린 곳)을 반드시 찍는다 — 없으면 같은 `path` 여러 줄이
          // 완전히 동일해져 어느 것을 눌렀을 때 난 것인지 구분되지 않는다(검수 지적).
          ...bad.map(
            (i) =>
              `✗ [${i.on} 에 hover] ${i.path} ${i.contrast}:1 < ${floorOf(i)}:1 ` +
              `(${i.px}px w${i.weight}) "${i.text}"`,
          ),
          ...unmeasured.map((i) => `· [${i.on} 에 hover] ${i.path} 판정 불가 — ${i.why}`),
        ],
      });
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
  textExempt: [...SCREEN.textExempt, ...(screen.textExempt ?? [])],
  sampleInsetPct: SCREEN.sampleInsetPct,
  minOverlapPx2: SCREEN.minOverlapPx2,
  minOverlapEdgePx: SCREEN.minOverlapEdgePx,
  clipWorstSuffix: SCREEN.clipWorstSuffix,
  layoutRules: SCREEN.layoutRules ?? [],
  screenId: screen.id,
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

/**
 * S9 — **상태(hover) 대비.** 25회차에 `button:hover`가 커스텀 버튼으로 새어
 * 상자 전체가 진갈색이 되고 글자 대비가 1.16:1이 됐는데, 게이트는 그걸 **원리적으로
 * 못 봤다** — 자기 리포트에 「§사람 확인: hover 상태의 색은 사람 몫」이라 인쇄하고 있었다.
 *
 * **JS로는 `:hover`를 만들 수 없다.** 그래서 여기서 **진짜 마우스를 움직인다**
 * (`CSS.forcePseudoState`보다 실제에 가깝다 — 브라우저 자신의 히트 테스트를 쓴다).
 * 요소마다 CDP 왕복 2회(이동 + 계측)이고, 후보는 조작 요소로 한정한다.
 *
 * ⚠️ **«달라진 것»만 잰다.** hover에서 색이 안 바뀌는 요소는 S6가 이미 쟀다 —
 *    여기서 또 세면 같은 위반을 두 번 세고, 어느 검사가 잡은 것인지 흐려진다.
 */
/**
 * S14 — **포커스에서 «커지는» 것이 남을 덮는가.**
 *
 * 🔴 S13(hover 기하)이 원리적으로 못 보는 축이다. 43회차가 「거터로는 못 막는다 · 사람 몫」으로
 *    큐에 남긴 배경음 슬라이더가 정확히 여기 있다:
 *      · 그 축은 `:hover`가 아니라 **`:focus-within`**이고
 *      · 결함은 **coarse 뷰포트에만** 나는데 S13은 coarse를 통째로 SKIP한다
 *        (브라우저가 hover를 안 만든다 — 그건 hover 축에서는 옳은 판단이다).
 *    **포커스는 손가락에도 있다** — 슬라이더를 탭하면 걸린다. 그래서 이 프로브는
 *    마우스를 안 쓰고 `focus()`만 부르며, **모든 뷰포트에서 돈다.**
 *
 * 재는 쪽은 사각형 둘을 읽어 교차만 낸다 — 식을 쓰지 않는다.
 * ⚠️ 주입 코드에 **백틱을 쓰지 않는다** — 51회차가 중첩 템플릿 리터럴로 파일을 두 번 깨뜨렸다.
 */
const probeFocusGeometry = async (sid, pairs = SCREEN.focusPairs ?? []) => {
  if (!pairs.length) return { items: [], skip: "선언된 focus 쌍이 없다 — `gate.config.mjs`의 `focusPairs`" };
  try {
    await evalIn(sid, `window.__zcState.freeze(true)`);
  } catch (e) {
    return { items: [], unavailable: `계측 도구를 못 불렀다 — ${e.message}` };
  }
  const items = [];
  let fail = null;
  for (const fp of pairs) {
    try {
      const m = await evalIn(sid, `(() => {
        /* 매치 «전부»를 돌아 최악을 취한다 — 51회차가 hover에서 「첫 매치만 보면
           «덮음 0»이 «안 쟀다»였다」로 뒤집혔고, S14 초안은 그 교훈을 인용하면서 채택 안 했다.
           ⚠️ 이 주입 코드 안에는 백틱을 쓰지 않는다 — 51·52회차가 세 번 파일을 깨뜨렸다. */
        const cands = [...document.querySelectorAll(${JSON.stringify(fp.focus)})];
        if (!cands.length) return { missing: true };
        const a = cands[0];
        /* 🔴 **폭 0이라고 «없다»로 치면 안 된다.** 초안이 그랬는데, 포커스를 줘야 «커지는»
           요소는 접혀 있을 때 폭이 0이다 — 배경음 슬라이더가 정확히 그렇다.
           걸러야 하는 것은 «크기»가 아니라 «렌더 자체가 없음»이다. */
        if (typeof a.checkVisibility === "function"
            && !a.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }))
          return { missing: true };
        /* focus()는 문서를 스크롤할 수 있다 — 카드 화면은 body.no-scroll이 없어
           실제로 움직일 수 있고 그 뒤에 S9·S13이 돈다. 지금 안 움직이는 것은 우연이다. */
        a.focus({ preventScroll: true });
        const host = ${JSON.stringify(fp.on ?? null)}
          ? a.closest(${JSON.stringify(fp.on ?? "*")}) : a;
        if (!host) return { missing: true };
        const applied = host.matches(":focus-within");
        const vis = (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const bs = [...document.querySelectorAll(${JSON.stringify(fp.vs)})].filter(vis);
        const ra = host.getBoundingClientRect();
        const r10 = (n) => Math.round(Math.max(0, n) * 10) / 10;
        /* «겹쳤나»만 재면 여유 0.1px과 여유 40px이 같은 PASS로 보인다 —
           52회차가 여유 16px을 -4px로 바꿔 놓고도 PASS를 받은 이유가 그것이다.
           그래서 안 겹칠 때는 «얼마나 더 자라야 닿는가»를 함께 잰다.
           두 사각형은 두 축 «모두»에서 겹쳐야 겹치므로, 그 거리는 큰 쪽 간격이다. */
        let best = { w: 0, h: 0 };
        let gap = Infinity, near = "";
        const nm = (e) => e.id ? "#" + e.id : "." + (e.className || "").split(/\s+/)[0];
        for (const b of bs) {
          if (host.contains(b) || b.contains(host)) continue;
          const rb = b.getBoundingClientRect();
          const w = r10(Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
          const h = r10(Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
          if (w * h > best.w * best.h) best = { w, h };
          if (!(w > 0 && h > 0)) {
            const dx = Math.max(rb.left - ra.right, ra.left - rb.right, 0);
            const dy = Math.max(rb.top - ra.bottom, ra.top - rb.bottom, 0);
            const d = r10(Math.max(dx, dy));
            if (d < gap) { gap = d; near = nm(b); }
          }
        }
        a.blur();
        return { ...best, on: r10(ra.width), applied, seen: bs.length,
                 gap: Number.isFinite(gap) ? gap : null, near };
      })()`);
      items.push({ ...fp, ...(m ?? { missing: true }) });
    } catch (e) {
      fail = `포커스 계측 중 예외 — ${e.message}`;
    }
  }
  await evalIn(sid, `window.__zcState.freeze(false)`).catch(() => {});
  return { items, fail };
};

const probeHoverStates = async (sid, cfgHoverPairs = SCREEN.hoverPairs ?? []) => {
  let cands = [];
  try {
    // 🔴 **손가락 화면에서는 아예 안 잰다.** 게이트가 폰 뷰포트에 `hover: none`을
    //    **에뮬레이션으로 강제**하므로 브라우저가 hover 상태를 만들지 않는다.
    //    실기 폰에도 hover가 없다는 판단까지 더해 여기서는 **SKIP + 사유**가 정답이다 —
    //    PASS로 찍으면 «쟀는데 괜찮다»로 읽힌다.
    if (!(await evalIn(sid, `window.__zcState.hoverable()`)))
      return {
        items: [],
        candidates: 0,
        skip:
          "이 뷰포트는 `hover: none`으로 에뮬레이션된다 — 브라우저가 hover 상태를 안 만든다. " +
          "실기 폰에도 hover가 없으므로 «못 쟀다»가 아니라 «없는 상태»다",
      };
    // ⚠️ **전이를 끈다.** 안 끄면 ① `.bgm-ctrl`의 `transition .18s`처럼 전이가 걸린 hover 색을
    //    **한 번도 못 잡고**(실측: 정착 300ms를 주면 잡히지만 화면 하나가 2.0s → 10.1s가 된다)
    //    ② 전 후보의 잔상이 **다음** 후보 계측에 섞인다(실측 확인).
    await evalIn(sid, `window.__zcState.freeze(true)`);
    cands = (await evalIn(sid, `window.__zcState.candidates()`)) ?? [];
  } catch (e) {
    return { items: [], candidates: 0, unavailable: `계측 도구를 못 불렀다 — ${e.message}` };
  }
  /* ── S13 hover 기하 ────────────────────────────────────────────────
     🔴 **hover에서 «커지는» 요소가 남을 덮는 축을 아무도 안 쟀다.**
        S1은 평상 상태만, S9는 **색**만 잰다. 그래서 실측으로 이런 것이 통과했다:
          · 배너에 hover → 이름 6개가 펼쳐져 폭 326 → **612**, 액션 바를 **106px** 덮는다
            (50회차가 배너를 상단 줄로 되돌리며 **되살린 축**이다)
          · 배경음 컨트롤에 `:focus-within` → 왼쪽으로 **97px** 커져 카드 내용을 덮는다(43회차 큐)
        마우스를 진짜로 움직이는 장치가 **바로 여기 있는데** 색만 읽고 있었다.
        재는 쪽은 사각형 둘을 읽어 교차만 낸다 — 식을 쓰지 않는다. */
  const geo = [];
  let geoFail = null;
  for (const hp of cfgHoverPairs) {
    /* 🔴 **매치 «전부»를 돌아 최악을 취한다.** 초안은 `querySelector`로 첫 매치의 **중심**에
       마우스를 놓았는데, `.hud-turn` 중심은 상태 줄과 칩 줄 사이의 **여백**이라
       `elementFromPoint`가 배너 자신을 돌려준다 — `.ti-chip:hover`가 **한 번도 안 걸렸다.**
       그래서 «덮음 0»은 「안 덮는다」가 아니라 **「hover를 안 만들었다」**였다(검수가 되주입
       140.8×40px으로 증명했다). 이제 `hover: ".ti-chip"`이라 선언하면 **가장 긴 이름**이
       자동으로 잡힌다.
       🔴 그리고 **hover가 실제로 걸렸는지 확인한다** — 안 걸렸으면 «못 쟀다»로 남긴다.
          바로 옆 `stateCand`가 이미 같은 패턴을 쓴다. */
    try {
      const pts = await evalIn(sid, `(() => {
        const vis = (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        return [...document.querySelectorAll(${JSON.stringify(hp.hover)})].filter(vis).map((e, i) => {
          const r = e.getBoundingClientRect();
          return { i, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
      })()`);
      if (!pts?.length) { geo.push({ ...hp, missing: true }); continue; }
      let worst = null;
      let applied = 0;
      let blocked = null;
      for (const pt of pts) {
        await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, buttons: 0 }, sid);
        const m = await evalIn(sid, `(() => {
          const all = [...document.querySelectorAll(${JSON.stringify(hp.hover)})];
          const a = all[${pt.i}];
          if (!a) return null;
          /* vs 쪽은 **보이는 것**만 본다 — 초안은 querySelector라 숨은 랜딩 카드를 잡아
             0x0을 «교차 없음»으로 통과시켰다(검수 실측). S1은 filter(shown)을 쓴다. */
          const bs = [...document.querySelectorAll(${JSON.stringify(hp.vs)})].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const ra = a.getBoundingClientRect();
          const r10 = (n) => Math.round(Math.max(0, n) * 10) / 10;
          let best = { w: 0, h: 0 };
          for (const b of bs) {
            if (a.contains(b) || b.contains(a)) continue; // 포함관계는 «가림»이 아니다
            const rb = b.getBoundingClientRect();
            const w = r10(Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
            const h = r10(Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
            if (w * h > best.w * best.h) best = { w, h };
          }
          /* 🔴 hover가 안 걸린 «사유»를 읽는다 — 모달이 열려 있으면 오버레이가 칩을 덮어
             hover가 원리적으로 불가능하다. 그건 결함이 아니라 **다른 상태**다.
             바로 옆 stateCand가 이미 같은 패턴(중심이 남에게 가려졌는지)을 쓴다. */
          const hovered = a.matches(":hover");
          let blockedBy = null;
          if (!hovered) {
            const hit = document.elementFromPoint(${pt.x}, ${pt.y});
            blockedBy = !hit ? "화면 밖" : (hit === a || a.contains(hit)) ? null
              : hit.tagName.toLowerCase()
                + (hit.id ? "#" + hit.id : "")
                + (hit.className && typeof hit.className === "string"
                    ? "." + hit.className.trim().split(/\s+/)[0] : "");
          }
          return { ...best, on: r10(ra.width), hovered, blockedBy };
        })()`);
        if (!m) continue;
        if (m.hovered) applied++;
        else if (m.blockedBy) blocked = m.blockedBy;
        if (!worst || m.w * m.h > worst.w * worst.h) worst = m;
      }
      geo.push({ ...hp, ...(worst ?? {}), tried: pts.length, applied, blocked });
    } catch (e) {
      geoFail = `기하 계측 중 예외 — ${e.message}`;
    }
  }
  await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: -20, y: -20, buttons: 0 }, sid).catch(() => {});

  const items = [];
  try {
    for (const c of cands) {
      await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y, buttons: 0 }, sid);
      const r = await evalIn(
        sid,
        `window.__zcState.measure(${c.x}, ${c.y}, ${JSON.stringify(c.rest)})`,
      );
      if (r) items.push({ ...r, on: c.path });
    }
  } catch (e) {
    // ⚠️ **S9가 화면 전체를 인질로 잡으면 안 된다.** 여기서 예외가 새면 `openScreen`의 catch가
    //    받아 그 화면이 «도달 실패»가 되고 S1~S6 판정이 통째로 버려진다.
    //
    // 🔴 **«TypeError»가 아니라 «무슨 일이 있었는지»를 적는다.** 주입한 계측 도구는
    //    페이지가 이동하면 통째로 사라진다 — 클라는 탈락·종료에서 `location.href = "/"`로
    //    나간다(`main.ts`의 `exitToMain`). 그러면 여기서 `__zcState`가 `undefined`가 되고
    //    초안은 그 원본 TypeError를 그대로 인쇄했다. 54회차가 서버 방 생성에 왕복 하나를
    //    더하자 판 시각이 밀려 그 이동이 **계측 창 안으로** 들어왔고, 리포트에는
    //    「Cannot read properties of undefined (reading 'measure')」만 남아 **원인을 못 읽었다.**
    //    도구가 사라진 것이 확인되면 그 사실을 그대로 말한다.
    const gone = await evalIn(sid, `typeof window.__zcState === "undefined"`).catch(() => false);
    const url = gone ? await evalIn(sid, `location.href`).catch(() => null) : null;
    return {
      items,
      candidates: cands.length,
      unavailable: gone
        ? `계측 도중 **페이지가 이동했다** — 주입한 계측 도구가 사라졌다(지금 ${url ?? "?"}). ` +
          `클라는 탈락·종료에서 «/»로 나간다(\`exitToMain\`) — 이 탭은 hover를 못 잰다`
        : `계측 중 예외 — ${e.message}`,
    };
  } finally {
    // 커서를 화면 밖으로 뺀다(잔상 방지) · 전이를 되살리고 계측 도구를 지운다.
    await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: -20, y: -20, buttons: 0 }, sid).catch(() => {});
    await evalIn(sid, `window.__zcState.done()`).catch(() => {});
  }
  return { items, candidates: cands.length, geo, geoFail };
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

    if (faultJs) await evalIn(sid, faultJs);

    // 캡처는 **뷰포트만** 찍는다. 전체 페이지 캡처는 밀려 올라간 화면을 정상으로 렌더한다.
    const data = await probeTab(sid, screen, `${screen.id}-${vp.id}`);
    // S9는 캡처·본 계측 **뒤에** 돈다 — 마우스를 움직이므로 앞에 두면 다른 검사가
    // hover 상태를 재게 된다.
    data.focusGeo = await probeFocusGeometry(sid);
    data.hover = await probeHoverStates(sid);
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

/** 신고 모달의 select 3개에서 «전체 후보»와 «내 패(=disabled)»를 읽는다. */
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
  if (!b) return { ok: false, why: '[신고한다] 버튼이 없다' };
  b.click();
  return { ok: true, picked: want };
})()`;

const clickJs = (sel) => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return false;
  e.click();
  return true;
})()`;

// ── S8 판 중반 우측 컬럼 배분 (gate.config.mjs `SCREEN.rightColumn`) ─────
//
// 여기 있는 것은 **관측**뿐이다. 판정(래칫 대조)은 Node 쪽 `judgeRightColumn` 한 곳에서 한다
// — 다른 검사와 같은 규약이다.

/**
 * 우측 컬럼의 높이 배분 한 장.
 *
 * 재는 것:
 *   · 컬럼 자식 각각의 실제 높이(= 나눠 가진 몫)
 *   · `#log`(기록/알림 본문)의 **쓸 수 있는 픽셀**(clientHeight − 상하 패딩)
 *   · 그 안에서 **온전히 보이는 줄 수** — 위/아래가 잘리지 않은 로그 줄만 센다.
 *     잘린 줄은 «보인다»가 아니다. 사람은 반 잘린 문장을 사건으로 읽지 않는다.
 *   · 한 줄의 최소 높이(줄바꿈 없는 줄) → 이 상자가 원리적으로 담을 수 있는 줄 수
 *
 * `#log`는 최신이 **위로** 쌓인다(`prepend`) → `scrollTop === 0`이 곧 «지금 보이는 것»이다.
 * 그 사실을 확인해서 함께 돌려준다(스크롤이 내려가 있으면 «가시»의 정의가 달라진다).
 */
const READ_RP_COL_JS = `(() => {
  const col = document.getElementById('rightPanel');
  if (!col) return { err: '#rightPanel 이 없다 — 게임 화면이 아니다' };
  if (getComputedStyle(col).display === 'none')
    return { err: '우측 컬럼이 접혀 있다(display:none) — 나눠 가질 높이가 없다' };
  const VH = window.innerHeight;
  const r1 = (n) => Math.round(n * 10) / 10;
  const visH = (el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(VH, r.bottom) - Math.max(0, r.top));
  };
  const panels = Array.prototype.map.call(col.children, (el) => {
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).join('.') : '';
    return {
      sel: el.id ? '#' + el.id : (cls ? '.' + cls : el.tagName.toLowerCase()),
      h: r1(r.height),
      visH: r1(visH(el)),
      gone: c.display === 'none',
      // 절대 배치(너비 손잡이)는 **흐름 밖**이라 높이를 나눠 갖지 않는다 → 몫 계산에서 뺀다.
      outOfFlow: c.position === 'absolute' || c.position === 'fixed',
      flex: c.flexGrow + ' ' + c.flexShrink + ' ' + c.flexBasis,
      minH: c.minHeight,
      maxH: c.maxHeight,
    };
  });
  const logPanel = document.getElementById('logPanel');
  const body = document.getElementById('log');
  if (!logPanel || !body) return { err: '#logPanel / #log 이 없다' };
  const bs = getComputedStyle(body);
  const padT = parseFloat(bs.paddingTop) || 0;
  const padB = parseFloat(bs.paddingBottom) || 0;
  const usable = Math.max(0, body.clientHeight - padT - padB);
  const br = body.getBoundingClientRect();
  const top = br.top + padT;
  const bot = br.bottom - padB;
  const rows = Array.prototype.slice.call(body.children);
  let full = 0;
  let minRow = null;
  let firstText = null;
  for (const el of rows) {
    const r = el.getBoundingClientRect();
    const mb = parseFloat(getComputedStyle(el).marginBottom) || 0;
    const h = r.height + mb;
    if (minRow === null || h < minRow) minRow = h;
    // 0.5px 여유 = 서브픽셀 반올림. 그 이상 잘린 줄은 세지 않는다.
    if (r.top >= top - 0.5 && r.bottom <= bot + 0.5) {
      full++;
      if (firstText === null) firstText = (el.textContent || '').trim().slice(0, 28);
    }
  }
  // ── 「자기 최소 몫」 ─────────────────────────────────────────────
  // #logPanel 은 flex: 1 1 0 — **남는 것을 받는 쪽**이다. 그래서 지금 받은 몫은
  // «위 패널들이 아직 안 자란 덕»이지 보장이 아니다. 이 화면이 **보장하는** 값은
  // CSS가 적어 둔 min-height 하나뿐이다. 그 바닥에서 본문이 몇 픽셀 남는지를 잰다:
  //   바닥 본문 = min-height − (머리글 + 패딩 + 테두리)   ← 뒤 괄호는 실측으로 뺀다
  const lp = getComputedStyle(logPanel);
  const logPanelH = logPanel.getBoundingClientRect().height;
  const minH = parseFloat(lp.minHeight) || 0;
  const chrome = Math.max(0, logPanelH - usable); // 머리글·패딩·테두리가 먹는 몫
  const floorBody = Math.max(0, minH - chrome);
  return {
    vh: VH,
    colH: r1(col.getBoundingClientRect().height),
    panels,
    logPanelH: r1(logPanelH),
    logFlex: lp.flexGrow + ' ' + lp.flexShrink + ' ' + lp.flexBasis,
    logMinH: r1(minH),
    logChromePx: r1(chrome),
    floorBodyPx: r1(floorBody),
    floorLines: minRow ? Math.floor((floorBody + 0.5) / minRow) : null,
    logBodyPx: r1(usable),
    logRows: rows.length,
    visibleLines: full,
    firstVisible: firstText,
    minRowH: minRow === null ? null : r1(minRow),
    capacityLines: minRow ? Math.floor((usable + 0.5) / minRow) : null,
    atTop: body.scrollTop <= 0.5,
    scrollH: body.scrollHeight,
    sugRows: document.querySelectorAll('#sugBody .sg-row').length,
    sugShown: (() => {
      const p = document.getElementById('sugPanel');
      return !!p && getComputedStyle(p).display !== 'none';
    })(),
  };
})()`;

/** `#suggest`가 지금 눌러도 되는 상태인가(= 내 차례 · 방 안). 사유 문자열도 함께. */
const SUGGEST_READY_JS = `(() => {
  const b = document.getElementById('suggest');
  if (!b) return { ready: false, why: '#suggest 버튼이 없다' };
  return { ready: b.getAttribute('aria-disabled') === 'false', why: b.getAttribute('title') || '' };
})()`;

/**
 * D-패드 ↑ 를 `n`번 누른다 — **손가락이 하는 그 이벤트**(`pointerdown`)를 그대로 보낸다.
 * `click`이 아닌 이유: `wireDpad()`가 듣는 것은 `pointerdown`이고, 클라는 `MOVE_COOLDOWN_MS`
 * (110ms)로 연타를 솎아낸다 → 그보다 긴 간격을 두지 않으면 **눌림이 조용히 삼켜진다.**
 */
const walkUpJs = (n, gapMs) => `(async () => {
  const b = document.querySelector('#dpad .dp-u');
  if (!b) return { ok: false, why: 'D-패드 ↑ 버튼이 없다' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < ${n}; i++) {
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    await sleep(${gapMs});
  }
  return { ok: true };
})()`;

/**
 * 소환 사슬 한 코 — **턴 순서상 다음 좌석**의 용의자를 지목해 제안한다.
 *
 * «다음 좌석»은 턴 배너 순서 스트립의 2번째 칩(`title`에 « (다음)»이 붙은 것)이다.
 * 화면에 이미 적혀 있는 글자만 읽는다 — 내부 상태(`room.state`)에 손대지 않는다.
 * 지목된 좌석은 이 방으로 **소환**되고 재진입 잠금이 풀리므로, 그 좌석은 자기 턴에
 * 곧바로 같은 일을 할 수 있다 → 매 턴 1건씩 표가 자란다.
 */
const CHAIN_SUGGEST_JS = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chips = Array.prototype.slice.call(document.querySelectorAll('#turnInfo .ti-chip'));
  if (chips.length < 2) return { ok: false, why: '턴 순서 스트립에서 «다음» 좌석을 읽지 못했다' };
  const nameOf = (c) => (c.getAttribute('title') || '').split(' (')[0].trim();
  const meName = nameOf(chips[0]);
  const nextName = nameOf(chips[1]);
  if (!nextName) return { ok: false, why: '«다음» 좌석의 이름이 비어 있다' };
  const b = document.getElementById('suggest');
  if (!b || b.getAttribute('aria-disabled') !== 'false')
    return { ok: false, why: '[제안]이 비활성이다 — ' + (b ? b.getAttribute('title') : '버튼 없음') };
  b.click();
  for (let i = 0; i < 40 && !document.querySelector('.overlay .modal select'); i++) await sleep(50);
  const sels = Array.prototype.slice.call(document.querySelectorAll('.overlay .modal select'));
  // 제안 모달은 **용의자·훔친 것 2칸**이다(장소는 «현재 방 고정» 표시행).
  if (sels.length !== 2) return { ok: false, why: '제안 모달의 select가 2개가 아니다(' + sels.length + ')' };
  const opts = Array.prototype.slice.call(sels[0].options);
  const want = opts.find((o) => (o.textContent || '').indexOf(nextName) >= 0);
  if (!want) return { ok: false, why: '용의자 목록에서 «' + nextName + '»을 찾지 못했다' };
  if (want.disabled) return { ok: false, why: '«' + nextName + '» 옵션이 잠겨 있다' };
  sels[0].value = want.value;
  if (sels[0].value !== want.value) return { ok: false, why: '용의자 지정 실패: ' + want.value };
  const ok = document.querySelector('.overlay .modal .actions button:not(.ghost)');
  if (!ok) return { ok: false, why: '[이 조합으로 제안] 버튼이 없다' };
  ok.click();
  return { ok: true, me: meName, next: nextName, suspect: want.value, weapon: sels[1].value };
})()`;

// ── S7 공개방 목록 상태 배지(ui-copy §8.5) ─────────────────────────────
//
// 재는 대상은 **글자**다. 배지·버튼 라벨·부가 문구는 전부 DOM에 있고 늘 «존재»하므로
// 존재 검사로는 회귀가 잡히지 않는다. 그래서 확정 문안과 **문자 그대로** 대조한다.

/** 랜딩 `#roomList`의 각 줄을 문안 단위로 읽는다(내부 상태에 손대지 않는다). */
const READ_ROOM_LIST_JS = `(() => {
  const list = document.getElementById('roomList');
  if (!list) return { err: '#roomList 가 없다(랜딩이 아니다)' };
  const txt = (e) => (e ? (e.textContent || '').trim() : null);
  const empty = list.querySelector('.room-empty');
  const items = Array.prototype.map.call(list.querySelectorAll('.room-item'), (li) => {
    const btn = li.querySelector('button');
    const sub = li.querySelector('.ri-sub');
    return {
      badge: txt(li.querySelector('.ri-badge')),
      button: txt(btn),
      // \`disabled\`는 «만석»의 절반이다 — 라벨만 맞고 눌리면 문안이 거짓말을 한다.
      disabled: btn ? !!btn.disabled : null,
      // 부가 문구는 \`· \` 구분자와 함께 그려진다. 구분자는 문안이 아니므로 벗긴다.
      sub: sub ? (sub.textContent || '').replace(/^[\\s·]+/, '').trim() : null,
      title: txt(li.querySelector('.ri-body')),
    };
  });
  return { items: items, empty: empty ? (empty.textContent || '').trim() : null };
})()`;

/**
 * 목록이 `want`개로 갱신되기를 기다린 뒤 읽는다.
 * `#refreshRooms`를 눌러 **사람이 하는 것과 같은 경로**로 갱신한다(내부 함수 호출이 아니다).
 * 기다리다 못 채워도 **읽어서 그대로 돌려준다** — 판정은 호출부가 한다(조용히 넘기지 않는다).
 */
const readRoomList = async (sid, want) => {
  await evalIn(sid, clickJs("#refreshRooms")).catch(() => false);
  // 기다림이 시간을 넘겨도 **읽는다.** 「몇 개였는지」는 아래 판정이 실제 내용으로 인쇄한다 —
  // 여기서 되돌아가면 «왜 못 쟀는지»가 사라진다.
  await waitFor(
    sid,
    `document.querySelectorAll('#roomList .room-item').length === ${want}`,
    SCREEN.roomList.waitMs,
  );
  return evalIn(sid, READ_ROOM_LIST_JS);
};

/**
 * 한 시점의 목록을 §8.5 확정 문안과 대조한다. 반환은 다른 검사와 같은 모양의 체크 1건.
 * **판정 불가는 FAIL이 아니라 SKIP + 사유**다(목록에 방이 1개가 아니면 우리 방을 지목할 수 없다).
 */
const judgeRoomList = (caseDef, snap, ctx) => {
  const id = "S7";
  const dump = (snap.items ?? [])
    .map((i) => `«${i.title}» 배지«${i.badge ?? "-"}» 버튼«${i.button ?? "-"}»${i.disabled ? "(비활성)" : ""} 부가«${i.sub ?? "-"}»`)
    .join(" / ");
  if (snap.err) return { id, status: "SKIP", detail: `${caseDef.label} — ${snap.err}`, lines: [] };
  const items = snap.items ?? [];
  if (items.length !== SCREEN.roomList.expectRooms) {
    // 「없다」가 **예상된 사실**인 경우(정원 초과 행)는 그 사유를 그대로 인쇄한다.
    const why =
      items.length === 0 && caseDef.unreachableWhy
        ? caseDef.unreachableWhy
        : `목록에 방이 ${items.length}개다(1개여야 우리 방을 지목할 수 있다). ` +
          `실제: ${dump || snap.empty || "(빈 목록)"}`;
    return { id, status: "SKIP", detail: `${caseDef.label} — ${why}`, lines: [] };
  }
  const got = items[0];
  const want = {
    badge: caseDef.badge,
    button: caseDef.button,
    sub:
      typeof caseDef.sub === "string"
        ? caseDef.sub.replace("{clients}", String(ctx.clients)).replace("{maxClients}", String(ctx.maxClients))
        : caseDef.sub,
  };
  const lines = [];
  const cmpText = (name, w, g) => {
    if (w === null || w === undefined) return; // 문서가 규정하지 않은 칸은 재지 않는다
    if (g === w) return;
    lines.push(`✗ ${name} — 기대 «${w}» · 실제 «${g ?? "(없음)"}»`);
  };
  cmpText("배지", want.badge, got.badge);
  cmpText("버튼", want.button, got.button);
  cmpText("부가 문구", want.sub, got.sub);
  if (caseDef.disabled !== null && caseDef.disabled !== undefined && got.disabled !== caseDef.disabled)
    lines.push(
      `✗ 버튼 활성 — 기대 «${caseDef.disabled ? "비활성" : "활성"}» · 실제 «${got.disabled ? "비활성" : "활성"}»`,
    );
  return {
    id,
    status: lines.length ? "FAIL" : "PASS",
    detail: lines.length
      ? `${caseDef.label} — 확정 문안과 어긋난 칸 ${lines.length}개`
      : `${caseDef.label} — 배지·버튼·부가 문구가 §8.5 확정 문안과 일치`,
    lines,
  };
};

/** 결과 흐름 전체. 실패는 전부 `{ skip: 사유 }`로 돌려준다(FAIL이 아니다). */
const runResultFlow = async () => {
  const R = SCREEN.result;
  const vpOf = (id) => (id ? SCREEN.viewports.find((v) => v.id === id) ?? null : null);
  const tabs = [];
  const notes = [];
  /** S7(§8.5) 판정 결과. 실판을 재사용할 뿐 **판을 새로 돌리지 않는다.** */
  const roomChecks = [];
  /** S8(판 중반 우측 컬럼 배분) 관측치. 같은 1판에 얹혀 돈다. */
  let rightColumn = null;
  const t0 = Date.now();
  const bail = async (why) => {
    for (const t of tabs) await t.close();
    await observer.close();
    return { skip: why, ms: Date.now() - t0, notes, roomChecks, rightColumn };
  };

  for (const spec of R.tabs) {
    const t = await newTab(vpOf(spec.vp));
    tabs.push({ ...t, id: spec.id, role: spec.role, vpId: spec.vp });
  }
  /**
   * S7 관측 탭 — **방에 들어가지 않는다.** 랜딩만 열고 공개방 목록을 읽는다
   * (좌석에 앉지 않으므로 «전원 사람 6인» 전제를 건드리지 않는다).
   * 뷰포트 에뮬레이션도 걸지 않는다 — 재는 것은 레이아웃이 아니라 **글자**다.
   */
  const observer = await newTab(null);
  const byId = (id) => tabs.find((t) => t.id === id);
  const host = tabs[0];

  /** 관측 탭에서 한 시점을 재고 결과를 모은다. 실패는 SKIP + 사유로만 남는다. */
  const grabRoomList = async (caseKey, ctx) => {
    const c = SCREEN.roomList.cases[caseKey];
    const g0 = Date.now();
    const snap = await readRoomList(observer.sid, ctx.want).catch((e) => ({
      err: `목록을 읽지 못했다 — ${e.message}`,
    }));
    const check = judgeRoomList(c, snap, ctx);
    roomChecks.push({ id: c.id, label: c.label, ms: Date.now() - g0, check });
    return check;
  };

  // ① 방장 탭이 **공개 방**을 만든다(기존 랜딩 UI 그대로 — 라디오가 아니라 `.seg-btn` 버튼이다).
  //    비공개로 만들면 `setListed()`가 «비공개로 만든 방은 계속 비공개»로 되돌려
  //    §8.5가 재는 목록에 **애초에 나타나지 않는다.** 공개방이어야 판정 대상이 생긴다.
  //    (공개라고 판이 달라지지 않는다 — 좌석 6개를 우리가 다 채우므로 난입 여지도 없고,
  //     판이 도는 동안은 서버가 `setListed(false)`로 목록에서 빼 둔다.)
  step("결과 흐름 · 방 만들기");
  await cmd("Page.navigate", { url: `${BASE}/?demo=1` }, host.sid);
  // `readyState === 'complete'` 까지 기다린다 — 버튼 **DOM**은 정적 HTML에 이미 있지만
  // `onclick`은 모듈 스크립트가 실행돼야 붙는다. 그 전에 누르면 **아무 일도 일어나지 않는다**.
  if (!(await waitFor(host.sid, "document.readyState === 'complete' && !!document.getElementById('createBtn')", SCREEN.readyTimeoutMs)))
    return bail("랜딩이 뜨지 않았다");
  if (!(await evalIn(host.sid, clickJs('#visSeg .seg-btn[data-pub="1"]'))))
    return bail("공개/비공개 선택 버튼(`#visSeg .seg-btn[data-pub=\"1\"]`)을 찾지 못했다");
  await evalIn(host.sid, clickJs("#createBtn"));
  if (!(await waitFor(host.sid, "!document.getElementById('lobby').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
    return bail("대기실에 들어가지 못했다(방 생성 실패)");
  const code = String(await evalIn(host.sid, "(location.pathname.match(/\\/room\\/([^/?]+)/) || [])[1] || ''"));
  if (!code) return bail("초대 코드를 읽지 못했다");

  // ①′ S7 «대기 중» — 방 하나 · 사람 1명 · 판 시작 전. 여기가 §8.5 1행의 정의 그대로다.
  step("결과 흐름 · S7 목록 «대기 중»");
  await cmd("Page.navigate", { url: `${BASE}/?demo=1` }, observer.sid);
  if (!(await waitFor(observer.sid, "document.readyState === 'complete' && !!document.getElementById('refreshRooms')", SCREEN.readyTimeoutMs)))
    roomChecks.push({
      id: SCREEN.roomList.cases.lobby.id,
      label: SCREEN.roomList.cases.lobby.label,
      ms: 0,
      check: { id: "S7", status: "SKIP", detail: "관측 탭에 랜딩이 뜨지 않았다", lines: [] },
    });
  else await grabRoomList("lobby", { want: 1, clients: 1, maxClients: R.seats });

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

  // ②′ S7 «정원 초과» — 좌석이 다 찼다. 다만 **목록에는 나타나지 않는다**(설정의 `unreachableWhy`).
  //     기대 개수를 0으로 주고, 0이면 그 사실을 SKIP + 사유로 인쇄한다(통과로 세지 않는다).
  step("결과 흐름 · S7 목록 «만석»");
  await grabRoomList("full", { want: 0, clients: R.seats, maxClients: R.seats });

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

  /** 한 바퀴 돌며 6탭의 손패를 읽는다(신고 모달을 열고 **[취소]** — 판을 건드리지 않는다). */
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
          return { skip: `${game}판: 탭 ${t.id}의 신고 모달이 열리지 않았다` };
        const cats = await evalIn(t.sid, READ_PICKER_JS);
        await evalIn(t.sid, CANCEL_JS);
        if (!cats) return { skip: `${game}판: 탭 ${t.id}의 신고 모달 select 3개를 읽지 못했다` };
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
      return `탭 ${t.id}: 신고 모달이 열리지 않았다`;
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

  // ── 3판: 판 중반 우측 컬럼 배분(S8) ────────────────────────────────
  //
  // **왜 1·2판에 얹지 않고 판을 하나 더 도는가.** 세 가지가 겹친다.
  //   ① «판 중반»은 정의상 **판이 끝나기 전**이고, 1·2판은 끝나야 결과 화면 4행이 나온다.
  //      같은 판 안에서 앞쪽에 끼우면 그 판의 종료 오버레이 계측이 **제안 기록표가 떠 있는
  //      화면**을 재게 된다 — S1~S6이 재는 대상이 조용히 바뀐다.
  //   ② 실제로 그렇게 해 봤더니(실측) 데스크톱 결과 화면에서 S6이 새 위반을 잡았다:
  //      제안 기록표 순번 `.sg-n` 이 **10px `#8f8574` on `#1f2b3a` = 3.94:1**로 AA(4.5) 미달이다.
  //      **이것은 진짜 결함이고 숨기는 것이 아니다** — 다만 «재기만 한다»는 이번 작업의 범위를
  //      벗어나고(고치려면 CSS를 건드려야 한다) 촬영 전 화면 동결에도 걸린다.
  //      그래서 사유를 여기와 `SCREEN.rightColumn.knownUnmeasured`에 적어 두고, 그 문장은
  //      **실행할 때마다 S8 판정과 함께 인쇄된다.** 촬영 뒤 고칠 목록의 첫 줄이다.
  //   ③ 3판은 1·2판과 **같은 탭·같은 서버·같은 브라우저**를 그대로 쓴다. 새로 드는 비용은
  //      [다시 하기] 한 번과 사슬 한 바퀴뿐이다(실측 ≈+6초).
  step("결과 흐름 · 3판(판 중반 계측용) 다시 하기");
  await evalIn(host.sid, clickJs("#endRematch"));
  for (const t of tabs)
    if (!(await waitFor(t.sid, "document.getElementById('endOverlay').classList.contains('hidden') && !document.getElementById('turnInfo').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
      return bail(`탭 ${t.id}: 3판(판 중반 계측)에 들어가지 못했다`);
  // 3판을 **끝내지 않는다.** 이 판이 존재하는 이유가 «중반»이라서다 —
  // 사슬 한 바퀴를 돌려 제안 기록표를 규칙대로 키운 그 시점에서 재고 멈춘다.
  // (판은 아래 3막에서 탭을 닫을 때 서버가 정리한다.)
  // 도달 방법·근거는 gate.config.mjs `SCREEN.rightColumn` 주석에 있다(확률이 아니라 규칙이다).
  {
    const RC = SCREEN.rightColumn;
    const rc0 = Date.now();
    /** 계측 탭 — 이 결함은 «높이를 나눠 갖는» 데스크톱에서만 정의된다(설정의 `phoneSkipWhy`). */
    const target = tabs.find((t) => t.vpId === RC.viewport);
    const walker = tabs[0]; // = 방장 = `spawnPoint(0)` = 잔치상 (11,11)
    const trace = [];
    const rcSkip = (why) => {
      rightColumn = { ms: Date.now() - rc0, skip: why, trace };
    };

    if (!target) {
      rcSkip(`계측 뷰포트(${RC.viewport}) 탭이 이 세션에 없다 — SCREEN.result.tabs 를 확인하라`);
    } else if (OPT.viewport && OPT.viewport !== RC.viewport) {
      rcSkip(`--viewport=${OPT.viewport} 로 제외됨 — S8은 ${RC.viewport}에서만 정의된다. ${RC.phoneSkipWhy}`);
    } else {
      step("결과 흐름 · S8 판 중반(소환 사슬로 제안 기록표 키우기)");
      let sug = 0;
      let broke = null;
      for (let i = 0; i < RC.maxTurns && sug < RC.suggestRows && !broke; i++) {
        const a = await activeTab();
        if (a.ended) {
          broke = "판 중반을 재기 전에 판이 끝났다";
          break;
        }
        if (!a.tab) {
          await sleep(120);
          continue;
        }
        const t = a.tab;
        let ready = await evalIn(t.sid, SUGGEST_READY_JS).catch(() => ({ ready: false, why: "읽기 실패" }));
        // 사슬의 **첫 코**는 누군가 방 안에 서야 시작된다 → 방장 탭만 걷는다.
        if (!ready.ready && t.id === walker.id) {
          await evalIn(t.sid, walkUpJs(RC.walkClicks, RC.walkGapMs));
          await sleep(300);
          ready = await evalIn(t.sid, SUGGEST_READY_JS).catch(() => ({ ready: false, why: "읽기 실패" }));
          trace.push(
            `${t.id} 걷기 ↑×${RC.walkClicks} (잔치상 → 대청 문) → ` +
              (ready.ready ? "방 안 · 제안 가능" : `아직 복도 — ${ready.why}`),
          );
        }
        if (ready.ready) {
          const r = await evalIn(t.sid, CHAIN_SUGGEST_JS).catch((e) => ({ ok: false, why: e.message }));
          if (!r?.ok) {
            broke = `탭 ${t.id}: 제안 실패 — ${r?.why ?? "?"}`;
            break;
          }
          if (
            !(await waitFor(
              target.sid,
              `document.querySelectorAll('#sugBody .sg-row').length === ${sug + 1}`,
              8000,
            ))
          ) {
            broke = `탭 ${t.id}의 제안이 계측 탭의 표에 ${sug + 1}행으로 도착하지 않았다`;
            break;
          }
          sug++;
          trace.push(`${t.id} «${r.me}» → 다음 좌석 «${r.next}» 지목 → 소환 · 표 ${sug}행`);
        }
        await evalIn(t.sid, clickJs("#endTurn"));
        if (!(await waitTurnLeft(t))) {
          broke = `탭 ${t.id}의 [턴 종료]가 반영되지 않았다`;
          break;
        }
      }
      if (broke) rcSkip(broke);
      else if (sug < RC.suggestRows)
        rcSkip(`${RC.maxTurns}턴 안에 제안 기록표가 ${RC.suggestRows}행에 이르지 못했다(${sug}행에서 멈춤)`);
      else {
        await sleep(SCREEN.settleMs);
        const data = await evalIn(target.sid, READ_RP_COL_JS).catch((e) => ({ err: e.message }));
        if (data?.err) rcSkip(data.err);
        else {
          // 🔴 **30회차까지 여기는 «캡처만» 남겼다** — 「S8이 재는 것은 배분 하나다」라는
          //    사유였는데, 그 결과 **제안 기록표가 6행 찬 유일한 화면**에서 S1~S6·S9가
          //    하나도 안 돌았다(설정의 `knownUnmeasured`가 그 사실을 매 실행 인쇄하고 있었다).
          //    이제 같은 탭에서 `pageProbe`를 돌린다 — `probeTab`이 캡처도 함께 남긴다.
          //    ⚠️ 실패해도 **S8은 살린다.** 배분 수치는 이미 손에 있고, 새 계측이
          //       기존 래칫을 무너뜨리는 것은 회귀가 아니라 도구 사고다.
          let probe = null;
          try {
            probe = await probeTab(target.sid, RC.probe, `right-column-${RC.viewport}`);
          } catch (e) {
            probe = { err: e.message };
          }
          // ⚠️ hover는 **따로** 감싼다. 한 `try`에 묶으면 hover 예외가 이미 성공한
          //    S1~S6까지 `{err}`로 덮어 통째로 버린다(검수 지적).
          if (probe && !probe.err) {
            try {
              probe.hover = await probeHoverStates(target.sid);
            } catch (e) {
              probe.hover = { skip: `hover 계측 실패 — ${e.message}` };
            }
          }
          rightColumn = { ms: Date.now() - rc0, data, probe, trace, vp: RC.viewport, tab: target.id };
        }
      }
    }
    for (const l of trace) notes.push(`S8 ${l}`);
  }


  // ── 3막: S7 «종료됨» ───────────────────────────────────────────────
  //
  // **왜 위 6탭 방을 그대로 못 쓰는가**(실측으로 두 번 확인했다 — 같은 함정에 다시 빠지지 마라):
  //   위 방은 판이 끝나 `setListed(true)`로 «공개»로 되돌아온다. 그런데 목록에 안 뜬다.
  //   `getAvailableRooms()`는 `{ locked:false, private:false }`로 거르는데, 좌석이 6/6이 되는
  //   순간 Colyseus가 방을 **잠근다**(`Room._incrementClientCount` → `lock()`).
  //   잠금은 접속 수가 줄어야 풀리는데, 접속 수를 줄이는 `_decrementClientCount()`는
  //   `Room._onLeave`에서 **`await this.onLeave()` 뒤에** 있고, 이 저장소의 `onLeave`는
  //   `phase !== "lobby"`면 `allowReconnection(120초)`를 **await** 한다(결과 화면 새로고침 복구).
  //   → 탭을 닫아도 120초 동안 `clients`는 6, `locked`는 true다. 게이트 예산 안에서는
  //     **6인 방이 목록에 되돌아오는 일 자체가 없다.**
  //
  // **그래서 이 막은 좌석 하나를 NPC에게 준다**(사람 5 + NPC 1).
  //   접속 수가 5라 방은 **한 번도 잠기지 않고**, 판이 끝나면 그대로 목록에 뜬다.
  //   끝내는 방법은 위와 같은 «규칙상 실패 불가» 장치다 — 각 탭은 **남의 손패 카드**로
  //   고발한다(정의상 오답 → 탈락). 사람 5명이 전부 탈락하면 남는 것은 NPC 하나뿐이라
  //   서버가 그 자리에서 `survivor`로 판을 끝낸다. 고발 횟수 상한이 5로 **확정**돼 있다.
  //   (NPC가 먼저 오답으로 탈락하면 4번이면 끝난다 — 어느 쪽이든 끝난다.)
  //   ⚠️ 정답 봉투는 **모르고, 알 필요도 없다.** NPC 손패 3장이 미지라 소거가 안 되지만
  //      이 막이 필요한 것은 «판이 끝났다»뿐이다.
  //
  // ⚠️ 위 결과 화면 계측(`grab(2)`)이 **끝난 뒤**에만 온다 — 탭을 먼저 돌리면 §7.1 4행을 잃는다.
  const L = SCREEN.roomList;
  step("결과 흐름 · S7 종료된 방 만들기(사람 5 + NPC 1)");
  // ⚠️ **탭을 재사용하지 않는다.** 재접속 토큰은 `sessionStorage`(탭 단위)에 남고,
  //    `init()`이 랜딩에서 그 토큰으로 **이전 방에 재접속**해 버린다(실측: 새 방을 만들어도
  //    `room`이 옛 방으로 덮여 [잔치 시작]이 옛 방으로 날아갔다). 새 탭은 토큰이 없다.
  //    뷰포트 에뮬레이션도 걸지 않는다 — 이 막이 재는 것은 레이아웃이 아니라 목록의 글자다.
  for (const t of tabs) await t.close();
  tabs.length = 0;
  for (let i = 0; i < L.endedRoom.humans; i++) {
    const t = await newTab(null);
    tabs.push({ ...t, id: `X${i + 1}`, role: "loser", vpId: null });
  }
  const host3 = tabs[0];

  await cmd("Page.navigate", { url: `${BASE}/?demo=1` }, host3.sid);
  if (!(await waitFor(host3.sid, "document.readyState === 'complete' && !!document.getElementById('createBtn')", SCREEN.readyTimeoutMs)))
    return bail("3막: 랜딩이 뜨지 않았다");
  await evalIn(host3.sid, clickJs('#visSeg .seg-btn[data-pub="1"]'));
  await evalIn(host3.sid, clickJs("#createBtn"));
  if (!(await waitFor(host3.sid, "!document.getElementById('lobby').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
    return bail("3막: 공개방을 만들지 못했다");
  const code3 = String(await evalIn(host3.sid, "(location.pathname.match(/\\/room\\/([^/?]+)/) || [])[1] || ''"));
  if (!code3) return bail("3막: 초대 코드를 읽지 못했다");
  for (const t of tabs.slice(1)) {
    await cmd("Page.navigate", { url: `${BASE}/?room=${encodeURIComponent(code3)}&demo=1` }, t.sid);
    if (!(await waitFor(t.sid, "document.readyState === 'complete' && !!document.getElementById('joinBtn')", SCREEN.readyTimeoutMs)))
      return bail(`3막: 탭 ${t.id} 랜딩이 뜨지 않았다`);
    await evalIn(t.sid, clickJs("#joinBtn"));
    if (!(await waitFor(t.sid, "!document.getElementById('lobby').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
      return bail(`3막: 탭 ${t.id} 대기실 참가 실패`);
  }
  if (!(await waitFor(host3.sid, `document.getElementById('playerCount').textContent === '${L.endedRoom.humans}'`, SCREEN.readyTimeoutMs)))
    return bail(`3막: 사람 ${L.endedRoom.humans}명이 모이지 않았다`);
  await evalIn(host3.sid, clickJs("#startBtn"));
  for (const t of tabs)
    if (!(await waitFor(t.sid, "!document.getElementById('gameScreen').classList.contains('hidden') && !document.getElementById('turnInfo').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
      return bail(`3막: 탭 ${t.id}가 게임 화면에 들어가지 못했다`);

  /**
   * 남의 손패 카드 하나로 «반드시 오답»인 조합을 만든다.
   * - 한 칸이라도 남의 손에 있으면 그 고발은 **정의상 틀린다** — 세 칸을 다 알 필요가 없다.
   * - 나머지 두 칸은 **잠기지 않은(=내 패가 아닌)** 아무 값. 잠긴 옵션을 고르면
   *   `accuseJs`가 스스로 실패하므로 «UI 잠금을 우회하지 않았다»가 계속 보증된다.
   */
  const wrongWithDonor = (myCats, donorHand) => {
    const pick = [];
    let used = false;
    for (let i = 0; i < 3; i++) {
      const mine = new Set(myCats[i].mine);
      const donor = donorHand[i].find((v) => !mine.has(v));
      if (!used && donor) {
        pick.push(donor);
        used = true;
        continue;
      }
      const any = myCats[i].all.find((v) => !mine.has(v));
      if (!any) return null;
      pick.push(any);
    }
    return used ? { suspect: pick[0], weapon: pick[1], room: pick[2] } : null;
  };

  step("결과 흐름 · S7 사람 5명 오답 탈락");
  /** 탭별 손패(카테고리 3개). 자기 차례에 신고 모달을 열면 그 자리에서 읽힌다. */
  const hands3 = new Map();
  let ended3 = false;
  for (let i = 0; i < R.maxTurns && !ended3; i++) {
    const a = await activeTab();
    if (a.ended) {
      ended3 = true;
      break;
    }
    if (!a.tab) {
      await sleep(120);
      continue;
    }
    const t = a.tab;
    await evalIn(t.sid, clickJs("#accuse"));
    if (!(await waitFor(t.sid, "!!document.querySelector('.overlay .modal select')", 8000)))
      return bail(`3막: 탭 ${t.id}의 신고 모달이 열리지 않았다`);
    const cats = await evalIn(t.sid, READ_PICKER_JS);
    if (!cats) return bail(`3막: 탭 ${t.id}의 신고 모달 select 3개를 읽지 못했다`);
    hands3.set(t.id, cats.map((c) => c.mine));
    const donorId = [...hands3.keys()].find((id) => id !== t.id && hands3.get(id).some((m) => m.length));
    const triple = donorId ? wrongWithDonor(cats, hands3.get(donorId)) : null;
    if (!triple) {
      // 아직 남의 패를 하나도 모른다(첫 탭) — 판을 건드리지 않고 [취소] 후 턴만 넘긴다.
      await evalIn(t.sid, CANCEL_JS);
      await evalIn(t.sid, clickJs("#endTurn"));
      if (!(await waitTurnLeft(t))) return bail(`3막: 탭 ${t.id}의 [턴 종료]가 반영되지 않았다`);
      continue;
    }
    const r = await evalIn(t.sid, accuseJs(triple));
    if (!r?.ok) return bail(`3막: 탭 ${t.id} 고발 실행 실패 — ${r?.why ?? "?"}`);
    notes.push(`3막 ${t.id} 고발 [${triple.suspect} · ${triple.weapon} · ${triple.room}] — 남의 손패 = 정답 불가`);
    if (!(await waitTurnLeft(t))) {
      const st = await evalIn(t.sid, TAB_STATE_JS).catch(() => null);
      if (!st?.ended) return bail(`3막: 탭 ${t.id}의 고발이 반영되지 않았다`);
      ended3 = true;
    }
  }
  if (!ended3 && !(await activeTab()).ended)
    return bail(`3막: ${R.maxTurns}턴 안에 판이 끝나지 않았다`);

  step("결과 흐름 · S7 목록 «종료됨»");
  // 종료 처리(`setListed(true)` → `setPrivate(false)`)가 매치메이커에 반영될 틈.
  await sleep(SCREEN.settleMs);
  await grabRoomList("ended", { want: 1, clients: L.endedRoom.humans, maxClients: R.seats });

  for (const t of tabs) await t.close();
  await observer.close();
  return { measured, ms: Date.now() - t0, notes, roomChecks, rightColumn };
};

/**
 * S8 — 판 중반 우측 컬럼 배분. **래칫**으로 판정한다(번들 예산 게이트와 같은 형태).
 *
 * ⚠️ **지금 이 값은 결함이다.** 그래서 기능 하한(`minVisibleLines`)으로 FAIL을 내지 않는다 —
 *    상시 빨간불이 된 게이트는 아무도 안 돌리고, 안 도는 게이트는 아무것도 막지 못한다.
 *    대신 실측을 기준선에 박고 **더 나빠지면 FAIL**한다. 하한 미달은 매번
 *    «결함 확인»으로 인쇄한다 — 기준선 통과가 «정상»으로 읽히면 이 검사는 거짓말이 된다.
 *
 * **두 종류의 수치를 잰다 — 섞으면 안 된다.**
 *   ⓐ 지금 **받은** 몫(`logBodyPx` · `capacityLines`).
 *      `#logPanel`은 `flex: 1 1 0`, 즉 **남는 것을 받는 쪽**이다. 그래서 이 값은
 *      «위 패널들이 아직 안 자란 덕»이지 약속이 아니다. 회귀 감시(=래칫)는 여기 건다.
 *   ⓑ 이 화면이 **보장하는** 몫(`floorBodyPx` · `floorLines`).
 *      보장은 CSS가 적어 둔 `min-height` 하나뿐이다. 거기서 머리글·패딩·테두리를 빼면
 *      본문에 남는 픽셀이 나오고, 그것을 줄 최소 높이로 나눈 것이 **바닥 줄 수**다.
 *      기능 하한(`minVisibleLines`)은 ⓑ에 건다 — «최악에도 이만큼은 보인다»가 아니면
 *      기록/알림은 **언젠가 반드시** 아무 사건도 전달하지 못하는 순간을 맞는다.
 *
 * 래칫이 ⓐ의 두 값을 다 보는 이유: `capacityLines`는 정수라 한 줄이 통째로 사라지기
 * 전까지 침묵한다(35px 줄 기준으로 34px이 깎여도 그대로다). 그 구간을 잡는 것이 픽셀 쪽이다.
 */
const judgeRightColumn = (rc, baseline) => {
  const RC = SCREEN.rightColumn;
  const id = "S8";
  if (!rc)
    return {
      id,
      status: "SKIP",
      detail:
        "결과 흐름(6탭 실판)이 3판까지 가지 못했다 — S8은 결과 화면 4행을 다 계측한 **뒤** " +
        "[다시 하기]로 여는 3판에 얹혀 도는 검사다. 앞 단계의 SKIP 사유를 위에서 확인하라",
      lines: [],
    };
  if (rc.skip) return { id, status: "SKIP", detail: `판 중반에 도달하지 못했다 — ${rc.skip}`, lines: [] };

  const d = rc.data;
  const pct = (n) => `${((n / d.colH) * 100).toFixed(1)}%`;
  const lines = [];
  lines.push(
    `· 컬럼 ${d.colH}px (뷰포트 ${d.vh}px) · 제안 기록표 ${d.sugRows}행${d.sugShown ? "" : "(패널 숨김!)"}`,
  );
  for (const p of d.panels)
    lines.push(
      `  ${p.sel.padEnd(14)} ${String(p.h).padStart(7)}px  ` +
        `${p.gone ? "display:none" : p.outOfFlow ? "(절대 배치 — 흐름 밖)" : pct(p.h)}` +
        `  flex:${p.flex} min:${p.minH} max:${p.maxH}`,
    );
  lines.push(
    `· 📜 기록/알림 — 지금 **받은** 몫: 본문 ${d.logBodyPx}px · 줄 최소 높이 ${d.minRowH ?? "?"}px ` +
      `→ 담을 수 있는 줄 ${d.capacityLines ?? "?"} (실제 온전히 보이는 줄 ${d.visibleLines}/${d.logRows}` +
      `${d.atTop ? "" : " · ⚠ 스크롤이 최상단이 아니다"}${d.firstVisible ? ` · 첫 줄 «${d.firstVisible}»` : ""})`,
  );
  lines.push(
    `· 📜 기록/알림 — 이 화면이 **보장하는** 몫: \`flex:${d.logFlex}\`(남는 것을 받는 쪽) + ` +
      `\`min-height:${d.logMinH}px\` − 머리글·패딩 ${d.logChromePx}px = 본문 ${d.floorBodyPx}px ` +
      `→ **바닥 줄 수 ${d.floorLines}**`,
  );

  const floor = d.floorLines ?? 0;
  const short = floor < RC.minVisibleLines;
  if (short)
    lines.push(
      `✗ **결함 확인 — 이 패널은 자기 최소 몫을 확보하지 못한다.** ` +
        `보장 ${floor}줄 < 기능 하한 ${RC.minVisibleLines}줄. ` +
        `지금 ${d.capacityLines}줄이 보이는 것은 **위 패널들이 아직 안 자란 덕**이지 약속이 아니다 — ` +
        `AI 대사 패널은 폴백 사유가 늘수록, 증거 노트는 고정 ${d.panels.find((p) => p.sel === "#eviPanel")?.h ?? "?"}px, ` +
        `제안 기록표는 \`#sugBody{max-height:26vh}\`까지 자란다. 그 합이 컬럼을 넘는 순간 로그는 \`min-height\`로 떨어지고, ` +
        `그 바닥이 ${d.floorBodyPx}px = ${floor}줄이다. 📜 기록/알림은 반증·계략·소환이 사람에게 닿는 ` +
        `**유일한 통로**이므로 그때 통로의 대역폭은 0이 된다. ` +
        `(이 줄은 아래 래칫과 **무관하다** — 래칫을 통과해도 화면은 여전히 결함이다.)`,
    );
  lines.push(`□ 이 화면에서 봤지만 이번엔 판정하지 않는 것 — ${RC.knownUnmeasured}`);

  const cap = d.capacityLines ?? 0;
  if (!baseline)
    return {
      id,
      status: "SKIP",
      detail:
        `기준선 미기록 — 재기만 했다. 실측: 받은 몫 ${d.logBodyPx}px/${cap}줄 · ` +
        `보장 ${d.floorBodyPx}px/${floor}줄. ` +
        '`node scripts/gate-screen.mjs --only=result --update-baseline --reason="…"` 로 박아라',
      lines,
    };

  const limitPx = +(baseline.logBodyPx * (1 - RC.ratchetSlackPct / 100)).toFixed(1);
  const pxBad = d.logBodyPx < limitPx;
  const lineBad = cap < baseline.capacityLines;
  const floorPxBad = d.floorBodyPx < baseline.floorBodyPx - 0.5;
  const floorLineBad = floor < baseline.floorLines;
  if (pxBad)
    lines.push(
      `✗ 래칫 위반(받은 몫·픽셀) — 로그 본문 ${d.logBodyPx}px < ${limitPx}px ` +
        `(기준선 ${baseline.logBodyPx}px −${RC.ratchetSlackPct}%)`,
    );
  if (lineBad)
    lines.push(`✗ 래칫 위반(받은 몫·줄) — 담을 수 있는 줄 ${cap} < 기준선 ${baseline.capacityLines}줄`);
  if (floorPxBad)
    lines.push(`✗ 래칫 위반(보장·픽셀) — 바닥 본문 ${d.floorBodyPx}px < 기준선 ${baseline.floorBodyPx}px`);
  if (floorLineBad)
    lines.push(`✗ 래칫 위반(보장·줄) — 바닥 줄 수 ${floor} < 기준선 ${baseline.floorLines}줄`);

  const dPx = d.logBodyPx - baseline.logBodyPx;
  const gainPct = (dPx / Math.max(1, baseline.logBodyPx)) * 100;
  const bad = pxBad || lineBad || floorPxBad || floorLineBad;
  if (!bad && (gainPct >= RC.ratchetTightenPct || floor > baseline.floorLines))
    lines.push(
      `· 기준선보다 좋아졌다(받은 몫 ${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}% · 보장 ${baseline.floorLines}→${floor}줄). ` +
        "**기준선을 조여라** — " +
        'node scripts/gate-screen.mjs --only=result --update-baseline --reason="…" ' +
        "(조이지 않으면 다음 커밋이 되돌려놔도 통과한다)",
    );

  return {
    id,
    status: bad ? "FAIL" : "PASS",
    // ⚠️ 통과해도 **인쇄한다.** 기본 출력은 PASS 항목을 접는데, 이 검사는 통과가
    //    «정상»이 아니라 «안 나빠졌다»는 뜻이라 접히는 순간 게이트가 거짓말을 시작한다.
    // `[정정 2026-08-26]` 여기가 `short`(= 보장이 기능 하한 미달)였다. 플랜 28이 보장을
    //    0줄 → 4줄로 올리자 `short`가 false가 되면서 **이 블록 전체가 기본 출력에서 사라졌다**
    //    — `knownUnmeasured`(«조용히 빼면 은폐») 줄까지 함께. 결함을 고친 것이 은폐 방지
    //    장치를 끈 셈이라 `true`로 고정한다.
    always: true,
    detail:
      `받은 몫 ${d.logBodyPx}px/${cap}줄(컬럼의 ${pct(d.logPanelH)}) · **보장 ${d.floorBodyPx}px/${floor}줄**` +
      ` (기준선 ${baseline.logBodyPx}px·${baseline.capacityLines}줄 / 보장 ${baseline.floorBodyPx}px·${baseline.floorLines}줄, 기록 ${baseline.recordedAt})` +
      (bad
        ? " — **더 나빠졌다**"
        : short
          ? " — 회귀는 없다. **다만 현재 값 자체가 결함이다**(위 ✗ 참조 — 이 PASS는 «정상»이 아니라 «안 나빠졌다»는 뜻이다)"
          : ""),
    lines,
  };
};

// 📍 2026-08-25 — 여기 있던 `hudRectMap`/`judgeHudShift`(S4 «뷰 간 HUD 동일성»)가 사라졌다.
//    S4는 «뷰를 바꿔도 같은 HUD가 같은 자리에 있는가»를 재는 검사였고, 렌더러가 하나가 되면서
//    비교 대상이 없어졌다. 측정 대상이 없는 검사를 PASS로 남기면 «검사했다»는 거짓 신호가 된다.

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
    id: "F2b-hover만깨짐",
    expect: "S9",
    vp: "desktop", // hover는 손가락 화면에 없다 — 이 결함은 마우스 뷰포트에서만 성립한다
    // ⚠️ 지문은 **주입한 그 요소**여야 한다. 초안은 `/hover에서/`라 **모든 S9 위반 줄**에
    //    걸렸다 — 그러면 「내 결함을 잡았다」가 아니라 「S9에 FAIL이 하나라도 생겼다」가 된다
    //    (`zc-fault-hover`는 style의 id일 뿐 출력에 절대 안 나오는 죽은 대안이었다).
    signature: /\[button#(suggest|accuse|passage|bonus|endTurn)[^\]]* 에 hover\]/,
    why:
      "**평상 상태는 멀쩡하고 hover에서만** 글자가 배경에 묻히게 만든다 — 25회차에 실제로 난 " +
      "사고다(전역 `button:hover`가 커스텀 버튼으로 새어 대비 1.16:1). S6는 이걸 원리적으로 " +
      "못 본다. 잡는 것은 S9뿐이고, 이 결함이 안 잡히면 S9는 **아무것도 안 재는 검사**다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-hover';
      // 액션 바 버튼: 평상시 그대로, hover에서만 «거의 같은 두 색»으로 만든다.
      st.textContent = '.hud-ctrl button:hover{background:#8A8A8A !important;color:#828282 !important}';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F4b-마우스타깃",
    expect: "S3",
    vp: "desktop", // 28회차 전에는 마우스 뷰포트가 통째로 SKIP이라 이 결함이 **불가능**했다
    signature: /button#endTurn/,
    why:
      "[턴 종료]를 20×20으로 줄인다 — **마우스** 하한 24px(WCAG 2.2 §2.5.8 AA · 포인터 무관) 미달. " +
      "F4와 같은 결함이지만 **뷰포트가 다르다**: F4는 손가락 44, 이건 마우스 24다. " +
      "이 결함이 안 잡히면 28회차가 넓힌 것은 «숫자만 바꾼 SKIP»이다.",
    js: `(() => {
      const b = document.getElementById('endTurn');
      b.style.cssText += ';min-width:20px;min-height:20px;width:20px;height:20px;padding:0;font-size:8px';
      return 'injected';
    })()`,
  },
  {
    id: "F29-짧은가로에서몫나누기",
    expect: "S1",
    screen: "game-column",
    vp: "land",
    signature: /유일한 통로/,
    why:
      "**짧은 가로 화면에도** 3:2 몫을 강제한다 — 58·59회차가 실제로 그렇게 내보냈고 " +
      "로그의 온전한 줄이 `land` 2 → **1**, `edge` 1 → **0**이 됐다(검수 실측). " +
      "🔴 그 화면은 고정 크롬이 **컬럼의 47%**다(`#aiPanel` 66 + 손잡이 2개 88 = 154 / 324) — " +
      "그 안에서 몫을 어떻게 나눠도 로그가 죽는다. 그래서 조건을 `min-height: 501px`로 " +
      "좁혔고, **그 조건 자체를 이 결함이 지킨다.** " +
      "⚠️ `F28`은 `phone` 전용이라 이 회귀를 **못 잡는다**(검수 실증: 되돌려도 자기시험 초록).",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-short-share';
      st.textContent = '.rp-col .rp-evi { height: auto !important; flex: 3 1 0 !important; min-height: 200px !important; }'
        + '.rp-col .rp-log { flex: 2 1 0 !important; }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F28-로그가컬럼밖으로",
    expect: "S1",
    screen: "game-column",
    vp: "phone",
    /* 🔴 `/rp-head/`는 **로그와 증거 머리글을 구분하지 못한다** — `path()`가 id 없는 div를
       `div.rp-head`로만 찍기 때문이다. 검수가 증거 머리글만 밀어내고도 이 지문에 걸리는 것을
       실증했다(로그 계약이 죽어도 «잡았다»고 보고한다). 그 항목의 `why` 고유 문구로 좁힌다. */
    signature: /유일한 통로/,
    why:
      "폰 컬럼에서 증거 노트를 내용 높이로 풀어 **로그를 컬럼 밖으로** 밀어낸다 — " +
      "58회차 초안이 실제로 그렇게 나갔고 **게이트는 전건 초록이었다**(로그 top 414 → 864 · " +
      "컬럼 높이 828). 이 파일의 `F21` 주석이 이미 「`#logPanel`이 `protect`에 없어 " +
      "**S1은 원리적으로 침묵한다**」고 적어 뒀는데 그 구멍을 아무도 안 메웠다. " +
      "`index.html`은 그 패널을 「반증·계략·소환이 사람에게 닿는 **유일한 통로**」라 부른다. " +
      "59회차가 `#logPanel .rp-head`를 계약에 넣어 막았다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-log-pushed';
      st.textContent = '.rp-col .rp-evi { flex: 0 0 auto !important; height: auto !important; }'
        + '.rp-col .rp-evi .rp-body { overflow: visible !important; }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F27-상대단위로새는의도",
    expect: "S15",
    screen: "lobby",
    vp: "desktop",
    signature: /의도가/,
    why:
      "같은 누출을 **`rem`으로** 쓴다. 🔴 초안은 선언 문자열과 계산값을 **문자로 비교**해서 " +
      "`0.9375rem`(=15px)이면 조용히 통과했다(검수 실증). 단위를 안 풀면 그것이 우회로가 된다. " +
      "또한 초안은 `font: inherit` 같은 값을 «진 선언»으로 오인했다 — 이 저장소에 그런 요소가 " +
      "이미 **21개**(`.evi-hit`) 있고, 값이 안 겹쳐서 «오늘만» 조용했다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-type-rem';
      st.textContent = '@media (min-width: 761px) and (min-height: 600px) {'
        + ' .card button { font-size: 0.9375rem !important; } }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F26-쉼표not으로새는의도",
    expect: "S15",
    screen: "lobby",
    vp: "desktop",
    signature: /의도가/,
    why:
      "누출 규칙을 **`:not(a, b)`** 꼴로 쓴다. 🔴 초안은 선택자 리스트를 `split(\",\")`로 잘라 " +
      "괄호 속 쉼표에 규칙이 조각났고, `el.matches`가 던져 **그 규칙이 통째로 사라졌다** " +
      "— 같은 결함이 `:not(.a):not(.b)`면 FAIL, `:not(.a, .b)`면 PASS였다(검수 실증). " +
      "하필 `index.html`의 제외 목록 주석이 **그 리팩터를 다음 사람에게 권한다.**",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-type-comma';
      st.textContent = '@media (min-width: 761px) and (min-height: 600px) {'
        + ' .card button:not(.zzz, .yyy) { font-size: 15px !important; } }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F25-타입선언이의도를이김",
    expect: "S15",
    screen: "lobby",
    vp: "desktop",
    signature: /의도가/,
    why:
      "데스크톱 tier의 `.card button`이 **요소를 겨냥한 글자 크기 의도를 이기게** 만든다. " +
      "🔴 이 사고는 **세 번 났다** — `.char`(12 → 15px) · `.inv-code-v`(20 → 15px) · " +
      "`.full`(16 → 15px). 앞의 둘은 사람이 눈으로 찾았고 **게이트는 전건 초록**이었다. " +
      "S5는 «하한»(10px)이고 coarse에서만 도는데 15px은 하한을 안 어긴다 — " +
      "어긴 것은 하한이 아니라 **의도**다. 셋째는 이 검사가 만들어지자마자 찾았다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-type-intent';
      /* 배포 규칙보다 뒤에 오는 같은 조건의 규칙 — 제외 목록을 무력화한다 */
      st.textContent = '@media (min-width: 761px) and (min-height: 600px) {'
        + ' .card button { font-size: 15px !important; } }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F24-포커스가남을덮음",
    expect: "S14",
    screen: "landing",
    vp: "edge", // 짧은 화면 — 세로로 펴기 전에는 여기서 1차 컨트롤을 46.5×7px 덮었다
    signature: /포커스 →/,
    why:
      "배경음 슬라이더를 **옆으로** 펴게 되돌린다(52회차 전 상태) — 컨테이너가 60 → 162가 되어 " +
      "카드 오른쪽을 파고든다. " +
      "🔴 **이 축은 S13(hover 기하)이 원리적으로 못 본다**: 축이 `:focus-within`이고 " +
      "결함이 **coarse에만** 나는데 S13은 coarse를 통째로 SKIP한다. " +
      "43회차가 «사람 몫»으로 큐에 남긴 뒤 아홉 회차를 살아남은 결함이다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-focus-grow';
      /* 🔴 **수리의 «전부»를 되돌려야 결함이 재현된다.** 초안은 방향과 폭만 되돌리고
         padding·gap은 남겨 둬서, 재현된 상자가 배포 전 상태보다 작았다 —
         결함을 재현한 것이 아니라 «비슷한 것»을 만든 것이다(검수 지적).
         아래 값은 전부 이 규칙이 덮고 있는 기본값이다 — index.html의 .bgm-ctrl 과 그 :hover.
         (주입 코드 안에는 백틱을 쓰지 않는다.) */
      st.textContent = '#bgmCtrl:hover, #bgmCtrl:focus-within { flex-direction: row-reverse !important;'
        + ' padding: 3px 4px 3px 12px !important; gap: 6px !important; }'
        + '#bgmCtrl:hover .bgm-vol, #bgmCtrl:focus-within .bgm-vol { width: 92px !important; }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F23-hover가남을덮음",
    expect: "S13",
    screen: "game",
    vp: "bannerTop",
    signature: /hover → \.hud-ctrl를/,
    why:
      "칩 hover에서 이름을 **크게** 펼치게 만든다 — **배포된 셀렉터(`.ti-chip:hover`)를 탄다.** " +
      "🔴 초안은 옛 셀렉터(`.hud-turn:hover`)만 시험해서, **수리한 자리를 재는 결함이 하나도 없었다** " +
      "— 검수가 되주입으로 그 침묵을 증명했다(140.8×40px에 S13이 조용했다). " +
      "**S1은 평상 상태만, S9는 색만 재므로 이 축은 원리적으로 안 보였다**: 실측 폭 326 → 611.9, " +
      "액션 바를 66×40px 덮는다. 50회차가 배너를 상단 줄로 되돌리며 되살린 축이고, " +
      "마우스를 진짜로 움직이는 장치는 S9가 이미 갖고 있었는데 **색만 읽고 있었다.**",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-hover-grow';
      st.textContent = '.ti-chip:hover .ti-nm { max-width: 30em !important; opacity: 1 !important; margin-left: 300px !important; }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F22-배너가상단을떠남",
    expect: "S12",
    screen: "game",
    vp: "bannerTop", // 🔴 `desktop`을 고르면 규칙이 안 걸린다 — F19가 겪은 실수와 같다
    signature: /\.hud-ctrl와 세로 교차/,
    why:
      "넓은 화면(폭 ≥1360)에서 배너를 **아래 줄로 내린다** — 47회차가 조건 없이 내려 " +
      "«겹침이 애초에 없는 화면까지» 보드 위로 내려앉았던 그 상태다. " +
      "🔴 **50회차 초안은 이 방향을 «`bannerTop`이 잡는다»고 적었는데 거짓이었다** — " +
      "상한을 1500으로 올려도 전건 PASS였다(규칙이 경계를 따라가서 침묵한다). " +
      "F를 붙였으면 착수 중에 드러났다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-banner-down';
      st.textContent = '@media (min-width: 1360px) { .hud-turn { top: 62px !important; } }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F20-덱이상단으로",
    expect: "S12",
    screen: "game",
    vp: "phone",
    signature: /\.hud-turn 아래 여유/,
    why:
      "하단 데크를 **상단으로 되돌린다** — 폰 분기가 스스로 「상단 좌측에 두면 6개 버튼이 폭을 " +
      "거의 다 먹어 배너와 겹친다」고 적어 둔 그 회귀다. " +
      "🔴 **49회차 초안은 이걸 `display: grid`로 재려 했고, 검수가 «덱을 위로 올리되 `grid`는 " +
      "유지»한 상태를 되주입하니 S12가 침묵했다** — `display`는 의도의 «상관관계»일 뿐이었다. " +
      "이 결함이 그때 있었으면 착수 중에 드러났다. 그래서 관계(`below`)로 고쳤다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-deck-top';
      st.textContent = '.hud-ctrl { top: 6px !important; bottom: auto !important; }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F21-컬럼스크롤해제",
    expect: "S12",
    screen: "game-column",
    vp: "phone",
    signature: /\.rp-col \{ overflowY \}/,
    why:
      "우측 컬럼의 `overflow-y`를 `visible`로 되돌린다. **S1은 원리적으로 침묵한다** — " +
      "흘러넘치는 `#logPanel`이 `protect`에 없기 때문이다(검수 실측: 컬럼 접힘 아래 27px에 있어 " +
      "상자 밖으로 흘러 보드 위에 그려지고 뷰포트 밖으로 19px 나간다). 이 축은 S12만 본다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-col-overflow';
      st.textContent = '.rp-col { overflow-y: visible !important; }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F19-조판분기되돌림",
    expect: "S12",
    screen: "lobby",
    vp: "cardGuard", // 🔴 초안은 `desktop`(1440×900)이라 **진짜 가드 회귀가 재현되지 않았다**
    signature: /\.card \{ width \}/,
    why:
      "`.card`의 데스크톱 폭을 380으로 되돌린다 — **가드가 회귀한 것과 같은 상태**다. " +
      "47회차가 실증했듯 S1~S11은 이걸 **원리적으로 못 본다**: 카드가 «더 작아질» 뿐 " +
      "여전히 화면에 들어가서 전건 PASS다. 39~47회차가 내내 다툰 것이 그 경계값들인데, " +
      "그 값은 **회귀해도 화면이 깨지지 않고 그냥 나빠진다.** 그 축을 재는 것이 S12다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-layout';
      // 🔴 초안은 높이 조건이 없어 «모든 높이에서 380»이었다 — 실제 가드 회귀(600→660)는
      //    높이 600~659에서만 나타난다. 「가드가 회귀한 것과 같은 상태」라던 설명이 거짓이었다.
      st.textContent = '@media (min-width: 761px) and (min-height: 600px) { .card { width: 380px !important; } }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F18-스크롤상자접힘",
    expect: "S1",
    screen: "accuse-modal",
    vp: "phone",
    signature: /button\.(ghost|danger).*상자 안에서 접힘 아래/,
    why:
      "모달의 `max-height`를 300px으로 줄여 `[취소]`/`[신고한다]`가 **상자 안에서 부분만** 보이게 한다. " +
      "🔴 초안은 160px이었는데 그러면 버튼이 **통째로** 접혀 `offscreen` 분기로 새어 나가, " +
      "정작 지문에 걸린 것은 `select` 하나뿐이었다 — **자기가 말하는 것을 시험하지 않았다**(검수 지적). " +
      "**뷰포트로는 멀쩡하다** — 요소가 화면 안에 있고 잘린 것은 스크롤 상자다. " +
      "44회차까지 `visBox`가 뷰포트만 잘라서 이 축은 **원리적으로 안 보였고**, " +
      "실측 620×340에서 주 행동이 44px 중 7px만 보이는데 S1은 전건 PASS였다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-clipbox';
      st.textContent = '.modal { max-height: 300px !important; }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F17-보호대상뷰포트잘림",
    expect: "S1",
    vp: "phone",
    signature: /뷰포트에 잘림/,
    why:
      "액션 바를 아래로 30px 밀어 버튼 절반이 뷰포트 밖으로 나가게 한다. " +
      "**«뷰포트 밖»(넓이 0)과 «멀쩡함» 사이가 통째로 사각지대였다** — 표본점은 " +
      "«보이는 상자» 안에서만 찍히므로 절반이 잘려도 나머지 절반에서 self가 잡혀 PASS였다. " +
      "41회차 실측: 1280×450에서 [잔치 시작]이 아래 11.6px 잘린 채로 게이트를 통과했다.",
    js: `(() => {
      const el = document.querySelector('.hud-ctrl');
      el.style.cssText += ';transform:translateY(30px)';
      return 'injected';
    })()`,
  },
  {
    id: "F16-선택컨트롤잘림",
    expect: "S11",
    screen: "accuse-modal", // select가 있는 유일한 도달 가능 화면(제안 모달은 방 진입이 필요하다)
    vp: "phone",
    signature: /모자라 잘린다/,
    why:
      "모달 select를 90px으로 좁힌다 — 최장 옵션이 들어가지 못한다. " +
      "**39회차가 실제로 겪은 결함과 같은 종류다**(기본 폭이 좁아 옵션이 잘렸다). " +
      "그때 S1~S10은 전건 PASS였다 — 40회차가 결함을 되주입해 확인했다. " +
      "`.modal select { min-width: 0 }`이 브라우저의 «최장 옵션에 맞추기»를 끄기 때문에 " +
      "이 축은 **CSS로 언제든 다시 열린다.** 잡히지 않으면 그 문이 무방비다.",
    js: `(() => {
      const st = document.createElement('style');
      st.id = 'zc-fault-clip';
      st.textContent = '.modal select { width: 90px !important; flex: 0 0 90px !important; }';
      document.head.appendChild(st);
      return 'injected';
    })()`,
  },
  {
    id: "F11-카메라프레이밍",
    expect: "S10",
    vp: "phone",
    signature: /프레이밍이 어긋났다/,
    why:
      "씬의 `insetOffsetY()`를 **200(월드)**로 덮어써 추적 오프셋을 어긋나게 한다 — " +
      "34회차가 실제로 만든 회귀와 **같은 종류**다(오프셋 식이 틀린 경우). " +
      "폰 zoom 0.4에서 화면 **80px** 밀리므로 한계 24px을 확실히 넘는다. " +
      "이 축은 **DOM으로는 안 보인다** — S1~S9가 전건 PASS인 채로 내 말이 D패드 뒤로 사라졌었다.",
    js: `(() => {
      const g = window.__zcGame; if (!g) return 'no game';
      const sc = g.scene.getScenes(true).find((x) => typeof x.camFraming === 'function');
      if (!sc) return 'no scene';
      sc.insetOffsetY = () => 200;   // \`update()\`가 매 프레임 이 값을 followOffset에 넣는다
      return 'injected';
    })()`,
  },
  {
    id: "F4c-마우스24통과",
    expect: "S3",
    vp: "desktop",
    shouldPass: true, // **하한이 24임을 고정한다** — 44라면 이 결함이 FAIL을 낸다
    signature: /button#endTurn/,
    why:
      "[턴 종료]를 **30×30**으로 줄인다 — 마우스 하한 24는 **통과**하고 손가락 하한 44라면 **실패**한다. " +
      "F4b(20×20)는 24·44 **양쪽에서** 잡히므로 «데스크톱을 재기는 한다»만 증명한다. " +
      "`minPointerPx`를 실수로 44로 적어도 F4b는 그대로 OK를 찍는다 — 그 구멍을 이 결함이 막는다.",
    js: `(() => {
      const b = document.getElementById('endTurn');
      b.style.cssText += ';min-width:30px;min-height:30px;width:30px;height:30px;padding:0;font-size:9px';
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
    id: "F6-작은글자",
    expect: "S5",
    signature: /#endTurn/,
    why:
      "[턴 종료] 라벨만 7px로 줄인다(상자 크기는 그대로 — S3는 건드리지 않는다). " +
      "«칸은 44px인데 글자는 못 읽는» 상태가 실제로 가능하다는 것이 이 검사의 존재 이유다",
    js: `(() => {
      document.getElementById('endTurn').style.fontSize = '7px';
      return 'injected';
    })()`,
  },
  {
    id: "F7-저대비",
    expect: "S6",
    signature: /#accuse/,
    why:
      "[신고하기] 글자색을 버튼 배경과 거의 같은 색으로 바꾼다(1.1:1) — " +
      "§7.13이 고친 `#6b6355`(2.9:1) 회귀가 다시 일어났을 때의 모양",
    js: `(() => {
      document.getElementById('accuse').style.color = '#b46a35';
      return 'injected';
    })()`,
  },
  {
    id: "F8-비활성면제",
    expect: "S6",
    signature: /#passage/,
    shouldPass: true, // **오탐 방지 시험** — 문서화한 WCAG 예외가 실제로 도는지 본다
    why:
      "`aria-disabled=\"true\"`인 [통로] 글자를 배경색과 같게 만든다. " +
      "WCAG 1.4.3은 비활성 컴포넌트를 명시적으로 예외로 두므로 **잡히면 안 된다** — " +
      "이 예외가 실제로 도는지, 그리고 선택자가 아직 살아 있는지를 확인한다",
    js: `(() => {
      const b = document.getElementById('passage');
      if (b.getAttribute('aria-disabled') !== 'true') return 'not-disabled';
      b.style.color = getComputedStyle(b).backgroundColor;
      return 'injected';
    })()`,
  },
];

/**
 * S7(공개방 목록 배지) 음성 테스트 결함.
 *
 * ⚠️ 이 결함들은 **게임 판이 필요 없다.** 공개방 하나(대기 중) + 랜딩 관측 탭 하나면
 *    §8.5 1행이 성립하므로, 음성 테스트에 6탭 실판(≈18초)을 끌고 오지 않는다.
 * ⚠️ `js`는 **문(statement)**이다 — 주입과 재독을 한 표현식으로 묶기 때문이다
 *    (랜딩의 5초 자동 갱신이 그 사이에 끼면 결함이 지워져 «게이트가 놓쳤다»로 잘못 읽힌다).
 */
const ROOM_FAULTS = [
  {
    id: "F9-배지오표기",
    signature: /배지 — 기대 «대기 중» · 실제 «종료됨»/,
    why: "대기 중인 방의 배지를 «종료됨»으로 바꾼다 — 상태를 거꾸로 적은 목록 그 자체다",
    js: `document.querySelector('#roomList .ri-badge').textContent = '종료됨';`,
  },
  {
    id: "F10-버튼오표기",
    signature: /버튼 — 기대 «참가» · 실제 «관전»/,
    why:
      "버튼 라벨만 «관전»으로 바꾼다(배지는 그대로 «대기 중»). " +
      "§8.5가 막으려는 사고가 정확히 이것의 거울상이다 — 상태와 버튼이 서로 다른 말을 한다",
    js: `document.querySelector('#roomList .room-item button').textContent = '관전';`,
  },
  {
    id: "F11-버튼잠김",
    signature: /버튼 활성 — 기대 «활성» · 실제 «비활성»/,
    why:
      "라벨은 «참가» 그대로 두고 버튼만 비활성으로 만든다. " +
      "글자만 비교하면 통과해 버리는 자리다 — «만석»의 절반은 라벨이 아니라 `disabled`다",
    js: `document.querySelector('#roomList .room-item button').disabled = true;`,
  },
  {
    id: "F12-무해한변경",
    shouldPass: true, // **오탐 방지 시험** — 이건 잡히면 안 된다
    signature: /./,
    why:
      "방장 이름만 바꾼다. §8.5가 규정하는 것은 배지·버튼·부가 문구뿐이므로 " +
      "**잡히면 안 된다** — 잡히면 이 검사는 «줄이 바뀌었다»를 재는 것이지 문안을 재는 게 아니다",
    js: `document.querySelector('#roomList .ri-body b').textContent = 'ZZZ';`,
  },
];

if (OPT.selfTest) {
  // 자기검사는 폰을 기본으로 쓴다(44px 하한 등 손가락 축이 많다). 다만 **hover는 폰에 없다** —
  // S9 같은 검사는 결함마다 뷰포트를 고를 수 있어야 한다(`f.vp`).
  const vpPhone = SCREEN.viewports.find((v) => v.id === "phone");
  const scr = (id) => SCREEN.screens.find((s) => s.id === id);
  const rows = [];
  /** 화면 하나를 열고 판정한다. */
  const run = async (screen, faultJs, vp = vpPhone) => {
    const r = await openScreen(screen, vp, faultJs);
    if (r.unreachable || r.skip) {
      await r.close?.();
      return { fail: r.unreachable ?? r.skip };
    }
    const checks = judge(screen, vp, r.data);
    await r.close();
    return { checks };
  };

  // 기준선 — 결함 없이 통과하는가(통과해야 «FAIL이 결함 때문»이라고 말할 수 있다).
  // 화면마다 따로 필요하다: F5는 뷰2에 주입하므로 «뷰2의 무결함 상태»가 기준선이다.
  const baselines = new Map();
  // ⚠️ 기준선은 **결함과 같은 뷰포트**여야 한다 — 「기준선에 없던 지문이 새로 나타났는가」가
  //    판정 방식이라, 뷰포트가 다르면 지문 집합 자체가 달라 비교가 성립하지 않는다.
  const baselineOf = async (id, vpId = "phone") => {
    const key = `${id}@${vpId}`;
    if (baselines.has(key)) return baselines.get(key);
    step(`음성 테스트 기준선 ${key}`);
    const r = await run(scr(id), null, SCREEN.viewports.find((v) => v.id === vpId));
    if (r.fail) skipOut(`음성 테스트 기준선(${id}) 도달 실패 — ${r.fail}`, client.log);
    baselines.set(key, r.checks);
    rows.push({
      id: `기준선(${key})`,
      expect: "-",
      got: r.checks.map((c) => `${c.id}:${c.status}`).join(" "),
      ok: true,
      note: "결함 주입 전 상태. 여기서 이미 FAIL이면 아래 판정은 결함 때문이 아니다",
      checks: r.checks,
    });
    return r.checks;
  };
  // 결함 주입 전 기준선 — 「FAIL이 결함 때문」이라고 말하려면 무결 상태의 통과가 먼저다.
  await baselineOf("game");
  /** 한 검사의 판정 문장 전부(요약 + 위반 줄). 지문 대조용. */
  const violations = (checks, id) => {
    const c = checks.find((x) => x.id === id);
    if (!c || c.status !== "FAIL") return [];
    return [c.detail, ...(c.lines ?? []).filter((l) => l.startsWith("✗"))];
  };

  for (const f of FAULTS) {
    const screen = scr(f.screen ?? "game");
    const baseChecks = await baselineOf(screen.id, f.vp ?? "phone");
    step(`음성 테스트 ${f.id}`);
    const r = await run(screen, f.js, SCREEN.viewports.find((v) => v.id === (f.vp ?? "phone")));
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

  // ── S7 음성 테스트 — 공개방 1개(대기 중) + 랜딩 관측 탭 1개.
  //    실판을 돌리지 않는다: §8.5 1행은 «방 하나가 목록에 있다»만으로 성립한다.
  {
    step("음성 테스트 기준선 room-list");
    const rlHost = await newTab(null);
    const rlObs = await newTab(null);
    const rlBail = async (why) => {
      await rlHost.close();
      await rlObs.close();
      // 결함을 주입할 무대 자체를 못 만들었다 → **판정 불가(SKIP)**다. 통과로 세지 않는다.
      skipOut(`S7 음성 테스트 기준선 도달 실패 — ${why}`, client.log);
    };
    await cmd("Page.navigate", { url: `${BASE}/?demo=1` }, rlHost.sid);
    if (!(await waitFor(rlHost.sid, "document.readyState === 'complete' && !!document.getElementById('createBtn')", SCREEN.readyTimeoutMs)))
      await rlBail("랜딩이 뜨지 않았다");
    await evalIn(rlHost.sid, clickJs('#visSeg .seg-btn[data-pub="1"]'));
    await evalIn(rlHost.sid, clickJs("#createBtn"));
    if (!(await waitFor(rlHost.sid, "!document.getElementById('lobby').classList.contains('hidden')", SCREEN.readyTimeoutMs)))
      await rlBail("공개방을 만들지 못했다");
    await cmd("Page.navigate", { url: `${BASE}/?demo=1` }, rlObs.sid);
    if (!(await waitFor(rlObs.sid, "document.readyState === 'complete' && !!document.getElementById('refreshRooms')", SCREEN.readyTimeoutMs)))
      await rlBail("관측 탭에 랜딩이 뜨지 않았다");

    const rlCase = SCREEN.roomList.cases.lobby;
    const rlCtx = { clients: 1, maxClients: SCREEN.result.seats };
    /** 목록을 새로 그린 뒤(결함이 있으면 주입해) 판정한다. */
    const rlRead = async (faultJs) => {
      const snap = await readRoomList(rlObs.sid, 1);
      if (!faultJs) return judgeRoomList(rlCase, snap, rlCtx);
      const after = await evalIn(rlObs.sid, `(() => { ${faultJs} return ${READ_ROOM_LIST_JS}; })()`);
      return judgeRoomList(rlCase, after, rlCtx);
    };

    const rlBase = await rlRead(null);
    if (rlBase.status !== "PASS")
      await rlBail(`결함 없이도 통과하지 않는다(${rlBase.status}) — ${rlBase.detail} ${(rlBase.lines ?? []).join(" ")}`);
    rows.push({
      id: "기준선(room-list)",
      expect: "-",
      got: `S7:${rlBase.status}`,
      ok: true,
      note: "결함 주입 전 상태 — 대기 중인 공개방 1개가 §8.5 1행 문안대로 그려졌다",
    });
    for (const f of ROOM_FAULTS) {
      step(`음성 테스트 ${f.id}`);
      const c = await rlRead(f.js);
      const hits = (c.status === "FAIL" ? [c.detail, ...(c.lines ?? [])] : []).filter((l) => f.signature.test(l));
      rows.push({
        id: f.id,
        expect: f.shouldPass ? "S7 무반응" : "S7 신규 FAIL",
        got: `S7:${c.status} · 지문 ${hits.length}건`,
        ok: f.shouldPass ? c.status === "PASS" : hits.length > 0,
        note: f.why,
        detail: hits.slice(0, 3),
      });
    }
    await rlHost.close();
    await rlObs.close();
  }

  // ── S8 음성 테스트 — 데스크톱 게임 화면 **1탭**만 쓴다 ─────────────────
  //
  // ⚠️ 여기서 묻는 것은 «이 판정기가 배분 악화에 반응하는가»다. 그 질문에는 **판 중반이
  //    필요 없다** — 제안 기록표를 6행까지 키우는 것은 본 실행에서 «어떤 값을 재는가»를
  //    고정하려는 장치이지, 판정기가 도는 조건이 아니다. 그래서 음성 테스트에
  //    6탭 실판(≈35초)을 끌고 오지 않는다(S7 음성 테스트와 같은 규약).
  // 기준선은 **이 실행의 무결함 상태 그 자체**로 만든다. 파일 기준선을 쓰면
  // «내가 주입한 결함 때문에 FAIL인가, 원래 파일 값과 달라서인가»가 구분되지 않는다.
  {
    step("음성 테스트 기준선 right-column");
    const rcVp = SCREEN.viewports.find((v) => v.id === SCREEN.rightColumn.viewport);
    const rcTab = await newTab(rcVp);
    const rcBail = async (why) => {
      await rcTab.close();
      skipOut(`S8 음성 테스트 기준선 도달 실패 — ${why}`, client.log);
    };
    const gameScreen = scr("game");
    await cmd("Page.navigate", { url: BASE + gameScreen.url }, rcTab.sid);
    if (!(await waitFor(rcTab.sid, gameScreen.ready, SCREEN.readyTimeoutMs)))
      await rcBail("솔로 게임 화면에 도달하지 못했다");
    await sleep(SCREEN.settleMs);
    /** 결함을 넣고(있으면) 읽고, 곧바로 되돌린다 — 결함이 다음 사례로 새면 판정이 뒤섞인다. */
    const rcRead = async (f) => {
      if (f) await evalIn(rcTab.sid, `(() => { ${f.js} return true; })()`);
      await sleep(250);
      const snap = await evalIn(rcTab.sid, READ_RP_COL_JS);
      if (f) await evalIn(rcTab.sid, `(() => { ${f.undo} return true; })()`);
      return snap;
    };
    const clean = await rcRead(null);
    if (clean?.err) await rcBail(clean.err);
    /** 이 실행의 무결함 상태 = 기준선. 파일(`gate.baseline.json`)은 쓰지 않는다. */
    const synth = {
      recordedAt: "음성 테스트(이 실행의 무결함 상태)",
      logBodyPx: clean.logBodyPx,
      capacityLines: clean.capacityLines,
      floorBodyPx: clean.floorBodyPx,
      floorLines: clean.floorLines,
    };
    /** 래칫이 낸 위반만 센다 — 항상 인쇄되는 «결함 확인» 줄은 결함의 지문이 아니다. */
    const rcHits = (c, sig) =>
      (c.status === "FAIL" ? (c.lines ?? []) : []).filter((l) => l.startsWith("✗ 래칫") && sig.test(l));

    const rcBase = judgeRightColumn({ data: clean }, synth);
    if (rcBase.status !== "PASS")
      await rcBail(`결함 없이도 통과하지 않는다(${rcBase.status}) — ${rcBase.detail}`);
    rows.push({
      id: "기준선(right-column)",
      expect: "-",
      got: `S8:${rcBase.status}`,
      ok: true,
      note:
        `결함 주입 전 상태 — 받은 몫 ${clean.logBodyPx}px/${clean.capacityLines}줄 · ` +
        `보장 ${clean.floorBodyPx}px/${clean.floorLines}줄. ` +
        "**PASS는 «정상»이 아니라 «기준선보다 안 나빠졌다»는 뜻이다**(그 사실은 판정문의 «결함 확인» 줄이 말한다).",
    });

    const RC_FAULTS = [
      {
        id: "F13-로그몫잠식",
        signature: /래칫 위반\(받은 몫·픽셀\)/,
        why:
          "증거 노트 높이를 600px으로 늘려 컬럼을 넘치게 만든다 — 위 패널이 자라 " +
          "로그가 `min-height` 바닥으로 밀리는 **바로 그 사고**의 축소판이다. " +
          "S1은 침묵한다(아무도 로그를 덮지 않았다). 이 검사가 잡아야 한다",
        js: "document.getElementById('eviPanel').style.height = '600px';",
        undo: "document.getElementById('eviPanel').style.height = '';",
      },
      {
        id: "F14-바닥삭감",
        signature: /래칫 위반\(보장·픽셀\)/,
        why:
          "`#logPanel`의 `min-height`를 0으로 지운다. 화면은 **지금 이 순간 아무것도 달라지지 " +
          "않는다**(받은 몫 그대로) — 사라지는 것은 «최악에도 이만큼»이라는 약속뿐이다. " +
          "받은 몫만 재는 검사기는 이 회귀를 영원히 못 본다",
        js: "document.getElementById('logPanel').style.minHeight = '0px';",
        undo: "document.getElementById('logPanel').style.minHeight = '';",
      },
      {
        id: "F15-줄만늘림",
        shouldPass: true, // **오탐 방지 시험** — 이건 잡히면 안 된다
        signature: /./,
        why:
          "로그에 줄 20개를 더 넣는다(배분은 한 픽셀도 안 바뀐다). " +
          "S8이 재는 것은 **몫**이지 내용이 아니므로 **잡히면 안 된다** — " +
          "잡히면 이 검사는 «로그가 길어졌다»를 재는 것이지 배분을 재는 게 아니다",
        js:
          "const h = document.getElementById('log');" +
          "for (let i = 0; i < 20; i++) { const d = document.createElement('div');" +
          "d.className = 'log-info zc-fault-line'; d.textContent = '음성 테스트 줄 ' + i; h.prepend(d); }",
        undo: "for (const e of Array.from(document.querySelectorAll('.zc-fault-line'))) e.remove();",
      },
    ];
    for (const f of RC_FAULTS) {
      step(`음성 테스트 ${f.id}`);
      const snap = await rcRead(f);
      const c = snap?.err
        ? { status: "SKIP", detail: snap.err, lines: [] }
        : judgeRightColumn({ data: snap }, synth);
      const hits = rcHits(c, f.signature);
      rows.push({
        id: f.id,
        expect: f.shouldPass ? "S8 무반응" : "S8 신규 FAIL",
        got:
          `S8:${c.status} · 지문 ${hits.length}건` +
          (snap?.err ? "" : ` · 받은 몫 ${snap.logBodyPx}px/${snap.capacityLines}줄 · 보장 ${snap.floorBodyPx}px`),
        ok: f.shouldPass ? c.status === "PASS" && hits.length === 0 : hits.length > 0,
        note: f.why,
        detail: hits.slice(0, 3),
      });
    }
    await rcTab.close();
  }

  const bad = rows.filter((r) => !r.ok);
  if (OPT.json) {
    console.log(JSON.stringify({ mode: "self-test", status: bad.length ? "FAIL" : "PASS", rows }, null, 2));
  } else {
    if (tty) process.stderr.write(`${" ".repeat(70)}\r`);
    console.log(`\n══ 화면 게이트 · 음성 테스트(일부러 깨뜨려 본다) ${"═".repeat(24)}`);
    console.log(
      "   대상: 게임 뷰1 · 폰 390×844 (S1~S6) · 데스크톱 1440×900 (S9 — hover는 폰에 없다) · 랜딩 공개방 목록 1줄 (S7)",
    );
    console.log("   결함은 런타임 주입이라 앱 코드는 그대로다\n");
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
        why: `기본 대상은 이 화면을 ${screen.viewportsDefault.join("·")} 뷰포트로만 잰다 — \`--full\`에서 돈다`,
      });
      continue;
    }
    // 어떤 화면은 **한 뷰포트에만 존재한다**(예: 폰의 «컬럼 펼침» — 데스크톱은 늘 펼쳐져 있고
    // 토글 버튼 자체가 `display:none`이라 도달 자체가 불가능하다). 그런 조합은 «도달 실패»가
    // 아니라 **사유 있는 SKIP**이다 — 조용히 빼지 않는다.
    if (screen.onlyViewports) {
      // 오타 하나면 그 화면이 **전 뷰포트에서 조용히 SKIP**되고 exit 0이 난다.
      const bad = screen.onlyViewports.filter((id) => !SCREEN.viewports.some((v) => v.id === id));
      if (bad.length)
        skipOut(
          `gate.config 오류 — 화면 «${screen.id}»의 onlyViewports에 없는 뷰포트 id: ${bad.join(", ")}`,
          `쓸 수 있는 id: ${SCREEN.viewports.map((v) => v.id).join(", ")}`,
        );
    }
    if (screen.onlyViewports && !screen.onlyViewports.includes(vp.id)) {
      results.push({
        screen: screen.id,
        label: screen.label,
        vp: vp.id,
        vpLabel: vp.label,
        ms: 0,
        skip: `이 화면은 ${screen.onlyViewports.join("·")} 뷰포트에만 존재한다 — ${screen.onlyViewportsWhy}`,
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
/** S8 관측치(래칫 기준선 갱신용). 못 쟀으면 null. */
let rightColumnRun = null;
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
  // S7 — 결과 흐름이 도중에 끊겨도(`skip`) **거기까지 잰 시점은 인쇄한다.**
  // 못 잰 시점은 아예 행이 없는 것이 아니라, 도달한 데까지만 남는다.
  for (const rc of resultFlow.roomChecks ?? []) {
    if (rc.check.status === "SKIP") {
      results.push({ screen: rc.id, label: rc.label, vp: "-", vpLabel: "관측 탭", ms: rc.ms, skip: rc.check.detail });
      continue;
    }
    results.push({ screen: rc.id, label: rc.label, vp: "-", vpLabel: "관측 탭", ms: rc.ms, checks: [rc.check] });
  }
  // S8 — 판 중반 우측 컬럼 배분. 위 1판에 얹혀 돌았다(새 판·새 브라우저 없음).
  {
    const rc = resultFlow.rightColumn;
    const check = judgeRightColumn(rc, readBaseline().screenRightColumn ?? null);
    const base = {
      screen: SCREEN.rightColumn.id,
      label: SCREEN.rightColumn.label,
      vp: SCREEN.rightColumn.viewport,
      vpLabel: `${SCREEN.rightColumn.viewport} · 판 중반(제안 ${SCREEN.rightColumn.suggestRows}행)`,
      ms: rc?.ms ?? 0,
    };
    // S8 옆에 **같은 탭에서 잰 나머지 검사**를 붙인다(30회차 · 플랜 50).
    // 이 화면에만 있는 것이 제안 기록표라 여기서만 `.sg-*`가 계측된다.
    const rcVpObj = SCREEN.viewports.find((v) => v.id === SCREEN.rightColumn.viewport);
    let rcMore = [];
    if (rc?.probe?.err) {
      rcMore = [{ id: "S1~S9", status: "SKIP", detail: `계측 실패 — ${rc.probe.err}` }];
    } else if (rc?.probe && !rcVpObj) {
      // 조용히 비우지 않는다 — 사유 없는 미측정이 이 저장소가 가장 경계하는 실패다.
      rcMore = [{ id: "S1~S9", status: "SKIP", detail: `뷰포트 «${SCREEN.rightColumn.viewport}» 정의를 SCREEN.viewports에서 못 찾았다 — 판정 불가` }];
    } else if (rc?.probe) {
      rcMore = judge(SCREEN.rightColumn.probe, rcVpObj, rc.probe);
    }
    // 🔴 **S8이 SKIP이어도 나머지는 살린다.** S8이 SKIP되는 흔한 경로는 「기준선 미기록」인데
    //    그때 `rc.probe`는 **정상 계측돼 있다** — 초안은 그 경우 방금 붙인 S1~S9를
    //    사유도 없이 통째로 버렸다(검수 지적). 기준선을 새로 박는 회차마다 조용한 미측정이 났을 것이다.
    if (check.status === "SKIP")
      results.push({ ...base, skip: check.detail, skipLines: check.lines, checks: rcMore.length ? rcMore : undefined });
    else results.push({ ...base, checks: [check, ...rcMore], shot: join(outDir, `right-column-${SCREEN.rightColumn.viewport}.png`) });
    rightColumnRun = rc;
  }
  // 폰은 원리적으로 같은 수치가 정의되지 않는다 — **조용히 빼지 않는다.**
  results.push({
    screen: `${SCREEN.rightColumn.id}-phone`,
    label: `${SCREEN.rightColumn.label} · 폰`,
    vp: "phone",
    vpLabel: "폰 390×844",
    ms: 0,
    skip: SCREEN.rightColumn.phoneSkipWhy,
  });
} else {
  results.push({
    screen: "result",
    label: SCREEN.result.label,
    vp: "-",
    vpLabel: "6탭 세션",
    ms: 0,
    skip: `기본 대상에서 제외됨(tier=${RESULT_TIER}) — \`--full\`에서 돈다`,
  });
  for (const k of Object.keys(SCREEN.roomList.cases))
    results.push({
      screen: SCREEN.roomList.cases[k].id,
      label: SCREEN.roomList.cases[k].label,
      vp: "-",
      vpLabel: "관측 탭",
      ms: 0,
      skip: `6탭 실판에 얹혀 도는 검사다 — 결과 흐름이 기본 대상에서 빠지면(tier=${RESULT_TIER}) 함께 빠진다`,
    });
  results.push({
    screen: SCREEN.rightColumn.id,
    label: SCREEN.rightColumn.label,
    vp: SCREEN.rightColumn.viewport,
    vpLabel: "6탭 세션",
    ms: 0,
    skip: `6탭 실판 1판에 얹혀 도는 검사다 — 결과 흐름이 빠지면(tier=${RESULT_TIER}) 함께 빠진다`,
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

// ── S8 래칫 기준선 갱신 ─────────────────────────────────────────────
// 번들 예산 게이트와 **같은 규약**이다: 값은 `gate.baseline.json`에, 갱신에는 사람이 쓴 사유.
// 못 잰 실행으로는 절대 갱신하지 않는다 — 미측정을 기준선으로 승격시키는 것이 가장 위험하다.
if (OPT.update) {
  if (!rightColumnRun?.data) {
    console.log(
      "기준선 갱신 불가 — S8을 재지 못했다" +
        `${rightColumnRun?.skip ? ` (${rightColumnRun.skip})` : " (결과 흐름이 돌지 않았다)"}.\n` +
        "  `node scripts/gate-screen.mjs --only=result --update-baseline --reason=\"…\"` 로 다시 시도하라.",
    );
    process.exit(3);
  }
  const d = rightColumnRun.data;
  const rec = writeBaseline(
    "screenRightColumn",
    {
      viewport: SCREEN.rightColumn.viewport,
      vh: d.vh,
      suggestRows: d.sugRows,
      logBodyPx: d.logBodyPx,
      visibleLines: d.visibleLines,
      capacityLines: d.capacityLines,
      minRowH: d.minRowH,
      logPanelH: d.logPanelH,
      colH: d.colH,
      /** «이 화면이 보장하는 몫» — 기능 하한이 걸리는 쪽. 지금은 0줄(= 결함). */
      logFlex: d.logFlex,
      logMinH: d.logMinH,
      logChromePx: d.logChromePx,
      floorBodyPx: d.floorBodyPx,
      floorLines: d.floorLines,
      panels: d.panels.filter((p) => !p.outOfFlow).map((p) => ({ sel: p.sel, h: p.h })),
      defect:
        (d.floorLines ?? 0) < SCREEN.rightColumn.minVisibleLines
          ? `⚠ 이 기준선은 **결함 상태의 실측**이다 — 이 화면이 보장하는 로그 몫이 ` +
            `${d.floorBodyPx}px = ${d.floorLines}줄로, 기능 하한 ${SCREEN.rightColumn.minVisibleLines}줄에 미달한다. ` +
            `지금 ${d.capacityLines}줄이 보이는 것은 위 패널이 아직 안 자란 덕이다. ` +
            "래칫 통과는 «회귀 없음»일 뿐 «정상»이 아니다. 고친 뒤에는 반드시 이 기준선을 조여라."
          : null,
      note:
        `판 중반(제안 ${d.sugRows}행) · ${SCREEN.rightColumn.viewport} · ` +
        `받은 몫 ${d.logBodyPx}px/${d.capacityLines}줄 · 보장 ${d.floorBodyPx}px/${d.floorLines}줄`,
    },
    parseReason(argv),
  );
  console.log(`기준선 갱신 완료 → scripts/gate.baseline.json\n  ${rec.note}\n  사유: ${rec.reason}`);
  if (rec.defect) console.log(`  ${rec.defect}`);
  process.exit(0);
}

const allChecks = results.flatMap((r) => r.checks ?? []);
const failed = allChecks.filter((c) => c.status === "FAIL");
const unreachable = results.filter((r) => r.unreachable);
const skipped = results.filter((r) => r.skip);
// 도달 못 한 화면이 있으면 «전건 통과»라고 말할 수 없다 → FAIL이 아니라 SKIP(3)으로 끝낸다.
// `skip`(환경 사유·의도적 제외)은 여기 넣지 않는다 — 그건 «못 쟀다»의 **사유가 밝혀진** 쪽이다.
//
// 🔴 **아무것도 안 쟀는데 초록은 최악의 실패다.** `--only`와 `--viewport`가 겹치면
//    (예: `--only=game-column --viewport=desktop` — 그 화면은 폰 전용) 화면은 목록에 남고
//    **뷰포트 단계에서 빠져** `screens.length` 가드를 통과한다. 그러면 검사 0건으로
//    «결과: PASS»에 exit 0이 나온다(24회차 검수 실측).
//    검사가 하나도 없으면 그건 통과가 아니라 **미측정**이다.
const exitCode = failed.length ? 1 : unreachable.length || allChecks.length === 0 ? 3 : 0;
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
    // 「못 쟀다」와 「쟀는데 기준선이 없다」는 다르다 — 후자는 잰 값을 그대로 인쇄한다.
    for (const l of r.skipLines ?? []) console.log(`             ${l}`);
    continue;
  }
  const bad = r.checks.filter((c) => c.status === "FAIL");
  console.log(
    `  ${bad.length ? "FAIL" : "PASS"}  ${r.label} · ${r.vpLabel}  (${secs(r.ms)})`,
  );
  if (r.endTitle) console.log(`         · 화면 «${r.endTitle}» / ${r.endSub}`);
  for (const c of r.checks) {
    // `always` = 「통과했지만 접으면 안 되는 판정」. 지금은 S8이 그렇다 —
    // 그 PASS는 «정상»이 아니라 «안 나빠졌다»는 뜻이라, 접히면 게이트가 거짓말이 된다.
    if (c.status === "PASS" && !OPT.verbose && !c.always) continue;
    console.log(`         ${c.status === "FAIL" ? "✗" : c.status === "SKIP" ? "-" : "·"} ${c.id}  ${c.detail}`);
    for (const l of c.lines ?? []) {
      // `□` = «봤지만 이번엔 판정하지 않는 것». 은폐하지 않으려 넣은 줄이므로 접지 않는다.
      if (!OPT.verbose && !l.startsWith("✗") && !l.startsWith("□")) continue;
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
      ? allChecks.length === 0
        ? "  결과: SKIP — **검사를 하나도 못 돌렸다.** `--only`·`--viewport` 조합이 비었을 수 있다. 통과가 아니라 **미측정**이다."
        : "  결과: SKIP — 도달하지 못한 화면이 있다. 통과가 아니라 **미측정**이다."
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
