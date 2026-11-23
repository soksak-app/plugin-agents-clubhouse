// 호스트 크롬 표준 준수 게이트 — 사이드바/컨텐츠 뷰를 등록하는 플러그인은 호스트의 크롬 행 band 를
// 건드리면 안 된다. 호스트가 탭 band(높이·배치)를 단독 소유하고(테마별 --chrome-row-h 표준), 플러그인은
// 그 아래 본문 슬롯만 채운다 — 그래야 모든 사이드바 플러그인이 같은 줄에 정렬된다.
//
// 이 테스트는 main.ts 의 CSS 문자열을 파싱해, 호스트 소유 셀렉터/크롬 변수에 대한 height·배치 대입이
// 없음을 단언한다. 기준 미달이라고 이 테스트를 약화하지 마라 — 플러그인 CSS 를 자기 클래스(club-* 등)로
// 한정하라(배신 금지). 다른 사이드바 플러그인은 이 파일을 복사해 자기 뷰에 같은 게이트를 둔다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src", "main.ts"), "utf8");
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "plugin.json"), "utf8"),
) as {
  id: string;
  surface?: { composition?: { kind?: string; page?: string } };
  exposes?: {
    commands?: { name: string; params: { type: string } }[];
    element?: { name: string }[];
  };
};

// 호스트가 단독 소유하는 크롬 셀렉터 — 플러그인이 자기 CSS 로 덮으면 줄 정렬이 깨진다(금지).
const HOST_SELECTORS = [
  ".left-host-tabs",
  ".left-host-tab",
  ".content-tabs",
  ".view-tabs",
  ".view-tab",
  ".ft-header",
  ".plugin-side-head",
  ".tabs",
  ".titlebar",
];

// 테마가 소유하는 표준 높이 변수. 플러그인이 이 값을 **정의/대입**하면 표준을 덮는 것(금지). 하지만 자기
// 요소 높이를 표준에 맞추려고 var() 로 **사용**하는 건 준수(권장) — 좌측 사이드바 타이틀바는 var(--header-h)
// 를 써서 컨텐츠 탭행과 같은 줄·높이가 돼야 한다. 그래서 정의만 막고 사용은 허용한다.
const HOST_VARS = [
  "--chrome-row-h",
  "--header-h",
  "--status-h",
  "--ws-pad",
  "--tab-pad",
];

// main.ts 의 CSS 템플릿 리터럴(백틱)들을 모은다 — 플러그인 스타일은 여기에만 존재(plain DOM).
function cssBlocks(): string {
  const out: string[] = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (/[{};]/.test(m[1]) && /:/.test(m[1])) out.push(m[1]); // CSS 처럼 보이는 블록만
  }
  return out.join("\n");
}

describe("호스트 크롬 표준 준수 (사이드바 플러그인 계약)", () => {
  it("번들 CSS 가 호스트 소유 셀렉터를 덮지 않는다", () => {
    const css = cssBlocks();
    const hits = HOST_SELECTORS.filter((sel) => css.includes(sel));
    expect(hits).toEqual([]);
  });

  it("표준 변수를 정의/대입하지 않는다(사용 var() 은 허용 — 준수)", () => {
    const css = cssBlocks();
    // 정의/대입: `--header-h:` (콜론). 사용: `var(--header-h)` (괄호) — 후자는 통과해야 한다.
    const defined = HOST_VARS.filter((v) =>
      new RegExp(`${v}\\s*:`).test(css.replace(new RegExp(`var\\(\\s*${v}\\b`, "g"), "")),
    );
    expect(defined).toEqual([]);
  });

  it("플러그인 스타일은 자기 네임스페이스(club-/st-/acpc-)로 한정된다", () => {
    const css = cssBlocks();
    // 최상위 클래스 셀렉터(.foo)들을 모아, 자기 접두사가 아닌 것이 height 를 정의하는지 본다.
    const ownPrefix = /^\.(club|st|acpc)[\w-]*$/;
    const offenders: string[] = [];
    const ruleRe = /([.#][\w.#\s>:-]+)\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css))) {
      const sels = m[1].split(",").map((s) => s.trim());
      if (!/height\s*:/.test(m[2])) continue;
      for (const s of sels) {
        const head = s.split(/[\s>:]/)[0];
        if (head.startsWith(".") && !ownPrefix.test(head)) offenders.push(head);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// 현재 매니페스트 형식(core docs/spec/plugins.md#pluginjson)에는 permissions 멤버가 없다. core 검사
// (validateManifest)는 이를 알 수 없는 field로 거부하므로, 이전의 "commands" 권한 게이트 시험은 더 이상 기준이
// 아니다. 아래 시험은 현재 형식의 기준을 확인한다: 제거된 멤버가 없고, view surface 가 상대 경로의 .html page 를
// 가리키며, 노출하는 커맨드와 element 의 이름이 플러그인 id 로 시작하고, 커맨드 params 가 object 스키마다.

// 현재 형식에서 제거된 최상위 멤버(core validateManifest 가 거부하는 이름).
// `programs` is a current member (core docs/spec/plugins.md#pluginjson, checkPrograms of the plugin-api release), so it is not listed.
const REMOVED_MEMBERS = ["permissions", "entry", "configuration", "contributes", "views"];

describe("현재 plugin.json 형식 (core plugins.md#pluginjson)", () => {
  it("제거된 멤버를 선언하지 않는다", () => {
    const raw = manifest as unknown as Record<string, unknown>;
    expect(REMOVED_MEMBERS.filter((member) => member in raw)).toEqual([]);
  });

  it("surface 는 view composition 이고 page 는 패키지 안의 상대 경로 .html 이다", () => {
    expect(manifest.surface?.composition?.kind).toBe("view");
    const page = manifest.surface?.composition?.page ?? "";
    expect(page).toMatch(/\.html$/);
    expect(page.startsWith("/")).toBe(false);
    expect(page.split("/")).not.toContain("..");
  });

  it("노출하는 커맨드 이름은 플러그인 id 로 시작하고 params 는 object 스키마다", () => {
    const commands = manifest.exposes?.commands ?? [];
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command.name.startsWith(`${manifest.id}.`)).toBe(true);
      expect(command.params.type).toBe("object");
    }
  });

  it("노출하는 element 이름은 플러그인 id 로 시작한다", () => {
    for (const element of manifest.exposes?.element ?? []) {
      expect(element.name.startsWith(`${manifest.id}.`)).toBe(true);
    }
  });
});
