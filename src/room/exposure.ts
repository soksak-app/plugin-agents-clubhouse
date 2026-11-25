// Registration of the room's exposed commands, elements and statuses (core docs/spec/exposure.md). The names come from the
// exposes of plugin.json; each declared name needs exactly one handler, and a handler for an undeclared name is refused.

export type CommandHandler = (params: any) => unknown;

// An element target: one element, or a function that returns the current elements of an entry of many (exposure.md).
export type ElementTarget = object | (() => object[]);

export interface StatusHandler {
  read: () => unknown;
  subscribe: (listener: (value: unknown) => void) => () => void;
}

export interface RoomHandlers {
  commands: Record<string, CommandHandler>;
  elements: Record<string, ElementTarget>;
  statuses: Record<string, StatusHandler>;
}

// The exposure of the page (createExpose of @soksak/plugin-api) and the command layer of the view bridge.
export interface ExposeApi {
  command(name: string, run: CommandHandler): Promise<void>;
  element(name: string, target: ElementTarget): Promise<void>;
  status(name: string, read: () => unknown, subscribe: StatusHandler["subscribe"]): Promise<void>;
}

export interface CommandLayer {
  register(name: string, run: CommandHandler): Promise<void>;
}

export interface ExposesManifest {
  exposes: {
    commands: { name: string }[];
    element: { name: string }[];
    status: { name: string }[];
  };
}

// Each declared name has one handler, and each handler names a declared entry. The check runs before any registration, so a
// refused set registers nothing.
function checkHandlers(kind: string, declared: string[], handlers: Record<string, unknown>): void {
  for (const name of declared) {
    if (!(name in handlers)) throw new Error(`${kind} ${name} has no handler`);
  }
  for (const name of Object.keys(handlers)) {
    if (!declared.includes(name)) throw new Error(`${kind} ${name} is not declared in plugin.json`);
  }
}

export async function registerExposure(
  expose: ExposeApi,
  commands: CommandLayer,
  manifest: ExposesManifest,
  handlers: RoomHandlers,
): Promise<void> {
  const commandNames = manifest.exposes.commands.map((c) => c.name);
  const elementNames = manifest.exposes.element.map((e) => e.name);
  const statusNames = manifest.exposes.status.map((s) => s.name);
  checkHandlers("command", commandNames, handlers.commands);
  checkHandlers("element", elementNames, handlers.elements);
  checkHandlers("status", statusNames, handlers.statuses);
  const pending: Promise<void>[] = [];
  // A command is declared to the exposure and to the command layer of the view, which serves the requests of the view.
  for (const name of commandNames) {
    pending.push(expose.command(name, handlers.commands[name]), commands.register(name, handlers.commands[name]));
  }
  for (const name of elementNames) pending.push(expose.element(name, handlers.elements[name]));
  for (const name of statusNames) {
    const status = handlers.statuses[name];
    pending.push(expose.status(name, status.read, status.subscribe));
  }
  await Promise.all(pending);
}
