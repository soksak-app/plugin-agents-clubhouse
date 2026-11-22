// The operations of the room as declared commands (C35, docs/spec/room.md#commands). The elements of the page are bound to these
// commands, so a click and a command call run the same path. Each command refuses an invalid parameter with an explicit error.
import type { RoomMode } from "./commands";
import type { RosterEntry } from "./roster";

const P = "soksak-plugin-agents-clubhouse";
const MODES: RoomMode[] = ["facil", "turn", "simul"];

export interface OperationDeps {
  roster: RosterEntry[];
  mode: () => RoomMode;
  setMode: (mode: RoomMode) => void;
  // Redraws the roster and the mode after a change.
  changed: () => void;
  // Summons the checked members that have no open session.
  summon: () => void;
  // The number of checked members whose session is open.
  openMembers: () => number;
  // Shows the accepted text in the conversation and clears the input.
  accept: (text: string) => void;
  busy: (value: boolean) => void;
  // Relays the text; `stopped` tells whether the owner stopped the conversation of this relay (docs/spec/room.md#conversation).
  relay: (text: string, stopped: () => boolean) => Promise<{ id: string; text: string }[]>;
  // Delivers an owner line that a send added during a relay (docs/spec/room.md#owner-follow-up).
  followUp: () => void;
  // Ends the turns that wait for a blocked session or an answer, and the waits of the tokens kept from before a restart, and returns the
  // number of kept tokens that it closed (docs/spec/room.md#commands).
  stopWaits: () => number;
  // Shows a refusal or a failed relay of message.send through the error display of the window (docs/spec/room.md#commands).
  failed: (reason: string) => void;
}

function idOf(params: any): string {
  const id = params?.id;
  if (typeof id !== "string" || id === "") throw new Error(`id must be a non-empty string, got ${JSON.stringify(id)}`);
  return id;
}

function entryOf(roster: RosterEntry[], id: string): RosterEntry {
  const entry = roster.find((one) => one.id === id);
  if (!entry) throw new Error(`member ${id} is not in the roster`);
  return entry;
}

export function createRoomOperations(deps: OperationDeps): Record<string, (params: any) => Promise<any>> {
  let relaying = false;
  // Whether conversation.stop ended the conversation of the current relay.
  let stopped = false;
  return {
    [`${P}.member.set`]: async (params) => {
      const id = idOf(params);
      const checked = params?.checked;
      if (typeof checked !== "boolean") throw new Error(`checked must be a boolean, got ${JSON.stringify(checked)}`);
      const entry = entryOf(deps.roster, id);
      if (entry.checked !== checked) {
        entry.checked = checked;
        deps.changed();
        deps.summon();
      }
      return { id, checked };
    },
    // member.role sets the role of a roster entry, a text of 0 to 200 characters without control characters (docs/spec/room.md#roles).
    [`${P}.member.role`]: async (params) => {
      const id = idOf(params);
      const role = params?.role;
      if (typeof role !== "string" || [...role].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(role)) {
        throw new Error(`role must be a text of 0 to 200 characters without control characters, got ${JSON.stringify(role)}`);
      }
      const entry = entryOf(deps.roster, id);
      const next = role.trim();
      if (entry.role !== next) {
        entry.role = next;
        deps.changed();
      }
      return { id, role: next };
    },
    [`${P}.member.move`]: async (params) => {
      const id = idOf(params);
      const index = params?.index;
      const last = deps.roster.length - 1;
      if (!Number.isInteger(index) || index < 0 || index > last) {
        throw new Error(`index must be an integer from 0 to ${last}, got ${JSON.stringify(index)}`);
      }
      const entry = entryOf(deps.roster, id);
      const from = deps.roster.indexOf(entry);
      if (from !== index) {
        deps.roster.splice(from, 1);
        deps.roster.splice(index, 0, entry);
        deps.changed();
      }
      return { id, index };
    },
    [`${P}.mode.set`]: async (params) => {
      const mode = params?.mode;
      if (!MODES.includes(mode)) throw new Error(`mode must be facil, turn or simul, got ${JSON.stringify(mode)}`);
      if (deps.mode() !== mode) {
        deps.setMode(mode);
        deps.changed();
      }
      return { mode };
    },
    // conversation.stop ends the relay and its waiting turns and the waits of the kept tokens; a second call changes nothing.
    [`${P}.conversation.stop`]: async () => {
      const waits = deps.stopWaits();
      if (!relaying && waits === 0) throw new Error("the room is relaying no message");
      if (relaying) stopped = true;
      return { stopped: true };
    },
    // message.send reports each refusal and failure itself, so a command call that no element started shows it in the room too.
    [`${P}.message.send`]: async (params) => {
      try {
        return await sendMessage(params);
      } catch (error) {
        deps.failed(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
  async function sendMessage(params: any): Promise<{ answers: { id: string; text: string }[] }> {
    const raw = params?.text;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") throw new Error(`text must be a non-empty string, got ${JSON.stringify(raw)}`);
    if (relaying) {
      // The running relay takes the owner line: a working member receives it injected, an idle member in its next turn (docs/spec/room.md#owner-follow-up).
      deps.accept(text);
      deps.followUp();
      return { answers: [] };
    }
    if (deps.openMembers() === 0) throw new Error("no member session is open: check a member of the roster");
    relaying = true;
    stopped = false;
    deps.busy(true);
    try {
      deps.accept(text);
      return { answers: await deps.relay(text, () => stopped) };
    } finally {
      relaying = false;
      deps.busy(false);
    }
  }
}
