# Room relay

[English](room.md)

방은 입력창의 메시지를 owned session이 열린 체크된 member에게 전달한다. Member는 메시지를 turn의 token으로 끝나는 submit된 한 줄(`core.session.submit`)로 받고, 선언된 command `soksak-plugin-agents-clubhouse.answer`로 답을 전한다. 그 답이 도착하면 turn이 끝난다([답](#answer)).

## Roster

Roster는 agents plugin의 agent definition마다 entry 하나를 나열한다. Entry는 그 definition이 있는 동안 체크 상태와 자리를 유지한다. 제거된 definition은 roster에서 빠지고, 새 definition은 체크되지 않은 채 끝에 들어온다. Member를 초대하는 것은 사람의 선택이기 때문이다. 체크된 member가 바뀌면 open session이 없는 체크된 member를 summon한다.

## Header

방의 header는 plugin 이름, roster tab, mode button, tower button, transport status로 된 한 줄이며, card가 그 부분들보다 좁으면 다음 줄로 줄바꿈한다. Roster tab은 최소 120 point를 차지하고 자기 부분 안에서 가로로 scroll하므로, 좁은 card도 member를 보인다. 각 button은 text를 한 줄로 유지한다. Transport status는 남은 폭으로 줄고, 잘리면 ellipsis로 끝나며, 전체 text를 tooltip으로 보인다.

## Arrangement

Summon 뒤 방은 방 card와 member card로 된 이름 `Room`의 group card를 `core.layout.plan`으로 계획하고, 계획이 feasible하면 `core.layout.apply`로 만든다. 그렇지 않으면 각 member는 현재 card의 tab으로 열린다. Arrangement는 `close`를 넘기지 않으므로, core는 plane의 다른 모든 tab을 tree의 첫 card, 곧 방 card의 끝에 비활성 tab으로 남기고, 방 tab은 그 card의 활성 tab으로 남는다. 방은 끝난 자기 session의 member tab만 닫으며([restart](#restart)), 자기가 열지 않은 tab은 닫지 않는다. 사람의 tab은 저장하지 않은 작업을 가질 수 있고, 그것을 닫는 것은 사람의 선택이기 때문이다.

## Command

방의 모든 operation은 선언된 command를 실행하고, 방의 element는 page의 binder(`expose.bind`)로 이 command에 연결된다. 그래서 click과 command 호출은 같은 경로를 실행한다. 각 command는 잘못된 parameter를 그 parameter와 값을 밝힌 error로 거부한다.

- `soksak-plugin-agents-clubhouse.member.set {id, checked}`: roster entry `id`의 체크 상태를 설정하고 체크된 member를 summon한다. Idempotent하다: 현재 상태를 다시 설정하면 아무것도 바뀌지 않고 summon도 없다. 알 수 없는 `id`는 `member <id> is not in the roster`로 거부한다. 결과는 `{id, checked}`다. Roster tab(`soksak-plugin-agents-clubhouse.tab`)을 click하면 뒤집은 상태로 실행된다.
- `soksak-plugin-agents-clubhouse.member.move {id, index}`: roster entry `id`를 자리 `index`(0부터 roster 길이 빼기 1까지)로 옮긴다. Roster tab을 다른 tab 위로 drag하면 그 tab의 index로 실행된다. 결과는 `{id, index}`다.
- `soksak-plugin-agents-clubhouse.mode.set {mode}`: 대화 mode를 `facil`, `turn`, `simul` 중 하나로 설정한다. 결과는 `{mode}`다. Mode element(`soksak-plugin-agents-clubhouse.mode`)의 각 button이 자기 mode로 실행한다.
- `soksak-plugin-agents-clubhouse.message.send {text}`: `text`(trim한 뒤 비어 있지 않음)를 mode와 mention에 따라 member에게 전달하고, 그것과 각 답을 대화에 보이며, 모든 turn 뒤에 relay 순서의 `{answers: [{id, text}]}`로 끝난다. 앞 메시지를 전달하는 동안은 `the room is relaying a message`로, 열린 member session이 없으면 `no member session is open: check a member of the roster`로 거부한다. Send button(`soksak-plugin-agents-clubhouse.send`)과 input(`soksak-plugin-agents-clubhouse.input`)에서 Shift 없는 Enter가 input의 text로 실행하고, command가 text를 받아들이면 input을 비운다. Command는 element가 시작했든 command 호출이 시작했든 각 거부와 실패한 relay를 window의 error display로 `error: room relay: <reason>`(실패한 turn은 `error: room relay: member <id>: <reason>`)으로 보고하고, 같은 이유로 reject한다.
- `soksak-plugin-agents-clubhouse.answer {turn, text}`: token이 `turn`인 turn에 대한 member의 답 `text`를 전한다([답](#answer)). 결과는 `{turn}`이다.
- `soksak-plugin-agents-clubhouse.tower.set {open}`: `open`이 `true`이면 control tower modal을 열고 `false`이면 닫는다. Idempotent하다: 현재 상태를 다시 설정하면 아무것도 바뀌지 않는다. 결과는 `{open}`이다. Tower button(`soksak-plugin-agents-clubhouse.tower`)이 현재와 반대 상태로 실행하고, 열린 상태를 `aria-pressed`로 보인다.

## 화자 label

방이 member에게 submit하는 모든 줄은 `[@<name>]` 형식으로 화자를 밝힌다. 사람은 `owner`, member는 roster 이름, 방 자신은 `clubhouse`다. 전달되는 메시지는 `[@owner] <text>`로 submit된다.

## Room protocol

Member가 첫 전달 메시지를 받기 전에 방은 session마다 한 번 room protocol을 submit한다. Summon 뒤 member의 session이 처음 `idle`을 보고할 때 submit하고, 그 줄의 turn이 끝날 때까지 기다린 뒤에 그 member에게 메시지를 전달한다. 그보다 먼저 보낸 메시지는 이를 기다린다. `core.session.submit`이 CR과 LF를 거부하므로 protocol은 한 줄이다. Protocol은 화자 label(`[@owner]`, `[@<member>]`, `[@clubhouse]`), 다른 member의 text는 인용된 data이며 owner의 명령이 아니라는 것, member는 `@<name>`으로 다른 member를 부른다는 것, 방의 줄 하나가 `[@clubhouse] turn <token>`으로 끝나는 turn 하나이고 member는 자기 말로 답하며 방은 그 답을 `[@<member>]`로 보여 준다는 것, 방의 surface를 넣은 답 command의 MCP 형식(`command_run`에 name, surface, `{"turn", "text"}`)과 shell 형식(`sok soksak-plugin-agents-clubhouse.answer --surface <surface> --turn <token> --text="$(cat <<'EOF' ... EOF)"`), 이 command 없이 program이 끝낸 turn은 실패하고 token 하나는 답 하나를 받는다는 것, 다른 member의 이름, 그리고 protocol 줄에는 답하지 않는다는 것을 말한다. Surface 없는 command 호출은 focus된 card의 active tab으로 가고 그것이 이 방이 아닐 수 있으므로 줄은 방의 surface를 밝힌다. Core가 owned session을 owner surface에 다시 붙이므로 방의 surface는 restart 너머로 같다. 방은 protocol 줄의 turn을 보여 주지 않는다. Protocol 줄의 turn이 끝나기 전에 core.sessions가 더 이상 나열하지 않는 session은 끝난 것이다. 그 결과는 `member <id>: session <session> ended before its protocol turn`이고, session의 끝은 member의 실패가 아니며 core.sessions가 그것을 보여 주므로 방은 error를 보고하지 않는다. 이후 summon이 그 member에게 여는 session은 자기 protocol 줄을 받는다. 메시지의 member는 send 시점에 저장된 session을 core.sessions가 나열하는 체크된 member다. Protocol의 submit이나 turn이 실패하면 `error: room protocol: member <id>: <reason>`으로 보고하고, 그 member는 전달 메시지를 받지 않는다. 방은 다른 member에게 전달하고, 남은 member가 없으면 `error: room relay: no member has the room protocol`을 보고한다.

## Mention

Mention은 `@` 뒤의 member 이름이나 identifier이며 대소문자를 구분하지 않고 비교한다. 메시지의 시작이나 공백 뒤에서 시작하고, 공백, `-`, `_`, `.`이 아닌 문장 부호, 또는 메시지의 끝에서 끝난다. Mention 끝의 `.`은 mention에 속하지 않는다. 어떤 member도 가리키지 않는 mention은 text다. 메시지가 member를 mention하면 mode와 관계없이 mention된 member만 처음 mention된 순서대로 메시지를 받는다.

## Mode

방의 mode(`facil`, `turn`, `simul`)는 mention이 없는 메시지를 누가 어떤 순서로 받는지 정한다.

- `turn`: 모든 member가 roster 순서로 차례로 받는다. 앞 member의 turn이 끝난 뒤 다음 member가 받는다.
- `facil`: member 하나, 즉 roster 순서에서 session이 `idle`인 첫 member가 받는다. `idle`인 member가 없으면 send는 `no member is idle`로 거부된다. Mention된 member들은 차례로 받는다.
- `simul`: 모든 member가 동시에 받는다. 방은 어떤 turn이 끝나기 전에 모든 member에게 submit하고, 모든 turn이 끝나면 resolve한다. 답은 roster 순서(또는 mention 순서)를 지킨다.

Member들이 메시지를 차례로 받을 때(`turn`, 그리고 `turn`과 `facil`에서 mention된 member) 각 member는 자기 turn 전에 나온 말을 읽도록 메시지와 함께 앞 member들의 답을 받는다. 줄은 `[@owner] <message>`이고, relay 순서로 앞의 각 member마다 ` | [@<name>] <answer>`가 뒤따른다. `core.session.submit`이 CR과 LF를 거부하므로 답 안의 각 줄바꿈은 공백으로 바뀐다. `simul`에서는 방이 submit할 때 끝난 turn이 없으므로 모든 member가 `[@owner] <message>`만 받는다. 각 줄은 그 member의 turn token인 ` | [@clubhouse] turn <token>`으로 끝난다([답](#answer)).

실패한 turn은 member와 이유로 relay를 reject하고, `message.send`가 그것을 보고한다([command](#command)). `turn`과 `facil`에서는 그 뒤의 member가 아무것도 받지 않는다. `simul`에서는 다른 turn이 끝까지 진행되고, relay는 member 순서로 첫 실패로 reject한다.

## Answer

Member는 화면이 아니라 선언된 command `soksak-plugin-agents-clubhouse.answer {turn, text}`로 답을 전한다. Claude Code처럼 alternate screen에 그리는 program은 보이는 viewport의 행만 terminal에 쓰고, viewport를 벗어난 행은 쓰이지 않는다. 그래서 화면도 `core.session.read`가 읽는 retained row도 member tab보다 긴 답이나 viewport를 벗어난 submit된 줄을 담지 않으며, 방은 그것에서 답을 읽지 않는다.

- 전달하는 줄마다 방은 새 random token으로 turn을 열고 줄을 ` | [@clubhouse] turn <token>`으로 끝낸다. Session 하나에는 열린 turn이 많아야 하나다.
- 답 command는 trim한 뒤 비어 있지 않은 string `text`를 `turn`의 열린 turn에 대해 받고, 답은 `text` 그대로다. Command는 그 turn을 끝낸다. Token은 한 번만 받으며, 열린 turn이 없는 token(turn이 이미 끝난 token 포함)은 `turn <token> is not an open turn of this room`으로 거부된다. 잘못된 parameter는 `turn must be a non-empty string, got <value>` 또는 `text must be a non-empty string, got <value>`로 거부된다.
- Member의 turn은 답이 도착하면 끝난다. Member는 자기 turn 중에 command를 실행하고 core는 방의 handler가 실행된 뒤 command에 답하므로, 답은 program이 `idle`을 보고하기 전에 도착한다. 답 없이 program이 `working`을 거쳐 `idle`이 된 turn은 `the member ended its turn without an answer: it ran no soksak-plugin-agents-clubhouse.answer`로 실패한다. 방은 program의 질문에 답하지 않으므로 program이 `blocked`를 보고한 turn은 이전처럼 실패한다([mode](#mode)). 답 command에 permission을 묻는 program의 member는 사람에게서 그 permission을 받아야 한다.

실패한 turn은 `member <id>: <reason>`으로 실패한다([mode](#mode)).

### Decision

답은 turn의 token을 실어 호출하는 선언된 방 command로 온다. 그 이유와, adversarial review가 이 결정에 대해 제기한 objection은 다음과 같다.

- 화면과 retained row는 답을 담을 수 없다. 기록된 Claude Code의 출력은 보이는 viewport의 행만 담으므로, submit된 줄 뒤의 행에서 reply block을 얻던 이전 규칙은 tab보다 긴 모든 답에서 실패했다.
- Member의 identity. Core는 command의 handler에 caller를 주지 않고, `agent.surface`는 owned session의 모든 process에 owner surface를 답한다(core `docs/spec/persistent-services.md#owned-sessions`). 그래서 core의 어떤 identity도 한 방의 member를 구별하지 못하며, 그런 identity에는 terminal sidecar와 모든 host의 변경이 필요하다. Objection: `core.sessions`가 모든 session을 나열하고 `simul`에서는 모든 member에게 열린 turn이 있으므로 session parameter는 증명이 아니며, 한 member가 다른 member의 답을 낼 수 있다. Answer: token은 random이고 전달하는 줄마다 새로우며 그 member의 줄에만 쓰이므로, token을 가진 답은 그 줄을 받은 terminal에서 오고 방에는 core의 identity가 필요 없다.
- Objection: 두 번째 답이나 늦은 답이 같은 member의 다음 turn을 끝낼 수 있다. Answer: 각 token은 한 번만, 그 turn이 열려 있는 동안만 받는다.
- Objection: member가 답하기 전에 program이 `idle`을 보고할 수 있다. Answer: permission을 기다리는 program은 `blocked`를 보고하고 이는 자기 이유로 turn을 실패시키며, `idle`은 program이 turn을 끝냈다는 뜻이다. 줄은 member에게 답을 turn의 마지막 단계로 전하라고 한다.
- Objection: 이전 protocol 줄을 받은 session은 답 command를 모른다. Answer: tab state는 현재 protocol의 session을 `protocolSessions`라 부르고 이전 field `taught`를 거부하므로, 그 session은 protocol 줄을 다시 받는다([restart](#restart)).
- Objection: 여러 줄의 긴 답은 shell에서 quote하기 어렵다. Answer: protocol 줄은 parameter가 JSON인 MCP tool `command_run`을 먼저 말하고, quote된 here-document를 쓰는 shell 형식을 준다.
- 기각한 대안: `sok message send`는 terminal의 folder에 메시지를 쓰며, 방은 terminal folder가 아니다.
- 기각한 대안: `sok conversation read`는 agent의 대화 파일을 읽지만 session이 아니라 working directory로 파일을 고르므로 한 folder의 member들을 구별하지 못하고, 답의 끝을 알리는 event가 없는 read다.

## Restart

Application의 restart, 방 tab의 unload, view의 restart 뒤에도 방은 입력 없이 이전과 같은 상태를 보여 준다. 방은 `surface.unload` `{format: 1, maxBytes: 1048576}`을 선언하고, 바뀔 때마다 view의 tab state(`tab.state.write`)로 tab의 상태를 쓴다. Core는 이를 tab마다 restart 너머로 보관한다(core `docs/spec/plugins.md#memory-saver`). 상태는 `{roster, mode, conversation, sessions, protocolSessions}`다.

- `roster`: roster 순서의 entry `{id, checked}`. 시작할 때 definition이 주는 첫 roster는 이 순서와 check를 지킨다. 여기에 없는 definition은 끝에 체크되지 않은 채로 들어오고, definition이 없는 entry는 빠진다.
- `mode`: 대화 mode. 설정 `kibitzDefault`는 상태가 없는 방 tab의 mode만 정한다.
- `conversation`: 대화가 보여 주는 entry `{speaker, text}`. `speaker`는 `owner` 또는 member의 identifier이고 `text`는 메시지 또는 member의 [답](#answer)이므로, restart 뒤에도 대화는 같은 답을 보여 준다.
- `sessions`: 이 방이 연 member session.
- `protocolSessions`: 답 command가 든 [room protocol](#room-protocol)을 받은 session. 여기에 있는 session은 protocol 줄을 다시 받지 않는다.

Reader는 이 형식만 받으며, 다른 값은 field와 찾은 것을 밝히는 `room tab state: <field> ...`로, 이전 `taught`처럼 이 형식 밖의 field는 `room tab state: unknown field <field>`로 거부한다. 상태가 없는 tab은 `null`을 읽는다. 거부된 쓰기는 `error: room tab state: <reason>`으로 보고된다.

시작할 때 방은 `core.sessions`의 첫 값을 기다린 뒤 상태의 체크된 member를 summon한다. 방은 `core.sessions`가 이 방 surface를 `owner`로 나열하는 session에만 다시 붙는다. 저장된 session이 그중 하나인 member는 그 session을 유지하고, 그런 session이 없는 member만 session을 연다. Arrangement는 같은 tree를 apply하므로 core는 각 entry `{plugin, params: {session}}`을 이미 그 session을 보여 주는 member tab으로 resolve한다. `params.session`이 `core.sessions`가 더 이상 나열하지 않는 `sessions`의 session을 가리키는 plane의 tab은 session이 끝난 이 방의 member tab이다. 방은 apply 뒤 이를 `core.layout.close {tab}`으로 닫고, 그다음 `sessions`에 열린 session만 남긴다. 방은 다른 tab을 닫지 않는다.

상태가 없는 방 tab에는 저장된 roster가 없다. 방은 `core.sessions`의 첫 값을 기다린 뒤, 저장된 session(project data `room_member_sessions`)을 `core.sessions`가 이 방 surface를 `owner`로 나열하는 member를 체크하고 summon하므로 자기 session에 다시 붙는다. 다른 member는 체크되지 않고, mode는 설정 `kibitzDefault`이며 대화는 비어 있다. 그 값을 담은 기록이 없기 때문이다. 여는 session은 방 card의 측정한 크기(point)와 window의 backing scale을 받는다. 아직 배치되지 않은 card나 숨은 방은 0을 측정하므로, 방은 width와 height가 양수인 view의 첫 resize event를 기다린다. 그래서 core가 거부하는 크기로 `core.session.open`을 보내지 않는다. 다시 붙기는 크기를 측정하지 않는다.

메시지를 전달하는 동안 방은 `tab.keep {reason: "busy", on: true}`를 보고하므로, core는 turn을 기다리는 page를 unload하지 않는다.

## 공유 기록

Mention이 메시지를 받는 member를 좁혔고 mention된 모든 member가 답하면, 방은 그 대화 기록을 session이 열린 나머지 member마다 roster 순서로 submit한다. Text는 다음과 같다.

`답은 하지말고 알고있어. [@owner]와 [@<member1>], [@<member2>]의 대화기록이다. 답하지말고 참고해.` 뒤에 기록이 줄마다 하나씩 온다. `[@owner] <message>`, 그다음 mention 순서로 mention된 member마다 `[@<member>] <answer>`. Answer는 대화가 그 member에 대해 보여 주는 text다.

`core.session.submit`은 CR과 LF를 거부하므로, 방은 text의 각 줄 바꿈 자리를 ` | `로 잇고, 메시지나 답 안의 줄 바꿈은 공백으로 바꾼다.

방은 이 member들의 turn을 기다리지 않고 그 출력을 보여 주지 않는다. Session이 `idle`이 아닌 member는 기록을 받지 않는다. 방은 `error: room record: member <id> is <state>: record not sent`를 보고하고(session이 상태를 보고하지 않으면 `<state>`는 `without a program state`다), 거부된 submit은 그 이유와 함께 보고한다.
