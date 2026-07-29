// 클루 보드 데이터·이동 규칙 — **콘텐츠(주제) 층.**
//
// 원래 `packages/shared/src/index.ts`(패키지 배럴 루트)에 있었다. 배럴이 곧 클루 보드라
// `@zodiac-clue/shared`를 import하는 순간 이 상수들이 딸려왔다
// (docs/design/20260729-mafia-content-design.md §1.2-③). 값·주석은 **한 글자도 바꾸지 않고**
// 이 파일로 옮기기만 했다 — 루트 배럴이 그대로 재수출하므로 import 경로는 변하지 않는다.

/** 접속 가능한 최대 인원 (기본 클루 = 6인). */
export const MAX_PLAYERS = 6;

/** 그리드 맵 크기 (칸). */
export const GRID_WIDTH = 24;
export const GRID_HEIGHT = 24;

/** 장소(방) 영역 정의 — 그리드 좌표 사각형 + 입구(door) 1칸. */
export type RoomRegion = {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 입구 칸(방 경계). 방 출입은 이 칸으로만 가능. */
  door: { x: number; y: number };
  /** 소환 앵커 — 제안 시 용의자·장물이 모이는 지정 칸. 문 반대쪽 안쪽 구석에
   * 둬서 이동·출입을 방해하지 않는다. freeCellIn이 이 칸에서 가까운 순으로 채운다. */
  summon: { x: number; y: number };
};

export const ROOM_REGIONS: RoomRegion[] = [
  { name: "jeongji", x: 1, y: 1, w: 5, h: 5, door: { x: 3, y: 5 }, summon: { x: 4, y: 2 } },
  { name: "daecheong", x: 9, y: 1, w: 6, h: 5, door: { x: 11, y: 5 }, summon: { x: 13, y: 2 } },
  { name: "huwon", x: 18, y: 1, w: 5, h: 5, door: { x: 20, y: 5 }, summon: { x: 21, y: 2 } },
  { name: "sarangbang", x: 1, y: 9, w: 5, h: 6, door: { x: 5, y: 11 }, summon: { x: 2, y: 13 } },
  { name: "sarangchae", x: 18, y: 9, w: 5, h: 4, door: { x: 18, y: 10 }, summon: { x: 21, y: 11 } },
  { name: "seojae", x: 18, y: 15, w: 5, h: 4, door: { x: 18, y: 16 }, summon: { x: 21, y: 17 } },
  { name: "anbang", x: 1, y: 18, w: 5, h: 5, door: { x: 3, y: 18 }, summon: { x: 2, y: 21 } },
  { name: "haengnang", x: 9, y: 18, w: 6, h: 5, door: { x: 11, y: 18 }, summon: { x: 12, y: 21 } },
  { name: "byeoldang", x: 18, y: 20, w: 5, h: 3, door: { x: 20, y: 20 }, summon: { x: 21, y: 21 } },
];

/**
 * 문이 방의 **어느 벽에 뚫려 있는가**. 문 칸은 방 경계 행/열 위에 있으므로
 * 좌표 비교만으로 결정된다(데이터상 모서리에 놓인 문은 없다).
 *
 * 4뷰가 문을 "벽에 난 구멍"으로 그리려면 어느 벽을 끊을지 알아야 하는데,
 * 그 판단을 뷰마다 따로 하면 세 벌이 갈린다.
 */
export type DoorSide = "top" | "bottom" | "left" | "right";

export const doorSideOf = (r: RoomRegion): DoorSide =>
  r.door.y === r.y
    ? "top"
    : r.door.y === r.y + r.h - 1
      ? "bottom"
      : r.door.x === r.x
        ? "left"
        : "right";

/** 문이 뚫린 벽의 바깥 방향(복도 쪽) 단위 벡터. */
export const doorOutward = (side: DoorSide): { x: number; y: number } =>
  side === "top"
    ? { x: 0, y: -1 }
    : side === "bottom"
      ? { x: 0, y: 1 }
      : side === "left"
        ? { x: -1, y: 0 }
        : { x: 1, y: 0 };

/** 중앙 잔치상(시작 구역) — 방처럼 이동 소모 없는 자유 구역. */
export const FEAST = { x: 9, y: 9, w: 6, h: 6 };

/** (x,y)가 중앙 잔치상 위인지. */
export const inFeast = (x: number, y: number): boolean =>
  x >= FEAST.x &&
  x < FEAST.x + FEAST.w &&
  y >= FEAST.y &&
  y < FEAST.y + FEAST.h;

/** (x,y)가 속한 방 이름을 반환, 없으면 null. */
export const roomAt = (x: number, y: number): string | null => {
  for (const r of ROOM_REGIONS) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.name;
  }
  return null;
};

/** 비밀 통로 — 대각 방 쌍 연결(양방향). 방에서 주사위 없이 상대 방으로 이동. */
export const PASSAGES: Record<string, string> = {
  jeongji: "byeoldang",
  byeoldang: "jeongji",
  huwon: "anbang",
  anbang: "huwon",
  sarangbang: "seojae",
  seojae: "sarangbang",
};

/** 해당 방의 비밀 통로 연결 방(없으면 undefined). */
export const passageOf = (name: string): string | undefined => PASSAGES[name];

/** 방 영역 조회(이름). */
export const regionOf = (name: string): RoomRegion | undefined =>
  ROOM_REGIONS.find((r) => r.name === name);

/** 방 중심 칸. */
export const roomCenter = (name: string): { x: number; y: number } => {
  const r = regionOf(name);
  if (!r) return { x: 0, y: 0 };
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
};

/**
 * (ax,ay)→(bx,by) 인접 이동이 방 경계 규칙상 허용되는지.
 * - 같은 방/같은 복도 내부: 허용
 * - 복도→방: 목표가 그 방의 입구일 때만
 * - 방→복도: 출발이 그 방의 입구일 때만
 * - 방↔방 직접: 불가
 */
export const canCross = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean => {
  const ra = roomAt(ax, ay);
  const rb = roomAt(bx, by);
  if (ra === rb) return true;
  if (ra === null && rb !== null) {
    const r = regionOf(rb);
    return !!r && r.door.x === bx && r.door.y === by;
  }
  if (ra !== null && rb === null) {
    const r = regionOf(ra);
    return !!r && r.door.x === ax && r.door.y === ay;
  }
  return false; // 방↔방 직접 이동 불가
};
