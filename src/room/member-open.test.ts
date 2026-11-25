// The open of a member at its first turn (docs/spec/room.md#receivers): it summons the member, refuses a member without a login, and
// a stop of the owner during the open ends it as a stop, also when the summon itself waited for the protocol turn (C151).
import { describe, expect, it } from "vitest";
import { createMemberOpen } from "./member-open";
import { TurnStopped } from "./room-relay";
import type { ProtocolOutcome } from "./protocol";

function setup(outcomes: ProtocolOutcome[], onSummon: () => void = () => {}, refusal: string | null = null) {
  const calls: string[] = [];
  let stops = 0;
  const open = createMemberOpen({
    check: async (id) => {
      calls.push(`check ${id}`);
      if (refusal !== null) throw new Error(refusal);
    },
    summon: async (id) => {
      calls.push(`summon ${id}`);
      onSummon();
    },
    needsLogin: () => false,
    protocol: async (id) => {
      calls.push(`protocol ${id}`);
      const result = outcomes.shift();
      return result === undefined ? undefined : { session: "s-1", result };
    },
    stops: () => stops,
  });
  return { open, calls, stop: () => void (stops += 1) };
}

describe("createMemberOpen", () => {
  it("summons the member and answers its session once its protocol turn ended", async () => {
    const t = setup([{ ok: true }]);
    expect(await t.open({ id: "a", name: "A" })).toBe("s-1");
    expect(t.calls).toEqual(["check a", "summon a", "protocol a"]);
  });

  it("ends with TurnStopped and waits for no new protocol turn when the owner stopped during the summon", async () => {
    let t: ReturnType<typeof setup>;
    t = setup([{ ok: true }], () => t.stop());
    await expect(t.open({ id: "a", name: "A" })).rejects.toBeInstanceOf(TurnStopped);
    expect(t.calls).toEqual(["check a", "summon a"]);
  });

  it("ends with TurnStopped for a stopped protocol turn and with the reason of a refused one", async () => {
    await expect(setup([{ ok: false, stopped: true, reason: "r" }]).open({ id: "a", name: "A" })).rejects.toBeInstanceOf(TurnStopped);
    await expect(setup([{ ok: false, reason: "member a: refused" }]).open({ id: "a", name: "A" })).rejects.toThrow("member a: refused");
    await expect(setup([]).open({ id: "a", name: "A" })).rejects.toThrow("member a: its session did not open");
  });

  // C152 (docs/spec/room.md#check): a member that the check refuses opens no session.
  it("checks the member before its summon and summons no member that the check refuses", async () => {
    const t = setup([{ ok: true }], () => {}, "member a: /gone does not exist");
    await expect(t.open({ id: "a", name: "A" })).rejects.toThrow("member a: /gone does not exist");
    expect(t.calls).toEqual(["check a"]);
  });
});
