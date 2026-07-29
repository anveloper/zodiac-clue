import { Client, type Room, type RoomAvailable } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(endpoint);

/**
 * 룸 타입 = **주제(콘텐츠) 하나당 하나**. 서버 `index.ts`의 `gameServer.define(...)`과
 * 같은 문자열이어야 한다 — 두 곳이 갈라지면 방을 만들 수 없다.
 *
 * ⚠️ 지금 정의된 주제는 클루 하나뿐이므로 **기본값이 곧 유일한 값**이다. 인자로 뺀 것은
 * 두 번째 주제가 생겼을 때 이 파일을 다시 열지 않기 위한 확장점일 뿐, 선택 UI는 없다
 * (없는 주제를 있는 것처럼 보이게 하지 않는다).
 */
export type RoomType = "clue";
export const DEFAULT_ROOM_TYPE: RoomType = "clue";

/** 새 방을 만들고 방장이 된다. isPublic=false면 목록에 안 뜨는 비공개방(코드 참가만). */
export const createRoom = (
  isPublic: boolean,
  roomType: RoomType = DEFAULT_ROOM_TYPE,
): Promise<Room> => client.create(roomType, { isPublic });

/**
 * 초대 코드(roomId)로 참가. 비공개방도 코드로는 참가 가능.
 * **룸 타입 인자가 없다** — `joinById`는 방을 roomId로 찾으므로 주제를 알 필요가 없다
 * (`client.reconnect`도 토큰으로 찾는다. 룸 타입이 필요한 경로는 생성·목록 둘뿐이다).
 */
export const joinRoomById = (id: string): Promise<Room> =>
  client.joinById(id, {});

/**
 * 공개방 목록. 비공개방과 **판이 도는 동안의 방**은 빠진다(서버 `setListed`).
 * 잠금(`lock`)이 아니라 목록 숨김이므로, 목록에서 사라진 방도 **코드로는 참가**할 수 있고
 * 그때 좌석을 줄지 관전으로 받을지는 서버 `onJoin`이 정한다. 판이 끝나면 다시 뜬다.
 */
/**
 * 목록에 실려 오는 방 메타데이터 — **서버 `syncMeta()`가 쓰는 필드와 1:1**이다.
 * 전부 공개 정보다(손패·정답 봉투·좌석 배정은 어떤 형태로도 들어오지 않는다).
 * `phase`는 서버 `state.phase`와 같은 값 — 클라는 이 값을 **추정하지 않고 그대로 읽는다**.
 */
export type PublicRoomMeta = {
  hostName?: string;
  /** 좌석 총원(사람 + NPC). */
  count?: number;
  /** 그중 사람 좌석 수. */
  humans?: number;
  isPublic?: boolean;
  phase?: "lobby" | "playing" | "ended";
};
export type PublicRoom = RoomAvailable<PublicRoomMeta>;
export const listPublicRooms = (
  roomType: RoomType = DEFAULT_ROOM_TYPE,
): Promise<PublicRoom[]> =>
  client.getAvailableRooms<PublicRoomMeta>(roomType);
