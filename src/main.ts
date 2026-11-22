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
import { createMacroStore } from "./tower/macro";
import { setupTower } from "./tower/header";
import { TOWER_LIVE_TOPIC } from "./tower/modal";

const MODES: { id: RoomMode; key: "modeFacil" | "modeTurn" | "modeSimul" }[] = [
  { id: "facil", key: "modeFacil" },
  { id: "turn", key: "modeTurn" },
  { id: "simul", key: "modeSimul" },
];
// The members of the room. Their sessions are opened by C3; until then the tabs only choose the roster.
const MEMBERS: { id: string; label: string; color: string }[] = [
  { id: "claude", label: "Claude", color: "#d97757" },
  { id: "codex", label: "Codex", color: "#10a37f" },
];
const EXPOSE = "soksak-plugin-agents-clubhouse";

const CSS = `
.st{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg,#1e1e1e);color:var(--fg,#ddd);font:13px system-ui,-apple-system,sans-serif;overflow:hidden}
.st-bar{display:flex;align-items:center;gap:8px;height:var(--toolbar-h,28px);padding:0 var(--toolbar-pad-x,8px);border-bottom:1px solid rgba(127,127,127,.2);flex:0 0 auto;flex-wrap:nowrap;min-width:0}
.st-bar b{font-weight:700;letter-spacing:.02em;flex:0 0 auto;white-space:nowrap}
.st-tabs{display:flex;align-items:center;gap:5px;flex-wrap:nowrap;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
.st-tabs::-webkit-scrollbar{display:none}
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
.st-kib{margin-left:4px;display:inline-flex;border-radius:8px;overflow:hidden;border:1px solid rgba(127,127,127,.28);flex:0 0 auto}
.st-kib button{appearance:none;border:0;background:transparent;color:inherit;opacity:.6;font:inherit;font-size:11px;padding:3px 9px;cursor:pointer}
.st-kib button.on{opacity:1;background:rgba(127,127,127,.2);font-weight:700}
.st-status{margin-left:auto;font-size:11px;color:var(--fg3,#888);flex:0 0 auto;white-space:nowrap}
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


interface Tab {
  id: string;
  checked: boolean;
}

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
function buildRoom({ settings, collections }: RoomContext): RoomHandlers {
  const lang = navigator.language.startsWith("ko") ? "ko" : "en";
  const modeSetting = settings.kibitzDefault;
  if (modeSetting !== "facil" && modeSetting !== "turn" && modeSetting !== "simul") {
    throw new Error(`settings.kibitzDefault must be facil, turn or simul, got ${JSON.stringify(modeSetting)}`);
  }
  let mode: RoomMode = modeSetting;
  const roster: Tab[] = MEMBERS.map((m) => ({ id: m.id, checked: true }));
  const transport = { state: "unavailable" as const, reason: t("transportUnavailable", lang) };
  const arrangement = createArrangementStatus();
  const state = (): RoomState => ({
    mode,
    roster: roster.map((r) => ({ id: r.id, checked: r.checked })),
    transport: { ...transport },
  });

  const style = document.createElement("style");
  style.textContent = CSS;
  const root = el("div", "st");
  const bar = el("div", "st-bar");
  const tabsEl = el("div", "st-tabs");
  const kib = el("div", "st-kib");
  const towerButton = document.createElement("button");
  towerButton.type = "button";
  towerButton.className = "st-tower";
  towerButton.textContent = t("towerTitle", lang);
  towerButton.title = t("towerTitle", lang);
  const statusEl = elText("span", transport.reason, "st-status");
  bar.append(elText("b", manifest.name), tabsEl, kib, towerButton, statusEl);
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
  root.append(bar, msgs, composer);
  document.head.append(style);
  document.body.style.cssText = "margin:0;height:100%";
  document.body.replaceChildren(root);

  function renderTabs(): void {
    tabsEl.replaceChildren();
    for (const entry of roster) {
      const member = MEMBERS.find((m) => m.id === entry.id)!;
      const tab = el("span", `st-tab${entry.checked ? "" : " off"}`);
      tab.dataset.id = entry.id;
      tab.dataset.expose = `${EXPOSE}.tab`;
      tab.style.color = member.color;
      tab.append(elText("span", entry.checked ? "✓" : "", "chk"), elText("span", member.label, "nm"));
      tab.addEventListener("click", () => {
        entry.checked = !entry.checked;
        renderTabs();
      });
      tab.addEventListener("pointerdown", (down) => {
        const startX = down.clientX;
        let moved = false;
        const onMove = (ev: PointerEvent) => {
          if (!moved && Math.abs(ev.clientX - startX) < 4) return;
          moved = true;
          const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(".st-tab");
          if (!over || over.dataset.id === undefined || over.dataset.id === entry.id) return;
          const from = roster.indexOf(entry);
          const to = roster.findIndex((r) => r.id === over.dataset.id);
          roster.splice(from, 1);
          roster.splice(to, 0, entry);
          renderTabs();
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
      button.addEventListener("click", () => {
        mode = option.id;
        renderMode();
      });
      kib.append(button);
    }
  }

  renderTabs();
  renderMode();

  // The trace and the macros of the tower are project data of the room, kept per project root.
  const trace = createTrace(collections, { sessionId: sessionIdOf(), report });
  const macros = createMacroStore(collections, { sessionId: sessionIdOf() });
  const tower = setupTower(room, towerButton, t("towerTitle", lang), () => lang, trace, macros);
  addEventListener("pagehide", () => tower.dispose());

  const tabTargets = (): object[] => [...tabsEl.querySelectorAll<HTMLElement>(".st-tab")];
  const elements: Record<string, ElementTarget> = {
    [`${EXPOSE}.send`]: send,
    [`${EXPOSE}.input`]: input,
    [`${EXPOSE}.tab`]: tabTargets,
    [`${EXPOSE}.mode`]: kib,
    [`${EXPOSE}.tower`]: towerButton,
  };
  return {
    commands: createRoomCommands({ tower, trace, mode: () => mode, state }),
    elements,
    statuses: {
      [`${EXPOSE}.arrangement`]: {
        read: () => arrangement.read(),
        subscribe: (listener) => arrangement.subscribe(listener).dispose,
      },
      [`${EXPOSE}.transport`]: { read: () => ({ ...transport }), subscribe: () => () => {} },
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
