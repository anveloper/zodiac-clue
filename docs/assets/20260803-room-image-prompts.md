# 방 이미지 에셋 — 생성 프롬프트 · 결과 (2026-08-03)

> 대상: `apps/client/public/assets/rooms/*.webp` — 게임 뷰1 방 바닥 이미지.
> 생성: ChatGPT 이미지. **부엌 이미지를 톤 레퍼런스로 첨부**하고 프롬프트를 넣으면 방마다 팔레트·밝기가 일관된다.
> 처리 파이프라인(자동): 디스코드로 받은 PNG → 흰 테두리 자동 크롭 → WebP(q85) 변환 → `rooms/<id>.webp` 대치 → 배포.

## 공통 규칙 (모든 방 프롬프트에 포함)
- **한국 전통 한옥(hanok) 스타일만** — NOT western, NOT Japanese, no brick fireplace, no western furniture.
- **톤 일치** — 부엌과 같은 밝기·팔레트(밝은 따뜻한 목재·따뜻한 채광). 어둡거나 칙칙하게 금지.
- **문 개수·위치(중요)**: 문은 **방 전체에 딱 1개**, **지정한 벽에만**. 나머지 3면은 **완전히 막힌 벽**
  (특히 «하단 문»을 습관적으로 추가하지 말 것 — 비-하단 문 방에서 문이 2개가 되던 원인). 아래 «문» 항목의
  개구부는 그 지정한 벽 1곳에만 만든다.
- **문(중요)**: 벽은 **4면 전부 유지**, 문이 난 벽에만 **1타일 폭 개구부**(«벽 전체 제거» 금지). 개구부는
  **바닥과 같은 높이의 낮은 문지방(문지방 flush with floor)이 있는 «걸어서 지나가는 통로»**다 — 바닥이 그 gap을
  통해 복도로 이어진다. **창문이 아님**: 개구부에 한지/유리/높은 턱·창틀을 넣지 말 것(높은 문지방은 창문처럼 보인다).
  개구부 좌우(또는 상하)의 벽은 닫힌 채로 둔다.
- **배치(중요)**: 가구는 **벽에 밀착**(가장자리 정렬)하고 **방 가운데는 빈 바닥**으로 둔다. 낮은 상(서안·소반)만
  중앙 허용. **가구가 방 중앙에 떠 있거나** 벽과 가구 사이에 큰 여백이 생기지 않게(캐릭터가 설 중앙 공간 확보).
  영문: *place all furniture FLUSH against the walls, keep the CENTER open floor; do NOT float furniture in the middle.*
- **원근(중요)**: **부엌과 같은 살짝 비스듬한 탑다운(2.5D)**. 키 큰/세로 가구(책장·궤·족자)는 **정면이 보이게 «서 있게»**
  그린다 — «벽에 세워진» 느낌. **바닥에 눕힌 평면뷰(윗면만 보임) 금지.** 벽 가구엔 뒤에 벽이 보이게.
  영문: *tall/vertical furniture must show its FRONT FACE and STAND UPRIGHT against the wall — NOT lying flat on the floor as a flat top-view.*
- **비율**: 방 타일 비율에 맞춤. **흰/색 테두리 없이** 캔버스 edge-to-edge.
- 캐릭터·글자·UI·워터마크 없음. 플랫 탑다운(bird's-eye).

> **DOORWAY (English, paste into every prompt)**: The doorway is an OPEN FLOOR-LEVEL PASSAGE you
> walk through — a one-tile gap in the wall with a LOW wooden threshold (문지방) flush with the floor;
> the floor continues through the gap to a darker corridor beyond. It is NOT a window: no paper/lattice
> (한지), no glass, no raised sill, no window frame in the doorway. The wall stays closed on both sides
> of the gap.

## 방별 문 위치·비율·상태
| # | 방 | 타일 | 문(열리는 벽 · 위치) | 개구부 폭 | 상태 |
|---|---|---|---|---|---|
| ① | 부엌(jeongji) | 5×5 | 하단(남) · 가운데 | 1/5 | ✅ 반영 |
| ② | 대청마루(daecheong) | 6×5 | 하단(남) · 가운데 | 1/6 | ✅ 반영 |
| ③ | 후원(huwon) | 5×5 | 하단(남) · 가운데 | 1/5 | ✅ 반영 |
| ④ | 사랑방(sarangbang) | 5×6 | 우측(동) · 위쪽-중간 | 1/6 | ✅ 반영 |
| ⑤ | 사랑채(sarangchae) | 5×4 | 좌측(서) · 위쪽 | 1/4 | ✅ 반영 |
| ⑥ | 서재(seojae) | 5×4 | 좌측(서) · 위쪽 | 1/4 | ✅ 반영 |
| ⑦ | 안방(anbang) | 5×5 | 상단(북) · 가운데 | 1/5 | ✅ 반영 |
| ⑧ | 행랑채(haengnang) | 6×5 | 상단(북) · 가운데 | 1/6 | ✅ 반영 |
| ⑨ | 별당(byeoldang) | 5×3 | 상단(북) · 가운데 | 1/5 | ✅ 반영 |

> 잔치상(feast, 6×6 중앙)은 문 없음(사방 접근) — 별도.

---

## ① 부엌 (jeongji) — 5×5 · 문=하단 가운데  ✅
![부엌](https://zodiac-clue.vercel.app/assets/rooms/jeongji.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK kitchen (정지). Cozy top-down
pixel-art game asset, warm bright palette. Korean hanok style ONLY — NOT western/Japanese,
no brick, no western furniture.
Contents: clay wood-fired furnace (아궁이) with an iron cauldron, stacked firewood, wooden
barrels, ceramic onggi jars (옹기), a wooden storage chest, a hanging ladle. Packed-earth/
wood-plank floor.
Walls enclose ALL FOUR sides. ONLY OPENING: one doorway in the BOTTOM wall — ONE tile wide
(~1/5 of the bottom edge), centered; a small threshold gap, bottom wall intact on both sides.
No characters/text/UI, NO white/colored border (fills canvas edge to edge). Square 1:1 (5×5).
```

## ② 대청마루 (daecheong) — 6×5 · 문=하단 가운데  ✅
![대청마루](https://zodiac-clue.vercel.app/assets/rooms/daecheong.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK main hall (대청마루). Cozy top-down
pixel-art game asset. Korean hanok ONLY — not western/Japanese, no brick fireplace.
COLOR & TONE: warm, bright — match the kitchen room's palette/brightness.
Floor: light warm-brown wood plank in a 우물마루 grid. Walls: Korean 한지 lattice windows
(창호), exposed ceiling beams. Furniture (Korean only): rice chest (뒤주), open shelf
(사방탁자) with celadon (청자)/white porcelain (백자), low cabinet (문갑), front-opening
chest (반닫이), small tray table (소반), floor cushions (방석), folding screen (병풍).
Walls enclose ALL FOUR sides. ONLY OPENING: one doorway in the BOTTOM wall — ONE tile wide
(~1/6), centered; threshold gap, wall intact on both sides.
No characters/text/UI, NO border. Aspect 6:5 (6×5).
```

## ③ 후원 (huwon) — 5×5 · 문=하단 가운데  ✅
![후원](https://zodiac-clue.vercel.app/assets/rooms/huwon.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK back-garden storeroom (후원). Cozy
top-down pixel-art, warm bright palette (match the kitchen). Korean hanok ONLY.
Contents: a low platform (장독대) with round onggi jars (옹기 항아리), strings of dried
persimmons (곶감) and hanging dried herbs, a stone lantern (석등), green bamboo (대나무) in
a corner, a water jar and wooden bucket, a stone mortar (절구), a woven basket. Light
warm-brown floor. Walls: Korean 한지 lattice windows (창호), ceiling beams.
Walls enclose ALL FOUR sides. ONLY OPENING: one doorway in the BOTTOM wall — ONE tile wide
(~1/5), centered; threshold gap, wall intact on both sides.
No characters/text/UI, NO border. Square 1:1 (5×5).
```

## ④ 사랑방 (sarangbang) — 5×6 세로 · 문=우측 위쪽-중간  ✅
![사랑방](https://zodiac-clue.vercel.app/assets/rooms/sarangbang.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK scholar's study (사랑방). Cozy
top-down pixel-art, warm bright palette (match the kitchen). Korean hanok ONLY — not
western/Japanese, no western furniture.
Contents: a low writing desk (서안) with brush (붓), inkstone (벼루) and stacked thread-bound
books (한적); a low bookshelf/book stand; a stationery chest (문갑/연상); an open display
shelf (사방탁자); a celadon brush holder (청자 필통); a folding screen (병풍) with ink
calligraphy; a folding fan (부채); a floor cushion (방석). Light warm-brown wood floor.
Walls: Korean 한지 lattice windows (창호), ceiling beams.
DOORWAY — EXACTLY ONE, ONLY on the RIGHT wall (upper-middle, ~1/3 down). TOP/LEFT/BOTTOM walls
are COMPLETELY CLOSED solid walls — no bottom door. The one right-wall door is an OPEN FLOOR-
LEVEL PASSAGE: a one-tile gap with a LOW threshold (문지방) flush with the floor, floor continues
through to a darker corridor. NOT a window (no 한지/glass/raised sill/frame). Wall closed above
and below the gap.
No characters/text/UI, NO border. Aspect 5:6 (taller than wide, 5×6).
```

## ⑤ 사랑채 (sarangchae) — 5×4 가로 · 문=좌측 위쪽  ✅
![사랑채](https://zodiac-clue.vercel.app/assets/rooms/sarangchae.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK guest quarters (사랑채). Cozy
top-down pixel-art, warm bright palette (match the kitchen). Korean hanok ONLY.
Contents: a low tea table (소반) with a celadon (청자) teapot and cups; a folded bedding
set / thick floor mattress (보료/이부자리); floor cushions (방석); a low cabinet (문갑); a
folding screen (병풍); a potted plant. Light warm-brown wood floor. Walls: Korean 한지
lattice windows (창호), ceiling beams.
DOORWAY — EXACTLY ONE, ONLY on the LEFT wall (upper area, 2nd tile from the top). TOP/RIGHT/
BOTTOM walls are COMPLETELY CLOSED solid walls — no bottom door, no other opening. The one
left-wall door is an OPEN FLOOR-LEVEL PASSAGE: a one-tile gap with a LOW threshold (문지방)
flush with the floor, floor continues through to a darker corridor. NOT a window (no 한지/
glass/raised sill/frame). Left wall closed above and below the gap.
No characters/text/UI, NO border. Aspect 5:4 (wider than tall, 5×4).
```

## ⑥ 서재 (seojae) — 5×4 가로 · 문=좌측 위쪽  ✅
![서재](https://zodiac-clue.vercel.app/assets/rooms/seojae.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK library/study (서재). Cozy top-down
pixel-art, warm bright palette (match the kitchen). Korean hanok ONLY.
Contents: a tall bookshelf with thread-bound books (한적) and rolled scrolls (두루마리); a
low writing desk (서안) with brush, inkstone and a water dropper (연적); a hanging ink-
painting scroll (서화 족자); an abacus (주판); a floor cushion (방석); a small brazier.
Light warm-brown wood floor. Walls: Korean 한지 lattice windows (창호), ceiling beams.
LAYOUT: place all furniture AGAINST THE WALLS (bookshelf/chests flush to walls, scroll ON a
wall, brazier by a wall); keep the CENTER as open floor; only the writing desk (서안) may sit
toward the center. Do NOT float furniture in the middle.
DOORWAY — EXACTLY ONE, ONLY on the LEFT wall (upper area, 2nd tile from the top). TOP/RIGHT/
BOTTOM walls COMPLETELY CLOSED — no bottom door. Left-wall door = OPEN FLOOR-LEVEL PASSAGE:
one-tile gap with a LOW threshold (문지방) flush with the floor, floor continues to a darker
corridor. NOT a window (no 한지/glass/raised sill/frame). Left wall closed above and below.
No characters/text/UI, NO border. Aspect 5:4 (wider than tall, 5×4).
```

## ⑦ 안방 (anbang) — 5×5 · 문=상단 가운데  ✅
![안방](https://zodiac-clue.vercel.app/assets/rooms/anbang.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK master bedroom (안방). Cozy top-down
pixel-art, warm bright palette (match the kitchen). Korean hanok ONLY — not western/Japanese.
Contents: a folded quilt/bedding set (이부자리) and a bedding chest (이불장); a low vanity
(경대) with a round mirror; a front-opening chest (반닫이); a sewing basket (반짇고리); floor
cushions (방석); an oil lamp (등잔); a wrapped cloth bundle (보자기). Light warm-brown wood
floor / warm ondol floor. Walls: Korean 한지 lattice windows (창호), ceiling beams.
PLACEMENT: all furniture is pushed FLUSH against the walls, leaving the center floor open.
PERSPECTIVE: slightly-oblique top-down (2.5D) like the kitchen. Tall/vertical items
(bedding chest, vanity, chest) show their FRONT FACE and clearly STAND UPRIGHT against the
wall — NOT lying flat on the floor as a flat top-view. Attach the kitchen image as a style reference.
Walls enclose ALL FOUR sides. ONLY OPENING: one doorway in the TOP wall — ONE tile wide
(~1/5), centered; threshold gap flush to the floor (not a window), top wall intact on both sides.
No characters/text/UI, NO border. Square 1:1 (5×5).
```

## ⑧ 행랑채 (haengnang) — 6×5 · 문=상단 가운데  ✅
![행랑채](https://zodiac-clue.vercel.app/assets/rooms/haengnang.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK servants' quarters (행랑채). Cozy
top-down pixel-art, warm bright palette (match the kitchen). Korean hanok ONLY.
Contents: a woven straw mat (멍석/돗자리); a broom (빗자루); straw sandals (짚신); a simple
wooden shelf with earthenware bowls; a plain wooden chest (궤); a water bucket; an A-frame
carrier (지게). Packed-earth / plain wood floor. Walls: simple wooden plank walls with small
한지 windows, ceiling beams.
PLACEMENT: shelf, chest and A-frame carrier are pushed FLUSH against the walls; center floor open.
(The straw mat 멍석 lies flat on the floor — that one is fine.)
PERSPECTIVE: slightly-oblique top-down (2.5D) like the kitchen. The shelf, chest and A-frame
carrier show their FRONT FACE and STAND UPRIGHT against the wall — NOT lying flat as a flat
top-view. Attach the kitchen image as a style reference.
Walls enclose ALL FOUR sides. ONLY OPENING: one doorway in the TOP wall — ONE tile wide
(~1/6), centered; threshold gap flush to the floor (not a window), top wall intact on both sides.
No characters/text/UI, NO border. Aspect 6:5 (wider than tall, 6×5).
```

## ⑨ 별당 (byeoldang) — 5×3 가로 · 문=상단 가운데  ✅
![별당](https://zodiac-clue.vercel.app/assets/rooms/byeoldang.webp)
```
Top-down bird's-eye view of a TRADITIONAL KOREAN HANOK annex pavilion (별당). Cozy top-down
pixel-art, warm bright palette (match the kitchen). Korean hanok ONLY.
Contents: a folding screen (병풍) with plum-blossom (매화) painting; a hanging paper lantern;
a celadon (청자) flower vase; a low tray table (소반) with a folding fan (부채); a floor
cushion (방석); a bonsai (분재). Light warm-brown wood floor. Walls: Korean 한지 lattice
windows (창호), ceiling beams. (Wide, shallow room.)
PLACEMENT: folding screen, lantern, vase, bonsai are pushed FLUSH against the walls; center floor open.
PERSPECTIVE: slightly-oblique top-down (2.5D) like the kitchen. Tall/vertical items (folding
screen, hanging lantern, vase, bonsai) show their FRONT FACE and STAND UPRIGHT against the wall
— NOT lying flat as a flat top-view. Attach the kitchen image as a style reference.
Walls enclose ALL FOUR sides. ONLY OPENING: one doorway in the TOP wall — ONE tile wide
(~1/5), centered; threshold gap flush to the floor (not a window), top wall intact on both sides.
No characters/text/UI, NO border. Aspect 5:3 (wide landscape, 5×3).
```

---

## 변경 이력
- **2026-08-03** 신설 — 9방 프롬프트(한국식·톤일치·1타일 문턱·비율) + 결과 webp. ①부엌·②대청마루·③후원 반영, ④~⑨ 대기.
