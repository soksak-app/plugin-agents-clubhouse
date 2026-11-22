# 변경 기록

## 미출시

- C2, C6: 방이 자기 view page(`ui/clubhouse.html`)에서 `plugin.json`의 커맨드, element, status, project data로 돈다. ACP engine, 그 의존과 이를 쓰던 커맨드를 제거했으므로 방은 C3과 C5 전까지 멤버 transport가 없다.
- C7: project data store(`createPersonaStore`, `createMemberSessionStore`)가 빈 텍스트나 `null` 대신 data API의 오류로 거부한다. 실패한 define은 다음 호출이 다시 시도한다. 실패 경우의 테스트는 `src/room/persona.test.ts`와 `src/room/session-store.test.ts`에 있다.
- C5: member 메시지 중계(`src/room/relay.ts`)가 선언된 `terminal.submit` 커맨드로 방 메시지를 보내고, 선언된 `terminal.program` status에서 차례의 끝을 얻는다. member가 기다리거나 실행 중이 아니면 보내기를 거부한다. member terminal로 가는 port와 answer 읽기는 아직 만들지 않았다(C5는 열려 있다).
