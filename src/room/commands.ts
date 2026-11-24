// The commands of the room (plugin.json exposes.commands). Each handler runs in the view page and answers with the result shape that plugin.json declares.

export type RoomMode = "turn" | "facil" | "simul";

export interface RoomState {
  mode: RoomMode;
  roster: { id: string; checked: boolean }[];
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
