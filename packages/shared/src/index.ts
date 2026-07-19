export * from "./cards";
export * from "./types";

/** 접속 가능한 최대 인원 (기본 클루 = 6인). */
export const MAX_PLAYERS = 6;

/** 그리드 맵 크기 (칸). */
export const GRID_WIDTH = 24;
export const GRID_HEIGHT = 24;

/** 장소(방) 영역 정의 — 그리드 좌표 사각형. 진입 시 상호작용 지점. */
export type RoomRegion = {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const ROOM_REGIONS: RoomRegion[] = [
  { name: "jeongji", x: 1, y: 1, w: 5, h: 5 },
  { name: "daecheong", x: 9, y: 1, w: 6, h: 5 },
  { name: "huwon", x: 18, y: 1, w: 5, h: 5 },
  { name: "sarangbang", x: 1, y: 9, w: 5, h: 6 },
  { name: "sarangchae", x: 18, y: 9, w: 5, h: 4 },
  { name: "seojae", x: 18, y: 15, w: 5, h: 4 },
  { name: "anbang", x: 1, y: 18, w: 5, h: 5 },
  { name: "haengnang", x: 9, y: 18, w: 6, h: 5 },
  { name: "byeoldang", x: 18, y: 20, w: 5, h: 3 },
];

/** (x,y)가 속한 방 이름을 반환, 없으면 null. */
export const roomAt = (x: number, y: number): string | null => {
  for (const r of ROOM_REGIONS) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.name;
  }
  return null;
};
