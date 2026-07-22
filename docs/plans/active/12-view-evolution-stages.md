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
| 뷰4+ | (미래) | 3D 씬 등 | 3D 모델·방향 모션 | 3D모델·4방모션 | ⏸ 그 단계 개발 시 append |

- **에셋은 정면 기준**(빌보드/탑다운 공통). 쿼터뷰 토큰·4방 모션·3D 모델은 S4+ 전용.
- 에셋 상세 = `docs/assets/20260721-asset-catalog.md` (0. 뷰 진화 단계), 프롬프트 = `20260721-image-prompts.md`.

## 아키텍처 설계
- 단계를 배열로: `const STAGES = [{id:"2d-emoji", kind:"phaser"}, {id:"three-emoji", kind:"three", assets:false}, {id:"three-asset", kind:"three", assets:true}, ...]`.
- 버튼(현 `#viewToggle`)은 `stageIndex = (stageIndex + 1) % STAGES.length` 로 순환. **복원 없음 — 매 진입 시 `setStage(0)`로 항상 뷰1에서 시작**(진화 서사를 처음부터).
- 렌더러 활성화: `kind` 가 phaser면 Phaser 활성/Three 비활성, three면 반대. **단, `#game`은 절대 숨기지 않고** Three 캔버스를 z-index로 위에 얹어 가리기만. `assets` 플래그로 Three 뷰가 이모지 대신 텍스처 스프라이트를 만들도록 분기.
- 버튼 라벨에 "다음 갈 단계" 표기(예: `▶ 뷰2 · 2.5D`), 진화 서사 강조.

### 뷰3 렌더 분기 (three-asset)
- `iso-view.ts`의 `makeSprite(emoji(...))` 자리에 **텍스처 로더 경로** 추가: `THREE.TextureLoader`로 `/assets/char/<id>-face.svg`(placeholder, 추후 PNG) 로드해 스프라이트 텍스처로, 없으면 이모지 폴백. (구현: `assetSprite`/`charFace`/`lootSprite`)
- 룸 슬랩(`BoxGeometry`) 윗면에 방 바닥 텍스처 매핑(룸 종횡비 텍스처, UV 타일).
- 로더 실패/미존재 시 **graceful fallback → 이모지**(에셋 생성 전에도 단계는 살아 있음).

## 작업 순서
- [x] `STAGES` 배열 + `stageIndex` 상태로 토글 리팩터(바이너리 → 순서형). 렌더러 활성화 로직 재사용. (`main.ts`)
- [x] 버튼 라벨을 "다음 갈 단계"(`▶ 뷰N`) 표기로. **복원 제거 — 항상 뷰1 시작**(localStorage 미사용).
- [x] 뷰3 골격: `three-asset` 분기 + `TextureLoader` 경로 + 이모지/단색 폴백(에셋 0장이어도 동작). (`iso-view.ts` `setAssets`/`assetSprite`/`applyTexture`)
- [x] placeholder 에셋 44개 생성 + `public/assets/` 배선(SVG). 생성기 `scripts/gen-placeholder-assets.mjs`.
- [ ] 상세 아트(PNG)를 같은 경로에 덮어 실교체(GPT 이미지 2.0 산출물).
- [ ] (미래) 뷰4 `three-3d`: GLTFLoader + 모델/모션 단계 append.

## 구현 메모 (2026-07-22)
- 뷰2↔뷰3 전환은 IsoView 인스턴스 유지. `setAssets(on)`이 룸/잔치상 머티리얼에 텍스처를 입히고, 토큰·장물·NPC 스프라이트를 비워 다음 `syncState`에서 새 플래그로 재생성.
- 에셋은 **정적 파일(같은 오리진)** — `/assets/char/<id>-face.svg` 등. 스토리지·버킷·CORS·요금 없음. Vite `public/`이 dist로 복사됨(빌드 검증: dist/assets에 svg 44 + JS 청크 공존).
- 로드 실패 시 이모지/단색으로 graceful fallback → 에셋 미완성 상태에서도 단계가 깨지지 않음.
- 타입체크·프로덕션 빌드 통과.

## done-criteria
- 버튼 반복 클릭으로 S1→S2→S3(→순환) 전환. 각 단계가 독립 동작.
- S3는 에셋이 없어도 이모지 폴백으로 깨지지 않음. 에셋 배선 시 정면 아트로 교체.
- 새 단계(S4+)를 배열에 push만 하면 UI에 자동 편입.

## 관련
- 렌더 검수 원본: 2D=`apps/client/src/scenes/game-scene.ts`, 2.5D=`apps/client/src/scenes/iso-view.ts`, 토글=`apps/client/src/main.ts`.
- 선행 플랜: `10-view-2.5d-toggle.md`(2↔2.5 바이너리 토글, 완료).
