# 변경 기록

## 미출시

- C2, C6: 방이 자기 view page(`ui/clubhouse.html`)에서 `plugin.json`의 커맨드, element, status, project data로 돈다. ACP engine, 그 의존과 이를 쓰던 커맨드를 제거했으므로 방은 C3과 C5 전까지 멤버 transport가 없다.
- C7: project data store(`createPersonaStore`, `createMemberSessionStore`)가 빈 텍스트나 `null` 대신 data API의 오류로 거부한다. 실패한 define은 다음 호출이 다시 시도한다. 실패 경우의 테스트는 `src/room/persona.test.ts`와 `src/room/session-store.test.ts`에 있다.
- C5: member 메시지 중계(`src/room/relay.ts`)가 선언된 `terminal.submit` 커맨드로 방 메시지를 보내고, 선언된 `terminal.program` status에서 차례의 끝을 얻는다. member가 기다리거나 실행 중이 아니면 보내기를 거부한다. member terminal로 가는 port와 answer 읽기는 아직 만들지 않았다(C5는 열려 있다).
- C8: tower의 macro와 trace store는 실패한 `data.define`을, domain map은 실패한 `status.query`를 삼키지 않고 다시 던진다. 다음 define 호출은 다시 시도한다. `statuses`가 없는 `status.query` 응답은 거부한다.
- C9: tower와 room은 잡은 모든 오류를 `room.report`(`error: <where>: <text>`)로 보고하거나 다시 던진다. trace store는 실패한 쓰기를 보고하고 계속 진행한다. 확인 토큰은 `crypto.getRandomValues`가 필요하며 `Math.random` 폴백이 없다. 직렬화할 수 없는 step params는 scan을 거부한다. modal과 테마 listener는 실패를 보고한다.
- C10: 파괴적 묶음은 rollback snapshot을 캡처할 수 없으면 첫 step 전에 거부되고(`SNAPSHOT_FAILED`), 실패는 보고된다. 파괴적 step이 없는 묶음은 여전히 실행된다.
- C11: 실패한 palette 실행, plan, plan 편집은 code와 사유를 generic 문구 대신 `room.report`(`error: <where>: <code>: <reason>`)로 보고한다.
- C3: 소환은 고른 member마다 owned session(`core.session.open`)을 열고, member와 session의 관계를 project data에 저장한다. `plugin.json`은 `sessions`를 선언하지 않고 sidecar에도 의존하지 않는다. core는 sessions를 선언하지 않은 plugin의 열기만 거부한다. 열기 호출은 `cols`, `rows` 대신 `size`(`{width, height, scale}`)를 받고, 저장된 session은 `core.sessions`가 열린 것으로 나열할 때만 재사용한다. 정의 출처와 트리거는 아직 연결하지 않았다(C3은 열려 있다).
- C12: room은 각 실패를 window 오류 표시(`tab.error`)로 보여 주며, 거부된 표시는 `runtime.error`로 기록한다.
- C4: room은 방 card와 member card의 배치를 `core.layout.plan`으로 계획하고, feasible한 계획은 `core.layout.apply`로 짓는다. 아니면 member의 owned session을 tab으로 열고 계획의 reason을 선언된 arrangement status에 남긴다. 소환 뒤의 호출 지점은 아직 연결되지 않았다(C4는 열려 있다).
- 경계: 방 테스트는 member를 실행하는 plugin을 실제 plugin id 대신 각 테스트가 선언한 fixture id(`fixture-terminal`)로 쓴다. 방 코드는 plugin id를 갖지 않는다. member의 plugin은 호출자가 넘긴다.
- C5: 방은 message를 member의 owned session에 `core.session.submit`으로 보내고, `core.session.read`로 화면을 읽으며(형식 검사), program 상태는 `core.sessions`에서 읽는다. 중계(`src/room/relay.ts`)는 program이 idle일 때만 보내고, working을 거쳐 다시 idle이 되면 차례를 끝낸다. page 연결은 C3-1과 core F1062-7 release를 기다린다(C5은 열려 있다).
- C13: Room은 `dependencies`에 agents plugin을 적고 status `agents.definitions`를 `src/room/definitions.ts`로 읽는다. 이 모듈은 다른 형식을 status 이름을 담은 오류로 거부하며, 정의마다 plugin과 시작 값을 준다. Red: `src/room/definitions.test.ts`가 `Cannot find module`로 실패했다. Green: 279개 test와 typecheck가 통과한다. Window check는 core F1074를 기다린다.
