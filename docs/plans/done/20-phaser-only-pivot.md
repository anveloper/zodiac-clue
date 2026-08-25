# plan: Phaser 단일 렌더러 전환 + 과제 문맥 정리

status: done(2026-08-25) · created: 2026-08-25 · src: owner 지시(해커톤 종료 → 1년 실게임화)

## 배경
NHN NAN 2026 사전과제는 종료됐다(탈락). 이 저장소는 이제 **과제 산출물이 아니라 1년짜리 실제 게임 개발**이다.
렌더러 4종 병행은 과제용 «개발 진화를 콘텐츠로» 앵글의 산물이고, 그 앵글이 사라진 지금은 **순수 유지비**다.
근거는 이미 기록돼 있다 — `archive/design/20260730-view-selector-hide.md`: "뷰마다 코드를 3중으로 손대야 했고,
그 과정에서 뷰4에 `myId`가 없던 것을 발견·수정". 프로덕션은 이미 `.hud-view` 숨김으로 뷰1 고정 상태다.

## 결정 (owner, 2026-08-25)
1. **렌더러는 뷰1(`2d-emoji`, Phaser `GameScene`) 하나만 남긴다.** 3D(Three.js)는 하지 않는다.
   뷰4 `pixel`은 Phaser지만 **함께 제거** — 도트풍은 아트 디렉션으로 재검토할 수 있으나 지금 두 렌더러를 유지할 이유가 없다.
2. **해커톤 문서는 `docs/archive/`로 이관.** 삭제하지 않는다 — 의사결정 히스토리는 보존하되 현재 문서와 섞이지 않게 한다.
3. **리브랜딩은 과제 문맥 제거까지.** 게임 주제(호랑이 생신 잔치·십이지)와 이름(zodiac-clue)은 유지.

## tasks

### 1) 문서 (선행 — 이 단계가 코드 제거의 근거 문서가 된다)
- [x] 아카이브 디렉토리 신설 + 해커톤 문서 `git mv`
- [x] `README.md` — 과제 문맥 제거 · 스택에서 Three.js 제거 · 뷰 진화 항목 제거 · 1년 로드맵 링크
- [x] `CLAUDE.md` / `AGENTS.md` 동기화 (single-source 규칙)
- [x] 신규 `docs/design/20260825-roadmap-1y.md` + `.html` — 아카이브된 improvement-roadmap·execution-plan의 대체
- [x] `docs/index.html` 대시보드 — FEATURED·홈 카피·아카이브 섹션
- [x] `scripts/gen-docs-manifest.mjs` GROUPS · `scripts/docs-private.mjs` 경로 · `scripts/gate.config.mjs` D4 앵커
- [x] 플랜 정리 — 12(뷰 진화) 취소, 18·19(촬영·팀 브랜치) 아카이브

### 2) 코드 (문서 확정 후)
- [x] 삭제: `scenes/iso-view.ts`(1838) · `scenes/three-res.ts`(166) · `scenes/pixel-scene.ts`(1264) · `scenes/pixel-glyphs.ts`(163)
- [x] `pixel-glyphs.ts`는 통삭제 불가였다 — `GameScene`이 `CVD_CELL`·`cvdCueDots`(색각 대체 표기)를 쓴다.
      뷰4 전용분(십이지 배지 12 · 장물 스탬프 6 · 소환 마크)만 버리고 **`scenes/cvd-glyphs.ts`로 분리**
- [x] `view-contract.ts` → `view-types.ts`. `ViewContract`(15메서드)·`ViewId` 제거, 데이터 타입 8종만 존치.
      `GameScene`의 `implements`·`viewId`·`contextCost` 삭제
- [x] `main.ts` 3126 → 2929줄 — `STAGES`·`stageIndex`·`readyLoaders`·`loadIsoMod`·`applyStage`/`setStage` ·
      드롭다운 DOM·prefetch · `loop.sleep()/wake()` · `activeView()`/`allViews()` → `view()` 하나로
- [x] `apps/client/index.html` — `.hud-view`/`.view-list` CSS(데스크톱+모바일) · `#viewToggle`/`#viewList` DOM 제거
- [x] `package.json` — `three` · `@types/three` 제거(-8 패키지), lock 갱신
- [x] `packages/shared` — `PIXEL_PAL`·`CELL_UNIT`·`PX_PER_UNIT`·`pxToUnit`/`unitToPx`·`INIT_MIN_CELLS_PERSPECTIVE` 제거(참조 0 확인)
- [x] 게이트 정리 — 측정 대상이 사라진 검사를 PASS로 남기지 않는다:
      · `gate-gpu-baseline.mjs` G1·G2(three geometry)·G3(THREE.Cache) 삭제 → Phaser 2축(dispose·절차 텍스처)만
      · `gate.config.mjs` 뷰 화면 3종(`game-v2/v3/v4`)·`viewScreen()` 팩토리·`#viewToggle` 보호·`.hud-view` 쌍·S4 상수
      · `gate-screen.mjs` S4(뷰 간 HUD 동일성) 판정·뷰 전환 블록·자기테스트 F5

## 결과 (2026-08-25)

| 항목 | 전 | 후 |
|---|---|---|
| 클라 소스 | 8,822줄 | 5,161줄 (**-3,661**) |
| 지연 청크 | phaser 1478 + **iso-view 554** + pixel-scene 15.5 + pixel-glyphs 4.4 + … | phaser 1478 + game-scene 23 + network 76 |
| 초기 로드 JS | 49.18 kB | **46.89 kB** (-2.29) |
| 화면 게이트 | PASS 59 · FAIL 22 | PASS 54 · FAIL 15 |

**잔여 FAIL은 전부 이 작업 이전부터 있던 것**이다(HEAD에서 동일 재현):
`#bgmToggle` 34×34 < 44px 터치 하한(폰 전 화면) · `.gi-sub` 4.31:1 · `.modal-warn` 4.3:1 (WCAG AA 4.5 미달) ·
S8 우측 컬럼 로그 몫 래칫. 번들 B1 래칫도 HEAD에서 이미 초과(49.18 > 43.65)였고 이 작업이 2.29 kB 되돌렸다.
**래칫은 완화하지 않았다** — 되돌리는 것은 별건이다.

## done-criteria
- [x] `apps/`·`packages/`에 `three`/`iso-view`/`pixel-scene` **실행 코드** 0 (남은 것은 «무엇이 왜 사라졌나»를 적은 주석뿐)
- [x] `pnpm -r typecheck` · 클라 빌드 통과
- [x] `pnpm verify:quick` 5/5 PASS
- [x] 게임 플레이 경로가 뷰 전환 없이 동작(dev 스모크 + 화면 게이트 실판 6인 세션 통과)
- [ ] **후속(별건)**: 위 기존 FAIL 4종 · 번들 B1 래칫 복귀 → 로드맵 Q1 «환경 정리»
