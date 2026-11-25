// The check of the members of the room (C152, docs/spec/room.md#check): the reasons why a member cannot take a turn, before the open of
// its session and for every member on request, so the room shows them instead of waiting without a reason.
export interface CheckedMember {
  id: string;
  cwd: string;
  program: string;
}

export interface RoomCheckValue {
  members: { member: string; problems: string[] }[];
}

export interface RoomCheckDeps {
  // Runs the declared program member-check with the folder and the program of a definition.
  run: (folder: string, cli: string) => Promise<{ folder: string | null; cli: string | null }>;
  // Reads the login of the homes of the members, which loginProblem then gives (C165).
  readLogins: (ids: readonly string[]) => Promise<void>;
  // The login problem of the home of a member, or null.
  loginProblem: (id: string) => string | null;
  // The open session of a member and whether its program reports a program state, or null without an open session.
  session: (id: string) => { session: string; reports: boolean } | null;
  publish: (value: RoomCheckValue) => void;
}

export interface RoomCheck {
  beforeOpen(member: CheckedMember): Promise<void>;
  all(members: readonly CheckedMember[]): Promise<RoomCheckValue>;
  read(): RoomCheckValue;
  problemOf(id: string): string | null;
}

export function createRoomCheck(deps: RoomCheckDeps): RoomCheck {
  let value: RoomCheckValue = { members: [] };
  const reasons = async (member: CheckedMember): Promise<string[]> => {
    const answer = await deps.run(member.cwd, member.program);
    return [answer.folder, answer.cli].filter((one): one is string => one !== null);
  };
  return {
    async beforeOpen(member) {
      const found = await reasons(member);
      if (found.length > 0) throw new Error(`member ${member.id}: ${found.join("; ")}`);
    },
    async all(members) {
      const next: RoomCheckValue = { members: [] };
      // The check reads the login of each home when it runs, because a login can end or begin after the last open read it.
      await deps.readLogins(members.map((member) => member.id));
      for (const member of members) {
        const problems = await reasons(member);
        const login = deps.loginProblem(member.id);
        if (login !== null) problems.push(login);
        const open = deps.session(member.id);
        if (open !== null && !open.reports) problems.push(`the session ${open.session} reports no program state, so the room cannot tell when it is idle`);
        next.members.push({ member: member.id, problems });
      }
      value = next;
      deps.publish(value);
      return value;
    },
    read: () => value,
    problemOf: (id) => value.members.find((one) => one.member === id)?.problems[0] ?? null,
  };
}
