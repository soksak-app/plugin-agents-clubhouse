// The input placeholder names the mentions of the room (docs/spec/room.md#mentions), `@all` among them (C95-1).
import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("the input placeholder", () => {
  it("names the @ mention and @all in each language", () => {
    expect(t("placeholder", "en")).toBe("Message… (Enter to send, Shift+Enter for newline, @ to mention a model, @all for everyone)");
    expect(t("placeholder", "ko")).toBe("메시지… (Enter 전송, Shift+Enter 줄바꿈, @로 모델 지목, @all은 모두)");
  });
});
