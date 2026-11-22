// The start of the room page (core docs/spec/native-surfaces.md#view-surfaces). The page reads its settings and its project
// data through the view context, builds the room, and only then registers the exposure that plugin.json declares, so a room
// that fails to build registers nothing.
import { type Collections, type KeyedData, createProjectCollections } from "./collections";
import { type CommandLayer, type ExposeApi, type ExposesManifest, type RoomHandlers, registerExposure } from "./exposure";

export interface PageRuntime {
  manifest: ExposesManifest;
  settings: () => Promise<Record<string, unknown>>;
  data: KeyedData;
  expose: ExposeApi;
  commands: CommandLayer;
}

export interface RoomContext {
  settings: Record<string, unknown>;
  collections: Collections;
}

export async function startRoomPage(
  runtime: PageRuntime,
  build: (context: RoomContext) => RoomHandlers | Promise<RoomHandlers>,
): Promise<RoomHandlers> {
  const settings = await runtime.settings();
  const collections = createProjectCollections(runtime.data);
  const handlers = await build({ settings, collections });
  await registerExposure(runtime.expose, runtime.commands, runtime.manifest, handlers);
  return handlers;
}
