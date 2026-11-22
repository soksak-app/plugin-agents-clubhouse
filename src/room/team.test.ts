// The team of the leader (docs/spec/room.md#team): member.summon checks only its input, names each summoned member by its definition
// and the smallest free number, and refuses a summon beyond the setting maxMembers.
import { describe, expect, it } from "vitest";
import { maxMembersOf, summonedEntry, teamName, type TeamEntry } from "./team";

const DEFINITIONS = [{ id: "claude", name: "Claude" }, { id: "codex", name: "Codex" }];
const LEADER = { id: "lead", turns: ["t-1"] };
const params = (over: Record<string, unknown> = {}) => ({ turn: "t-1", definition: "claude", role: "server", directory: "/work/game", ...over });

describe("summonedEntry", () => {
  it("takes the smallest free number of the definition", () => {
    const team: TeamEntry[] = [{ id: "claude-2", definition: "claude", role: "", directory: "/a" }];
    expect(summonedEntry(params(), { team, definitions: DEFINITIONS, leader: LEADER, maxMembers: 6 })).toEqual({
      id: "claude-1", definition: "claude", role: "server", directory: "/work/game",
    });
    expect(teamName({ id: "claude-1", definition: "claude", role: "", directory: "/a" }, DEFINITIONS)).toBe("Claude-1");
  });

  it("refuses a turn that is not an open turn of the leader, and a room without a leader", () => {
    const deps = { team: [], definitions: DEFINITIONS, leader: LEADER, maxMembers: 6 };
    expect(() => summonedEntry(params({ turn: "t-9" }), deps)).toThrow("member.summon takes the turn token of the leader lead, got t-9");
    expect(() => summonedEntry(params(), { ...deps, leader: null })).toThrow("member.summon needs a leader: set one with member.leader");
  });

  it("checks only its input: the definition, the role text and an absolute directory", () => {
    const deps = { team: [], definitions: DEFINITIONS, leader: LEADER, maxMembers: 6 };
    expect(() => summonedEntry(params({ definition: "gemini" }), deps)).toThrow("definition gemini is not an agent definition");
    expect(() => summonedEntry(params({ directory: "work/game" }), deps)).toThrow('directory must be an absolute path, got "work/game"');
    expect(() => summonedEntry(params({ role: "a\nb" }), deps)).toThrow("role must be a text of 0 to 200 characters without control characters");
  });

  it("refuses a summon beyond maxMembers", () => {
    const team: TeamEntry[] = [{ id: "claude-1", definition: "claude", role: "", directory: "/a" }];
    expect(() => summonedEntry(params(), { team, definitions: DEFINITIONS, leader: LEADER, maxMembers: 1 })).toThrow("the team has reached maxMembers 1");
  });
});

describe("maxMembersOf", () => {
  it("accepts an integer from 1 to 16", () => {
    expect(maxMembersOf(6)).toBe(6);
    for (const value of [0, 17, 2.5, "6"]) expect(() => maxMembersOf(value)).toThrow(`settings.maxMembers must be an integer from 1 to 16, got ${JSON.stringify(value)}`);
  });
});
