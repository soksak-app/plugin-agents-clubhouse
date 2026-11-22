// The room's port to its view (core docs/spec/native-surfaces.md#view-surfaces). The tower and its executor reach the core and
// the room only through this port: command calls run through the view call runtime.command, a core command or a command that
// plugin.json declares for the room; the live relay and the theme are page events.
export interface RoomPort {
  commands: {
    // Runs a core command (core.*) or a command of the room. A command of another owner is refused by the view.
    execute(name: string, params: Record<string, unknown>): Promise<any>;
  };
  // The commands that plugin.json declares for the room, for the command palette.
  declaredCommands(): { name: string; description: string }[];
  // Page-local relay of the live tower stream; a listener is removed with its dispose.
  live: {
    on(topic: string, listener: (payload: unknown) => void): { dispose(): void };
    emit(topic: string, payload: unknown): void;
  };
  // Calls the listener when the theme of the view changes.
  onTheme(listener: () => void): { dispose(): void };
}
