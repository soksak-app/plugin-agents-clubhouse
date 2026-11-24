// The invite dialog page of the room (C120, docs/spec/room.md#invite): the definitions tree with a check box per definition, the button
// 초대 that closes the dialog with the picked identifiers and the button 취소 and Escape that close it with null. Params of another form are
// shown as the error of the dialog, written to the application log, and close the dialog with null.
import { createExpose } from "@soksak/plugin-api";
import { createViewBridge } from "@soksak/plugin-api/view";
import { INVITE_COMMANDS, INVITE_ELEMENTS, inviteGroups, invitedIds, parseInviteParams, type InviteParams } from "./room/invite";

const PICK = INVITE_COMMANDS.pick;
const CANCEL = INVITE_COMMANDS.cancel;
const WHERE = "clubhouse invite";

const bridge = createViewBridge({
  handler: window.webkit.messageHandlers["sok-view"],
  report: (event) => {
    if (event.kind !== "open-calls") void bridge.runtime.error(WHERE, JSON.stringify(event));
  },
});
const start = window.sokSurface;
if (start === undefined || start === null) throw new Error("the invite dialog has no start values: window.sokSurface is missing");
const expose = createExpose(
  {
    register: (kind, name) => (kind === "command" ? Promise.resolve() : bridge.exposure.register(kind, name).then(() => undefined)),
    onRequest: (answer) =>
      bridge.runtime.native.on("exposure-request", ({ id, surface, method, params }) => {
        if (surface !== start.surface) {
          void bridge.runtime.error(WHERE, `exposure request ${id} names surface ${surface}, not ${start.surface}`);
          return;
        }
        answer({ id, method, params });
      }),
    reply: (id, payload) => bridge.exposure.reply(id, payload),
    changed: (name, value, version) => bridge.exposure.changed(name, value, version),
    report: (text) => bridge.runtime.error(WHERE, text),
  },
  () => start.declarations,
);

const tree = document.getElementById("tree")!;
const pickButton = document.getElementById("pick") as HTMLButtonElement;
const cancelButton = document.getElementById("cancel") as HTMLButtonElement;
const message = document.getElementById("error")!;

// Shows the text of a refusal on the dialog page and records it through runtime.error.
const refused = (error: unknown): void => {
  const text = String((error as Error)?.message ?? error);
  message.textContent = text;
  void bridge.runtime.error(WHERE, text);
};

let params: InviteParams = { definitions: [], groups: [], members: [] };
const picked = new Set<string>();
const draw = (): void => {
  tree.replaceChildren();
  for (const group of inviteGroups(params)) {
    const part = document.createElement("div");
    part.className = "group";
    const title = document.createElement("b");
    title.textContent = group.name ?? "그룹 없음";
    part.append(title);
    for (const row of group.rows) {
      const label = document.createElement("label");
      label.className = row.member ? "member" : "";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.id = row.id;
      box.checked = row.member || picked.has(row.id);
      box.disabled = row.member;
      box.addEventListener("change", () => {
        if (box.checked) picked.add(row.id);
        else picked.delete(row.id);
        draw();
      });
      label.append(box, document.createTextNode(row.name));
      part.append(label);
    }
    tree.append(part);
  }
  pickButton.disabled = invitedIds(params, picked).length === 0;
};

// invite.pick {ids} closes the dialog with the identifiers; an identifier outside the definitions or a member is refused.
const pick = async (value: unknown): Promise<{ ids: string[] }> => {
  const ids = (value as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && id !== "")) throw new Error(`invite.pick ids must be an array of identifiers, got ${JSON.stringify(ids)}`);
  const invited = invitedIds(params, new Set(ids));
  if (invited.length !== ids.length) throw new Error(`invite.pick ids must name definitions that are no member, got ${JSON.stringify(ids)}`);
  if (invited.length === 0) throw new Error("invite.pick takes at least one definition");
  await bridge.runtime.dialog.close({ ids: invited });
  return { ids: invited };
};
const cancel = async (): Promise<null> => {
  await bridge.runtime.dialog.close(null);
  return null;
};

await Promise.all([
  expose.command(PICK, pick), bridge.commands.register(PICK, pick),
  expose.command(CANCEL, cancel), bridge.commands.register(CANCEL, cancel),
]);
await Promise.all([
  expose.element(INVITE_ELEMENTS.definition, () => [...tree.querySelectorAll("input")]),
  expose.element(INVITE_ELEMENTS.pick, pickButton),
  expose.element(INVITE_ELEMENTS.cancel, cancelButton),
  expose.bind(pickButton, PICK, () => ({ ids: invitedIds(params, picked) }), { failed: refused }),
  expose.bind(cancelButton, CANCEL, {}, { failed: refused }),
]);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") expose.run(CANCEL, {}).catch(refused);
});

try {
  params = parseInviteParams((start as { params?: unknown }).params);
  draw();
} catch (error) {
  refused(error);
  await bridge.runtime.dialog.close(null);
}
