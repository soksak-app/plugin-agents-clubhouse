// soksak-plugin-agents-clubhouse — the room page (ui/clubhouse.html, the view surface of plugin.json).
//
// The page starts through the view bridge of @soksak/plugin-api/view (core docs/spec/native-surfaces.md#view-surfaces): it
// reads the settings and the project data, builds the room (member cards and the conversation), and then
// registers the commands, elements and status that plugin.json declares (src/room/page.ts).

import { createExpose } from "@soksak/plugin-api";
import { createViewBridge, type ViewBridge } from "@soksak/plugin-api/view";
import manifest from "../plugin.json";
import { t, tp } from "./i18n";
import { createRoomCommands, type RoomState } from "./room/commands";
import type { ElementTarget, RoomHandlers } from "./room/exposure";
import { startRoomPage, type RoomContext } from "./room/page";
import type { RoomPort } from "./room/port";
import { createRoomReport } from "./room/report";
import { closeEndedTabs, createArrangementStatus, endedRoomSession } from "./room/arrangement";
import { HEADER_CSS, createRoomHeader, fillGroupSelect } from "./room/header";
import { memberLaunch } from "./room/isolation";
import { conversationView, elapsedLabel, nextLabelChange } from "./room/bubbles";
import { createFollow, type FollowState } from "./room/follow";
import { createStopState } from "./room/stop-state";
import { readAgentDefinitions, startFolders, toMemberDefinition, type AgentDataGet, type AgentDefinition } from "./room/definitions";
import { createMemberSessionStore } from "./room/session-store";
import { serialRunner, summonAndArrange, type TriggerDeps } from "./room/trigger";
import { createOpenedSessions } from "./room/summon";
import { conversationTurnsOf, relayMessage as relayToReceivers, type RelayPorts, type RoomMode } from "./room/room-relay";
import { createSubmitQueue } from "./room/submit-queue";
import { CLAIM_COMMAND, RELEASE_COMMAND, REPORT_COMMAND, createWorkReports, type WorkReports } from "./room/work-reports";
import { answerSections } from "./room/sections";
import { createRoomRecord, leaderRoute, settledRelay } from "./room/room-record";
import { agentFileText, agentNameOf, roleFileOf } from "./room/agent-file";
import { createConversationStatus, waitLabel } from "./room/conversation-status";
import { createRoomCheck, type RoomCheckValue } from "./room/check";
import { createMemberOpen, relayGroup } from "./room/member-open";
import { MEMORY_INDEX_LIMIT, createProtocolInjector, type AgentPlace, type MemberWorktree } from "./room/protocol";
import { parseRoomState, serializedRoomState, type RoomState as RoomTabState } from "./room/room-state";
import { ownedSessionIds, sessionProgram, shownByOf } from "./room/session-channel";
import { answerQuestion, questionChoices, readQuestion, showMember } from "./room/question";
import { insertMention, mentionCandidates, mentionQuery } from "./room/mention-hint";
import { groupMembers, readGroups, type AgentGroup, type RoomMember } from "./room/members";
import { initialsOf, memberState } from "./room/member-card";
import { createLoginGate } from "./room/login";
import { roomTitle } from "./room/title";
import { measuredCardSize } from "./room/card-size";
import { createRoomOperations } from "./room/operations";
import { ANSWER_COMMAND, createAnswerChannel } from "./room/answer";

const EXPOSE = "soksak-plugin-agents-clubhouse";
// The plugin whose stored definitions and accounts the room reads (agents docs/spec/definitions.md, dependencies in plugin.json).
const AGENTS_PLUGIN = "agents";

// The number of member colors; a member takes the color of its place in the group modulo this number.
const MEMBER_COLORS = 6;

const CSS = `
.st{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg,#1e1e1e);color:var(--fg,#ddd);font:13px system-ui,-apple-system,sans-serif;overflow:hidden}
.st-tab{min-width:0;box-sizing:border-box}
.st-tab{display:inline-flex;align-items:center;gap:7px;padding:4px 9px 4px 5px;border-radius:9px;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.06);font-size:12px}
.st-tab.none{border-style:dashed}
.st-tab .ini{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:rgba(127,127,127,.22);flex:0 0 auto}
.st-tab .txt{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.st-tab .nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-tab.problem .state{white-space:normal}
.st-tab .sub{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg3,#888);white-space:nowrap}
.st-msgs-box{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.st-pill{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);padding:3px 12px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:var(--card,#2a2a2a);color:var(--fg,#ddd);font-size:11.5px;cursor:pointer}
.st-pill[hidden]{display:none}
.st-msgs{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.st-row{display:flex;flex-direction:column;gap:3px;max-width:88%}
.st-row.user{align-self:flex-end;align-items:flex-end}
.st-row.assistant{align-self:flex-start}
.st-bubble{padding:8px 11px;border-radius:10px;white-space:pre-wrap;word-break:break-word;line-height:1.45}
.st-row.user .st-bubble{background:var(--acc,#2d6cdf);color:#fff}
.st-row[data-color="0"] .st-bubble{background:color-mix(in srgb,var(--card,#2a2a2a) 80%,#4f9d69)}
.st-row[data-color="1"] .st-bubble{background:color-mix(in srgb,var(--card,#2a2a2a) 80%,#c7853a)}
.st-row[data-color="2"] .st-bubble{background:color-mix(in srgb,var(--card,#2a2a2a) 80%,#8a63c9)}
.st-row[data-color="3"] .st-bubble{background:color-mix(in srgb,var(--card,#2a2a2a) 80%,#3a9fb0)}
.st-row[data-color="4"] .st-bubble{background:color-mix(in srgb,var(--card,#2a2a2a) 80%,#c15b78)}
.st-row[data-color="5"] .st-bubble{background:color-mix(in srgb,var(--card,#2a2a2a) 80%,#8f9b3c)}
.st-who-role{opacity:.8}
.st-section+.st-section{margin-top:6px;padding-top:6px;border-top:1px solid rgba(127,127,127,.25)}
.st-section-to{font-size:10.5px;font-weight:600;color:var(--fg3,#888)}
.st-section-text{white-space:pre-wrap}
.st-note{font-size:11px;color:var(--fg3,#888);padding:0 6px}
.st-system{align-self:center;font-size:11px;color:var(--fg3,#888);text-align:center;max-width:88%}
.st-round{display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--fg3,#888)}
.st-round::before,.st-round::after{content:"";flex:1;border-top:1px solid rgba(127,127,127,.25)}
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
.st-question{align-self:stretch;border:1px solid var(--warn,#d9a441);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.st-question-title{font-size:12px;color:var(--warn,#d9a441)}
.st-question-screen{margin:0;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;color:var(--fg2,#ccc);max-height:220px;overflow:auto}
.st-question-answer{align-self:flex-start}
.st-question-choices{display:flex;flex-wrap:wrap;gap:6px}
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
.st-in button{background:var(--acc,#2d6cdf);color:#fff;border:0;border-radius:7px;padding:0 14px;cursor:pointer;font:inherit;font-weight:600}
.st-in button:disabled{opacity:.4;cursor:default}
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

const room: RoomPort = {
  commands: { execute: (name, params) => bridge!.calls.request(name, params) },
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

// The room of the page: the member cards, the conversation and the composer. Its elements and
// status are the handlers that startRoomPage registers.
async function buildRoom({ settings, collections }: RoomContext): Promise<RoomHandlers> {
  const lang = navigator.language.startsWith("ko") ? "ko" : "en";
  // The largest number of turns that answers start for one message (docs/spec/room.md#conversation).
  const conversationTurns = conversationTurnsOf(settings.conversationTurns);
  // Whether each member starts with the flag of its program that accepts every request (docs/spec/room.md#accept-all).
  if (settings.acceptAll !== "ask" && settings.acceptAll !== "accept") {
    throw new Error(`settings.acceptAll must be ask or accept, got ${JSON.stringify(settings.acceptAll)}`);
  }
  const acceptAll = settings.acceptAll === "accept";
  if (settings.kibitzDefault !== "turn" && settings.kibitzDefault !== "simul") {
    throw new Error(`settings.kibitzDefault must be turn or simul, got ${JSON.stringify(settings.kibitzDefault)}`);
  }
  // The state of this room tab, which core keeps per tab across a restart (docs/spec/room.md#restart).
  const saved = parseRoomState(await bridge!.calls.request("tab.state.read", null));
  // default: a room tab without a state shows its member grid unfolded (docs/spec/room.md#restart).
  let folded = saved?.folded ?? false;
  // The worktree of each member that has one (docs/spec/room.md#worktrees).
  const worktrees = new Map<string, MemberWorktree>(Object.entries(saved?.worktrees ?? {}));
  // The memory folder of the project of each started member, which its memory line names (docs/spec/room.md#memory).
  const memories = new Map<string, string>();
  // The assigned group of the agents plugin; a room tab without a state has none (docs/spec/room.md#group).
  let group: string | null = saved?.group ?? null;
  // The conversation mode; a room tab without a state takes the setting kibitzDefault (docs/spec/room.md#modes).
  let mode: RoomMode = saved?.mode ?? settings.kibitzDefault;
  // The groups of the agents plugin, read with the definitions.
  let groups: Record<string, AgentGroup> = {};
  const conversation: RoomTabState["conversation"] = [...(saved?.conversation ?? [])];
  // The member sessions that this room opened, and the sessions that received the room protocol.
  const roomSessions = new Set<string>(saved?.sessions ?? []);
  const taughtSessions = new Set<string>(saved?.protocolSessions ?? []);
  // The last write of the tab state, which a turn line waits for (docs/spec/room.md#restart).
  let lastWrite: Promise<void> = Promise.resolve();
  // The tab title of the room follows its assigned group (C149); a refused title is reported through the room error path.
  let shownTitle: string | null = null;
  const showTitle = (): void => {
    const title = roomTitle(group === null ? null : (groups[group]?.name ?? null), manifest.name);
    if (title === shownTitle) return;
    shownTitle = title;
    void bridge!.calls.request("tab.title", title).catch((error: unknown) => report("tab title", String((error as Error)?.message ?? error)));
  };
  const persist = (): void => {
    showTitle();
    const value: RoomTabState = {
      group,
      mode,
      folded,
      conversation,
      sessions: [...roomSessions],
      protocolSessions: [...taughtSessions],
      addressed: record.addressed(),
      delivered: record.delivered(),
      sent: record.sent(),
      turns: answers.tokens(),
      worktrees: Object.fromEntries(worktrees),
    };
    let json: string;
    try {
      json = serializedRoomState(value);
    } catch (error) {
      report("room tab state", String((error as Error)?.message ?? error));
      lastWrite = Promise.reject(error);
      lastWrite.catch(() => {});
      return;
    }
    lastWrite = bridge!.calls.request("tab.state.write", JSON.parse(json)).then(() => undefined);
    lastWrite.catch((error: unknown) => report("room tab state", String((error as Error)?.message ?? error)));
  };
  // The members of the room are the members of the assigned group (docs/spec/room.md#group); they are empty until the data arrives.
  let members: RoomMember[] = [];
  let definitions: AgentDefinition[] = [];
  // The open session of each member of the room, read again after each change of core.sessions (C3).
  let memberSessions = new Map<string, string>();
  // The members that wait for the login of their home (docs/spec/room.md#login).
  const loginGate = createLoginGate({ run: async (program, args) => bridge!.runtime.program.run(program, args) });
  // The ids of the sessions that core.sessions lists as open, and the summons that run one after the other (C3, C4).
  const openSessionIds = new Set<string>();
  const runTrigger = serialRunner();
  // The transport is ready while a member has an open session; the composer takes a message only then (C5).
  type Transport = { state: "unavailable" | "ready"; reason: string; notIsolated: string[] };
  const transport: Transport = { state: "unavailable", reason: t("transportUnavailable", lang), notIsolated: [] };
  const transportListeners = new Set<(value: Transport) => void>();
  // The check of the members (C152, docs/spec/room.md#check), published as the status check.
  const checkListeners = new Set<(value: RoomCheckValue) => void>();
  const roomCheck = createRoomCheck({
    run: async (folder, cli) => {
      const reply = await bridge!.runtime.program.run("member-check", ["check", folder, cli]);
      if (reply.code !== 0) throw new Error(`member-check ${folder} ${cli} exited with ${reply.code}: ${reply.stderr.trim()}`);
      const answer = JSON.parse(reply.stdout) as { folder: unknown; cli: unknown };
      const reason = (one: unknown): string | null => {
        if (one === null || typeof one === "string") return one;
        throw new Error(`member-check answered ${reply.stdout.trim()}`);
      };
      return { folder: reason(answer.folder), cli: reason(answer.cli) };
    },
    loginProblem: (id) => {
      const home = definitions.find((one) => one.id === id)?.home;
      return loginGate.needs(id) && home ? `the home ${home.folder} has no login` : null;
    },
    session: (id) => {
      const session = memberSessions.get(id);
      // A session that core.sessions no longer lists is no open session; a program state of another form fails the check.
      if (session === undefined || !Array.isArray(sessionsValue) || !sessionsValue.some((entry) => entry?.session === session)) return null;
      return { session, reports: sessionProgram(sessionsValue, session) !== null };
    },
    publish: (value) => {
      for (const listener of [...checkListeners]) listener(value);
    },
  });
  const checkedMembers = () =>
    members.flatMap((entry) => {
      const definition = definitions.find((one) => one.id === entry.id);
      return definition === undefined ? [] : [{ id: definition.id, cwd: definition.cwd, program: definition.program }];
    });
  const checkAll = async () => {
    const value = await roomCheck.all(checkedMembers());
    showStates();
    return value;
  };
  // Whether the isolation table isolates the CLI of the member (docs/spec/room.md#isolation).
  const isolatedMember = (id: string): boolean => {
    const definition = definitions.find((entry) => entry.id === id);
    return definition !== undefined && memberLaunch(definition.program, definition.args).isolated;
  };
  const arrangement = createArrangementStatus();
  const state = (): RoomState => ({
    mode,
    group,
    members: members.map((member) => ({ id: member.id, leader: member.leader })),
    transport: { ...transport, notIsolated: [...transport.notIsolated] },
  });

  const style = document.createElement("style");
  style.textContent = HEADER_CSS + CSS;
  const root = el("div", "st");
  const header = createRoomHeader(transport.reason, { fold: t("foldButton", lang), unfold: t("unfoldButton", lang) });
  const { bar, grid: tabsEl, statusBar } = header;
  const msgs = el("div", "st-msgs");
  // The view follows new entries only at the bottom; in reading mode the pill counts the unseen entries (docs/spec/room.md#follow-mode).
  const msgsBox = el("div", "st-msgs-box");
  const pill = el("button", "st-pill") as HTMLButtonElement;
  pill.hidden = true;
  msgsBox.append(msgs, pill);
  // The threshold in points within which the last entry counts as fully visible.
  const BOTTOM_POINTS = 4;
  type ViewState = FollowState & { stopEnabled: boolean };
  const viewListeners = new Set<(value: ViewState) => void>();
  const viewState = (): ViewState => ({ ...follow.state(), stopEnabled: !stop.disabled });
  const follow = createFollow({
    atBottom: () => msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight <= BOTTOM_POINTS,
    scrollToBottom: () => void (msgs.scrollTop = msgs.scrollHeight),
    changed: (value) => {
      pill.hidden = value.following || value.unseen === 0;
      pill.textContent = tp("unseen", lang, { count: String(value.unseen) });
      publishView();
    },
  });
  msgs.addEventListener("scroll", () => follow.scrolled());
  function publishView(): void {
    const value = viewState();
    for (const listener of [...viewListeners]) listener(value);
  }
  // The observer reports each unseen entry that scrolls into view; it observes only entries of the record, keyed by data-index.
  const seen = new IntersectionObserver(
    (records) => {
      for (const entry of records) if (entry.isIntersecting) follow.visible(Number((entry.target as HTMLElement).dataset.index));
    },
    { root: msgs, threshold: 1 },
  );
  let drawnEntries = 0;
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
  // The stop button ends the conversation of the relayed message; it is enabled only while a message is relayed.
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = t("stopBtn", lang);
  stop.disabled = true;
  composer.append(input, send, stop);
  const stopState = createStopState(stop, () => publishView());
  let busy = false;
  // Sets the transport state and the composer. A status subscriber receives each new value.
  const setTransport = (ready: boolean): void => {
    transport.state = ready ? "ready" : "unavailable";
    transport.notIsolated = [...memberSessions.keys()].filter((id) => !isolatedMember(id));
    transport.reason =
      t(ready ? "transportReady" : "transportUnavailable", lang) +
      (transport.notIsolated.length > 0 ? ` ${tp("notIsolated", lang, { members: transport.notIsolated.join(", ") })}` : "");
    header.setStatus(transport.reason);
    input.disabled = !ready;
    input.title = transport.reason;
    send.disabled = !ready || busy;
    send.title = transport.reason;
    for (const listener of [...transportListeners]) listener({ ...transport });
  };
  root.append(bar, msgsBox, statusBar, composer);
  document.head.append(style);
  document.body.style.cssText = "margin:0;height:100%";
  document.body.replaceChildren(root);

  const failed = (where: string) => (error: unknown) => report(where, String((error as Error)?.message ?? error));
  // A binding is refused only for an undeclared command; the refusal is reported.
  const bound = (binding: Promise<unknown>, where: string): void => void binding.catch(failed(`bind ${where}`));
  // The members that the room waits for an answer of; the conversation status gives them once it exists (docs/spec/room.md#header).
  let waitedMembers: () => ReadonlySet<string> = () => new Set();
  // The member part of the header (C138, C140): the group select on the first line, and one card per member in the grid. Choosing a
  // group runs group.set with it (docs/spec/room.md#header).
  header.group.dataset.expose = `${EXPOSE}.group`;
  bound(expose.bind(header.group, `${EXPOSE}.group.set`, () => ({ group: header.group.value }), { event: "change", failed: failed("group.set") }), "group.set");
  const showGroups = (): void => fillGroupSelect(header.group, groups, group, t("groupChoose", lang));
  // The fold button runs members.fold with the toggled fold (docs/spec/room.md#header).
  header.fold.dataset.expose = `${EXPOSE}.fold`;
  bound(expose.bind(header.fold, `${EXPOSE}.members.fold`, () => ({ folded: !folded }), { failed: failed("members.fold") }), "members.fold");
  // The grid lays out its cards again at each change of its width, which the observer reports, and at each draw of the cards.
  const layoutGrid = (): void => header.layout(tabsEl.clientWidth, folded);
  new ResizeObserver(layoutGrid).observe(tabsEl);
  // The mode buttons right of the group select, one per mode, the set mode marked (docs/spec/room.md#modes).
  function renderMode(): void {
    header.modes.replaceChildren();
    for (const option of [{ id: "turn", key: "modeTurn" }, { id: "simul", key: "modeSimul" }] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t(option.key, lang);
      button.dataset.mode = option.id;
      button.classList.toggle("on", option.id === mode);
      bound(expose.bind(button, `${EXPOSE}.mode.set`, { mode: option.id }, { failed: failed("mode.set") }), "mode.set");
      header.modes.append(button);
    }
  }

  function renderTabs(): void {
    showGroups();
    tabsEl.replaceChildren();
    for (const entry of members) {
      const tab = el("span", "st-tab");
      tab.dataset.id = entry.id;
      tab.dataset.expose = `${EXPOSE}.tab`;
      const text = el("span", "txt");
      const sub = el("span", "sub");
      // The leader shows the star U+2B50 before its name (docs/spec/room.md#header).
      text.append(elText("span", entry.leader ? `\u2B50 ${entry.name}` : entry.name, "nm"), sub);
      tab.append(elText("span", initialsOf(entry.name), "ini"), text);
      sub.append(elText("span", "", "state"));
      tabsEl.append(tab);
    }
    showStates();
    layoutGrid();
  }
  // Shows the state of each member card without drawing the cards again.
  function showStates(): void {
    const waited = waitedMembers();
    for (const tab of tabsEl.querySelectorAll<HTMLElement>(".st-tab")) {
      const id = tab.dataset.id!;
      const state = memberState(memberSessions.has(id), waited.has(id));
      tab.classList.toggle("none", state === "none");
      // A member with a problem of the last check shows it in its state line (docs/spec/room.md#check).
      const problem = roomCheck.problemOf(id);
      tab.querySelector(".state")!.textContent = problem ?? t(state === "answering" ? "stateAnswering" : state === "idle" ? "stateIdle" : "stateNone", lang);
      tab.classList.toggle("problem", problem !== null);
    }
  }

  renderTabs();
  renderMode();

  // The member sessions of the room: the owned session of each member, while core.sessions lists it as open (C3).
  // The room reattaches only to the sessions that it owns, and its member relations are kept per room surface (docs/spec/room.md#restart).
  const surface = window.sokSurface?.surface;
  if (typeof surface !== "string" || surface === "") throw new Error("the room needs the surface identifier of its start values");
  if (collections === undefined) throw new Error("the room needs project data for its member sessions");
  const sessions = createMemberSessionStore(collections, surface);
  // The sessions that a summon opened before core.sessions listed them.
  const openedSessions = createOpenedSessions();
  const refreshMembers = async (): Promise<void> => {
    const present = new Set(members.map((entry) => entry.id));
    const next = new Map<string, string>();
    for (const definition of definitions) {
      if (!present.has(definition.id)) continue;
      const stored = await sessions.get(definition.id);
      if (stored !== null && openSessionIds.has(stored.sessionId)) next.set(definition.id, stored.sessionId);
    }
    memberSessions = next;
    // The transport is ready while the assigned group has a member, which opens its session at its first turn (docs/spec/room.md#header).
    setTransport(members.length > 0);
    showStates();
  };
  const refreshReported = (): void => {
    refreshMembers().catch((error: unknown) => report("room members", String((error as Error)?.message ?? error)));
  };

  // The definitions and the groups are the stored data of the agents plugin (C17): read with runtime.data.get {key, plugin: "agents"}
  // (core F1075), and read again on each data change. The members follow the assigned group; a stored value of another form is reported
  // through the room error path.
  const agentData: AgentDataGet = (key) => bridge!.calls.request("runtime.data.get", { key, plugin: AGENTS_PLUGIN });
  const refreshDefinitions = (): void => {
    Promise.all([readAgentDefinitions(agentData, (text) => report("room members", text)), agentData("groups")])
      .then(([next, stored]) => {
        definitions = next;
        groups = readGroups(stored);
        const before = members.map((entry) => entry.id).join("\n");
        members = groupMembers(definitions, groups, group, (text) => report("room group", text));
        setTransport(members.length > 0);
        showTitle();
        renderTabs();
        // The conversation names each member by the name of its definition.
        showConversation();
        refreshReported();
        // A change of the members opens no session: it reattaches the members with an open session of this room and arranges them
        // (docs/spec/room.md#group, docs/spec/room.md#restart).
        if (members.length > 0 && members.map((entry) => entry.id).join("\n") !== before) summon();
      })
      .catch((error: unknown) => report("agents.definitions", String((error as Error)?.message ?? error)));
  };
  // The definitions are data of the agents plugin, whose changes runtime.data.on follows only with {plugin} (C115).
  bridge!.runtime.data.on(() => refreshDefinitions(), { plugin: AGENTS_PLUGIN });
  refreshDefinitions();

  // The value of core.sessions, which the relay reads, and the listeners that the relay watches it with.
  let sessionsValue: unknown = [];
  const sessionListeners = new Set<(value: unknown) => void>();
  // The value of core.roles, which gives the agent file of the role of each definition (docs/spec/room.md#group).
  let rolesValue: unknown = undefined;
  Promise.resolve(bridge!.runtime.status.watch("core.roles", (value: unknown) => {
    rolesValue = value;
  })).catch((error: unknown) => report("core.roles", `status watch: ${String((error as Error)?.message ?? error)}`));
  // A summon waits for the first value, so that it opens no member whose session is open (docs/spec/room.md#restart).
  let sessionsArrived: () => void = () => {};
  const sessionsReady = new Promise<void>((resolve) => (sessionsArrived = resolve));
  Promise.resolve(bridge!.runtime.status.watch("core.sessions", (value: unknown) => {
    openSessionIds.clear();
    try {
      for (const session of ownedSessionIds(value, surface)) openSessionIds.add(session);
      openedSessions.listed(openSessionIds);
    } catch (error) {
      report("core.sessions", String((error as Error)?.message ?? error));
    }
    sessionsArrived();
    sessionsValue = value;
    for (const listener of [...sessionListeners]) listener(value);
    refreshReported();
  })).catch((error: unknown) => report("core.sessions", `status watch: ${String((error as Error)?.message ?? error)}`));

  // A change of the members summons them and arranges the opened ones (C3-1, C4). Each run waits for the previous one, and the member
  // sessions are read again after it.
  const trigger: TriggerDeps = {
    summon: { room, sessions, now: () => Date.now(), openSessions: async () => [...openSessionIds], opened: openedSessions },
    arrange: { commands: room.commands, report, shownBy: (session) => shownByOf(sessionsValue, session) },
    status: arrangement,
    size: () =>
      measuredCardSize({
        size: () => ({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio }),
        onResize: (listener) => {
          addEventListener("resize", listener);
          return () => removeEventListener("resize", listener);
        },
      }),
  };
  // Whether a session is a member session of this room that core.sessions no longer lists (docs/spec/room.md#restart, C146).
  const ended = (session: string): boolean => endedRoomSession(session, roomSessions, taughtSessions, openSessionIds);
  // The first value of core.grid, whose cards list every tab with its params; the watch ends with that value.
  const readGrid = (): Promise<unknown> => new Promise((resolve, reject) => {
    let stop: (() => void) | null = null;
    let read = false;
    Promise.resolve(bridge!.runtime.status.watch("core.grid", (value: unknown) => {
      if (read) return;
      read = true;
      resolve(value);
      stop?.();
    })).then((end) => {
      stop = end;
      if (read) end();
    }).catch(reject);
  });
  // Whether the program of a definition is Claude Code, which takes --session-id, --resume and --agent.
  const isClaude = (id: string): boolean => (definitions.find((one) => one.id === id)?.program.split("/").at(-1) ?? "") === "claude";
  // The agent name of a definition: the frontmatter name of the agent file of its role in core.roles, read with the declared program
  // agent-file, or null when core.roles lists no file for it (docs/spec/room.md#group).
  const agentFileOf = (id: string): string | null => roleFileOf(id, rolesValue);
  const agentPlaceOf = async (id: string): Promise<AgentPlace | null> => {
    const file = agentFileOf(id);
    if (file === null) return null;
    const reply = await bridge!.runtime.program.run("agent-file", [file]);
    return { agent: agentNameOf(agentFileText(reply, file), file), file };
  };
  const agentOf = async (id: string): Promise<string | null> => (await agentPlaceOf(id))?.agent ?? null;
  // The agents of the open members whose program takes no --agent, by member id, which their agent line states (docs/spec/room.md#agent-line).
  const memberAgents = new Map<string, AgentPlace>();
  // Before a Claude Code member starts in folder, its configuration file holds the answers of the questions of a first start: member-start
  // ends the first-start steps and trusts each folder of the member in the home of its account, and project-trust trusts each folder in the
  // configuration file of the person for a definition without a home (docs/spec/room.md#first-start).
  // Runs a command of the first start program and reads its JSON answer; a refusal fails with the member and the error of the program.
  const firstStart = async (name: string, args: string[], id: string): Promise<Record<string, unknown>> => {
    const reply = await bridge!.runtime.program.run(name, args);
    if (reply.code !== 0) throw new Error(`member ${id}: ${reply.stderr.trim()}`);
    return JSON.parse(reply.stdout) as Record<string, unknown>;
  };
  const prepareStart = async (definition: AgentDefinition, folder: string): Promise<void> => {
    if (!isClaude(definition.id)) return;
    for (const one of startFolders(definition, folder)) {
      const [name, args] = definition.home === null ? ["project-trust", ["trust", one]] : ["member-start", ["start", definition.home.folder, one]];
      const reply = await bridge!.runtime.program.run(name, args);
      if (reply.code !== 0) throw new Error(`${name} ${args.join(" ")} exited with ${reply.code}: ${reply.stderr.trim()}`);
    }
  };
  // login.check summons the members again, which reads the login of their homes, after the person logs in to an account in the agents
  // plugin (docs/spec/room.md#login).
  // login.check reads the login of each member that waits for a login again and opens the session of each one whose home now has a
  // login (docs/spec/room.md#login).
  const checkLogins = async (): Promise<null> => {
    await summonRun(members.filter((entry) => loginGate.needs(entry.id)).map((entry) => entry.id));
    return null;
  };
  // Reattaches the members with an open session of this room and opens the sessions of the members in `opening` whose home has a login;
  // a member opens its session only at its first turn (docs/spec/room.md#receivers).
  const summonRun = (opening: string[] = []): Promise<void> => {
    const ids = members.map((entry) => entry.id);
    let starting: string[] = [];
    return runTrigger(async () => {
      await sessionsReady;
      // A member without an open session starts only while the home of its account has a login; the others stay members with the state
      // login (docs/spec/room.md#login).
      const closed = ids.flatMap((id) => {
        if (memberSessions.has(id) || !opening.includes(id)) return [];
        const definition = definitions.find((one) => one.id === id);
        return definition === undefined ? [] : [{ ...definition, id }];
      });
      await loginGate.startable(closed);
      starting = ids.filter((id) => memberSessions.has(id) || (opening.includes(id) && !loginGate.needs(id)));
      showStates();
      // A member whose session opens works in its own worktree when the folder of its definition is in a git repository; a reattached
      // member whose definition folder is now in another repository starts a new session (docs/spec/room.md#worktrees).
      const folders = new Map<string, string>();
      for (const definition of definitions) {
        if (!starting.includes(definition.id)) continue;
        const kept = worktrees.get(definition.id);
        if (memberSessions.has(definition.id)) {
          if (kept === undefined) continue;
          const { root } = await firstStart("member-root", ["root", definition.cwd], definition.id);
          if (root === kept.root) {
            folders.set(definition.id, kept.worktree);
            continue;
          }
          await room.commands.execute("core.session.end", { session: memberSessions.get(definition.id)! });
          memberSessions.delete(definition.id);
          worktrees.delete(definition.id);
          record.append("clubhouse", `@${definition.name} starts a new session: its folder ${definition.cwd} left the repository ${kept.root}, and its worktree ${kept.worktree} stays`);
        }
        const tree = await firstStart("member-worktree", ["worktree", definition.cwd, surface, definition.id], definition.id);
        if (tree.worktree === null) {
          worktrees.delete(definition.id);
          record.append("clubhouse", `@${definition.name} works in ${definition.cwd} without a worktree`);
        } else {
          const { root, worktree, branch, integration } = tree;
          if (![root, worktree, branch, integration].every((one) => typeof one === "string" && one !== "")) {
            throw new Error(`member ${definition.id}: member-worktree answered ${JSON.stringify(tree)}`);
          }
          worktrees.set(definition.id, { root, worktree, branch, integration } as MemberWorktree);
          folders.set(definition.id, worktree as string);
        }
      }
      // Each starting member keeps the memory of its project in the folder .memory of the folder it works in, tracked by git
      // (docs/spec/room.md#memory).
      for (const definition of definitions) {
        if (!starting.includes(definition.id)) continue;
        const answer = await firstStart("member-memory", ["memory", folders.get(definition.id) ?? definition.cwd], definition.id);
        const { memory, indexLines } = answer;
        if (typeof memory !== "string" || !memory.startsWith("/") || !Number.isInteger(indexLines)) {
          throw new Error(`member ${definition.id}: member-memory answered ${JSON.stringify(answer)}`);
        }
        memories.set(definition.id, memory);
        if ((indexLines as number) > MEMORY_INDEX_LIMIT) {
          record.append("clubhouse", `the memory index ${memory}/index.md has ${indexLines} lines, over ${MEMORY_INDEX_LIMIT}; move pages into topic folders`);
        }
      }
      // A starting member starts in its folder without a question of a first start.
      for (const definition of definitions) {
        if (starting.includes(definition.id)) await prepareStart(definition, folders.get(definition.id) ?? definition.cwd);
      }
      // A starting member whose program takes no --agent learns the agent of its definition from the agent line (C110).
      for (const definition of definitions) {
        if (!starting.includes(definition.id) || isClaude(definition.id)) continue;
        const place = await agentPlaceOf(definition.id);
        if (place === null) memberAgents.delete(definition.id);
        else memberAgents.set(definition.id, place);
      }
      // A starting Claude Code member starts with the agent of its definition (C101).
      const memberDefinitions = await Promise.all(
        definitions.map(async (definition) =>
          toMemberDefinition(
            { ...definition, cwd: folders.get(definition.id) ?? definition.cwd },
            starting.includes(definition.id) && isClaude(definition.id) ? await agentOf(definition.id) : null,
            acceptAll,
          ),
        ),
      );
      await summonAndArrange(trigger, memberDefinitions, starting);
      // The room forgets an ended session only after it closed every tab of the grid that shows it, also a tab that no plan names, so
      // no member tab of the room stays without its session (docs/spec/room.md#restart, C145).
      await closeEndedTabs(room.commands, await readGrid(), ended);
      for (const session of [...roomSessions]) if (!openSessionIds.has(session)) roomSessions.delete(session);
    })
      .then(refreshMembers)
      .then(() => {
        for (const session of memberSessions.values()) roomSessions.add(session);
        persist();
      })
      .then(() => {
        // The protocol turns of the open members run without holding the summon; the open of a member waits for its own (C153).
        void teachMembers();
      });
  };
  const summon = (): void => {
    summonRun().catch((error: unknown) => report("room summon", String((error as Error)?.message ?? error)));
  };
  // At start, after the first value of core.sessions, the room closes the tabs of its member sessions that ended while the application was
  // closed and forgets those sessions, whether or not a summon runs (docs/spec/room.md#restart, C145).
  runTrigger(async () => {
    await sessionsReady;
    await closeEndedTabs(room.commands, await readGrid(), ended);
    for (const session of [...roomSessions]) if (!openSessionIds.has(session)) roomSessions.delete(session);
    persist();
  }).catch((error: unknown) => report("room restart", String((error as Error)?.message ?? error)));

  // A message goes to the members that it mentions and to the leader of the group (docs/spec/room.md#receivers). Each member delivers its answer with the answer command, and the conversation shows it as text.
  let work: WorkReports | null = null;
  // The end of the conversation-status wait of each token kept from before a restart, by token (docs/spec/room.md#restart).
  const keptWaits = new Map<string, () => void>();
  const keptOpen = (): boolean => keptWaits.size > 0;
  // The answer of a token raises the delivered number of its session; an answer of a turn kept from before a restart is the answer of
  // its member (docs/spec/room.md#restart).
  const answers = createAnswerChannel({
    restored: saved?.turns ?? [],
    delivered: (session, count) => record.markDelivered(session, count),
    restoredAnswer: (token, reply) => record.append(token.member, reply.text, { elapsedMs: null, index: reply.index }),
    closed: (token) => {
      work?.closed(token);
      keptWaits.get(token.turn)?.();
      keptWaits.delete(token.turn);
    },
    changed: () => {
      persist();
      stopState.update(busy, keptOpen());
    },
  });
  // One submit queue per member session, so each line is built from the sent number that the previous submit left.
  const lines = createSubmitQueue(room);
  const relayPorts: RelayPorts = {
    commands: room.commands,
    answers,
    lines,
    surface,
    persisted: () => lastWrite,
    sessions: () => sessionsValue,
    waiting: (member, step) => conversationStatus.waiting(member, step),
    watchSessions: (listener) => {
      sessionListeners.add(listener);
      return () => void sessionListeners.delete(listener);
    },
    // The first turn of a member without a session summons it, which arranges its tab, and submits the room protocol before the turn line
    // (docs/spec/room.md#receivers).
    open: createMemberOpen({
      check: async (id) => {
        const member = checkedMembers().find((one) => one.id === id);
        if (member === undefined) throw new Error(`member ${id} is not a member of the group`);
        try {
          await roomCheck.beforeOpen(member);
        } catch (error) {
          await checkAll();
          throw error;
        }
      },
      summon: (id) => summonRun([id]),
      needsLogin: (id) => loginGate.needs(id),
      protocol: async (id) => {
        const [outcome] = await protocolOutcomes(openMembers().filter((entry) => entry.id === id));
        return outcome === undefined ? undefined : { session: outcome.member.session, result: outcome.result };
      },
      stops: () => stopCount,
    }),
  };
  // The conversation shows the room record: it names the owner or a member by its identifier and shows the name of the member.
  const memberName = (speaker: string): string => {
    return members.find((one) => one.id === speaker)?.name || speaker;
  };
  // Below the entries the page shows one line per member whose turn the room waits for (docs/spec/room.md#conversation-status).
  const showConversation = (): void => {
    let value;
    try {
      value = conversationStatus.read();
    } catch (error) {
      report("room conversation", String((error as Error)?.message ?? error));
      return;
    }
    // Each entry is a bubble, a room line or a round divider (docs/spec/room.md#conversation-view).
    const rows = conversationView(value.entries, members.map((entry) => entry.id)).map((item) => {
      if (item.kind === "divider") return elText("div", tp("round", lang, { round: String(item.round) }), "st-round");
      if (item.kind === "system") return indexed(elText("div", item.text, "st-system"), item.index);
      // The claims and reports of an open turn show under the name of their member until the answer of the turn takes them.
      if (item.kind === "notes") {
        const row = el("div", "st-row assistant");
        if (item.color !== null) row.dataset.color = String(item.color % MEMBER_COLORS);
        const who = el("div", "st-who");
        who.append(elText("span", memberName(item.speaker), "st-who-name"));
        row.append(who);
        for (const note of item.notes) row.append(elText("div", `${note.kind} · ${note.text}`, `st-note st-note-${note.kind}`));
        return indexed(row, item.index);
      }
      const owner = item.side === "right";
      const row = el("div", `st-row ${owner ? "user" : "assistant"}`);
      if (item.color !== null) row.dataset.color = String(item.color % MEMBER_COLORS);
      const who = el("div", "st-who");
      who.append(elText("span", owner ? (lang === "ko" ? "나" : "You") : memberName(item.speaker), "st-who-name"));
      if (item.elapsedMs !== null) who.append(elText("span", elapsedLabel(item.elapsedMs, lang), "st-who-time"));
      const bubble = el("div", "st-bubble");
      if (item.sections.length === 0) bubble.textContent = item.text;
      // An answer with sections shows one block per addressee, so a reader sees who answered whom.
      for (const section of item.sections) {
        const block = el("div", "st-section");
        const to = section.to === "all" ? "@all" : section.to === "owner" ? "@owner" : `@${memberName(section.to)}`;
        block.append(elText("div", to, "st-section-to"), elText("div", section.text, "st-section-text"));
        bubble.append(block);
      }
      row.append(who, bubble);
      for (const note of item.notes) row.append(elText("div", `${note.kind} · ${note.text}`, `st-note st-note-${note.kind}`));
      return indexed(row, item.index);
    });
    // A waiting member shows the time since the room began to wait for it, which tickWaits writes at each change of its label.
    const waitRows = value.waiting.map((wait) => {
      const key = `${wait.member}/${wait.session}/${wait.step}`;
      if (!waitStarts.has(key)) waitStarts.set(key, Date.now());
      const line = elText("div", "", "st-pending st-waiting");
      line.dataset.key = key;
      line.dataset.text = tp("waitingFor", lang, { name: memberName(wait.member), step: waitLabel(wait), program: String(wait.program) });
      return line;
    });
    // A blocked member shows the question that its program asks and the button that makes the tab of its session active, where the
    // person answers it (docs/spec/room.md#questions).
    const questionRows = value.questions.map((question) => {
      const box = el("div", "st-question");
      box.append(elText("div", tp("questionAsks", lang, { name: memberName(question.member) }), "st-question-title"));
      box.append(elText("pre", question.rows.join("\n"), "st-question-screen"));
      // Each option of a cursor list is a button that selects it in the program (C112).
      if (question.choices.length > 0) {
        const choices = el("div", "st-question-choices");
        for (const choice of question.choices) {
          const button = elText("button", choice, "st-question-choice");
          button.dataset.expose = `${EXPOSE}.question.choice`;
          bound(expose.bind(button, `${EXPOSE}.question.answer`, { member: question.member, choice }, { failed: failed("question.answer") }), "question.answer");
          choices.append(button);
        }
        box.append(choices);
      }
      const answer = elText("button", tp("questionAnswer", lang, { name: memberName(question.member) }), "st-question-answer");
      answer.dataset.expose = `${EXPOSE}.question`;
      bound(expose.bind(answer, `${EXPOSE}.member.show`, { member: question.member }, { failed: failed("member.show") }), "member.show");
      box.append(answer);
      return box;
    });
    const keys = new Set(waitRows.map((line) => line.dataset.key!));
    for (const key of [...waitStarts.keys()]) if (!keys.has(key)) waitStarts.delete(key);
    // A draw keeps the scroll position; the follow mode decides whether the view moves to the new entries.
    const top = msgs.scrollTop;
    msgs.replaceChildren(...rows, ...waitRows, ...questionRows);
    msgs.scrollTop = top;
    tickWaits();
    seen.disconnect();
    const added: number[] = [];
    for (const row of rows) {
      const index = Number(row.dataset.index);
      if (row.dataset.index === undefined) continue;
      if (index >= drawnEntries) added.push(index);
      seen.observe(row);
    }
    drawnEntries = value.entries.length;
    follow.added(added);
  };
  const indexed = (row: HTMLElement, index: number): HTMLElement => {
    row.dataset.index = String(index);
    return row;
  };
  // The counter of each waiting member shows elapsedLabel of the time since the wait began. No event announces that a label unit has
  // passed, and the label is not tied to the display frames, so one timer runs to the next change of the label of any waiting line;
  // a line is written only when its text differs, and the timer ends when no wait remains and at the teardown of the view
  // (docs/spec/room.md#timing).
  const waitStarts = new Map<string, number>();
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  const tickWaits = (): void => {
    if (waitTimer !== null) clearTimeout(waitTimer);
    waitTimer = null;
    const lines = [...msgs.querySelectorAll<HTMLElement>(".st-waiting")];
    if (lines.length === 0) return;
    const now = Date.now();
    let delay = Number.POSITIVE_INFINITY;
    for (const line of lines) {
      const elapsed = now - (waitStarts.get(line.dataset.key!) ?? now);
      const text = `${line.dataset.text} · ${elapsedLabel(elapsed, lang)}`;
      if (line.textContent !== text) line.textContent = text;
      delay = Math.min(delay, nextLabelChange(elapsed));
    }
    waitTimer = setTimeout(tickWaits, delay);
  };
  addEventListener("pagehide", () => {
    if (waitTimer !== null) clearTimeout(waitTimer);
    waitTimer = null;
  });
  // Each member receives the record lines that it has not received at the start of its turn (docs/spec/room.md#room-record).
  const speakerName = (speaker: string): string => (speaker === "owner" ? "owner" : memberName(speaker));
  // The declared conversation status carries the entries that the page shows and the members that the room waits for; the page draws
  // each value, and each value of core.sessions publishes the program states again (docs/spec/room.md#conversation-status).
  // The sections of an answer name the addressees by the mention rules among the members (docs/spec/room.md#sections).
  type OpenMember = { id: string; name: string; session: string; mcp: boolean };
  const isOpen = (id: string): boolean => memberSessions.has(id) && openSessionIds.has(memberSessions.get(id)!);
  const openMembers = (): OpenMember[] =>
    members
      // The stored relation is read again after each change of core.sessions; until then a session that has ended is left out.
      .filter((entry) => isOpen(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name, session: memberSessions.get(entry.id)!, mcp: !isolatedMember(entry.id) }));
  // The members of the room whose session received the protocol, and the record lines that each has not received, which its next turn
  // line carries (docs/spec/room.md#conversation-status).
  const roomMembers = () => openMembers().filter((member) => taughtSessions.has(member.session));
  const deliveryEntries = () =>
    roomMembers().map((member) => {
      return {
        member: member.id,
        name: member.name,
        session: member.session,
        sent: record.sent()[member.session] ?? 0,
        delivered: record.delivered()[member.session] ?? 0,
        length: record.addressed()[member.session]?.length ?? 0,
        unreceived: record.unsent(member.session, member.id).length,
      };
    });
  // The questions of the blocked members by session, and the sessions whose screen the room reads (docs/spec/room.md#questions).
  const questions = new Map<string, { member: string; rows: string[]; choices: string[] }>();
  const questionReads = new Set<string>();
  const conversationStatus = createConversationStatus(conversation, () => sessionsValue, () => deliveryEntries(), (entry) =>
    entry.speaker === "owner" || entry.speaker === "clubhouse" ? [] : answerSections(entry.text, members),
    () => [...questions.entries()].map(([session, entry]) => ({ member: entry.member, session, rows: entry.rows, choices: entry.choices })),
  );
  conversationStatus.subscribe(() => showConversation());
  // The member cards show answering while the room waits for an answer of the member (docs/spec/room.md#header).
  waitedMembers = () => new Set(conversationStatus.read().waiting.map((wait) => wait.member));
  conversationStatus.subscribe(() => showStates());
  // The question of each blocked member (docs/spec/room.md#questions): the room reads the screen of its session once when its program
  // reports blocked, at the value of core.sessions that carries the state, and drops the question when the state changes.
  conversationStatus.subscribe((value) => {
    const blocked = new Map(value.waiting.filter((wait) => wait.program === "blocked").map((wait) => [wait.session, wait.member]));
    let dropped = false;
    for (const session of [...questions.keys()]) if (!blocked.has(session)) dropped = questions.delete(session) || dropped;
    for (const [session, member] of blocked) {
      if (questions.has(session) || questionReads.has(session)) continue;
      questionReads.add(session);
      readQuestion(room, session)
        .then((rows) => {
          if (!conversationStatus.read().waiting.some((wait) => wait.session === session && wait.program === "blocked")) return;
          questions.set(session, { member, rows, choices: questionChoices(rows).map((one) => one.text) });
          conversationStatus.changed();
        })
        .catch((error: unknown) => report("room question", `member ${member}: ${String((error as Error)?.message ?? error)}`))
        .finally(() => questionReads.delete(session));
    }
    if (dropped) conversationStatus.changed();
  });
  // With a leader the leader receives every line and a worker its owner lines and the lines that mention it
  // (docs/spec/room.md#addressed-views).
  const leaderEntry = () => members.find((entry) => entry.leader);
  const route = leaderRoute(
    () => {
      const leader = leaderEntry();
      return leader === undefined ? null : (memberSessions.get(leader.id) ?? null);
    },
    () => openMembers(),
  );
  const record = createRoomRecord(conversation, saved?.delivered ?? {}, speakerName, () => {
    conversationStatus.changed();
    persist();
  }, saved?.sent ?? {}, () => Date.now(), saved?.addressed ?? {}, route);
  showConversation();
  // The listener of core.sessions reads the conversation status, the delivery entries and the record, so it is added after them (C96).
  sessionListeners.add((value) => {
    work?.inject();
    try {
      conversationStatus.changed();
    } catch (error) {
      report("room conversation", String((error as Error)?.message ?? error));
    }
  });
  // Each member session receives the room protocol once, after it first reports idle and before its first relayed message
  // (docs/spec/room.md#room-protocol). The injector reports each refusal itself and resolves with the outcome of each member.
  const protocol = createProtocolInjector(relayPorts, report, {
    taught: [...taughtSessions],
    onTaught: (session) => {
      taughtSessions.add(session);
      persist();
    },
    stopping: (listener) => stopping(listener),
  });
  // A token kept from before a restart shows its member as waiting for the answer until the answer or conversation.stop closes it.
  for (const token of answers.tokens()) keptWaits.set(token.turn, relayPorts.waiting({ id: token.member, session: token.session }, "answer"));
  stopState.update(busy, keptOpen());
  // The work reports, claims and releases of the members, and the owner follow-ups injected into the working sessions
  // (docs/spec/room.md#work-reports, docs/spec/room.md#owner-follow-up).
  work = createWorkReports({ answers, lines, sessions: () => sessionsValue, report }, record, roomMembers);
  // Resolves with the members whose protocol turn has ended; a refused member receives no relayed message.
  const protocolOutcomes = (members: OpenMember[]) =>
    Promise.all(
      members.map(async (member) => ({
        member,
        result: await protocol.ensure({ ...member, place: placeOf(member), agent: memberAgents.get(member.id) ?? null, worktree: worktrees.get(member.id) ?? null, memory: memories.get(member.id) ?? null }),
      })),
    );
  const taughtMembers = async (members: OpenMember[]): Promise<OpenMember[]> =>
    (await protocolOutcomes(members)).filter((one) => one.result.ok).map((one) => one.member);
  // The place of a member in a room with a leader, which its protocol line states (docs/spec/room.md#leader).
  const placeOf = (member: OpenMember) => {
    const leader = leaderEntry();
    if (leader === undefined) return null;
    return member.id === leader.id ? { leader: null } : { leader: leader.name };
  };
  const teachMembers = async (): Promise<void> => {
    await taughtMembers(openMembers());
  };
  // A message runs message.send from the send button and from Enter without Shift in the input (docs/spec/room.md#commands).
  // The relay resolves with the answer of each member in relay order.
  // A relay in which core accepted no submit withdraws the line of the owner, and any other failed relay appends the failure line
  // (docs/spec/room.md#room-record).
  // conversation.stop ends each turn that waits for a blocked session or for its answer (docs/spec/room.md#turn-end).
  const stopListeners = new Set<() => void>();
  // The number of stops of the owner, which the open of a member compares (C151).
  let stopCount = 0;
  const stopping = (listener: () => void): (() => void) => {
    stopListeners.add(listener);
    return () => void stopListeners.delete(listener);
  };
  const relayMessage = (text: string, stopped: () => boolean): Promise<{ id: string; text: string }[]> =>
    settledRelay(record, async (accepted) => {
      const leader = leaderEntry();
      if (leader === undefined) throw new Error("no group is assigned");
      // A member without a session that received the room protocol opens it at its own turn, so a message waits for no protocol turn of
      // another member (docs/spec/room.md#receivers, C153).
      const group = relayGroup(members, openMembers(), taughtSessions);
      const answers = await relayToReceivers(relayPorts, group, text, record, {
        limit: conversationTurns, stopped, accepted, stopping, leader: leader.id, mode,
      });
      return answers.map((answer) => ({ id: answer.id, text: answer.text }));
    });
  const operations = createRoomOperations({
    group: () => group,
    setGroup: (next) => {
      group = next;
      members = groupMembers(definitions, groups, group, (text) => report("room group", text));
      setTransport(members.length > 0);
    },
    groupDefined: async (id) => id in readGroups(await agentData("groups")),
    mode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    folded: () => folded,
    setFolded: (next) => {
      folded = next;
    },
    changed: () => {
      renderTabs();
      renderMode();
      persist();
    },
    summon,
    accept: (text) => {
      input.value = "";
      record.append("owner", text);
    },
    busy: (value) => {
      busy = value;
      // A relay in progress keeps the tab loaded: an unload would end the page that waits for the turns.
      bridge!.calls.request("tab.keep", { reason: "busy", on: value }).catch((error: unknown) => report("tab keep", String((error as Error)?.message ?? error)));
      send.disabled = value || transport.state !== "ready";
      stopState.update(value, keptOpen());
    },
    relay: relayMessage,
    followUp: () => work?.followUp(),
    stopWaits: () => {
      stopCount += 1;
      for (const listener of [...stopListeners]) listener();
      return answers.closeWaits().length;
    },
    failed: (reason) => report("room relay", reason),
  });
  // message.send has shown each of its refusals and failures through the error display before it rejects, so the bindings show none
  // a second time; without failed, the binder would pass the rejection to unhandledrejection of the document.
  const shownBySend = (): void => {};
  bound(expose.bind(send, `${EXPOSE}.message.send`, () => ({ text: input.value }), { failed: shownBySend }), "message.send");
  bound(expose.bind(pill, `${EXPOSE}.conversation.scroll.bottom`, {}, { failed: failed("conversation.scroll.bottom") }), "conversation.scroll.bottom");
  bound(expose.bind(stop, `${EXPOSE}.conversation.stop`, {}, { failed: failed("conversation.stop") }), "conversation.stop");
  // The mention hint (C102, docs/spec/room.md#mention-hint): while the word before the caret starts with @, the list above the composer
  // shows all and the names of the members that start with its text. A click on an item, or Enter
  // or Tab on the marked item, runs mention.insert; the arrow keys move the mark and Escape closes the list.
  const mentionBox = el("div", "st-mention");
  mentionBox.hidden = true;
  composer.append(mentionBox);
  let mentionItems: string[] = [];
  let mentionMark = 0;
  let mentionClosed = false;
  const roomNames = (): { id: string; name: string }[] => members.map((entry) => ({ id: entry.id, name: entry.name }));
  const drawMentions = (): void => {
    const query = input.disabled || mentionClosed ? null : mentionQuery(input.value, input.selectionStart ?? input.value.length);
    mentionItems = query === null ? [] : mentionCandidates(roomNames(), query.query);
    if (mentionMark >= mentionItems.length) mentionMark = 0;
    mentionBox.hidden = mentionItems.length === 0;
    mentionBox.replaceChildren(
      ...mentionItems.map((name, index) => {
        const item = el("div", `st-mention-item${index === mentionMark ? " on" : ""}`);
        item.dataset.expose = `${EXPOSE}.mention`;
        item.append(elText("span", "@", "st-mention-at"), elText("span", name, "st-mention-nm"));
        item.addEventListener("pointerdown", (event) => event.preventDefault());
        bound(expose.bind(item, `${EXPOSE}.mention.insert`, { name }, { failed: failed("mention.insert") }), "mention.insert");
        return item;
      }),
    );
  };
  const mentionOpen = (): boolean => mentionItems.length > 0;
  const insertMentionName = (params: unknown): { text: string } => {
    const name = (params as { name?: unknown } | null)?.name;
    if (typeof name !== "string" || name === "") throw new Error("mention.insert name must be a non-empty text");
    const caret = input.selectionStart ?? input.value.length;
    const query = mentionQuery(input.value, caret);
    if (query === null) throw new Error("mention.insert: no @ word ends at the caret of the composer");
    const next = insertMention(input.value, caret, query.start, name);
    input.value = next.text;
    input.setSelectionRange(next.caret, next.caret);
    input.focus();
    drawMentions();
    return { text: input.value };
  };
  input.addEventListener("input", () => {
    mentionClosed = false;
    drawMentions();
  });
  input.addEventListener("click", () => drawMentions());
  input.addEventListener("blur", () => {
    mentionItems = [];
    mentionBox.hidden = true;
  });
  input.addEventListener("keydown", (event) => {
    if (!mentionOpen() || event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      mentionMark = (mentionMark + (event.key === "ArrowDown" ? 1 : mentionItems.length - 1)) % mentionItems.length;
      drawMentions();
    } else if (event.key === "Escape") {
      event.preventDefault();
      mentionClosed = true;
      drawMentions();
    } else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      expose.run(`${EXPOSE}.mention.insert`, { name: mentionItems[mentionMark] }).catch(failed("mention.insert"));
    }
  });
  // Enter without Shift sends; the newline that it would insert is prevented. Enter during an IME composition commits the text, and
  // Enter while the mention list is open chooses its marked item.
  const sendKey = (event: KeyboardEvent): boolean => event.key === "Enter" && !event.shiftKey && !event.isComposing && !mentionOpen();
  input.addEventListener("keydown", (event) => {
    if (sendKey(event)) event.preventDefault();
  });
  bound(
    expose.bind(input, `${EXPOSE}.message.send`, () => ({ text: input.value }), {
      event: "keydown",
      when: (event: Event) => sendKey(event as KeyboardEvent),
      failed: shownBySend,
    }),
    "message.send",
  );

  const tabTargets = (): object[] => [...tabsEl.querySelectorAll<HTMLElement>(".st-tab")];
  const elements: Record<string, ElementTarget> = {
    [`${EXPOSE}.send`]: send,
    [`${EXPOSE}.stop`]: stop,
    [`${EXPOSE}.pill`]: pill,
    [`${EXPOSE}.input`]: input,
    [`${EXPOSE}.tab`]: tabTargets,
    [`${EXPOSE}.group`]: header.group,
    [`${EXPOSE}.mode`]: header.modes,
    [`${EXPOSE}.fold`]: header.fold,
    [`${EXPOSE}.question`]: () => [...msgs.querySelectorAll<HTMLElement>(".st-question-answer")],
    [`${EXPOSE}.question.choice`]: () => [...msgs.querySelectorAll<HTMLElement>(".st-question-choice")],
    [`${EXPOSE}.mention`]: () => [...mentionBox.querySelectorAll<HTMLElement>(".st-mention-item")],
  };
  return {
    commands: {
      ...createRoomCommands({ state }),
      ...operations,
      [ANSWER_COMMAND]: async (params: unknown) => answers.deliver(params),
      [`${EXPOSE}.login.check`]: async () => checkLogins(),
      [`${EXPOSE}.mention.insert`]: async (params: unknown) => insertMentionName(params),
      [`${EXPOSE}.question.answer`]: async (params: unknown) => {
        const { member, choice } = (params ?? {}) as { member?: unknown; choice?: unknown };
        if (typeof member !== "string" || member === "") throw new Error("question.answer member must be a non-empty text");
        if (typeof choice !== "string" || choice === "") throw new Error("question.answer choice must be a non-empty text");
        const question = [...questions.entries()].find(([, entry]) => entry.member === member);
        if (question === undefined) throw new Error(`member ${member} has no question`);
        return answerQuestion(room, member, question[0], choice);
      },
      [`${EXPOSE}.member.show`]: async (params: unknown) => {
        const member = (params as { member?: unknown } | null)?.member;
        if (typeof member !== "string" || member === "") throw new Error("member.show member must be a non-empty text");
        const value = conversationStatus.read();
        const session =
          value.waiting.find((wait) => wait.member === member)?.session ??
          memberSessions.get(member) ??
          null;
        if (typeof session !== "string") throw new Error(`member ${member} has no open session`);
        return showMember(room, sessionsValue, member, session);
      },
      [REPORT_COMMAND]: async (params: unknown) => work!.reportCommand(params),
      [CLAIM_COMMAND]: async (params: unknown) => work!.claim(params),
      [RELEASE_COMMAND]: async (params: unknown) => work!.release(params),
      [`${EXPOSE}.conversation.scroll.bottom`]: async () => follow.bottom(),
      [`${EXPOSE}.room.check`]: async () => checkAll(),
    },
    elements,
    statuses: {
      [`${EXPOSE}.arrangement`]: {
        read: () => arrangement.read(),
        subscribe: (listener) => arrangement.subscribe(listener).dispose,
      },
      [`${EXPOSE}.check`]: {
        read: () => roomCheck.read(),
        subscribe: (listener) => {
          checkListeners.add(listener);
          return () => void checkListeners.delete(listener);
        },
      },
      [`${EXPOSE}.conversation`]: {
        read: () => conversationStatus.read(),
        subscribe: (listener) => conversationStatus.subscribe(listener),
      },
      [`${EXPOSE}.view`]: {
        read: () => viewState(),
        subscribe: (listener) => {
          viewListeners.add(listener);
          return () => void viewListeners.delete(listener);
        },
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
