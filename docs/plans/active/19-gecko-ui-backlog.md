# 19 — 게코 브랜치 UI 백로그 (07-30~)

브랜치 `gecko` · 테스트 URL `zodiac-clue-gecko.vercel.app` · 병합 권한: 종훈 지시 시 gecko→main(anveloper 승인).
**이 브랜치는 프로덕션·촬영 화면과 분리된 샌드박스** — 화면 자유 수정. main 병합은 종훈이 지시할 때만.

## 백로그
| # | 요청자 | 내용 | 위치(추정) | 상태 |
|---|---|---|---|---|
| ① | 종훈 | 제안 기록표 하단 내역 **드래그 스크롤**(이전 내역 확인). 지금 안 됨 | `index.html` `.rp-body`/`#log` · `main.ts` | todo |
| ② | 종훈 | 증거노트 항목별 **메모 작성란**. 지금은 클릭=삭제만 | `index.html` `#evidence` · `main.ts` | todo |
| ③ | 종훈 | 보드 '훔친 것' 아이템 **클릭 시 명칭 표시**. 지금 아이콘만 | `game-scene`·`iso-view`·`pixel-scene` (4뷰) | todo |
| ④ | anveloper | **2.5D 카메라 이동 반경**이 좁음 — 맵 여백 없음 느낌. 팬 바운즈에 여백 추가 | `iso-view.ts` 카메라 클램프 | todo |
| ⑤ | anveloper | **2D 기본 화면 화질**이 너무 낮음. 렌더 해상도/AA/스케일 점검 | `game-scene.ts` Phaser 설정 | todo |

## 진행 방식 (계속 반영 루프)
각 건: 구현 → `verify`(로컬) → 게코 워크트리에서 `vercel deploy` → `zodiac-clue-gecko.vercel.app` 별칭 갱신 → 종훈에게 통지.

## 유의
- 4뷰 공통 규약(색 단독 식별 금지·글리프·이모지) 유지.
- ⑤ '화질'은 원인 분류 먼저: DPR/resolution · antialias · 텍스처 스케일 · 카메라 줌 중 무엇인지 실측.
- main 병합 시 촬영 동결 유효 여부 anveloper에 확인.
