# 20260722 — 뷰 진화 단계 + 에셋 파이프라인 + 랜딩 정리

> "개발 진화 과정을 기능으로": 뷰1(2D) → 뷰2(2.5D) → 뷰3(에셋) 순서형 선택기. placeholder 에셋 44종 생성·배선. 전 구간 라이브 재배포.

---

## feat — 뷰 진화 단계 선택기 (뷰1/2/3, 순서형·확장형)
- 기존 2D↔2.5D **바이너리 토글**을 `STAGES` 배열 기반 **순서형 stage 머신**으로 교체(`main.ts`).
  - 뷰1 `2d-emoji`(Phaser 탑다운) · 뷰2 `three-emoji`(Three.js 42° 빌보드) · 뷰3 `three-asset`(Three.js + 에셋 아트).
  - 버튼은 "다음 갈 단계"(`▶ 뷰N`) 안내, 클릭 시 순환. 새 단계는 배열에 push만 하면 UI 자동 편입(뷰4+ 3D 등).
- 아마존 S3 혼동 방지로 명칭을 **뷰1/뷰2/뷰3**으로 통일.
- 플랜: `docs/plans/active/12-view-evolution-stages.md` 신설.

## feat — 뷰3 에셋 로더 (정적 파일 + 폴백)
- `iso-view.ts` `setAssets(on)`: 룸/잔치상 머티리얼에 `/assets/room/*.svg` 텍스처, 토큰·장물·NPC를 정면 아트 스프라이트로 재생성.
- `assetSprite()`: `TextureLoader`로 `/assets/char/<id>-face.svg` 등 로드, **실패 시 이모지/단색 폴백**(에셋 0장이어도 안 깨짐).
- 전부 **정적 파일(같은 오리진)** — 스토리지·버킷·CORS·요금 없음. Vite `public/`이 dist로 복사.

## feat — placeholder 에셋 44종 (SVG)
- `scripts/gen-placeholder-assets.mjs`: `cards.ts` 미러링, 사극 팔레트+이모지+라벨+`PLACEHOLDER` 태그.
- 출력: `apps/client/public/assets/{char,loot,room,ui,bg}` — 얼굴12·SD12·장물6·방9·잔치상·배경3·UI.
- 추후 GPT 이미지 2.0 PNG를 **동일 경로에 덮으면 즉시 교체**.
- 의존성 추가: `three`, `@types/three`.

## refactor — 랜딩 캐릭터 선택 제거 → 게임 선택 슬롯
- 랜딩의 캐릭터 그리드·성격 패널 삭제(대기실 선택과 중복). 캐릭터는 **대기실에서만**.
- `#gameSelect` 슬롯(현재 게임 1종 카드) 신설 — 다른 게임 컨텐츠 추가 시 **게임 선택 UI로 확장**.
- `createRoom()/joinRoomById(code)` 캐릭터 인자 미전달.

## fix — 뷰 전환 시 Phaser 빈 화면 + 초기 뷰 오류
- **원인**: 뷰2/3(Three)로 갈 때 `#game`(Phaser)을 `display:none` 처리 → `Scale.RESIZE`가 캔버스를 0크기로 축소 → 뷰1 복귀 시 빈 화면. 또 localStorage 복원으로 초기 화면이 three로 뜸.
- **해결**: `#game`을 절대 숨기지 않고 Three 캔버스를 **위에 얹어 가리기만**(z-index: Phaser 0 < 캔버스 2 < 버블 3 < HUD 5). localStorage 복원 제거 → **항상 뷰1에서 시작**.
- **검증**: agent-browser e2e — 방생성→시작→뷰1→2→3→1 순환 전부 스크린샷 정상, 복귀 시 Phaser 정상 렌더 확인.

## docs — 에셋 검수 반영
- 서브에이전트 2개로 2D/2.5D **실코드 검수**: 렌더러가 이미지·모델을 무로드(이모지+지오메트리 절차 생성) 확인.
- 스코프 정정: 보드말 쿼터뷰→**얼굴 정면 통합**, 3D모델·4방모션→**뷰4+ 미래**, 룸 인게임 바닥=**룸 종횡비**, 프롬프트 전체 **생성→최종 사이즈** 표기(1024²/1024×1536/1536×1024). IMG 108→**90장**.
- 갱신: `asset-catalog`(0.뷰 진화 단계 섹션), `image-prompts`, `plans/11`.

## deploy
- 클라이언트: Vercel Git 연동 자동 배포(main push). 서버 변경 없음 → 서버 배포 미실행.
- 라이브: https://zodiac-clue.vercel.app
