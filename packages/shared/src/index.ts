export * from "./cards";
export * from "./types";

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
};

export const ROOM_REGIONS: RoomRegion[] = [
  { name: "jeongji", x: 1, y: 1, w: 5, h: 5, door: { x: 3, y: 5 } },
  { name: "daecheong", x: 9, y: 1, w: 6, h: 5, door: { x: 11, y: 5 } },
  { name: "huwon", x: 18, y: 1, w: 5, h: 5, door: { x: 20, y: 5 } },
  { name: "sarangbang", x: 1, y: 9, w: 5, h: 6, door: { x: 5, y: 11 } },
  { name: "sarangchae", x: 18, y: 9, w: 5, h: 4, door: { x: 18, y: 10 } },
  { name: "seojae", x: 18, y: 15, w: 5, h: 4, door: { x: 18, y: 16 } },
  { name: "anbang", x: 1, y: 18, w: 5, h: 5, door: { x: 3, y: 18 } },
  { name: "haengnang", x: 9, y: 18, w: 6, h: 5, door: { x: 11, y: 18 } },
  { name: "byeoldang", x: 18, y: 20, w: 5, h: 3, door: { x: 20, y: 20 } },
];

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
