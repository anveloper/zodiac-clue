import { Client, type Room, type RoomAvailable } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(endpoint);

/** 새 방을 만들고 방장이 된다. isPublic=false면 목록에 안 뜨는 비공개방(코드 참가만). */
export const createRoom = (isPublic: boolean): Promise<Room> =>
  client.create("clue", { isPublic });

/** 초대 코드(roomId)로 참가. 비공개방도 코드로는 참가 가능. */
export const joinRoomById = (id: string): Promise<Room> =>
  client.joinById(id, {});

/** 시작 전 공개방 목록. 시작(lock)·비공개 방은 제외되어 반환된다. */
export type PublicRoom = RoomAvailable<{ hostName?: string; count?: number }>;
export const listPublicRooms = (): Promise<PublicRoom[]> =>
  client.getAvailableRooms<{ hostName?: string; count?: number }>("clue");
