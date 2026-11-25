import { describe, expect, it } from "vitest";
import { failedResume, resumeStart } from "./resume";

const id = "6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const fresh = "11111111-2222-4333-8444-555555555555";

describe("conversation resume (docs/spec/room.md#conversation-resume)", () => {
  it("starts a Claude Code member without a record with a new session id and records it", () => {
    const start = resumeStart({ program: "claude", home: "/h/a", folder: "/w/m", ownWorktree: true }, undefined, fresh);
    expect(start).toEqual({ args: ["--session-id", fresh], record: { home: "/h/a", folder: "/w/m", id: fresh }, resuming: null });
  });
  it("resumes a Claude Code member whose record has the same home and folder", () => {
    const start = resumeStart({ program: "/usr/local/bin/claude", home: "/h/a", folder: "/w/m", ownWorktree: false }, { home: "/h/a", folder: "/w/m", id }, fresh);
    expect(start).toEqual({ args: ["--resume", id], record: { home: "/h/a", folder: "/w/m", id }, resuming: `the conversation ${id}` });
  });
  it("starts a new Claude Code conversation for another account home", () => {
    const start = resumeStart({ program: "claude", home: "/h/b", folder: "/w/m", ownWorktree: true }, { home: "/h/a", folder: "/w/m", id }, fresh);
    expect(start.args).toEqual(["--session-id", fresh]);
    expect(start.record).toEqual({ home: "/h/b", folder: "/w/m", id: fresh });
  });
  it("starts a new Claude Code conversation for another folder", () => {
    const start = resumeStart({ program: "claude", home: null, folder: "/w/n", ownWorktree: true }, { home: null, folder: "/w/m", id }, fresh);
    expect(start.args).toEqual(["--session-id", fresh]);
  });
  it("resumes the last conversation of a Codex member in its own worktree", () => {
    const start = resumeStart({ program: "codex", home: "/h/c", folder: "/w/m", ownWorktree: true }, { home: "/h/c", folder: "/w/m", id: null }, fresh);
    expect(start).toEqual({ args: ["resume", "--last"], record: { home: "/h/c", folder: "/w/m", id: null }, resuming: "the last conversation of /w/m" });
  });
  it("records a Codex member in its own worktree without a resume at its first start", () => {
    const start = resumeStart({ program: "codex", home: "/h/c", folder: "/w/m", ownWorktree: true }, undefined, fresh);
    expect(start).toEqual({ args: [], record: { home: "/h/c", folder: "/w/m", id: null }, resuming: null });
  });
  it("starts a Codex member outside its own worktree with a new conversation and no record", () => {
    const start = resumeStart({ program: "codex", home: "/h/c", folder: "/d", ownWorktree: false }, { home: "/h/c", folder: "/d", id: null }, fresh);
    expect(start).toEqual({ args: [], record: null, resuming: null });
  });
  it("starts another CLI with a new conversation and no record", () => {
    expect(resumeStart({ program: "gemini", home: null, folder: "/w/m", ownWorktree: true }, undefined, fresh)).toEqual({ args: [], record: null, resuming: null });
  });
});

describe("failed resume (docs/spec/room.md#conversation-resume)", () => {
  const ended = { ok: false as const, reason: "member m: session s ended before its protocol turn" };
  it("names the resumed conversation when the session ended before its protocol turn", () => {
    expect(failedResume("m", "the conversation x", ended)).toBe("member m: the session ended while it resumed the conversation x; the next open starts a new conversation");
  });
  it("is null for a new conversation, a protocol turn that ended, a stop and another failure", () => {
    expect(failedResume("m", undefined, ended)).toBeNull();
    expect(failedResume("m", "the conversation x", { ok: true })).toBeNull();
    expect(failedResume("m", "the conversation x", { ok: false, stopped: true, reason: "member m: session s ended before its protocol turn" })).toBeNull();
    expect(failedResume("m", "the conversation x", { ok: false, reason: "member m: the submit failed" })).toBeNull();
  });
});
