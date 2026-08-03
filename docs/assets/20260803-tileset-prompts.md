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

### 2-1. 방 안 바닥
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

### 2-2. 방 밖 통로·마당 바닥 (건물 사이 이동 격자)
방과 방 사이의 «바깥» 이동 칸. 현재 보드의 초록 배경을 대체/보강한다. 마당은 잔디가 아니라
**흙·자갈 마당 + 디딤돌**이 한옥 정통. 통로 타일도 사방 seamless.
```
[공통 규격] +
Make a SHEET of seamless OUTDOOR courtyard/path tiles for a hanok yard, top view flat, each
tiling edge-to-edge with no seam:
1) 마당 — packed earthen courtyard ground, fine gravel & faint rake lines (main outdoor floor).
2) 디딤돌 통로 — a stepping-stone / flat-stone path segment, straight run (walkable corridor
   between buildings), stones set into the earthen ground; must repeat along its length.
3) 디딤돌 통로 교차/모서리 — corner & T-junction variants of the stone path so it can turn.
4) 잔디 가장자리 — soft grass/moss edging tile (optional, to blend the yard border).
Keep the SAME warm daylight & palette as the interior floors so inside/outside read as one scene.
Transparent gap between cells.
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
3. 바깥 먼저: 전체 격자에 `마당·디딤돌 통로`(§2-2)를 깔아 배경을 만든다 → 그 위에 방들을 얹는다.
4. 방 골격: `모서리·벽·문` 을 가장자리에 배치 → 안쪽 `방 안 바닥`(§2-1) 채우기 → `가구`를 벽에 붙여 얹기.
5. 각 방(5×3~6×6)은 [board.ts `ROOM_REGIONS`]의 크기·문 방향(top/bottom/left/right)대로 조립.
   방 문 앞은 §2-2 디딤돌 통로로 이어 붙여 «드나드는» 동선을 만든다.
6. 완성 방은 방별 PNG로 export → 기존 `rooms/<id>.webp`를 교체(같은 파이프라인: WebP q85).

> 방 크기·문 방향 표는 `docs/assets/20260803-room-image-prompts.md` §「방별 문 위치·비율·상태」 참조.
> (통짜 프롬프트 문서는 타일셋 전환 이후 «과거 방식» 아카이브로 남긴다.)

---

## 7. 코드 조립(단일 아틀라스) — 확정 방식

**이미지는 딱 한 장(마스터 아틀라스).** 벽·바닥·문·가구·마당을 한 시트에 모아 뽑고, **코드가 잘라
규칙대로 좌표에 배치**한다. Figma 수동 배치·방별 webp가 모두 사라지고 방이 «데이터»가 된다.
한 장에서 나오므로 톤·광원·원근이 구조적으로 동일 → 통짜 이미지의 흔들림 근절.

### 7-0. 단일 아틀라스 규약 (신원 확정)
자동 슬라이스한 조각이 «어느 타일인지» 알아야 규칙 배치가 된다. ChatGPT는 격자가 흔들리므로 **좌표가
아니라 순서로** 신원을 맞춘다:
- 아틀라스를 **정해진 순서(행 우선: 위→아래, 각 행은 좌→우)**로 그리도록 프롬프트에 배치 순서를 못 박는다.
- 슬라이스 후 조각을 **bbox 중심 y→x로 정렬** → 아래 «**id 순서 목록**»과 zip해 id 부여.
- 개수/순서가 목록과 맞으면 흔들려도 신원 확정. 어긋나면 그 한 조각만 수동 교정.
- **id 순서 목록**(이 순서대로 아틀라스에 배치):
  ```
  floor:     maru, umulmaru, heuk, jangpan
  yard:      madang, path_straight, path_corner, path_tjunc, grass_edge
  wall:      wall_top, wall_bottom, wall_left, wall_right,
             corner_tl, corner_tr, corner_bl, corner_br
  door:      door_top, door_bottom, door_left, door_right
  furniture: banaji, dwiju, ibuljang, sabangtakja, chaekjang, mungab, gyeongdae, byeongpung,
             soban, seoan, bangseok, hwaro, deungjan, onggi, jeolgu, muldongi, baguni,
             banjitgori, bojagi, bunjae, cheongja_hwabyeong,
             agungi, jangdokdae, seokdeung, jige, meongseok, daenamu, gotgam, bitjaru, jipsin
  ```
  (§2~§5의 조각 전체 = 이 한 목록. 카테고리별 시트는 «이 하나»로 합쳐 뽑는다.)

### 7-1. 왜 «고정 프레임 맹목 슬라이스»가 아니라 «자동 검출»인가

### 7-1. 왜 «고정 프레임 맹목 슬라이스»가 아니라 «자동 검출»인가
ChatGPT 이미지는 픽셀-정확 균일 격자를 못 뽑아 조각이 미세하게 흔들린다 → `frameWidth` 고정 슬라이스는
어긋난다. 그래서 **조각 사이를 넉넉한 투명 간격**으로 뽑고, **투명 경계로 조각을 자동 검출(alpha bbox,
connected-component)** 해 개별로 트림한다. 흔들려도 조각은 정확히 잘린다.

### 7-2. 파이프라인
1. 시트 생성 시 §1 공통 규격의 OUTPUT에 **"uniform TRANSPARENT gap ≥ 24px between every cell,
   no piece touching another"** 를 명시(자동 검출이 조각을 분리하도록).
2. 오프라인 슬라이스(Pillow):
   ```python
   # atlas.png(투명 배경, 조각 사이 간격) → 조각별 트림 PNG + index.json(id·w·h)
   from PIL import Image
   import numpy as np, json
   im = np.array(Image.open("atlas.png").convert("RGBA"))
   alpha = im[..., 3] > 8
   # scipy.ndimage.label 로 연결요소 검출 → 각 요소 bbox 크롭 → 순서/이름 부여
   ```
   (labeling은 `scipy.ndimage.label`; 없으면 flood-fill 직접 구현. venv: `/tmp/imgvenv`.)
3. 결과: `assets/tiles/<category>/<id>.png` + `<category>.atlas.json`(각 조각의 footprint 칸수).
4. Phaser 로드: 개별 PNG를 `this.load.image`로, 또는 트림 조각을 재-패킹해 `this.load.atlas`로.
5. **방 = 타일맵 데이터.** 방별 `layout`(바닥 종류 + 가구 배치 [id, gx, gy])을 `board.ts` 근처
   콘텐츠 데이터로 두고, `drawBoard()`가 그 데이터를 읽어 스프라이트를 좌표에 찍는다.

### 7-3. 방 레이아웃 데이터 예시(스케치)
```ts
type Placement = { id: string; gx: number; gy: number };   // 방 로컬 그리드 좌표(0-based)
type RoomLayout = {
  floor: "maru" | "umulmaru" | "heuk" | "jangpan";
  furniture: Placement[];                                    // 벽면·바닥 가구
};
// 예: 서재(5×4, 문=좌측)
const seojae: RoomLayout = {
  floor: "maru",
  furniture: [
    { id: "chaekjang", gx: 1, gy: 0 },   // 상단벽 책장
    { id: "banaji",    gx: 3, gy: 0 },
    { id: "seoan",     gx: 2, gy: 2 },   // 중앙 낮은 서안
  ],
};
```
벽·문·모서리는 방 크기와 `doorSideOf`로 **자동 배치**(코드가 가장자리에 두름) → 손으로 둘 필요 없음.
바깥 마당·통로(§2-2)는 전체 격자 배경으로 먼저 깐다.

### 7-4. 장점 요약
- **일관성**: 한 시트에서 나온 조각이라 톤·광원·원근이 구조적으로 동일.
- **유지보수**: 가구 하나 바꾸려면 조각 PNG만 교체, 방 전체 재생성 불필요.
- **경량**: 중복 타일은 한 번만 로드(방 9개가 같은 마루·벽 공유).
- **정합**: 문·이동 격자가 데이터(`board.ts`)와 1:1 → 시각과 규칙이 어긋나지 않음.

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
