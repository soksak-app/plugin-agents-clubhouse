// executor.ts 보안 단위 테스트 (RED→GREEN, RULE 1·RULE 6). executor=유일 실행점 + danger-게이트 불변식.
//
// 적대 검증 HARD 불변식(매트릭스):
//  (a) destructive → confirm 통과 전엔 절대 미실행(거부·timeout=0 실행).
//  (b) ⚠️ confirm accept 는 executor 의 dom 도달 밖 — ui.input.click 으로 자가승인 불가.
//  (c) 게이트는 실행에 엮인다 — confirm 파생 토큰이 실행의 필수 입력. 단일 if NOP-패치로 우회 불가.
//
// RED 의 핵심: 게이트가 없으면 destructive 가 즉시 실행(취약). 게이트가 단일 if 면 그 분기 제거로 우회(취약).
// 토큰을 데이터 의존(게이트 엔트리가 name/params 를 소유, 토큰으로 조회)으로 엮으면 우회 0 — GREEN.
// 기준 미달 시 이 단언을 약화하지 말고 구현을 고친다(배신 금지).

import { describe, expect, it, vi } from "vitest";
import {
  createExecutor,
  __unsafeDispatchForNopTest,
  randomToken,
  type ExecutorDeps,
} from "./executor";

// 실행을 가로채 호출만 기록하는 가짜 코어 — destructive 가 confirm 전에 불리면 즉시 드러난다.
function fakeApp() {
  const executed: Array<{ name: string; params: any }> = [];
  const room = {
    report: () => undefined,
    commands: {
      execute: vi.fn(async (name: string, params: any) => {
        // 검증·상태조회 read 명령은 fixture 응답.
        if (name === "state.commands") {
          return { ok: true, commands: CATALOG.map((c) => ({ name: c, description: c })) };
        }
        if (name === "ui.tree") {
          return { ok: true, nodes: [{ address: "win/main/chrome/tower/input" }] };
        }
        if (name === "plugin.implementers") {
          // soksak-spec-plugin-terminal 계약 발견 — 터미널 닫기 예시가 특정 플러그인 id 대신 계약으로 구현체를 해소한다.
          return { ok: true, contract: "soksak-spec-plugin-terminal", implementers: [{ id: "soksak-plugin-terminal", version: "0.0.1", status: "enabled" }] };
        }
        if (name === "panel.list") {
          return { ok: true, activePanelId: "g3", panels: [{ id: "g3", active: true, activeViewId: "v8", views: [{ id: "v8", kind: "plugin", plugin: "soksak-plugin-terminal" }, { id: "v9", kind: "editor" }] }] };
        }
        if (name === "theme.list") {
          return { ok: true, current: "Cupertino", mode: "dark", themes: [{ name: "Cupertino" }, { name: "Midnight" }] };
        }
        if (name === "state.tree") {
          return { ok: true, tree: { split: { id: "s1" } } };
        }
        executed.push({ name, params });
        return { ok: true };
      }),
    },
  };
  return { room, executed };
}

const CATALOG = ["panel.close", "panel.equalize", "theme.apply", "view.close", "editor.close", "state.commands", "ui.tree", "panel.list", "theme.list", "state.tree", "status.query", "plugin.implementers"];

// 테스트 deps — confirmGate 를 주입해 DOM 없이 사람-수락/거부/타임아웃을 흉내낸다.
//   실제 모달은 dom data-node 노출 여부가 (b) 의 본체 — 별도 dom 테스트에서 단언.
function deps(over: Partial<ExecutorDeps> = {}): { d: ExecutorDeps; executed: Array<{ name: string; params: any }> } {
  const { room, executed } = fakeApp();
  const d: ExecutorDeps = {
    room,
    // 기본 = 사람이 수락(게이트가 토큰 발급) — over 로 거부/타임아웃 주입.
    confirmGate: async (issue) => issue(), // issue() = 토큰 발급(수락). 반환 = 토큰.
    ...over,
  };
  return { d, executed };
}

describe("fast-path 비파괴 — confirm 없이 즉시 실행 (긍정)", () => {
  it("theme.apply(비파괴)는 게이트 없이 room.commands.execute 로 직행", async () => {
    const { d, executed } = deps();
    const ex = createExecutor(d);
    const r = await ex.runCommand("theme.apply", { name: "Cupertino" });
    expect(r.ok).toBe(true);
    expect(executed).toEqual([{ name: "theme.apply", params: { name: "Cupertino" } }]);
  });

  it("panel.equalize(비파괴)도 직행", async () => {
    const { d, executed } = deps();
    const ex = createExecutor(d);
    await ex.runCommand("panel.equalize", { split: "s1" });
    expect(executed.map((e) => e.name)).toEqual(["panel.equalize"]);
  });
});

describe("터미널 닫기 예시 — soksak-spec-plugin-terminal 계약 발견 fast-path(하드코딩 id 아님)", () => {
  it('runExample(1)="터미널 패널 닫아줘" 는 plugin.implementers 로 구현체를 찾아 panel.close(destructive, 게이트 경유)', async () => {
    const { d, executed } = deps(); // 기본 = 사람 수락
    const ex = createExecutor(d);
    const r = await ex.runExample(1); // index 1 = "터미널 패널 닫아줘"
    expect(r.ok).toBe(true);
    // 계약 구현체(soksak-plugin-terminal) 뷰가 든 g3 를 해소 → destructive 게이트 통과 후 실행.
    expect(executed).toEqual([{ name: "panel.close", params: { panel: "g3" } }]);
  });
});

describe("(a) destructive — confirm 통과 전엔 절대 미실행", () => {
  it("confirm 거부 → destructive 미실행", async () => {
    const { d, executed } = deps({ confirmGate: async () => null }); // 거부(토큰 미발급)
    const ex = createExecutor(d);
    const r = await ex.runCommand("panel.close", { panel: "g3" });
    expect(r.ok).toBe(false);
    expect(executed).toEqual([]); // 0 실행
  });

  it("confirm timeout → destructive 미실행", async () => {
    const { d, executed } = deps({ confirmGate: async () => null }); // timeout = null
    const ex = createExecutor(d);
    await ex.runCommand("view.close", { view: "v9" });
    expect(executed).toEqual([]);
  });

  it("confirm 수락 → destructive 실행(긍정)", async () => {
    const { d, executed } = deps(); // 기본 수락
    const ex = createExecutor(d);
    const r = await ex.runCommand("panel.close", { panel: "g3" });
    expect(r.ok).toBe(true);
    expect(executed).toEqual([{ name: "panel.close", params: { panel: "g3" } }]);
  });
});

describe("(c) 게이트는 실행에 엮인다 — NOP-패치 우회 불가", () => {
  it("토큰 없이 dispatch 직접 호출 → destructive 실행 안 됨(데이터 의존)", async () => {
    const { d, executed } = deps();
    const ex = createExecutor(d);
    // __unsafeDispatchForNopTest = 게이트 if 를 건너뛴 '공격' 경로(단일 분기 NOP 모사).
    //   토큰이 없으면 게이트 엔트리(name/params 소유)가 없어 execute 호출 자체를 구성 못 함.
    const r = await __unsafeDispatchForNopTest(ex, "deadbeef-bogus-token");
    expect(r.ok).toBe(false);
    expect(executed).toEqual([]); // 위조 토큰으론 0 실행
  });

  it("토큰은 1회용 — 같은 토큰 재사용 시 2번째는 미실행(replay 차단)", async () => {
    let captured: string | null = null;
    const { d, executed } = deps({
      confirmGate: async (issue) => {
        captured = issue();
        return captured;
      },
    });
    const ex = createExecutor(d);
    await ex.runCommand("panel.close", { panel: "g3" }); // 토큰 소비
    expect(executed).toHaveLength(1);
    // 동일 토큰으로 직접 재-dispatch 시도 → 이미 소비됨 → 미실행
    const r = await __unsafeDispatchForNopTest(ex, captured as unknown as string);
    expect(r.ok).toBe(false);
    expect(executed).toHaveLength(1);
  });
});

describe("(b) ⚠️ confirm accept 는 executor 의 dom 도달 밖", () => {
  it("executor 는 dom 디스패치에서 보안-confirm 주소를 거부한다", async () => {
    const { d, executed } = deps();
    const ex = createExecutor(d);
    // 악성 plan: ui.input.click 으로 confirm accept 자가클릭 시도.
    const r = await ex.runDom("win/main/chrome/tower/confirm/accept");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN_CHROME");
    // confirm accept 주소가 어떤 형태든 executor 의 ui.input.click 로 흐르지 않았다.
    expect(d.room.commands.execute).not.toHaveBeenCalledWith("ui.input.click", expect.objectContaining({ address: expect.stringContaining("confirm") }));
    expect(executed).toEqual([]);
  });

  it("일반 dom 주소(tower/input)는 ui.input.click 으로 통과(긍정·대조)", async () => {
    const { d } = deps();
    const ex = createExecutor(d);
    const r = await ex.runDom("win/main/chrome/tower/input");
    expect(r.ok).toBe(true);
    expect(d.room.commands.execute).toHaveBeenCalledWith("ui.input.click", { address: "win/main/chrome/tower/input" });
  });

  it("confirm 모달 accept 컨트롤은 data-node 가 없다(주소화 0 → collectExposed 미수집)", () => {
    // 모달 빌더가 노출하는 data-node 집합에 accept 가 없음을 단언(소스 계약).
    //   container 는 노출(human/E2E 가시성), accept 는 비노출(executor 도달 밖).
    const nodes = ex_modalConfirmNodes();
    expect(nodes).toContain("tower/confirm"); // 컨테이너 = 가시
    expect(nodes.some((n) => /accept|confirm\/ok|confirm\/yes/.test(n))).toBe(false); // accept = 비노출
  });
});

// confirm 모달이 선언하는 data-node 경로 — 소스의 단일 진실에서 가져온다(하드코드 사본 아님).
import { CONFIRM_EXPOSED_NODES } from "./executor";
function ex_modalConfirmNodes(): readonly string[] {
  return CONFIRM_EXPOSED_NODES;
}

describe("C8 — a refused status.query fails the plan instead of planning without statuses", () => {
  it("runPlan rejects with the status.query refusal", async () => {
    const app = fakeApp();
    const room = {
      commands: {
        execute: vi.fn(async (name: string, params: any) => {
          if (name === "status.query") throw new Error("status.query refused by the room");
          return app.room.commands.execute(name, params);
        }),
      },
      report: () => undefined,
    };
    const ex = createExecutor(deps({ room }).d);
    await expect(ex.runPlan([])).rejects.toThrow("status.query refused by the room");
  });
});

describe("C9 — errors are reported or rethrown, never swallowed", () => {
  it("randomToken needs crypto.getRandomValues and has no Math.random fallback", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{32}$/);
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => randomToken()).toThrow(/getRandomValues/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a failed theme capture refuses a destructive batch before it runs", async () => {
    const app = fakeApp();
    const report = vi.fn();
    const room = {
      commands: {
        execute: vi.fn(async (name: string, params: any) => {
          if (name === "theme.list") throw new Error("theme list refused");
          if (name === "status.query") return { ok: true, statuses: [] };
          return app.room.commands.execute(name, params);
        }),
      },
      report,
    };
    const ex = createExecutor(deps({ room }).d);
    const out = await ex.runPlan([{ axis: "command", name: "panel.close", params: {} }]);
    expect(out).toMatchObject({ ok: false, code: "SNAPSHOT_FAILED" });
    expect(app.executed.map((e) => e.name)).not.toContain("panel.close");
    expect(report).toHaveBeenCalledWith("tower rollback snapshot", expect.stringContaining("theme list refused"));
  });

  it("a failed layout capture refuses a destructive batch before it runs", async () => {
    const app = fakeApp();
    const report = vi.fn();
    const room = {
      commands: {
        execute: vi.fn(async (name: string, params: any) => {
          if (name === "state.tree") throw new Error("state tree refused");
          if (name === "status.query") return { ok: true, statuses: [] };
          return app.room.commands.execute(name, params);
        }),
      },
      report,
    };
    const ex = createExecutor(deps({ room }).d);
    const out = await ex.runPlan([{ axis: "command", name: "panel.close", params: {} }]);
    expect(out).toMatchObject({ ok: false, code: "SNAPSHOT_FAILED" });
    expect(app.executed.map((e) => e.name)).not.toContain("panel.close");
    expect(report).toHaveBeenCalledWith("tower rollback snapshot", expect.stringContaining("state tree refused"));
  });

  it("a batch without a destructive step needs no snapshot, so failed snapshot reads do not stop it", async () => {
    const app = fakeApp();
    const room = {
      commands: {
        execute: vi.fn(async (name: string, params: any) => {
          if (name === "theme.list" || name === "state.tree") throw new Error("snapshot read refused");
          if (name === "status.query") return { ok: true, statuses: [] };
          return app.room.commands.execute(name, params);
        }),
      },
      report: () => undefined,
    };
    const ex = createExecutor(deps({ room }).d);
    const out = await ex.runPlan([{ axis: "status", name: "status.query", params: {} }]);
    expect(out.ok).toBe(true);
  });

  it("a confirm gate that throws rejects its own run and does not block the next confirm", async () => {
    let calls = 0;
    const ex = createExecutor(
      deps({
        confirmGate: async (issue) => {
          calls += 1;
          if (calls === 1) throw new Error("gate broke");
          return issue();
        },
      }).d,
    );
    const [first, second] = await Promise.allSettled([ex.runCommand("panel.close", {}), ex.runCommand("view.close", {})]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
  });
});
