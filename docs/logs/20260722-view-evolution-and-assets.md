# 20260722 — 뷰 진화 단계·도트뷰 + 에셋 파이프라인 + 공개방 + 랜딩 정리

> "개발 진화 과정을 기능으로": 뷰1(2D)·뷰2(2.5D)·뷰3(에셋)·뷰4(도트) 드롭다운 선택기. placeholder 에셋 44종. 방 공개/비공개+공개방 목록. 소환 문·벽 봉쇄 수정. 전 구간 라이브 재배포.

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

## feat — 뷰 전환 드롭다운 + 뷰4 도트풍
- 뷰 전환을 순환 버튼 → **위로 열리는 드롭다운**(`#viewList`)으로. 항목 클릭 시 해당 단계 **직접 점프**, 활성 항목 강조, 바깥 클릭 닫힘.
- **뷰4 `pixel` 추가**: `PixelScene`(신규) — 탑다운 픽셀 오버레이. 절차적 잔디 타일(`generateTexture`)·픽셀 룸/문·**도트 크리터(몸통+귀+눈)**·장물 상자·잔치상 궤짝(외부 에셋 0). `scene:[GameScene, PixelScene]`의 2번째라 처음 필요할 때 `scene.run`.
- **GameScene이 입력·카메라·로직 담당**(뷰4에선 invisible), PixelScene은 카메라 미러링 + `room.state` 동기화 → 중복/충돌 없음. 풍문상회(pungmun.site) 스타일 참고, 추후 픽셀 타일셋 업그레이드.
- 브라우저 e2e: 뷰1↔4 드롭다운 선택·복귀 정상.

## feat — 방 공개/비공개 + 메인 공개방 목록·참여
- 서버 `onCreate(isPublic)`: 비공개면 `setPrivate`(목록 숨김·코드 참가는 가능), 메타데이터(`hostName`·`count`) 갱신(`syncMeta`). **시작(lock) 시 목록에서 자동 제외** → 시작 전 공개방만 노출.
- `network`: `createRoom(isPublic)`, `listPublicRooms`(`getAvailableRooms`).
- 랜딩: 게임 선택 칸 확장(340→380), **공개/비공개 세그 토글**, **공개방 목록**(방장·인원·5초 갱신·[참여]).
- 프로덕션 2세션 e2e: 생성→타 세션 목록 노출("생쥐 서생님의 방 · 1/6인")→참여(2인)→A 시작 후 목록 제외("열린 공개방이 없어요") 확인.
- (미래 아이디어) 진행 중 방의 **AI(봇) 자리 이어받기** — 봇도 Player 슬롯이라 suspect·위치·턴 승계 방식으로 가능.

## fix — 소환 토큰 문·벽 봉쇄
- 제안 소환 토큰이 **문 칸**에 앉아 방 전체가 못 나가던 버그 → 방마다 `summon` 앵커(문 반대쪽 **내부** 구석) 지정. `freeCellIn`이 앵커 근처부터 채우되 **문 제외·명패행/벽 후순위** → 소환이 문·벽을 안 막고 안쪽에 모임. (shared `ROOM_REGIONS.summon` 9방 + server `freeCellIn`)

## feat — 캐릭터 직업 용어 풀이
- 이름의 직업(서생·역사·낭자·도령·무녀·장수·목동·광대·훈장·포교·객주·대감)이 생소한 사극 용어라 **뜻풀이** 추가. shared `JOB`(term+gloss)·`job()` 시드.
- 대기실: 캐릭터에 올리면 `#lobbyPersona` 패널에 **직업 뜻 + 성격**, 셀 `title` 툴팁도.
- 문서: character-concepts에 "직업 용어 풀이" 글로서리(md+html), README/game-intro 반영.

## feat — 턴 순서 UI (스트립 + 원형)
- 상단 턴 배너에 상태 + **순서 스트립**(현재→다음… 이모지 칩, 현재 강조, 끝 `↺` 순환). `state.turnOrder` 사용(서버 무변경).
- 배너 클릭 → **원형 순서 오버레이**(`#turnCircle` — 라운드 테이블·중앙 시계방향 ↻·현재/다음 배지·순번). 브라우저 e2e 검증.

## deploy
- 클라이언트: Vercel Git 연동 자동 배포(main push) — 뷰 진화·드롭다운·뷰4·공개방·직업 풀이·턴 순서 UI.
- 서버: GitHub Actions(SSH→OCI) — 소환 앵커·문 봉쇄 수정, 방 공개/비공개·메타데이터. (apps/server·packages/shared 변경 시 트리거)
- 라이브: https://zodiac-clue.vercel.app · 배포 모두 성공(server GH Actions success, client Vercel Ready).
