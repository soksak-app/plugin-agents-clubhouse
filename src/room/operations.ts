// The operations of the room as declared commands (C35, docs/spec/room.md#commands). The elements of the page are bound to these
// commands, so a click and a command call run the same path. Each command refuses an invalid parameter with an explicit error.
const P = "soksak-plugin-agents-clubhouse";

export interface OperationDeps {
  // The assigned group of the agents plugin, or null, and its change (docs/spec/room.md#group).
  group: () => string | null;
  setGroup: (group: string) => void;
  // Whether the agents plugin stores the group.
  groupDefined: (group: string) => Promise<boolean>;
  // Whether the member grid of the header is folded, and its change (docs/spec/room.md#header).
  folded: () => boolean;
  setFolded: (folded: boolean) => void;
  // Ends a member with its worktree; it rejects with the refusal of the removal (docs/spec/room.md#worktrees).
  endMember: (member: string) => Promise<void>;
  // Redraws the members after a change.
  changed: () => void;
  // Summons the members that have no open session.
  summon: () => void;
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

export function createRoomOperations(deps: OperationDeps): Record<string, (params: any) => Promise<any>> {
  let relaying = false;
  // Whether conversation.stop ended the conversation of the current relay.
  let stopped = false;
  return {
    // group.set assigns a group of the agents plugin to the room and summons its members; the assigned group changes nothing
    // (docs/spec/room.md#commands).
    [`${P}.group.set`]: async (params) => {
      const group = params?.group;
      if (typeof group !== "string" || group === "") throw new Error(`group must be a group identifier, got ${JSON.stringify(group)}`);
      if (deps.group() === group) return { group };
      if (!(await deps.groupDefined(group))) throw new Error(`group ${group} is not defined`);
      deps.setGroup(group);
      deps.changed();
      deps.summon();
      return { group };
    },
    [`${P}.members.fold`]: async (params) => {
      const folded = params?.folded;
      if (typeof folded !== "boolean") throw new Error(`folded must be true or false, got ${JSON.stringify(folded)}`);
      if (deps.folded() !== folded) {
        deps.setFolded(folded);
        deps.changed();
      }
      return { folded };
    },
    [`${P}.member.end`]: async (params) => {
      const member = params?.member;
      if (typeof member !== "string" || member === "") throw new Error(`member must be a member identifier, got ${JSON.stringify(member)}`);
      await deps.endMember(member);
      deps.changed();
      return { member, ended: true };
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
    if (deps.group() === null) throw new Error("no group is assigned");
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
