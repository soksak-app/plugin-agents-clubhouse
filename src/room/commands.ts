// The commands of the room (plugin.json exposes.commands). Each handler runs in the view page and answers with the result shape that plugin.json declares.

import type { RoomMode } from "./room-relay";

export interface RoomState {
  // The conversation mode of the room (docs/spec/room.md#modes).
  mode: RoomMode;
  // The assigned group and its members in the order of the group (docs/spec/room.md#group).
  group: string | null;
  members: { id: string; leader: boolean }[];
  transport: { state: "unavailable" | "ready"; reason?: string; notIsolated: string[] };
}

export interface CommandDeps {
  state: () => RoomState;
}

export function createRoomCommands(deps: CommandDeps): Record<string, (params: any) => Promise<any>> {
  return {
    "soksak-plugin-agents-clubhouse.state": async () => deps.state(),
  };
}
