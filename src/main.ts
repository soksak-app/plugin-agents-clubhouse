// soksak-plugin-agents-clubhouse — the room page (ui/clubhouse.html, the view surface of plugin.json).
//
// The page starts through the view bridge of @soksak/plugin-api/view (core docs/spec/native-surfaces.md#view-surfaces): it
// reads the settings and the project data, builds the room (roster tabs, conversation mode, control tower button), and then
// registers the commands, elements and status that plugin.json declares (src/room/page.ts). The room has no member transport
// yet: the transport status is unavailable and the composer stays disabled until the member sessions (C3) and the terminal
// relay (C5) exist.

import { createExpose } from "@soksak/plugin-api";
import { createViewBridge, type ViewBridge } from "@soksak/plugin-api/view";
import manifest from "../plugin.json";
import { t } from "./i18n";
import { createRoomCommands, type RoomMode, type RoomState } from "./room/commands";
import type { ElementTarget, RoomHandlers } from "./room/exposure";
import { startRoomPage, type RoomContext } from "./room/page";
import type { RoomPort } from "./room/port";
import { createTrace } from "./tower/trace";
import { createRoomReport } from "./room/report";
import { createArrangementStatus } from "./room/arrangement";
import { HEADER_CSS, createRoomHeader } from "./room/header";
import { readAgentDefinitions, toMemberDefinition, type AgentDataGet, type AgentDefinition } from "./room/definitions";
import { createMemberSessionStore } from "./room/session-store";
import { serialRunner, summonAndArrange, type TriggerDeps } from "./room/trigger";
import { relayInMode, type RelayPorts } from "./room/room-relay";
import { mentionedMembers } from "./room/mention";
import { shareRecord } from "./room/record";
import { createProtocolInjector } from "./room/protocol";
import { parseRoomState, type RoomState as RoomTabState } from "./room/room-state";
import { ownedSessionIds } from "./room/session-channel";
import { rosterFrom, type RosterEntry } from "./room/roster";
import { createRoomOperations } from "./room/operations";
import { createMacroStore } from "./tower/macro";
import { setupTower } from "./tower/header";
import { TOWER_LIVE_TOPIC } from "./tower/modal";

const MODES: { id: RoomMode; key: "modeFacil" | "modeTurn" | "modeSimul" }[] = [
  { id: "facil", key: "modeFacil" },
  { id: "turn", key: "modeTurn" },
  { id: "simul", key: "modeSimul" },
];
const EXPOSE = "soksak-plugin-agents-clubhouse";
// The plugin whose stored definitions and accounts the room reads (agents docs/spec/definitions.md, dependencies in plugin.json).
const AGENTS_PLUGIN = "agents";

const CSS = `
.st{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg,#1e1e1e);color:var(--fg,#ddd);font:13px system-ui,-apple-system,sans-serif;overflow:hidden}
.st-tab{flex:0 0 auto}
.st-tab{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:8px;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.08);cursor:grab;font-size:12px;user-select:none;touch-action:none;transition:opacity .12s,border-color .12s}
.st-tab.off{opacity:.4}
.st-tab.drag{cursor:grabbing;opacity:.95;border-color:currentColor;box-shadow:0 3px 10px rgba(0,0,0,.35);transform:scale(1.06);position:relative;z-index:3}
.st-tab .chk{width:13px;height:13px;border-radius:4px;border:1.5px solid currentColor;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1}
.st-tab .nm{font-weight:600}
.st-roster-rail{display:flex;flex-direction:column;height:100%;min-height:0;overflow-y:auto;padding:8px}
.st-roster-rail .st-tabs{flex-direction:column;align-items:stretch;flex:0 0 auto;overflow:visible}
.st-roster-rail .st-tab{justify-content:flex-start}
.st-crown{cursor:pointer;font-size:10px;opacity:.3;user-select:none;filter:grayscale(1)}
.st-term{cursor:pointer;font-size:10px;opacity:.35;user-select:none}
.st-term:hover{opacity:.85}
.st-crown:hover{opacity:.7}
.st-crown.on{opacity:1;filter:none}
.st-msgs{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.st-row{display:flex;flex-direction:column;gap:3px;max-width:88%}
.st-row.user{align-self:flex-end;align-items:flex-end}
.st-row.assistant{align-self:flex-start}
.st-bubble{padding:8px 11px;border-radius:10px;white-space:pre-wrap;word-break:break-word;line-height:1.45}
.st-row.user .st-bubble{background:#2d6cdf;color:#fff}
.st-row.assistant .st-bubble{background:rgba(127,127,127,.14)}
.st-who{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:10.5px;color:var(--fg3,#888);padding:0 4px}
.st-who-name{font-weight:600}
.st-who-time{font-weight:400;opacity:.75;font-variant-numeric:tabular-nums}
.st-think{cursor:pointer;font-weight:400;font-size:10px;color:var(--fg3,#888);border:1px solid rgba(127,127,127,.3);border-radius:6px;padding:0 5px;user-select:none}
.st-think:hover{border-color:rgba(127,127,127,.55)}
.st-think.open{color:var(--fg2,#bbb);background:rgba(127,127,127,.12)}
.st-think-body{align-self:flex-start;max-width:88%;margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--fg3,#888);background:rgba(127,127,127,.06);border-left:2px solid rgba(127,127,127,.35);border-radius:4px;padding:6px 9px;white-space:pre-wrap;word-break:break-word}
.st-tool{align-self:flex-start;max-width:88%;border:1px solid rgba(127,127,127,.25);border-radius:8px;padding:6px 9px;font-size:12px;background:rgba(127,127,127,.06)}
.st-pending{align-self:flex-start;font-size:11px;color:var(--fg3,#888);display:flex;align-items:center;gap:6px}
.st-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:st-pulse 1.1s ease-in-out infinite}
.st-fail{align-self:flex-start;max-width:88%;font-size:11.5px;color:var(--danger-soft,#d77);border:1px solid var(--danger-soft,#d77);border-radius:8px;padding:6px 9px;white-space:pre-wrap;word-break:break-word;opacity:.85}
.st-box-time{display:block;text-align:right;font-size:9px;opacity:.5;margin-top:3px;font-variant-numeric:tabular-nums}
@keyframes st-pulse{0%,100%{opacity:.25}50%{opacity:1}}
/* 지속 활동 인디케이터 — running 인데 활성 스트리밍 발화가 없는 구간(백그라운드 작업 대기·턴
   사이·다음 발화 준비)에 "작업 중…"을 항상 보여 대화가 멈춘 듯 보이지 않게 한다. 활성 스트리밍
   땐 per-turn .st-pending(응답 중…)이 담당하므로 이건 actives 가 빌 때만 뜬다. */
.st-busy{display:none;align-items:center;gap:6px;font-size:11px;color:var(--acc,#0a6fde);padding:0 12px 8px;flex:0 0 auto}
.st-in{display:flex;gap:8px;padding:8px 10px;border-top:1px solid rgba(127,127,127,.2);flex:0 0 auto;position:relative}
.st-mention{position:absolute;left:10px;bottom:calc(100% + 4px);min-width:160px;background:var(--card,#262626);border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.4);z-index:20}
.st-mention-item{display:flex;align-items:center;gap:5px;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:12.5px}
.st-mention-item.on{background:rgba(127,127,127,.2)}
.st-mention-at{opacity:.6}
.st-mention-nm{font-weight:600;color:var(--fg,#ddd)}
.st-in textarea{flex:1;resize:none;background:rgba(127,127,127,.1);color:inherit;border:1px solid rgba(127,127,127,.25);border-radius:7px;padding:7px 9px;font:inherit;min-height:20px;max-height:120px}
.st-in button{background:#2d6cdf;color:#fff;border:0;border-radius:7px;padding:0 14px;cursor:pointer;font:inherit;font-weight:600}
.st-cut{font-weight:400;opacity:.7;font-size:9px;font-style:italic} /* 참견으로 중단된 부분응답 표식 */
.st-row.queued .st-bubble{opacity:.45;border:1px dashed rgba(255,255,255,.4)} /* 대기 중 사람 입력(미반영) */
.st-queued-tag{font-weight:400;opacity:.7;font-size:10px;font-style:italic}
.st-modal{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50}
.st-modal-box{background:var(--card,#262626);border:1px solid rgba(127,127,127,.4);border-radius:12px;padding:16px 18px;max-width:300px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.st-modal-title{font-weight:700;font-size:13px;margin-bottom:4px}
.st-modal-msg{font-size:12px;color:var(--fg3,#aaa);margin-bottom:14px;line-height:1.4}
.st-modal-btns{display:flex;gap:6px;flex-wrap:wrap}
.st-modal-btn{flex:1;min-width:74px;appearance:none;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.1);color:inherit;border-radius:7px;padding:7px 8px;font:inherit;font-size:12px;cursor:pointer}
.st-modal-btn:hover{background:rgba(127,127,127,.2)}
.st-modal-btn.primary{background:#2d6cdf;border-color:#2d6cdf;color:#fff;font-weight:600}
`;



// The page bootstrap. Errors of the page and of its start go through the window error display (tab.error, src/room/report.ts),
// which shows them and writes them to the application log; reports that come before the bridge exists wait for it.
const roomReport = createRoomReport();
const report = roomReport.report;
let bridge: ViewBridge | null = null;

const handler = window.webkit.messageHandlers["sok-view"];
bridge = createViewBridge({
  handler,
  report: (event) => {
    if (event.kind !== "open-calls") report("calls", JSON.stringify(event));
  },
});
roomReport.attach(bridge);
addEventListener("error", (event) => report("page", String(event.error?.message ?? event.message)));
addEventListener("unhandledrejection", (event) => report("rejection", String(event.reason?.message ?? event.reason)));

const live = new Map<string, Set<(payload: unknown) => void>>();
const room: RoomPort = {
  commands: { execute: (name, params) => bridge!.calls.request(name, params) },
  report,
  declaredCommands: () => manifest.exposes.commands.map((c) => ({ name: c.name, description: c.description })),
  live: {
    on(topic, listener) {
      if (!live.has(topic)) live.set(topic, new Set());
      live.get(topic)!.add(listener);
      return { dispose: () => void live.get(topic)?.delete(listener) };
    },
    emit(topic, payload) {
      for (const listener of [...(live.get(topic) ?? [])]) listener(payload);
    },
  },
  onTheme(listener) {
    const theme = bridge!.runtime.theme(() => listener());
    return {
      dispose: () =>
        void theme.dispose.then(
          (off) => off(),
          (error: unknown) => report("theme listener", String((error as Error)?.message ?? error)),
        ),
    };
  },
};

const expose = createExpose(
  {
    register: (kind, name) => (kind === "command" ? Promise.resolve() : bridge!.exposure.register(kind, name).then(() => undefined)),
    onRequest: (answer) =>
      bridge!.runtime.native.on("exposure-request", ({ id, surface, method, params }) => {
        if (surface !== window.sokSurface?.surface) {
          report("exposure", `request ${id} names surface ${surface}, not ${window.sokSurface?.surface}`);
          return;
        }
        answer({ id, method, params });
      }),
    reply: (id, payload) => bridge!.exposure.reply(id, payload),
    changed: (name, value, version) => bridge!.exposure.changed(name, value, version),
    report: (text) => Promise.resolve(report("exposure", text)),
  },
  () => window.sokSurface?.declarations,
);

// The room of the page: the roster tabs, the conversation mode, the control tower button and the composer. Its elements and
// status are the handlers that startRoomPage registers.
async function buildRoom({ settings, collections }: RoomContext): Promise<RoomHandlers> {
  const lang = navigator.language.startsWith("ko") ? "ko" : "en";
  const modeSetting = settings.kibitzDefault;
  if (modeSetting !== "facil" && modeSetting !== "turn" && modeSetting !== "simul") {
    throw new Error(`settings.kibitzDefault must be facil, turn or simul, got ${JSON.stringify(modeSetting)}`);
  }
  // The state of this room tab, which core keeps per tab across a restart (docs/spec/room.md#restart).
  const saved = parseRoomState(await bridge!.calls.request("tab.state.read", null));
  let mode: RoomMode = saved?.mode ?? modeSetting;
  // The roster of the saved state orders and checks the first roster that the definitions give.
  let seed: RosterEntry[] = (saved?.roster ?? []).map((entry) => ({ id: entry.id, name: "", checked: entry.checked }));
  const conversation: RoomTabState["conversation"] = [...(saved?.conversation ?? [])];
  // The member sessions that this room opened, and the sessions that received the room protocol.
  const roomSessions = new Set<string>(saved?.sessions ?? []);
  const taughtSessions = new Set<string>(saved?.taught ?? []);
  const persist = (): void => {
    const value: RoomTabState = {
      roster: roster.map((entry) => ({ id: entry.id, checked: entry.checked })),
      mode,
      conversation,
      sessions: [...roomSessions],
      taught: [...taughtSessions],
    };
    bridge!.calls.request("tab.state.write", value).catch((error: unknown) => report("room tab state", String((error as Error)?.message ?? error)));
  };
  // The roster lists the agent definitions of the agents plugin (C13); it is empty until the status arrives.
  const roster: RosterEntry[] = [];
  let definitions: AgentDefinition[] = [];
  // The ids of the sessions that core.sessions lists as open, and the summons that run one after the other (C3, C4).
  const openSessionIds = new Set<string>();
  const runTrigger = serialRunner();
  // The transport is ready while a checked member has an open session; the composer takes a message only then (C5).
  const transport: { state: "unavailable" | "ready"; reason: string } = { state: "unavailable", reason: t("transportUnavailable", lang) };
  const transportListeners = new Set<(value: { state: "unavailable" | "ready"; reason: string }) => void>();
  const arrangement = createArrangementStatus();
  const state = (): RoomState => ({
    mode,
    roster: roster.map((r) => ({ id: r.id, checked: r.checked })),
    transport: { ...transport },
  });

  const style = document.createElement("style");
  style.textContent = HEADER_CSS + CSS;
  const root = el("div", "st");
  const header = createRoomHeader(manifest.name, t("towerTitle", lang), transport.reason);
  const { bar, tabs: tabsEl, kib, tower: towerButton } = header;
  const msgs = el("div", "st-msgs");
  const composer = el("div", "st-in");
  const input = document.createElement("textarea");
  input.placeholder = t("placeholder", lang);
  input.disabled = true;
  input.title = transport.reason;
  const send = document.createElement("button");
  send.type = "button";
  send.textContent = t("sendBtn", lang);
  send.disabled = true;
  send.title = transport.reason;
  composer.append(input, send);
  let busy = false;
  // Sets the transport state and the composer. A status subscriber receives each new value.
  const setTransport = (ready: boolean): void => {
    transport.state = ready ? "ready" : "unavailable";
    transport.reason = t(ready ? "transportReady" : "transportUnavailable", lang);
    header.setStatus(transport.reason);
    input.disabled = !ready;
    input.title = transport.reason;
    send.disabled = !ready || busy;
    send.title = transport.reason;
    for (const listener of [...transportListeners]) listener({ ...transport });
  };
  root.append(bar, msgs, composer);
  document.head.append(style);
  document.body.style.cssText = "margin:0;height:100%";
  document.body.replaceChildren(root);

  // Whether the pointer moved a roster tab since its press; the click that ends a drag is no check.
  let dragged = false;
  const failed = (where: string) => (error: unknown) => report(where, String((error as Error)?.message ?? error));
  // A binding is refused only for an undeclared command; the refusal is reported.
  const bound = (binding: Promise<unknown>, where: string): void => void binding.catch(failed(`bind ${where}`));
  function renderTabs(): void {
    tabsEl.replaceChildren();
    for (const entry of roster) {
      const tab = el("span", `st-tab${entry.checked ? "" : " off"}`);
      tab.dataset.id = entry.id;
      tab.dataset.expose = `${EXPOSE}.tab`;
      tab.append(elText("span", entry.checked ? "✓" : "", "chk"), elText("span", entry.name, "nm"));
      // A click runs member.set with the toggled state; the click that ends a drag runs nothing (docs/spec/room.md#commands).
      bound(
        expose.bind(tab, `${EXPOSE}.member.set`, () => ({ id: entry.id, checked: !entry.checked }), {
          when: () => !dragged,
          failed: failed("member.set"),
        }),
        "member.set",
      );
      tab.addEventListener("pointerdown", (down) => {
        const startX = down.clientX;
        dragged = false;
        const onMove = (ev: PointerEvent) => {
          if (!dragged && Math.abs(ev.clientX - startX) < 4) return;
          dragged = true;
          const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(".st-tab");
          if (!over || over.dataset.id === undefined || over.dataset.id === entry.id) return;
          const index = roster.findIndex((r) => r.id === over.dataset.id);
          expose.run(`${EXPOSE}.member.move`, { id: entry.id, index }).catch(failed("member.move"));
        };
        const onUp = () => {
          removeEventListener("pointermove", onMove);
          removeEventListener("pointerup", onUp);
        };
        addEventListener("pointermove", onMove);
        addEventListener("pointerup", onUp);
      });
      tabsEl.append(tab);
    }
  }

  function renderMode(): void {
    kib.replaceChildren();
    for (const option of MODES) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t(option.key, lang);
      button.dataset.mode = option.id;
      button.classList.toggle("on", option.id === mode);
      bound(expose.bind(button, `${EXPOSE}.mode.set`, { mode: option.id }, { failed: failed("mode.set") }), "mode.set");
      kib.append(button);
    }
  }

  renderTabs();
  renderMode();

  // The member sessions of the room: the owned session of each checked definition, while core.sessions lists it as open (C3).
  const sessions = createMemberSessionStore(collections);
  if (sessions === undefined) throw new Error("the room needs project data for its member sessions");
  let memberSessions = new Map<string, string>();
  const refreshMembers = async (): Promise<void> => {
    const checked = new Set(roster.filter((entry) => entry.checked).map((entry) => entry.id));
    const next = new Map<string, string>();
    for (const definition of definitions) {
      if (!checked.has(definition.id)) continue;
      const stored = await sessions.get(definition.id);
      if (stored !== null && openSessionIds.has(stored.sessionId)) next.set(definition.id, stored.sessionId);
    }
    memberSessions = next;
    setTransport(next.size > 0);
  };
  const refreshReported = (): void => {
    refreshMembers().catch((error: unknown) => report("room members", String((error as Error)?.message ?? error)));
  };

  // The definitions are the stored data of the agents plugin (C17): read with runtime.data.get {key, plugin: "agents"} (core F1075), and
  // read again on each data change. The roster follows them; a stored value of another form is reported through the room error path.
  const agentData: AgentDataGet = (key) => bridge!.calls.request("runtime.data.get", { key, plugin: AGENTS_PLUGIN });
  const refreshDefinitions = (): void => {
    readAgentDefinitions(agentData)
      .then((next) => {
        definitions = next;
        roster.splice(0, roster.length, ...rosterFrom(definitions, roster.length === 0 ? seed : roster));
        renderTabs();
        refreshReported();
        // At start the checked members of the saved state are summoned: a member with an open session of this room is reattached,
        // and only a member without one opens a session (docs/spec/room.md#restart).
        if (seed.length > 0 && roster.some((entry) => entry.checked)) summon();
        seed = [];
      })
      .catch((error: unknown) => report("agents.definitions", String((error as Error)?.message ?? error)));
  };
  bridge!.runtime.data.on(() => refreshDefinitions());
  refreshDefinitions();

  // The value of core.sessions, which the relay reads, and the listeners that the relay watches it with.
  let sessionsValue: unknown = [];
  const sessionListeners = new Set<(value: unknown) => void>();
  // The room reattaches only to the sessions that it owns; a summon waits for the first value, so that it opens no member whose
  // session is open (docs/spec/room.md#restart).
  const surface = window.sokSurface?.surface;
  if (typeof surface !== "string" || surface === "") throw new Error("the room needs the surface identifier of its start values");
  let sessionsArrived: () => void = () => {};
  const sessionsReady = new Promise<void>((resolve) => (sessionsArrived = resolve));
  Promise.resolve(bridge!.runtime.status.watch("core.sessions", (value: unknown) => {
    openSessionIds.clear();
    try {
      for (const session of ownedSessionIds(value, surface)) openSessionIds.add(session);
    } catch (error) {
      report("core.sessions", String((error as Error)?.message ?? error));
    }
    sessionsArrived();
    sessionsValue = value;
    for (const listener of [...sessionListeners]) listener(value);
    refreshReported();
  })).catch((error: unknown) => report("core.sessions", `status watch: ${String((error as Error)?.message ?? error)}`));

  // A check of the roster summons the checked members and arranges the opened ones (C3-1, C4). Each run waits for the previous one,
  // and the member sessions are read again after it.
  const trigger: TriggerDeps = {
    summon: { room, sessions, now: () => Date.now(), openSessions: async () => [...openSessionIds] },
    arrange: { commands: room.commands, report },
    status: arrangement,
    size: () => ({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio }),
    ended: (session) => roomSessions.has(session) && !openSessionIds.has(session),
  };
  const summon = (): void => {
    const checked = roster.filter((entry) => entry.checked).map((entry) => entry.id);
    runTrigger(async () => {
      await sessionsReady;
      await summonAndArrange(trigger, definitions.map(toMemberDefinition), checked);
      // The arrangement closed the tabs of the ended sessions; the room keeps the sessions that are open.
      for (const session of [...roomSessions]) if (!openSessionIds.has(session)) roomSessions.delete(session);
    })
      .then(refreshMembers)
      .then(() => {
        for (const session of memberSessions.values()) roomSessions.add(session);
        persist();
      })
      .then(teachMembers)
      .catch((error: unknown) => report("room summon", String((error as Error)?.message ?? error)));
  };

  // A message goes to the checked members whose session is open, by the mode of the room and the mentions of the message
  // (docs/spec/room.md). The answers are the screens of the members after their turns, shown as text in the conversation.
  const relayPorts: RelayPorts = {
    commands: room.commands,
    sessions: () => sessionsValue,
    watchSessions: (listener) => {
      sessionListeners.add(listener);
      return () => void sessionListeners.delete(listener);
    },
  };
  // The conversation names the owner or a member by its identifier and shows the roster name of the member.
  const showMessage = (speaker: string, text: string): void => {
    const who = speaker === "owner" ? (lang === "ko" ? "나" : "You") : (roster.find((entry) => entry.id === speaker)?.name ?? speaker);
    msgs.append(elText("div", `${who}: ${text}`, "st-msg"));
    msgs.scrollTop = msgs.scrollHeight;
  };
  const appendMessage = (speaker: string, text: string): void => {
    conversation.push({ speaker, text });
    showMessage(speaker, text);
    persist();
  };
  for (const entry of conversation) showMessage(entry.speaker, entry.text);
  // Each member session receives the room protocol once, after it first reports idle and before its first relayed message
  // (docs/spec/room.md#room-protocol). The injector reports each refusal itself and resolves with the outcome of each member.
  const protocol = createProtocolInjector(relayPorts, report, {
    taught: [...taughtSessions],
    onTaught: (session) => {
      taughtSessions.add(session);
      persist();
    },
  });
  type OpenMember = { id: string; name: string; session: string };
  const openMembers = (): OpenMember[] =>
    roster
      // The stored relation is read again after each change of core.sessions; until then a session that has ended is left out.
      .filter((entry) => entry.checked && memberSessions.has(entry.id) && openSessionIds.has(memberSessions.get(entry.id)!))
      .map((entry) => ({ id: entry.id, name: entry.name, session: memberSessions.get(entry.id)! }));
  // Resolves with the members whose protocol turn has ended; a refused member receives no relayed message.
  const taughtMembers = async (members: OpenMember[]): Promise<OpenMember[]> => {
    const outcomes = await Promise.all(
      members.map((member) => protocol.ensure(member, members.filter((other) => other !== member).map((other) => other.name))),
    );
    return members.filter((_, index) => outcomes[index].ok);
  };
  const teachMembers = async (): Promise<void> => {
    await taughtMembers(openMembers());
  };
  // A message runs message.send from the send button and from Enter without Shift in the input (docs/spec/room.md#commands).
  // The relay resolves with the answer of each member in relay order.
  const relayMessage = async (text: string): Promise<{ id: string; text: string }[]> => {
    const targets = openMembers();
    const taught = await taughtMembers(targets);
    if (taught.length === 0) throw new Error("no member has the room protocol");
    const answers = await relayInMode(relayPorts, mode, taught, text);
    const shown = answers.map((answer) => {
      const member = targets.find((entry) => entry.id === answer.id)!;
      appendMessage(member.id, answer.text);
      return { member, text: answer.text };
    });
    // A mention narrowed the receivers: the other members receive the record of the exchange and answer nothing that the room
    // shows (docs/spec/room.md#shared-record).
    const mentioned = mentionedMembers(text, taught);
    if (mentioned.length > 0) {
      const others = taught.filter((entry) => !mentioned.includes(entry));
      await shareRecord(relayPorts, { message: text, answers: shown }, others, report);
    }
    return shown.map((one) => ({ id: one.member.id, text: one.text }));
  };
  const operations = createRoomOperations({
    roster,
    mode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    changed: () => {
      renderTabs();
      renderMode();
      persist();
    },
    summon,
    openMembers: () => openMembers().length,
    accept: (text) => {
      input.value = "";
      appendMessage("owner", text);
    },
    busy: (value) => {
      busy = value;
      // A relay in progress keeps the tab loaded: an unload would end the page that waits for the turns.
      bridge!.calls.request("tab.keep", { reason: "busy", on: value }).catch((error: unknown) => report("tab keep", String((error as Error)?.message ?? error)));
      send.disabled = value || transport.state !== "ready";
    },
    relay: relayMessage,
  });
  bound(expose.bind(send, `${EXPOSE}.message.send`, () => ({ text: input.value }), { failed: failed("room relay") }), "message.send");
  // Enter without Shift sends; the newline that it would insert is prevented. Enter during an IME composition commits the text.
  const sendKey = (event: KeyboardEvent): boolean => event.key === "Enter" && !event.shiftKey && !event.isComposing;
  input.addEventListener("keydown", (event) => {
    if (sendKey(event)) event.preventDefault();
  });
  bound(
    expose.bind(input, `${EXPOSE}.message.send`, () => ({ text: input.value }), {
      event: "keydown",
      when: (event: Event) => sendKey(event as KeyboardEvent),
      failed: failed("room relay"),
    }),
    "message.send",
  );

  // The trace and the macros of the tower are project data of the room, kept per project root.
  const trace = createTrace(collections, { sessionId: sessionIdOf(), report });
  const macros = createMacroStore(collections, { sessionId: sessionIdOf() });
  const tower = setupTower(room, towerButton, t("towerTitle", lang), () => lang, trace, macros);
  addEventListener("pagehide", () => tower.dispose());
  // A click on the tower button runs tower.set with the state opposite to the current one (docs/spec/room.md#commands).
  bound(expose.bind(towerButton, `${EXPOSE}.tower.set`, () => ({ open: !tower.isOpen() }), { failed: failed("tower.set") }), "tower.set");

  const tabTargets = (): object[] => [...tabsEl.querySelectorAll<HTMLElement>(".st-tab")];
  const elements: Record<string, ElementTarget> = {
    [`${EXPOSE}.send`]: send,
    [`${EXPOSE}.input`]: input,
    [`${EXPOSE}.tab`]: tabTargets,
    [`${EXPOSE}.mode`]: kib,
    [`${EXPOSE}.tower`]: towerButton,
  };
  return {
    commands: { ...createRoomCommands({ tower, trace, mode: () => mode, state }), ...operations },
    elements,
    statuses: {
      [`${EXPOSE}.arrangement`]: {
        read: () => arrangement.read(),
        subscribe: (listener) => arrangement.subscribe(listener).dispose,
      },
      [`${EXPOSE}.transport`]: {
        read: () => ({ ...transport }),
        subscribe: (listener) => {
          transportListeners.add(listener);
          return () => void transportListeners.delete(listener);
        },
      },
    },
  };
}

function sessionIdOf(): string {
  const root = window.sokSurface?.project?.root;
  return typeof root === "string" && root !== "" ? root : "default";
}

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

function elText(tag: string, text: string, cls = ""): HTMLElement {
  const node = el(tag, cls);
  node.textContent = text;
  return node;
}

startRoomPage(
  {
    manifest,
    settings: async () => (await bridge!.runtime.settings.read()) as Record<string, unknown>,
    data: bridge!.runtime.data,
    expose,
    commands: bridge!.commands,
  },
  buildRoom,
).catch((error: unknown) => report("start", String((error as Error)?.message ?? error)));
