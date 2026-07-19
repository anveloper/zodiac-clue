import { Client, type Room } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(endpoint);

/** 새 방을 만들고 방장이 된다. character = 십이지 손님 ID. */
export const createRoom = (character: string): Promise<Room> =>
  client.create("clue", { character });

/** 초대 코드(roomId)로 기존 방에 참가한다. */
export const joinRoomById = (id: string, character: string): Promise<Room> =>
  client.joinById(id, { character });
