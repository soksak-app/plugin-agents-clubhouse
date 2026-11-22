// The answer of a member (docs/spec/room.md#answer): the submitted line is found on the screen by its prompt marker, and the answer is
// the last reply block of the rows of the turn, which end at the next prompt, without the status line, the spinner and the
// separators. The fixture holds the screen rows of three members that a window reported after one turn; two of them were laid out at
// another width than the terminal had, and their rows are refused.
import { describe, expect, it } from "vitest";
import { submittedLine, turnAnswer } from "./answer";
import fixture from "./fixtures/member-screens.json";

const screen = (id: string): string[] => fixture.screens.find((entry) => entry.id === id)!.rows;

describe("submittedLine", () => {
  it("answers the absolute line of the last row that shows the submitted line, also when the terminal wrapped it", () => {
    const rows = ["❯ [@owner] earlier", "⏺ old", "", "❯ [@owner] a long line that", "  wraps", "─────", "❯"];
    expect(submittedLine({ from: 40, rows }, "[@owner] a long line that wraps")).toBe(43);
    expect(submittedLine({ from: 0, rows: ["❯ hi"] }, "hi")).toBe(0);
  });

  it("refuses a screen without a row of the submitted line", () => {
    expect(() => submittedLine({ from: 0, rows: ["❯", "❯ other"] }, "hi")).toThrow(
      "the screen shows no submitted line: no row starts with the prompt marker and the submitted text",
    );
  });
});

describe("turnAnswer", () => {
  it("takes only the reply rows of a turn, without the status line, the separators and the prompt", () => {
    expect(turnAnswer(screen("harness-harness"))).toBe(
      "여러분들, 저는 harness고 코드 변경을 꼼꼼히 확인하고\n커밋하는 일을 잘하는데요, 아직 앞에서 말한 사람이\n없어서 덧붙일 말은 없어요.",
    );
  });

  it("refuses the rows of a reply that the terminal broke at another width, naming the turn row", () => {
    expect(() => turnAnswer(screen("moai-manager-lead"))).toThrow('the reply rows are broken at turn row 1: "보고"');
    expect(() => turnAnswer(screen("superpowers-superpowers"))).toThrow('the reply rows are broken at turn row 1: "드는"');
  });

  it("refuses rows of a turn without a reply row", () => {
    expect(() => turnAnswer(["✻ Cogitated for 3s", "❯"])).toThrow("the rows of the turn show no reply row: no row starts with the reply marker");
  });

  it("refuses rows of a turn without a prompt row", () => {
    expect(() => turnAnswer(["⏺ hi", ""])).toThrow("the rows of the turn show no prompt row after the submitted line");
  });

  it("takes the last reply block before the prompt, keeps its blank rows between paragraphs and drops the trailing ones", () => {
    const rows = ["⏺ Read(a.md)", "  ⎿  Read 3 lines", "", "⏺ first paragraph", "  goes on", "", "  second paragraph", "", "", "✻ Baked for 2s", "❯", "⏺ later"];
    expect(turnAnswer(rows)).toBe("first paragraph\ngoes on\n\nsecond paragraph");
  });
});
