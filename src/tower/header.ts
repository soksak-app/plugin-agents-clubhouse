// The control tower of the room. The room element soksak-plugin-agents-clubhouse.tower is the button that the page binds to the
// declared command tower.set (docs/spec/room.md#commands); the button shows the open state with the class "on" and aria-pressed.
//
// The modal reaches the core and the room through the room port (src/room/port.ts), so no host object is named here.

import { createTowerModal, type TowerModal } from "./modal";
import type { RoomPort } from "../room/port";
import type { Planner, PlanRunResult, PlanRunOptions, DistRunResult, DistRunOptions, ReflectResult, ReflectOptions, UntrustedSource, MacroProposal, MacroRunResult, CommitOptions } from "./executor";
import type { PlanStep } from "./plan";
import type { TraceSink } from "./trace";
import type { Macro, MacroSink } from "./macro";
import type { ScanReport } from "./scanner";

export interface TowerHandle {
  dispose: () => void;
  isOpen: () => boolean;
  // Opens or closes the modal; the current state changes nothing.
  setOpen: (open: boolean) => void;
  // 헤드리스 slow-path 구동(노출 command·E2E) — 모달의 executor.planAndRun 직통.
  planAndRun: (nl: string, opts?: PlanRunOptions) => Promise<PlanRunResult>;
  // 편집된 plan 재검증 + dry-run(M9) — 모달의 executor.revalidateAndRun 직통(편집 검증 우회 0, rollback 보호).
  revalidateAndRun: (steps: PlanStep[], opts?: PlanRunOptions) => Promise<PlanRunResult>;
  // 다중 에이전트 분배(M6) — 모달의 executor.distributeAndRun 직통.
  distributeAndRun: (nl: string, opts: DistRunOptions) => Promise<DistRunResult>;
  // post-execution reflection 루프(M8) — 모달의 executor.reflectAndRun 직통.
  reflectAndRun: (nl: string, opts?: ReflectOptions) => Promise<ReflectResult>;
  // 결정적 시각 E2E — 모달 UI 에 KNOWN plan dry-run preview 렌더(snapshot 확인용).
  previewInject: (nl: string, steps: PlanStep[]) => Promise<PlanRunResult>;
  // incoming-plan 콘텐츠 스캐너 직통(M10) — 노출 command tower.scan 이 헤드리스로 자가검증(실행 0).
  scan: (input: { untrusted?: UntrustedSource[]; steps?: PlanStep[] }) => Promise<ScanReport>;
  // ── M11: 매크로 승격 — 노출 command tower.macro 가 헤드리스로 구동(save/run/list/forget + propose) ──
  proposeMacro: (threshold?: number) => Promise<MacroProposal>;
  saveMacro: (input: { name: string; trigger: string; steps: PlanStep[]; tainted?: boolean; scanVerdict?: "clean" | "flagged" }) => Promise<Macro | null>;
  runMacro: (name: string, opts?: CommitOptions) => Promise<MacroRunResult>;
  listMacros: () => Promise<Macro[]>;
  forgetMacro: (name: string) => Promise<boolean>;
}

// Installs the modal of the control tower and shows its open state on the tower button. room = the room port, button = the tower element,
// label = the button and modal title, lang = the language accessor, trace and macros = the project data sinks of the tower.
// Without a planner the modal reports NO_PLANNER for a natural-language request; a planner is supplied once a member transport exists.
export function setupTower(room: RoomPort, button: HTMLElement, label: string, lang: () => string, trace?: TraceSink, macros?: MacroSink, planner?: Planner): TowerHandle {
  // The open state changes only through onChange, so the button follows the modal whatever opened it.
  const modal: TowerModal = createTowerModal({ title: label, lang, room, planner, trace, macros, onChange: () => render() });
  const render = () => {
    button.classList.toggle("on", modal.isOpen());
    button.setAttribute("aria-pressed", String(modal.isOpen()));
  };
  render();

  return {
    isOpen: () => modal.isOpen(),
    setOpen: (open: boolean) => {
      if (open !== modal.isOpen()) (open ? modal.open() : modal.close());
    },
    planAndRun: (nl: string, opts?: PlanRunOptions) => modal.planAndRun(nl, opts),
    revalidateAndRun: (steps: PlanStep[], opts?: PlanRunOptions) => modal.revalidateAndRun(steps, opts),
    distributeAndRun: (nl: string, opts: DistRunOptions) => modal.distributeAndRun(nl, opts),
    reflectAndRun: (nl: string, opts?: ReflectOptions) => modal.reflectAndRun(nl, opts),
    previewInject: (nl: string, steps: PlanStep[]) => modal.previewInject(nl, steps),
    scan: (input) => modal.scan(input),
    proposeMacro: (threshold) => modal.proposeMacro(threshold),
    saveMacro: (input) => modal.saveMacro(input),
    runMacro: (name, opts) => modal.runMacro(name, opts),
    listMacros: () => modal.listMacros(),
    forgetMacro: (name) => modal.forgetMacro(name),
    dispose: () => {
      modal.dispose();
    },
  };
}
