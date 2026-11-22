// The error report of the room page (C12). Each failure goes to the one error display path of the window through the view call
// tab.error (core docs/spec/native-surfaces.md#view-surfaces): the window shows it as a toast and writes its record. runtime.error
// only records an error that the view shows itself, so it is not the display call. A refused tab.error (its text must be 1 to
// 1024 characters without control characters) is recorded with runtime.error, so the error stays in the application log.
// A report before the bridge exists waits for attach.

export interface ViewErrorApi {
  calls: { request(command: string, params: unknown): Promise<unknown> };
  runtime: { error(where: string, text: string): Promise<unknown> };
}

export interface RoomReport {
  report(where: string, text: string): void;
  attach(api: ViewErrorApi): void;
}

export function createRoomReport(): RoomReport {
  let attached: ViewErrorApi | null = null;
  const pending: Array<[string, string]> = [];
  return {
    report(where, text) {
      if (attached === null) {
        pending.push([where, text]);
        return;
      }
      show(attached, where, text);
    },
    attach(api) {
      attached = api;
      for (const [where, text] of pending.splice(0)) show(api, where, text);
    },
  };
}

function show(api: ViewErrorApi, where: string, text: string): void {
  const shown = `${where}: ${text}`;
  void api.calls.request("tab.error", shown).catch((refusal: unknown) => {
    // The fallback record is the last path: when runtime.error fails too, its rejection is unhandled and stays visible.
    void api.runtime.error("room report", `tab.error refused (${String((refusal as Error)?.message ?? refusal)}): ${shown}`);
  });
}
