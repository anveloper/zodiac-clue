import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

/** 동기화되는 플레이어 상태 (모든 클라가 봄). 비밀 카드는 여기 넣지 않는다. */
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") suspect = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("boolean") connected = true;
  @type("boolean") eliminated = false;
  /** 현재 위치한 방(장소). 없으면 "" (복도). */
  @type("string") room = "";
}

/** 방 전체 동기화 상태. 정답 봉투·손패는 서버 전용이라 여기 없음. */
export class GameState extends Schema {
  /** lobby | playing | ended */
  @type("string") phase = "lobby";
  /** 방장(host) sessionId — 첫 입장자. 게임 시작 권한. */
  @type("string") host = "";
  /** 현재 턴 플레이어의 sessionId */
  @type("string") currentTurn = "";
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type({ map: Player }) players = new MapSchema<Player>();
  /** 승자 sessionId (없으면 "") */
  @type("string") winner = "";
}
