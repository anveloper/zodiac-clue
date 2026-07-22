# plan: 뷰 진화 단계 선택기 (개발 진화를 기능으로)

status: active · created: 2026-07-22 · src: 라이브 요청(에셋 검수 후 확정)

## goal
게임 화면이 **개발되면서 어떻게 진화했는지**를 플레이어가 직접 넘겨보는 기능. 버튼을 누를 때마다 다음 "진화 단계"로 전환되고, 새 단계는 개발되는 대로 **뒤에 append**된다. 심사에서 "개발 과정 자체를 콘텐츠로" 보여주는 앵글.

## 배경 (실코드 검수 결론)
- 현재 렌더러는 이미지·모델을 **하나도 로드하지 않음**. 2D(Phaser)·2.5D(Three.js) 모두 이모지+벡터/지오메트리를 런타임에 그림. `TextureLoader`/`GLTFLoader`/`load.image` 없음.
- 2.5D 카메라 = 42° 원근, 캐릭터·장물은 **빌보드 스프라이트**(항상 카메라 정면). → 방향 전환·3D 모델은 현재 구조에 코드 경로 없음.
- 기존 토글은 `viewMode: "2d" | "iso"` **바이너리**였음(`apps/client/src/main.ts`). → `STAGES` 순서형 배열로 확장 완료.

## 단계 정의 (순서형·확장형)
> 코드/UI 명칭 = **뷰1·뷰2·뷰3**(아마존 S3와 혼동 방지). id는 `STAGES` 배열의 값.

| # | id | 렌더 | 표현 | 필요 에셋 | 상태 |
|---|---|---|---|---|---|
| 뷰1 | `2d-emoji` | Phaser 2D(탑다운) | 이모지 + 색 원/벡터 | 없음 | ✅ 구현·기본 |
| 뷰2 | `three-emoji` | Three.js(42° 원근·빌보드) | 이모지 스프라이트 | 없음 | ✅ 구현 |
| 뷰3 | `three-asset` | Three.js 빌보드 + 룸 텍스처 | **정면 아트** + 룸 바닥 | 얼굴12·장물6·룸바닥·UI | ✅ 구현(placeholder 로드 중, PNG 교체 대기) |
| 뷰4 | `pixel` | Phaser 도트(탑다운 픽셀 오버레이) | 절차적 픽셀 타일·**도트 크리터**·장물 상자 | 없음(코드 생성) | ✅ 구현(첫 버전, 추후 픽셀 타일셋) |
| 뷰5+ | (미래) | 3D 씬 등 | 3D 모델·방향 모션 | 3D모델·4방모션 | ⏸ 그 단계 개발 시 append |

- **에셋은 정면 기준**(빌보드/탑다운 공통). 쿼터뷰 토큰·4방 모션·3D 모델은 뷰5+ 전용.
- 에셋 상세 = `docs/assets/20260721-asset-catalog.md` (0. 뷰 진화 단계), 프롬프트 = `20260721-image-prompts.md`.

## 아키텍처 설계
- 단계를 배열로: `const STAGES = [{id,label,kind:"phaser"|"three"|"pixel",assets}]`. 새 단계는 push만 하면 UI 자동 편입.
- **UI = 위로 열리는 드롭다운**(`#viewToggle` 버튼 + `#viewList`). 현재 뷰를 버튼에 표시(`뷰N · 라벨 ▲`), 항목 클릭 시 해당 단계로 **직접 점프**(순환 아님). 바깥 클릭 시 닫힘. **복원 없음 — 매 진입 시 `setStage(0)`로 항상 뷰1에서 시작**.
- 렌더러 활성화(`setStage`): `three`면 IsoView 오버레이(캔버스를 z-index로 위에 얹음), `phaser`(뷰1)/`pixel`(뷰4)이면 IsoView 끔. **`#game`(Phaser)은 절대 숨기지 않음**. Phaser 씬 표시는 `sys.setVisible` — 뷰1=GameScene, 뷰4=PixelScene. three에선 Phaser 키보드 off(iso가 입력), phaser/pixel은 GameScene이 입력·카메라 담당.

### 뷰3 렌더 분기 (three-asset)
- `iso-view.ts`의 `makeSprite(emoji(...))` 자리에 **텍스처 로더 경로** 추가: `THREE.TextureLoader`로 `/assets/char/<id>-face.svg`(placeholder, 추후 PNG) 로드해 스프라이트 텍스처로, 없으면 이모지 폴백. (구현: `assetSprite`/`charFace`/`lootSprite`)
- 룸 슬랩(`BoxGeometry`) 윗면에 방 바닥 텍스처 매핑(룸 종횡비 텍스처, UV 타일).
- 로더 실패/미존재 시 **graceful fallback → 이모지**(에셋 생성 전에도 단계는 살아 있음).

### 뷰4 렌더 (pixel · 도트풍)
- `PixelScene`(신규, `scenes/pixel-scene.ts`) = 탑다운 픽셀 오버레이 씬. 절차적 잔디 타일(`generateTexture`)·픽셀 룸/문·**도트 크리터(몸통+귀+눈)**·장물 상자·잔치상 궤짝. 외부 에셋 0.
- config `scene:[GameScene, PixelScene]`의 2번째라 자동 시작 안 됨 → 처음 필요할 때 `scene.run("pixel")`.
- **GameScene이 입력·카메라·로직 담당**(뷰4에선 invisible), PixelScene은 GameScene 카메라를 매 프레임 미러링 + `room.state` 위치 동기화 → 입력/동기화 중복 없음.
- 첫 버전은 절차적 도트. 추후 실제 픽셀 타일셋(풍문상회 스타일)으로 크리터·타일 업그레이드.

## 작업 순서
- [x] `STAGES` 배열 + `stageIndex` 상태로 토글 리팩터(바이너리 → 순서형). (`main.ts`)
- [x] **위로 열리는 드롭다운**으로 단계 직접 선택(`#viewList`). 복원 제거 — 항상 뷰1 시작.
- [x] 뷰3 골격: `three-asset` 분기 + `TextureLoader` + 이모지/단색 폴백. (`iso-view.ts`)
- [x] placeholder 에셋 44개 생성 + `public/assets/` 배선(SVG). `scripts/gen-placeholder-assets.mjs`.
- [x] **뷰4 도트풍**: `PixelScene` 절차적 픽셀 렌더 + GameScene 카메라 미러링. (`scenes/pixel-scene.ts`)
- [ ] 상세 아트(PNG)를 같은 경로에 덮어 실교체(GPT 이미지 2.0 산출물).
- [ ] (미래) 뷰5 `three-3d`: GLTFLoader + 모델/모션. 또는 뷰4 픽셀 타일셋 업그레이드.

## 구현 메모 (2026-07-22)
- 뷰2↔뷰3 전환은 IsoView 인스턴스 유지. `setAssets(on)`이 룸/잔치상 머티리얼에 텍스처를 입히고, 토큰·장물·NPC 스프라이트를 비워 다음 `syncState`에서 새 플래그로 재생성.
- 에셋은 **정적 파일(같은 오리진)** — `/assets/char/<id>-face.svg` 등. 스토리지·버킷·CORS·요금 없음. Vite `public/`이 dist로 복사됨(빌드 검증: dist/assets에 svg 44 + JS 청크 공존).
- 로드 실패 시 이모지/단색으로 graceful fallback → 에셋 미완성 상태에서도 단계가 깨지지 않음.
- 타입체크·프로덕션 빌드 통과.

## done-criteria
- **드롭다운에서 뷰1~뷰4 직접 선택**·전환. 각 단계 독립 동작, 뷰4↔뷰1 복귀 정상(브라우저 e2e 검증).
- 뷰3은 에셋 없어도 이모지 폴백. 뷰4는 외부 에셋 0(절차적 도트).
- 새 단계를 `STAGES`에 push만 하면 드롭다운·전환에 자동 편입.

## 관련
- 렌더 검수 원본: 2D=`apps/client/src/scenes/game-scene.ts`, 2.5D=`apps/client/src/scenes/iso-view.ts`, 토글=`apps/client/src/main.ts`.
- 선행 플랜: `10-view-2.5d-toggle.md`(2↔2.5 바이너리 토글, 완료).
