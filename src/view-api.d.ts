// Declarations of the host modules that the room page imports at run time. The host import map of the view provides them
// (core docs/spec/plugins.md#view-surfaces); build.mjs leaves them external. Only the members the room uses are declared.

interface Window {
  // The start values of the surface, set by the host before the page runs (core docs/spec/native-surfaces.md#view-surfaces).
  sokSurface?: {
    surface: string;
    project?: { root?: string } | null;
    declarations: unknown;
  };
  webkit: { messageHandlers: Record<string, { postMessage(message: unknown): void }> };
}

declare module "@soksak/plugin-api/view" {
  export interface ViewBridge {
    calls: { request(command: string, params: unknown): Promise<any> };
    commands: { register(name: string, run: (params: any, context: unknown) => unknown): Promise<void> };
    exposure: {
      register(kind: string, name: string): Promise<unknown>;
      reply(id: number, payload: unknown): Promise<unknown>;
      changed(name: string, value: unknown, version: number): Promise<unknown>;
    };
    runtime: {
      native: { on(name: string, listener: (event: any) => void): Promise<() => void> };
      settings: { read(): Promise<unknown> };
      // A status of the workbench or of another plugin named in dependencies (core docs/spec/plugins.md#dependencies, F1074); the stop function ends the watch.
      status: { watch(name: string, listener: (value: unknown) => void): Promise<() => void> };
      data: {
        get(key: string): Promise<unknown>;
        set(key: string, value: unknown): Promise<unknown>;
        change(key: string, next: (value: unknown) => unknown): Promise<unknown>;
        // A change of the project data of the view's plugin, or of another plugin's data that the view reads (F1075); the listener gets the event.
        on(listener: (event: unknown) => void): Promise<() => void>;
      };
      theme(listener: (theme: unknown) => void): { ready: Promise<void>; dispose: Promise<() => void> };
      error(where: string, text: string): Promise<void>;
    };
  }
  export function createViewBridge(options: {
    handler: unknown;
    report: (event: { kind: string; [key: string]: unknown }) => void;
  }): ViewBridge;
}

declare module "@soksak/plugin-api" {
  export interface ExposeApi {
    command(name: string, run: (params: any) => unknown): Promise<void>;
    element(name: string, target: object | (() => object[])): Promise<void>;
    status(name: string, read: () => unknown, subscribe: (listener: (value: unknown) => void) => () => void): Promise<void>;
    dispose(): Promise<void>;
    // The shared binder of the page (core docs/spec/exposure.md): bind connects an element to a declared command, run runs one.
    bind(
      element: HTMLElement,
      name: string,
      params: Record<string, unknown> | ((event: Event) => Record<string, unknown>),
      options?: { event?: string; stop?: boolean; when?: (event: Event) => boolean; failed?: (error: unknown) => void },
    ): Promise<HTMLElement>;
    run(name: string, params: Record<string, unknown>): Promise<unknown>;
  }
  export function createExpose(
    port: {
      register(kind: string, name: string): Promise<void>;
      onRequest(answer: (request: { id: number; method: string; params: any }) => void): Promise<() => void>;
      reply(id: number, payload: unknown): Promise<unknown>;
      changed(name: string, value: unknown, version: number): Promise<unknown>;
      report(text: string): Promise<unknown>;
    },
    load: () => unknown,
  ): ExposeApi;
}
