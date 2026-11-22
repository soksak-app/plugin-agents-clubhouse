// The answer of a member (docs/spec/room.md#answer): the last reply block of the screen rows after the turn, without the status
// line, the spinner, the separators and the prompt of the program. The fixture holds the screen rows of three members that a window
// reported after one turn; two of them were laid out at another width than the terminal had, and their rows are refused.
import { describe, expect, it } from "vitest";
import { answerText } from "./answer";
import fixture from "./fixtures/member-screens.json";

const screen = (id: string): string[] => fixture.screens.find((entry) => entry.id === id)!.rows;

describe("answerText", () => {
  it("takes only the reply rows of a screen, without the status line, the separators and the prompt", () => {
    expect(answerText(screen("harness-harness"))).toBe(
      "여러분들, 저는 harness고 코드 변경을 꼼꼼히 확인하고\n커밋하는 일을 잘하는데요, 아직 앞에서 말한 사람이\n없어서 덧붙일 말은 없어요.",
    );
  });

  it("refuses the rows of a reply that the terminal broke at another width, naming the screen row", () => {
    expect(() => answerText(screen("moai-manager-lead"))).toThrow('the reply rows are broken at screen row 1: "보고"');
    expect(() => answerText(screen("superpowers-superpowers"))).toThrow('the reply rows are broken at screen row 1: "드는"');
  });

  it("refuses a screen without a reply row", () => {
    expect(() => answerText(["✻ Cogitated for 3s", "❯"])).toThrow("the screen shows no reply row");
  });

  it("takes the last reply block, keeps its blank rows between paragraphs and drops the trailing ones", () => {
    const rows = ["⏺ Read(a.md)", "  ⎿  Read 3 lines", "", "⏺ first paragraph", "  goes on", "", "  second paragraph", "", "", "✻ Baked for 2s", "❯"];
    expect(answerText(rows)).toBe("first paragraph\ngoes on\n\nsecond paragraph");
  });
});
