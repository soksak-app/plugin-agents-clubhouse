// The room's port to its view (core docs/spec/native-surfaces.md#view-surfaces). The room reaches the core only through this port:
// command calls run through the view call runtime.command, a core command or a command that plugin.json declares for the room.
export interface RoomPort {
  commands: {
    // Runs a core command (core.*) or a command of the room. A command of another owner is refused by the view.
    execute(name: string, params: Record<string, unknown>): Promise<any>;
  };
}
