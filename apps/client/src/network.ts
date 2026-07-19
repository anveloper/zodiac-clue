import { Client, type Room } from "colyseus.js";

const endpoint = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export const client = new Client(endpoint);

/** 새 방을 만들고 방장이 된다. character 미지정 시 서버가 빈 자리 자동 배정. */
export const createRoom = (character?: string): Promise<Room> =>
  client.create("clue", character ? { character } : {});

/** 초대 코드(roomId)로 참가. character 미지정 시 서버가 빈 자리 자동 배정. */
export const joinRoomById = (id: string, character?: string): Promise<Room> =>
  client.joinById(id, character ? { character } : {});
