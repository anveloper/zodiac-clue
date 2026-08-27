# plan: 전면 모달 위에 뜨던 배경음 컨트롤을 끈다 — z-index로는 못 막는 자리

status: done(2026-08-27) · created: 2026-08-27 · src: 개선 루프 19회차 (플랜 38 큐 1번)

## goal
결과 화면(`#endOverlay`)·목표 카드(`#goalCard`)가 떠 있는데 **배경음 스피커가 그 위에**
스크림도 안 먹은 채로 뜨고 **눌리기까지 했다.** 상용 화면에서 가장 눈에 띄는 결함이다.

## 진단 — 「z-index를 몇으로 줄까」가 애초에 잘못된 질문이었다
`apps/client/index.html:452` — `#gameScreen { position: fixed; inset: 0 }`.
**`position: fixed`는 z-index가 `auto`여도 스택 컨텍스트를 만든다.**
그래서 그 안의 `#goalCard`(z:35) · `#endOverlay`(z:40) · `.tc-overlay`(z:45) · 우측 패널(z:5)은
**`#gameScreen`이라는 하나의 덩어리 안에서만** 겨룬다. `<body>` 직계인 `#bgmCtrl`은
루트 컨텍스트에서 그 덩어리(`z:auto` = 0)와 겨루므로 **4든 40이든 항상 위**다.

플랜 38이 주석에 「우측 패널(z:5) 아래에 둔다」고 적어 뒀던 것이 이래서 거짓이었다.
이번 회차는 그 진단을 **실제 처방까지** 끌고 간다.

## 처방 — 「모달이 뜨면 끈다」
```ts
const MODAL_SEL = "#goalCard:not(.hidden), #endOverlay:not(.hidden), " +
                  "#turnCircle:not(.hidden), #codex:not(.hidden), .overlay";
const syncModalOn = () => document.body.classList.toggle(
  "modal-on",
  [...document.querySelectorAll(MODAL_SEL)].some((el) => el.getClientRects().length > 0),
);
```
```css
body.modal-on .bgm-ctrl { display: none; }
```

- **이건 §1.6 규약의 포인터 쪽이다.** `cycleTab`이 키보드는 모달 안에 가둬 놨는데
  **마우스·터치는 나갈 수 있었다.** 두 입력이 같은 규약을 따르게 됐다.
- **`display: none`이라야 한다** — `visibility:hidden`·`opacity:0`도 눈에는 같지만
  `opacity:0`은 **히트 타깃이 남아** 「안 보이는데 눌린다」가 된다.
- 호출 지점 8곳(버스 2 · `openPicker` 2 · `#turnCircle` 2 · 도감 2) + `show()`의 안전벨트 1.

### 🔴 검수가 뒤집은 것 ①(내가 만든 버그) — 포커스 복귀 자리를 파괴했다
초안은 `runOverlay`에서 `setModalOn()`을 **`overlayReturn` 캡처보다 먼저** 불렀다.
배경음 버튼에 포커스가 있는 채로 모달이 뜨면 `display:none`이 그것을 즉시 포커스 불가로
만들어 `activeElement`가 `<body>`로 떨어지고, **그 `<body>`가 되돌릴 자리로 잡힌다.**
`restoreFocus`는 `<body>`를 유효한 자리로 보므로(`isConnected` ✓ · `getClientRects` ✓)
폴백도 안 걸리고 **포커스가 문서 맨 앞으로 날아간다.**
크롬은 버튼 mousedown에 포커스를 주므로 «스피커를 누른 직후 결과 화면이 뜨는» 평범한
경로로 재현된다 — **§1.6을 확장하겠다면서 §1.6을 깨는** 변경이었다.
→ 캡처 **뒤**로 옮겼다. 도감도 같은 순서로 맞췄다.

### 🔴 검수가 뒤집은 것 ②(설계) — 불리언 토글은 소유자가 넷이라 못 쓴다
전면 모달의 소유자가 버스 · `openPicker` · `#turnCircle` · 도감으로 **넷**이다.
각자 `true`/`false`를 쓰면 «신고 모달이 열린 채 결과 화면이 뜨고(→true), 신고 모달을
취소하면(→false) **결과 화면 위에 배경음이 되돌아오는**» 순서 의존 버그가 난다.
→ **DOM에서 파생**시켰다. 「지금 열려 있는가」만 보므로 호출 순서에 안전하다.
`.hidden`이 아니라 `getClientRects()`로 재는 이유는 **조상이 꺼진 경우**다 — `show()`가
`#gameScreen`째로 끄면 `#endOverlay`의 클래스는 그대로라, 클래스만 보면 `modal-on`이
남아 **배경음이 영영 사라진다.** `show()`에도 안전벨트로 한 줄 넣었다.

### 🔴 검수가 찾은 것 ③ — **데스크톱 제안·신고 모달**은 처방 전부터 결함이었다
`.overlay`는 **z:10**(`index.html:1425`)인데 `.bgm-ctrl` 기본값은 **z:40**이다 —
z를 4로 내리는 규칙이 폰·`pointer:coarse` 블록 **안에만** 있다. 즉 데스크톱에서는
**스택 컨텍스트와 무관하게** 40 > 10으로 컨트롤이 모달 위에 뜬다.
**「폰에서 안 났다」가 「없다」가 아니었다** — 이 결함은 데스크톱이 더 넓다.
초안은 이 화면을 아예 안 봤다.

### 🔴 검수가 뒤집은 것 ④ — 내 게이트 논거 두 개가 틀렸다
- ~~«`visibility:hidden`으로 고치면 `b-covers-a` 오탐이 난다»~~ — **거짓.**
  `shown()`은 `visibility:hidden`도 `opacity:0`도 **똑같이 거른다**(`gate-screen.mjs:415`).
  오탐이 나는 것은 **z-index로 고쳤을 때**뿐이고, 그건 이번 음성 테스트에서 실제로 났다
  (폰에서 `.overlay`가 `#bgmCtrl`을 덮어 `b-covers-a` FAIL).
  → `display:none`을 고르는 진짜 이유는 **①(히트 타깃을 안 남긴다) 하나**다.
- ~~«`protect`가 침묵하는 이유는 기하 교차가 없어서»~~ — **부정확.** 데스크톱은 맞지만
  폰에서는 `#bgmCtrl`(x≈326..382 · y150..200)이 `.end-card`(x16..374)와 **겹칠 수 있다.**
  진짜 이유는 `protect`가 요소마다 **중심 + 20% 인셋 5점**만 찍는다는 것이다.

## 게이트를 먼저 실패시켰다 (음성 테스트)
`scripts/gate.config.mjs`에 `BGM_OVER_MODAL(modalSel)` 헬퍼를 넣고 `goal-modal`·결과 화면
`pairs`에 걸었다. 모달이 `inset:0`이라 교차 = 배경음 상자 전체, 중심 히트 테스트가
`#bgmCtrl`을 잡으면 `a-covers-b` → FAIL.

| 화면 | 수정 전 | 수정 후 |
|---|---|---|
| `goal-modal` | **FAIL 2** — 폰 82×50 · 데스크톱 72×40, 히트 `button#bgmToggle.bgm-icon` | PASS |
| `accuse-modal` | **FAIL 2** — 데스크톱 `a-covers-b`(히트 `#bgmToggle`) · 폰 `b-covers-a` | PASS |
| 결과 화면 4종 | — | PASS |

**«켜는 검사»도 넣었다** — `BGM_OVER_MODAL`은 «숨겨져 있으면 통과»라 `modal-on`이 고착돼
배경음이 **영영 사라져도** 전부 PASS다. 그래서 `GAME_PROTECT`에 `#bgmToggle`을 넣어
«모달이 없는 화면에서는 보여야 한다»를 잰다. 음성 테스트(`.bgm-ctrl{display:none!important}`
주입) → `✗ #bgmToggle — 보이는 요소 0개 (기대 1개, DOM 1개)` 폰·데스크톱 양쪽 FAIL.
**끄는 검사만 있으면 한 벌이 아니다.**

🔴 **기존 주석이 거짓이었다** — 결과 화면 `pairs` 위에 「«오버레이 위를 아무도 덮지 않는다»는
`protect`가 이미 한다」고 적혀 있었다. `protect`는 **모달 안의** 요소가 가려졌는지만 보고,
`#bgmCtrl`(우상단)은 `#endTitle`·`#endCards`·버튼 줄(가운데)과 **기하 교차가 없다** →
원리적으로 침묵한다. 겹치는 보호 대상이 있을 때만 참인 문장이었다.

## tasks
- [x] `syncModalOn()` — 열린 모달 DOM에서 **파생**(불리언 토글 폐기)
- [x] 호출 8곳 + `show()` 안전벨트. 포커스 캡처 **뒤**에 부른다(위 뒤집힘 ①)
- [x] `body.modal-on .bgm-ctrl { display: none }`
- [x] 게이트 `BGM_OVER_MODAL` 쌍 3곳 — 음성 테스트로 FAIL 재현 후 PASS 확인
- [x] 게이트 `GAME_PROTECT`에 `#bgmToggle` — «켜는 검사». 음성 테스트로 FAIL 확인
- [x] `ui-copy` §1.6 (`.md` + `.html`) — 근거 정정 포함

## done-criteria
- [x] 결과 화면 캡처에서 스피커가 사라졌다(눈으로 대조 — 수정 전/후 `result-win-phone.png`)
- [x] 화면 게이트 FAIL 증가 0 — PASS 68 · FAIL 1(`roomlist-ended` 플레이크만)
- [x] 회귀하면 게이트가 **양방향으로** 잡는다(끄는 검사 · 켜는 검사 둘 다 음성 테스트)
- [x] `pnpm -r typecheck` 통과

## 남긴 것 (의도적)
- **`#turnCircle`은 배경음만 해소됐다.** 여전히 버스를 안 타므로 `role="dialog"`·포커스
  트랩·Esc가 없다. `syncModalOn()`을 손으로 부르는 두 줄은 **버스에 올리면 지워질 코드**지만,
  같은 결함을 알면서 남기는 것보다 낫다고 봤다.
- **배경음이 우측 패널(z:5) 위에 칠해지는 것**은 안 고쳤다 — `GAME_PAIRS`에
  `["#bgmCtrl", "#rightPanel", …]`을 넣으면 **지금 FAIL이 난다.** 그건 «모달 위»가 아니라
  **배치** 문제(플랜 38 계열)라 이번 회차의 단위가 아니다. 새 상시 FAIL을 만들지 않으려고
  검사도 넣지 않았다 — 고칠 때 함께 넣는다.

## 다음 회차 후보 (착수 전 **반드시 현재 화면·코드로 재확인**)
1. 🔴 **`#turnCircle`을 오버레이 버스에 올린다** — `role="dialog"`·포커스 트랩·Esc.
   올리면 `syncModalOn()` 직접 호출 두 줄도 지운다. 게이트에 turnCircle 시나리오가 **없어서**
   회귀도 안 잡힌다 — 화면을 하나 추가하는 것이 같이 간다.
2. 🔴 **보이지 않는데 눌리는 22px** — `.bgm-vol`이 `width:0`인데 계산값 22px(플랜 38 별건 2).
   `pointer-events`만으로는 부족하다(컨테이너 `div`가 대신 먹는다). S3 사각지대.
3. 🖼 **배경음이 우측 패널 위에 뜬다** — 위 «남긴 것». 고치면서 `GAME_PAIRS`도 함께 넣는다.
4. 🖼 **게이트에 coarse 태블릿 뷰포트** — `pointer: coarse` 블록 전체가 무계측이다.
5. 🖼 **§1.7을 게이트로** — 카드를 키우고 **스크롤시키며** 재는 프로브(플랜 38 스크래치패드).
6. 🔴 **게이트가 포커스·모달 상태를 안 찍는다** — `CSS.forcePseudoState`로 싸게 된다.
7. 🔴 **`index.html`이 초기 로드 최대 자산인데 무계측**(53 kB > JS 49.2 kB).
8. 🖼 S6를 `right-column`에도 · `#aiDetail`·`.room-list` 스크롤 경계 신호.
9. 🟠 증거 노트가 `revealCommonClue()`를 반영하지 않는다 · 죽은 플랜 3건 정리.

## 형상관리 메모
`feat/bgm-placement`에서 땄다. 체인 15개 — … → `bgm-placement` → `bgm-overlay-stacking`.
