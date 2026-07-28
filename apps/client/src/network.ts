import { Client, type Room, type RoomAvailable } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(endpoint);

/** 새 방을 만들고 방장이 된다. isPublic=false면 목록에 안 뜨는 비공개방(코드 참가만). */
export const createRoom = (isPublic: boolean): Promise<Room> =>
  client.create("clue", { isPublic });

/** 초대 코드(roomId)로 참가. 비공개방도 코드로는 참가 가능. */
export const joinRoomById = (id: string): Promise<Room> =>
  client.joinById(id, {});

/**
 * 공개방 목록. 비공개방과 **판이 도는 동안의 방**은 빠진다(서버 `setListed`).
 * 잠금(`lock`)이 아니라 목록 숨김이므로, 목록에서 사라진 방도 **코드로는 참가**할 수 있고
 * 그때 좌석을 줄지 관전으로 받을지는 서버 `onJoin`이 정한다. 판이 끝나면 다시 뜬다.
 */
export type PublicRoom = RoomAvailable<{ hostName?: string; count?: number }>;
export const listPublicRooms = (): Promise<PublicRoom[]> =>
  client.getAvailableRooms<{ hostName?: string; count?: number }>("clue");
