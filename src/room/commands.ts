// The commands of the room (plugin.json exposes.commands). Each handler runs in the view page and answers with the result shape
// that plugin.json declares. The control tower commands run through the tower handle, which runs its steps through the room port.
import type { TowerHandle } from "../tower/header";
import type { TraceSink, TracePlan, TraceStep } from "../tower/trace";
import type { Macro } from "../tower/macro";
import type { PlanStep } from "../tower/plan";
import type { UntrustedSource, Planner } from "../tower/executor";
import { deleteStep, moveStep, editParams } from "../tower/editplan";

export type RoomMode = "turn" | "facil" | "simul";

export interface RoomState {
  mode: RoomMode;
  roster: { id: string; checked: boolean }[];
  transport: { state: "unavailable" | "ready"; reason?: string; notIsolated: string[] };
}

export interface CommandDeps {
  tower: TowerHandle;
  trace: TraceSink | undefined;
  // The conversation mode of the room, recorded with each trace plan.
  mode: () => RoomMode;
  state: () => RoomState;
}

function normalizeUntrusted(raw: unknown): UntrustedSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UntrustedSource[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === "string") {
      if (item) out.push({ source: `untrusted#${i}`, text: item });
    } else if (item && typeof item === "object") {
      const text = typeof (item as any).text === "string" ? (item as any).text : "";
      const source = typeof (item as any).source === "string" && (item as any).source ? (item as any).source : `untrusted#${i}`;
      if (text) out.push({ source, text });
    }
  }
  return out.length ? out : undefined;
}

export function createRoomCommands(deps: CommandDeps): Record<string, (params: any) => Promise<any>> {
  const { tower, trace } = deps;
  return {
    "soksak-plugin-agents-clubhouse.state": async () => deps.state(),
    "soksak-plugin-agents-clubhouse.tower.set": async (p: any) => {
      const open = p?.open;
      if (typeof open !== "boolean") throw new Error(`open must be a boolean, got ${JSON.stringify(open)}`);
      tower.setOpen(open);
      return { open };
    },
    "soksak-plugin-agents-clubhouse.tower.plan": async (p: any): Promise<any> => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, code: "INVALID_INPUT", message: "text 필수" };
          // M10 — untrusted 출처 정규화({source,text}[]). 주입 시 scanner+taint 가 plan 경로 전체에 흐른다.
          const untrusted = normalizeUntrusted(p?.untrusted);
          let inject = Array.isArray(p?.plan) ? (p.plan as any[]) : undefined;
          // M9 — edit ops(삭제·reorder·params)를 주입 plan 에 적용한 뒤 *편집된* plan 으로 진행한다. 순수
          //   editplan 연산 → 편집된 plan 은 아래 revalidateAndRun 이 다시 validatePlan(편집 검증 우회 0).
          const edits = Array.isArray(p?.edit) ? (p.edit as any[]) : undefined;
          if (edits && inject) {
            let steps = inject as any[];
            for (const e of edits) {
              const idx = Number(e?.index);
              if (!Number.isInteger(idx)) continue;
              if (e?.op === "delete") steps = deleteStep(steps as any, idx) as any[];
              else if (e?.op === "up") steps = moveStep(steps as any, idx, "up") as any[];
              else if (e?.op === "down") steps = moveStep(steps as any, idx, "down") as any[];
              else if (e?.op === "params" && e?.params && typeof e.params === "object")
                steps = editParams(steps as any, idx, e.params as Record<string, unknown>) as any[];
            }
            inject = steps;
          }
          // M9 — autoConfirm:"deny" 면 commit 동안 danger confirm 자동 거부(헤드리스 rollback 검증). deny 만.
          const autoDeny = p?.autoConfirm === "deny";
          // render:true + 주입 plan → 모달 UI 에 dry-run preview 렌더(시각 E2E). 실행 0.
          if (p?.render === true && inject) {
            const r = await tower.previewInject(text, inject as any);
            if (!r.ok) return { ok: false, code: r.code, message: r.message };
            return { ok: true, dryRun: true, rendered: true, steps: r.steps };
          }
          // 인터럽트 협조 양보 — commit 도중 사람 참견(pendingHuman)이 들어오면 다음 step/plan 전에 멈춘다
          //   (현재까지 실행 보존, 취소-폐기 아님). 활성 뷰 없으면 항상 false(헤드리스 단발).
          // M9 — 편집된 plan(또는 주입 plan)을 revalidateAndRun 으로 재검증→dry-run. 편집이 미등록을 들여놓으면
          //   여기서 거부(UNKNOWN_COMMAND/NOT_EXPOSED) — 편집이 검증을 우회하지 못함. commit 은 편집된 plan.
          if (edits && inject) {
            const traceMeta = { nl: text, mode: deps.mode() };
            const res = await tower.revalidateAndRun(inject as any, { trace: traceMeta, untrusted });
            if (!res.ok) return { ok: false, code: res.code, message: res.message, scan: (res as any).scan };
            if (p?.commit !== true) return { ok: true, dryRun: true, edited: true, steps: res.steps };
            const c = await res.commit({ autoDenyConfirm: autoDeny });
            return { ok: c.ok, committed: true, edited: true, code: c.code, steps: res.steps, results: c.results, yielded: c.yielded, rollback: c.rollback };
          }
          // distribute:true → 다중 에이전트 분배(M6). 모드는 활성 뷰에서. 주입 plan 은 simul 단일경로라 무시.
          if (p?.distribute === true) {
            return { ok: false, code: "NO_TRANSPORT", message: "distribution needs member sessions and the terminal relay (C3, C5)" };
          }
          // trace 메타(M7) — commit/discard 시 plan·step·outcome 이 project data 에 영속(이벤트-우선).
          //   mode 는 활성 뷰의 대화 모드(없으면 "solo"). nl = 원문(투명). untrusted(M10) 전달.
          const traceMeta = { nl: text, mode: deps.mode() };
          const res = await tower.planAndRun(text, inject ? { injectPlan: inject, trace: traceMeta, untrusted } : { trace: traceMeta, untrusted });
          // M10 — SCANNER_FLAGGED 거부면 scan 리포트(flags/bySource)도 투명 노출(되먹임·감사). 실행 0.
          if (!res.ok) return { ok: false, code: res.code, message: res.message, scan: (res as any).scan };
          // dry-run 결과 — 검증된 step(축/이름/주소/파라미터) 그대로 노출(투명). 아직 실행 0.
          const steps = res.steps;
          if (p?.commit !== true) return { ok: true, dryRun: true, steps };
          const c = await res.commit({ autoDenyConfirm: autoDeny });
          // rollback(M9) — destructive 묶음 중간 실패 시 한정 rollback 결과(restored/unrestorable)를 투명 노출.
          return { ok: c.ok, committed: true, code: c.code, steps, results: c.results, yielded: c.yielded, rollback: c.rollback };
    },
    "soksak-plugin-agents-clubhouse.tower.reflect": async (p: any): Promise<any> => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, code: "INVALID_INPUT", message: "text 필수" };
          // 결정적 E2E — plans(스크립트 plan 시퀀스)가 있으면 그 순서대로 돌려주는 planner 를 구성(라이브 우회).
          //   검증·게이트·verify·재계획·trace 는 모두 동일(보안 우회 0). 라이브 모드면 활성 엔진 planner 사용.
          let plannerInject: import("../tower/executor").Planner | undefined;
          if (Array.isArray(p?.plans)) {
            const scripted: any[] = p.plans;
            let i = 0;
            plannerInject = async () => {
              const cur = scripted[Math.min(i++, scripted.length - 1)];
              return JSON.stringify(Array.isArray(cur) ? cur : []);
            };
          }
          const goalCheck = p?.goalCheck && typeof p.goalCheck === "object" ? (p.goalCheck as import("../tower/plan").PlanStep) : undefined;
          const failGoalCodes = Array.isArray(p?.failGoalCodes) ? (p.failGoalCodes as string[]) : undefined;
          const maxReplans = Number.isFinite(p?.maxReplans) ? Math.max(0, Number(p.maxReplans)) : undefined;
          const maxSteps = Number.isFinite(p?.maxSteps) ? Math.max(1, Number(p.maxSteps)) : undefined;
          const untrusted = normalizeUntrusted(p?.untrusted); // M10 — untrusted 컨텍스트(scanner+taint).
          // trace 메타(M7) — 각 반복(재계획)이 독립 plan 레코드로, escalation 은 마지막 plan outcome="escalated" 로.
          const traceMeta = { nl: text, mode: deps.mode() };
          const res = await tower.reflectAndRun(text, {
            planner: plannerInject,
            goalCheck,
            failGoalCodes,
            maxReplans,
            maxSteps,
            trace: traceMeta,
            untrusted,
          });
          // 투명 — outcome(succeeded/escalated/rejected)·각 반복(steps/verified/rejectCode/failure)·escalation 표면.
          return {
            ok: res.ok,
            outcome: res.outcome,
            iterations: res.iterations,
            escalation: res.escalation,
          };
    },
    "soksak-plugin-agents-clubhouse.tower.trace": async (p: any): Promise<any> => {
          if (!trace) return { ok: false, code: "DATA_UNAVAILABLE", message: "data 영속이 비활성(project data 미제공)" };
          const planId = typeof p?.plan === "string" && p.plan ? p.plan : undefined;
          if (planId) {
            const steps: TraceStep[] = await trace.stepsOf(planId);
            return { ok: true, planId, steps };
          }
          const limit = Math.max(1, Math.min(200, Number(p?.limit) || 20));
          const plans: TracePlan[] = await trace.recentPlans({ limit });
          // session = sink 의 실제 키(쓰기·조회 동일) — 활성 후 프로젝트가 바뀌어도 이 sink 의 키는 고정.
          return { ok: true, session: trace.sessionId, plans };
    },
    "soksak-plugin-agents-clubhouse.tower.scan": async (p: any): Promise<any> => {
          const untrusted = normalizeUntrusted(p?.untrusted);
          const steps = Array.isArray(p?.steps) ? (p.steps as PlanStep[]) : undefined;
          const report = await tower.scan({ untrusted, steps });
          return { ok: true, verdict: report.verdict, flags: report.flags, bySource: report.bySource };
    },
    "soksak-plugin-agents-clubhouse.tower.macro": async (p: any): Promise<any> => {
          const verb = String(p?.verb ?? "").trim();
          if (!verb) return { ok: false, code: "INVALID_INPUT", message: "verb 필수(save|run|list|forget|propose)" };
          if (verb === "list") {
            const macros: Macro[] = await tower.listMacros();
            return { ok: true, macros };
          }
          if (verb === "propose") {
            const threshold = Number.isFinite(p?.threshold) ? Math.max(2, Number(p.threshold)) : undefined;
            const prop = await tower.proposeMacro(threshold);
            return { ok: true, ...prop };
          }
          if (verb === "save") {
            const name = String(p?.name ?? "").trim();
            if (!name) return { ok: false, code: "INVALID_INPUT", message: "save 엔 name 필수" };
            const steps = Array.isArray(p?.steps) ? (p.steps as PlanStep[]) : undefined;
            if (!steps || !steps.length) return { ok: false, code: "INVALID_INPUT", message: "save 엔 steps(비어 있지 않은 배열) 필수" };
            const trigger = typeof p?.trigger === "string" && p.trigger ? p.trigger : name;
            const scanVerdict = p?.scanVerdict === "flagged" || p?.scanVerdict === "clean" ? p.scanVerdict : undefined;
            const saved = await tower.saveMacro({ name, trigger, steps, tainted: p?.tainted === true, scanVerdict });
            // null = RULE 0 봉인 거부(tainted/flagged) 또는 영속 비활성(project data 미제공).
            if (!saved) return { ok: false, code: "MACRO_NOT_SAVED", message: "매크로 저장 거부(untrusted 유래이거나 영속 비활성)" };
            return { ok: true, saved };
          }
          if (verb === "run") {
            const name = String(p?.name ?? "").trim();
            if (!name) return { ok: false, code: "INVALID_INPUT", message: "run 엔 name 필수" };
            const autoDeny = p?.autoConfirm === "deny";
            const r = await tower.runMacro(name, { autoDenyConfirm: autoDeny });
            // 투명 — stage(not-found/refused/dispatched)·결과를 그대로 노출(되먹임·감사).
            if (r.stage === "not-found") return { ok: false, stage: r.stage, code: r.code, message: r.message };
            if (r.stage === "refused") return { ok: false, stage: r.stage, code: r.code, message: r.message, refusal: r.refusal, macro: r.macro };
            return { ok: r.ok, stage: r.stage, code: r.code, macro: r.macro, results: r.results, yielded: r.yielded, rollback: r.rollback };
          }
          if (verb === "forget") {
            const name = String(p?.name ?? "").trim();
            if (!name) return { ok: false, code: "INVALID_INPUT", message: "forget 엔 name 필수" };
            const forgot = await tower.forgetMacro(name);
            return { ok: true, forgot, name };
          }
          return { ok: false, code: "INVALID_INPUT", message: `알 수 없는 verb: ${verb}(save|run|list|forget|propose)` };
    },
  };
}
