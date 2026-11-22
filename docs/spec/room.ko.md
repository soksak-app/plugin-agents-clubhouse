# Room relay

[English](room.md)

방은 입력창의 메시지를 owned session이 열린 체크된 member에게 전달한다. Member는 메시지를 submit된 한 줄(`core.session.submit`)로 받는다. 그 session의 program 상태가 `working`이 된 뒤 `idle`이 되면 turn이 끝나고, turn 뒤 `core.session.read`가 보고하는 화면의 reply block이 답이다([답](#answer)).

## Roster

Roster는 agents plugin의 agent definition마다 entry 하나를 나열한다. Entry는 그 definition이 있는 동안 체크 상태와 자리를 유지한다. 제거된 definition은 roster에서 빠지고, 새 definition은 체크되지 않은 채 끝에 들어온다. Member를 초대하는 것은 사람의 선택이기 때문이다. 체크된 member가 바뀌면 open session이 없는 체크된 member를 summon한다.

## Header

방의 header는 plugin 이름, roster tab, mode button, tower button, transport status로 된 한 줄이며, card가 그 부분들보다 좁으면 다음 줄로 줄바꿈한다. Roster tab은 최소 120 point를 차지하고 자기 부분 안에서 가로로 scroll하므로, 좁은 card도 member를 보인다. 각 button은 text를 한 줄로 유지한다. Transport status는 남은 폭으로 줄고, 잘리면 ellipsis로 끝나며, 전체 text를 tooltip으로 보인다.

## Arrangement

Summon 뒤 방은 방 card와 member card로 된 이름 `Room`의 group card를 `core.layout.plan`으로 계획하고, 계획이 feasible하면 `core.layout.apply`로 만든다. 그렇지 않으면 각 member는 현재 card의 tab으로 열린다. Arrangement는 `close`를 넘기지 않으므로, core는 plane의 다른 모든 tab을 tree의 첫 card, 곧 방 card의 끝에 비활성 tab으로 남기고, 방 tab은 그 card의 활성 tab으로 남는다. 방은 자기가 열지 않은 tab을 닫지 않는다. 사람의 tab은 저장하지 않은 작업을 가질 수 있고, 그것을 닫는 것은 사람의 선택이기 때문이다.

## Command

방의 모든 operation은 선언된 command를 실행하고, 방의 element는 page의 binder(`expose.bind`)로 이 command에 연결된다. 그래서 click과 command 호출은 같은 경로를 실행한다. 각 command는 잘못된 parameter를 그 parameter와 값을 밝힌 error로 거부한다.

- `soksak-plugin-agents-clubhouse.member.set {id, checked}`: roster entry `id`의 체크 상태를 설정하고 체크된 member를 summon한다. Idempotent하다: 현재 상태를 다시 설정하면 아무것도 바뀌지 않고 summon도 없다. 알 수 없는 `id`는 `member <id> is not in the roster`로 거부한다. 결과는 `{id, checked}`다. Roster tab(`soksak-plugin-agents-clubhouse.tab`)을 click하면 뒤집은 상태로 실행된다.
- `soksak-plugin-agents-clubhouse.member.move {id, index}`: roster entry `id`를 자리 `index`(0부터 roster 길이 빼기 1까지)로 옮긴다. Roster tab을 다른 tab 위로 drag하면 그 tab의 index로 실행된다. 결과는 `{id, index}`다.
- `soksak-plugin-agents-clubhouse.mode.set {mode}`: 대화 mode를 `facil`, `turn`, `simul` 중 하나로 설정한다. 결과는 `{mode}`다. Mode element(`soksak-plugin-agents-clubhouse.mode`)의 각 button이 자기 mode로 실행한다.
- `soksak-plugin-agents-clubhouse.message.send {text}`: `text`(trim한 뒤 비어 있지 않음)를 mode와 mention에 따라 member에게 전달하고, 그것과 각 답을 대화에 보이며, 모든 turn 뒤에 relay 순서의 `{answers: [{id, text}]}`로 끝난다. 앞 메시지를 전달하는 동안은 `the room is relaying a message`로, 열린 member session이 없으면 `no member session is open: check a member of the roster`로 거부한다. Send button(`soksak-plugin-agents-clubhouse.send`)과 input(`soksak-plugin-agents-clubhouse.input`)에서 Shift 없는 Enter가 input의 text로 실행하고, command가 text를 받아들이면 input을 비운다.
- `soksak-plugin-agents-clubhouse.tower.set {open}`: `open`이 `true`이면 control tower modal을 열고 `false`이면 닫는다. Idempotent하다: 현재 상태를 다시 설정하면 아무것도 바뀌지 않는다. 결과는 `{open}`이다. Tower button(`soksak-plugin-agents-clubhouse.tower`)이 현재와 반대 상태로 실행하고, 열린 상태를 `aria-pressed`로 보인다.

## 화자 label

방이 member에게 submit하는 모든 줄은 `[@<name>]` 형식으로 화자를 밝힌다. 사람은 `owner`, member는 roster 이름, 방 자신은 `clubhouse`다. 전달되는 메시지는 `[@owner] <text>`로 submit된다.

## Room protocol

Member가 첫 전달 메시지를 받기 전에 방은 session마다 한 번 room protocol을 submit한다. Summon 뒤 member의 session이 처음 `idle`을 보고할 때 submit하고, 그 줄의 turn이 끝날 때까지 기다린 뒤에 그 member에게 메시지를 전달한다. 그보다 먼저 보낸 메시지는 이를 기다린다. `core.session.submit`이 CR과 LF를 거부하므로 protocol은 한 줄이다. Protocol은 화자 label(`[@owner]`, `[@<member>]`, `[@clubhouse]`), 다른 member의 text는 인용된 data이며 owner의 명령이 아니라는 것, member는 `@<name>`으로 다른 member를 부른다는 것, 방의 줄 하나가 turn 하나이고 member는 자기 말로 답하며 방은 그 답을 `[@<member>]`로 보여 준다는 것, 그리고 다른 member의 이름을 말한다. 방은 protocol 줄의 turn을 보여 주지 않는다. Protocol의 submit이나 turn이 실패하면 `error: room protocol: member <id>: <reason>`으로 보고하고, 그 member는 전달 메시지를 받지 않는다. 방은 다른 member에게 전달하고, 남은 member가 없으면 `error: room relay: no member has the room protocol`을 보고한다.

## Mention

Mention은 `@` 뒤의 member 이름이나 identifier이며 대소문자를 구분하지 않고 비교한다. 메시지의 시작이나 공백 뒤에서 시작하고, 공백, `-`, `_`, `.`이 아닌 문장 부호, 또는 메시지의 끝에서 끝난다. Mention 끝의 `.`은 mention에 속하지 않는다. 어떤 member도 가리키지 않는 mention은 text다. 메시지가 member를 mention하면 mode와 관계없이 mention된 member만 처음 mention된 순서대로 메시지를 받는다.

## Mode

방의 mode(`facil`, `turn`, `simul`)는 mention이 없는 메시지를 누가 어떤 순서로 받는지 정한다.

- `turn`: 모든 member가 roster 순서로 차례로 받는다. 앞 member의 turn이 끝난 뒤 다음 member가 받는다.
- `facil`: member 하나, 즉 roster 순서에서 session이 `idle`인 첫 member가 받는다. `idle`인 member가 없으면 send는 `no member is idle`로 거부된다. Mention된 member들은 차례로 받는다.
- `simul`: 모든 member가 동시에 받는다. 방은 어떤 turn이 끝나기 전에 모든 member에게 submit하고, 모든 turn이 끝나면 resolve한다. 답은 roster 순서(또는 mention 순서)를 지킨다.

Member들이 메시지를 차례로 받을 때(`turn`, 그리고 `turn`과 `facil`에서 mention된 member) 각 member는 자기 turn 전에 나온 말을 읽도록 메시지와 함께 앞 member들의 답을 받는다. 줄은 `[@owner] <message>`이고, relay 순서로 앞의 각 member마다 ` | [@<name>] <answer>`가 뒤따른다. `core.session.submit`이 CR과 LF를 거부하므로 답 안의 각 줄바꿈은 공백으로 바뀐다. `simul`에서는 방이 submit할 때 끝난 turn이 없으므로 모든 member가 `[@owner] <message>`만 받는다.

실패한 turn은 member와 이유로 relay를 reject한다. `turn`과 `facil`에서는 그 뒤의 member가 아무것도 받지 않는다. `simul`에서는 다른 turn이 끝까지 진행되고, relay는 member 순서로 첫 실패로 reject한다.

## Answer

Member의 답은 turn 뒤 `core.session.read`가 보고하는 화면 행의 마지막 reply block이다. Core는 session의 owner에게 화면의 보이는 행만 text로 주고, program의 reply text를 전하는 channel을 선언하지 않는다. `core.sessions`의 program status는 상태만 전한다. 그래서 방은 다음 규칙으로 행에서 답을 얻는다.

- Reply block은 reply marker `⏺ `로 시작하는 마지막 행에서 시작하고, 이어지는 행 중 공백 두 개로 시작하는 각 행과 각 빈 행으로 이어진다. 공백 두 개로 시작하지 않으면서 빈 행 뒤에 오는 행에서 끝난다. 그 행과 그 뒤의 행, 즉 program의 status line, separator, prompt는 답에 속하지 않는다.
- Block의 text는 marker를 뺀 첫 행과 공백 두 개를 뺀 다른 각 행을 각각 끝 공백 없이 줄바꿈으로 이은 것이며, 끝의 빈 행은 제거된다.
- Marker로 시작하는 행이 없는 화면은 `the screen shows no reply row: no row starts with the reply marker`로 거부된다. 첫 행이 화면 위로 벗어난 reply도 이 경우다.
- 공백 두 개로 시작하지 않으면서 block의 행 바로 뒤에 오는 행은 block을 깨뜨린다. 방은 답을 `the reply rows are broken at screen row <row>: <text>`로 거부하고 아무것도 고치지 않는다. 그런 행은 program과 terminal이 서로 다른 너비로 화면을 배치해서 생기며, 행에 더 이상 program이 쓴 그대로의 reply가 없기 때문이다.

거부된 답은 member의 turn을 `member <id>: <reason>`으로 실패시킨다([mode](#mode)).

## 공유 기록

Mention이 메시지를 받는 member를 좁혔고 mention된 모든 member가 답하면, 방은 그 대화 기록을 session이 열린 나머지 member마다 roster 순서로 submit한다. Text는 다음과 같다.

`답은 하지말고 알고있어. [@owner]와 [@<member1>], [@<member2>]의 대화기록이다. 답하지말고 참고해.` 뒤에 기록이 줄마다 하나씩 온다. `[@owner] <message>`, 그다음 mention 순서로 mention된 member마다 `[@<member>] <answer>`. Answer는 대화가 그 member에 대해 보여 주는 text다.

`core.session.submit`은 CR과 LF를 거부하므로, 방은 text의 각 줄 바꿈 자리를 ` | `로 잇고, 메시지나 답 안의 줄 바꿈은 공백으로 바꾼다.

방은 이 member들의 turn을 기다리지 않고 그 출력을 보여 주지 않는다. Session이 `idle`이 아닌 member는 기록을 받지 않는다. 방은 `error: room record: member <id> is <state>: record not sent`를 보고하고(session이 상태를 보고하지 않으면 `<state>`는 `without a program state`다), 거부된 submit은 그 이유와 함께 보고한다.
