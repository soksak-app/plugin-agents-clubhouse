// The check of the members (C152, docs/spec/room.md#check): the reasons of member-check before an open, and the problems of every member.
import { describe, expect, it } from "vitest";
import { createRoomCheck } from "./check";

const A = { id: "a", cwd: "/work", program: "claude" };
const B = { id: "b", cwd: "/gone", program: "cat" };

function setup() {
  const published: unknown[] = [];
  const check = createRoomCheck({
    run: async (folder, cli) => (folder === "/gone" ? { folder: "/gone does not exist", cli: null } : { folder: null, cli: cli === "nope" ? "the program nope is not found in PATH" : null }),
    readLogins: async () => {},
    loginProblem: (id) => (id === "a" ? "the home /h/a has no login" : null),
    session: (id) => (id === "a" ? { session: "s-1", reports: false } : null),
    publish: (value) => void published.push(value),
  });
  return { check, published };
}

describe("createRoomCheck", () => {
  it("refuses the open of a member with the reasons of member-check and opens one without them", async () => {
    const { check } = setup();
    await expect(check.beforeOpen(B)).rejects.toThrow("member b: /gone does not exist");
    await expect(check.beforeOpen({ ...A, program: "nope" })).rejects.toThrow("member a: the program nope is not found in PATH");
    await expect(check.beforeOpen(A)).resolves.toBeUndefined();
  });

  it("lists the problems of every member in group order, publishes them, and starts with no member", async () => {
    const { check, published } = setup();
    expect(check.read()).toEqual({ members: [] });
    const value = await check.all([A, B]);
    expect(value).toEqual({
      members: [
        { member: "a", problems: ["the home /h/a has no login", "the session s-1 reports no program state, so the room cannot tell when it is idle"] },
        { member: "b", problems: ["/gone does not exist"] },
      ],
    });
    expect(check.read()).toEqual(value);
    expect(published).toEqual([value]);
  });

  // C165: room.check reads the login of each home when it runs, not the login that the last open read.
  it("reads the login of the homes of the members before it lists their problems", async () => {
    const without = new Set<string>();
    const read: string[][] = [];
    const check = createRoomCheck({
      run: async () => ({ folder: null, cli: null }),
      readLogins: async (ids) => {
        read.push([...ids]);
        without.add("a");
      },
      loginProblem: (id) => (without.has(id) ? `the home /h/${id} has no login` : null),
      session: () => null,
      publish: () => {},
    });
    expect(await check.all([A, B])).toEqual({ members: [{ member: "a", problems: ["the home /h/a has no login"] }, { member: "b", problems: [] }] });
    expect(read).toEqual([["a", "b"]]);
  });

  it("gives the first problem of a member for its card", async () => {
    const { check } = setup();
    expect(check.problemOf("b")).toBeNull();
    await check.all([A, B]);
    expect(check.problemOf("b")).toBe("/gone does not exist");
    expect(check.problemOf("c")).toBeNull();
  });
});
