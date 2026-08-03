# 한옥 타일셋 에셋 — 생성 프롬프트 (2026-08-03)

> 목적: 방 «통짜» 이미지를 버리고, **한 칸(그리드) 단위 조립형 타일셋**으로 전환.
> 벽·바닥·문·가구를 조각 에셋으로 생성 → **Figma에서 격자에 붙여 방을 조립**한다.
> 통짜 이미지가 매번 톤·원근·문 위치가 흔들리던 문제를 «부품 공유»로 해결한다.
>
> 대상 폴더(예정): `apps/client/public/assets/tiles/{floor,wall,door,furniture}/*.png`
> 생성: ChatGPT 이미지. **아래 «공통 규격» 블록을 매 프롬프트 앞에 그대로 붙인다.**

---

## 0. 왜 원근을 끄는가 (가장 중요)

통짜 방이 흔들린 근본 원인은 **«진짜 원근»** 이었다 — 물체마다 소실점·각도가 제각각이라
격자에 물리지 않고, 가구가 «눕거나» 톤이 튀었다. 타일셋은 그 반대로 간다:

- **원근 없음(orthographic).** 카메라 고정, 소실점 없음. **스타듀밸리 / RPG Maker 2D 탑다운 타일셋**과 같은 관례.
- **바닥**은 완전한 위에서-본-평면(flat top view). **벽·가구**는 «고정 높이의 얕은 정면(front face)»만
  덧대어 세워진 느낌을 준다 — 물체마다 각도가 달라지지 않는다(그래서 항상 격자에 물린다).
- 이 한 줄이 조립 가능성의 전부다: **개별 물체 원근 금지, 고정-높이 정면 관례 유지.**

---

## 1. 공통 규격 (모든 프롬프트 앞에 붙여넣기)

```
STYLE: 2D top-down game TILESET asset, in the style of Stardew Valley / RPG Maker VX —
orthographic (NO perspective, NO vanishing point), fixed camera. Cozy warm pixel-ish
illustration. TRADITIONAL KOREAN HANOK theme ONLY — not Japanese, not Chinese, not western.
CAMERA/PROJECTION: flat top-down. FLOOR is a pure top view. WALLS and FURNITURE add only a
short FIXED-HEIGHT front face so they read as standing up — every object uses the SAME shallow
front-face height; never draw true perspective or per-object tilt.
LIGHT: soft, from the TOP-LEFT, consistent on every tile (so pieces match when tiled).
PALETTE: warm & bright — light warm-brown wood, cream 한지 (mulberry paper), dark walnut beams,
muted celadon accents. Match across ALL tiles (one shared palette).
GRID: each cell is a SQUARE tile. Author every piece on its own square cell, centered, so cells
snap together on a grid. Assets tile/repeat seamlessly on shared edges where noted.
BACKGROUND: fully TRANSPARENT (alpha). No drop shadow bleeding outside the cell, no ground plate,
no white/checkerboard, no border, no text/label/number/watermark, no characters.
OUTPUT: a clean sprite SHEET on transparent background, pieces laid on an even grid with a small
uniform gap between cells so each can be sliced individually in Figma.
```

> 참고 해상도: 인게임 셀 = **40px**. 에셋은 **셀당 256×256px**로 크게 그려 두고 다운스케일한다(선명도 확보).
> 벽·문은 «셀 가장자리»에, 바닥은 «셀 전체», 가구는 «footprint 칸 중앙»에 앵커되도록 그린다.

---

## 2. 바닥 (floor) — 1×1, 사방 이음매 seamless

한 장씩 시트로. **네 변이 서로 이어지게(seamless tiling)** — 방을 여러 칸 깔아도 경계가 안 보여야 함.

```
[공통 규격] +
Make a SHEET of 4 seamless FLOOR tiles (top view, flat), each a square that tiles edge-to-edge
in every direction with no visible seam:
1) light warm-brown WOOD PLANK floor (마루), planks running vertically.
2) 우물마루 — square wood parquet grid (for the main hall 대청마루).
3) packed-earth / dirt floor (흙바닥), subtle pebbles (for kitchen 정지 & servants' 행랑채).
4) warm ONDOL paper floor (장판) — smooth oiled-paper amber floor (for bedrooms).
Each tile fully fills its cell, seamless on all four edges. Transparent gap between the 4 cells.
```

---

## 3. 벽 (wall) — 방향별 + 모서리

2.5D 관례상 벽은 «셀 가장자리에 선 얇은 정면 띠». 방향별로 정면이 다르므로 4방 + 모서리 4종을 만든다.
직선 벽은 **가로/세로로 반복(seamless)** 가능해야 함.

```
[공통 규격] +
Make a SHEET of HANOK WALL segment tiles (orthographic, fixed short height). One shared style:
warm wood post-and-beam frame with cream 한지 lattice panels (창호), dark wood sill at the base.
Straight segments must repeat seamlessly left↔right (for top/bottom walls) or up↕down (for side walls).
Pieces (label positions by layout, NOT text in image):
1) TOP wall segment — back wall seen from the front: tall 한지 lattice panel above a low wood sill,
   ceiling beam (서까래) along the top. This is the TALLEST face.
2) BOTTOM wall segment — front/near wall: only a LOW wood sill/threshold band, so the room interior
   is visible over it (short).
3) LEFT wall segment — vertical wood-frame + 한지 band running top-to-bottom, thin.
4) RIGHT wall segment — mirror of the left.
5) OUTER CORNER posts ×4 — a wooden corner PILLAR (기둥) joining two walls, one for each corner
   (top-left, top-right, bottom-left, bottom-right).
Consistent post thickness so segments and corners line up on the grid. Transparent background.
```

> 조립 규칙: 방 = [좌상 기둥][상단벽 ×N][우상 기둥] / [좌측벽]…[우측벽] / [좌하 기둥][하단벽 ×N][우하 기둥].
> 하단벽을 «낮은 문턱»으로 두면 방 안이 들여다보인다(탑다운 가독성).

---

## 4. 출입문 (door) — 방향별, 벽 1칸 대체

문은 «벽 세그먼트 1칸을 대체»하는 열린 통로. **문지방은 바닥과 같은 높이**(낮게), 바닥이 통로로 이어짐.
창문처럼 보이지 않게(한지·유리·높은 턱 금지).

```
[공통 규격] +
Make a SHEET of 4 HANOK DOORWAY tiles — each REPLACES one wall segment with an OPEN floor-level
passage you walk through. Same wood/한지 style as the wall set. In each, the floor continues
through a one-tile gap to a slightly darker corridor beyond; a LOW wooden threshold (문지방) flush
with the floor; open hinged 한지 door leaf shown ajar to the side. NOT a window — no glass, no
paper panel filling the gap, no raised sill.
1) TOP doorway — gap in the back/top wall (corridor above).
2) BOTTOM doorway — gap in the front/bottom wall (corridor below).
3) LEFT doorway — gap in the left wall (corridor to the left).
4) RIGHT doorway — gap in the right wall (corridor to the right).
Each fits exactly one wall cell and lines up with the wall segments. Transparent background.
```

---

## 5. 가구 (furniture) — 개별 오브젝트, 투명 PNG

**벽에 붙는 키 큰 가구는 정면(front face)이 보이게 세워서**, 바닥에 눕히지 않는다.
footprint(차지 칸)를 함께 표기 — Figma에서 몇 칸에 얹을지 기준.

### 5-1. 벽면 가구 (1×2 세로 / 2×1 가로 — 정면 세움)
```
[공통 규격] +
Make a SHEET of tall HANOK furniture objects, each standing UPRIGHT showing its FRONT FACE
(against a back wall), on transparent background, uniform lighting/scale:
- 반닫이 (front-opening wooden chest), 뒤주 (rice chest), 이불장 (bedding cabinet),
  사방탁자 (open display shelf w/ 청자·백자), 책장 (bookshelf w/ 한적·두루마리),
  문갑 (low long cabinet, 2×1 wide), 경대 (vanity w/ round mirror),
  병풍 (folding screen w/ 매화 ink painting, wide 2×1 or 3×1).
Each object drawn front-on and upright (NOT top-view, NOT lying flat). Even spacing to slice.
```

### 5-2. 바닥/낮은 가구 (1×1 — 위에서)
```
[공통 규격] +
Make a SHEET of small HANOK floor objects (top-down, low height), transparent background:
- 소반 / 서안 (low tray & writing table), 방석 (floor cushion), 화로 (brazier w/ embers),
  등잔 (oil lamp), 옹기 항아리 (onggi jar), 절구 (stone mortar), 물동이 (water jar),
  바구니 (woven basket), 반짇고리 (sewing basket), 보자기 (wrapped bundle), 분재 (bonsai on stand),
  청자 화병 (celadon vase). Each 1×1, uniform scale & light. Even spacing to slice.
```

### 5-3. 주제 소품 (부엌·마당·특수)
```
[공통 규격] +
Make a SHEET of special HANOK props, transparent background, matching style/scale:
- 아궁이 (clay wood-fired furnace w/ iron cauldron, 2×1), 장독대 (platform of onggi jars, 2×1),
  석등 (stone lantern), 지게 (A-frame carrier, upright against wall), 멍석 (flat straw mat, 2×2 floor),
  대나무 (green bamboo cluster), 곶감 타래 (dried-persimmon string, hangs on wall),
  빗자루 (broom), 짚신 (straw sandals). Label footprint by size; even spacing to slice.
```

---

## 6. Figma 조립 가이드 (요약)

1. 시트 1장씩 받아 **투명 PNG**로 저장 → Figma에서 조각별로 슬라이스(프레임/컴포넌트화).
2. **256px 격자 프레임**을 깔고 스냅 켜기. 1칸 = 256px(= 인게임 40px).
3. 방 골격: `모서리·벽·문` 을 가장자리에 배치 → 안쪽 `바닥` 채우기 → `가구`를 벽에 붙여 얹기.
4. 각 방(5×3~6×6)은 [board.ts `ROOM_REGIONS`]의 크기·문 방향(top/bottom/left/right)대로 조립.
5. 완성 방은 방별 PNG로 export → 기존 `rooms/<id>.webp`를 교체(같은 파이프라인: WebP q85).

> 방 크기·문 방향 표는 `docs/assets/20260803-room-image-prompts.md` §「방별 문 위치·비율·상태」 참조.
> (통짜 프롬프트 문서는 타일셋 전환 이후 «과거 방식» 아카이브로 남긴다.)

---

## 부록. 방별 조립 사양 (board.ts 기준)

| 방 | 타일 | 문 방향 | 바닥 | 특징 가구 |
|---|---|---|---|---|
| 정지(부엌) | 5×5 | 하단 | 흙바닥 | 아궁이·옹기·장작 |
| 대청마루 | 6×5 | 하단 | 우물마루 | 뒤주·사방탁자·병풍 |
| 후원 | 5×5 | 하단 | 흙바닥 | 장독대·석등·대나무 |
| 사랑방 | 5×6 | 우측 | 마루 | 서안·책장·병풍 |
| 사랑채 | 5×4 | 좌측 | 마루 | 소반·보료·문갑 |
| 서재 | 5×4 | 좌측 | 마루 | 책장·서안·족자 |
| 안방 | 5×5 | 상단 | 장판 | 이불장·경대·반닫이 |
| 행랑채 | 6×5 | 상단 | 흙바닥 | 선반·궤·지게·멍석 |
| 별당 | 5×3 | 상단 | 마루 | 병풍·등·청자·분재 |
