# Room relay

[English](room.md)

방은 입력창의 메시지를 owned session이 열린 체크된 member에게 전달한다. Member는 메시지를 turn의 token으로 끝나는 submit된 한 줄(`core.session.submit`)로 받고, 선언된 command `soksak-plugin-agents-clubhouse.answer`로 답을 전한다. 그 답이 도착하면 turn이 끝난다([답](#answer)).

## Roster

Roster는 agents plugin의 agent definition마다 entry 하나를 나열한다. Entry는 그 definition이 있는 동안 체크 상태와 자리를 유지한다. 제거된 definition은 roster에서 빠지고, 새 definition은 체크되지 않은 채 끝에 들어온다. Member를 초대하는 것은 사람의 선택이기 때문이다. 체크된 member가 바뀌면 open session이 없는 체크된 member를 summon한다.

## Header

방의 header는 plugin 이름, roster tab, mode button, tower button, transport status로 된 한 줄이며, card가 그 부분들보다 좁으면 다음 줄로 줄바꿈한다. Roster tab은 최소 120 point를 차지하고 자기 부분 안에서 가로로 scroll하므로, 좁은 card도 member를 보인다. 각 button은 text를 한 줄로 유지한다. Transport status는 남은 폭으로 줄고, 잘리면 ellipsis로 끝나며, 전체 text를 tooltip으로 보인다.

## Arrangement

Summon 뒤 방은 방 card와 member card로 된 이름 `Room`의 group card를 `core.layout.plan`으로 계획하고, 계획이 feasible하면 `core.layout.apply`로 만든다. 그렇지 않으면 각 member는 현재 card의 tab으로 열린다. 각 member tab entry는 `{plugin, params: {session, title}}`이다. `session`은 member의 owned session이고, `title`은 방이 member에 보이는 이름, 곧 그 definition의 이름이며, member tab의 plugin이 tab의 title로 보인다(terminal plugin `docs/spec/tab-title.md`). Title은 `tab.title`의 text 규칙, 곧 control character 없는 1~256자를 따른다. 방은 다른 이름을 layout command를 보내기 전에 `arrangement member <session>: the tab title must be a text of 1 to 256 characters without control characters`로 거부하고 `error: room arrangement: <reason>`으로 보고한다. `surface.params`에 `title`을 선언하지 않은 member tab의 plugin은 core의 params 검사로 entry를 거부하며, 방은 그 거부를 같은 방식으로 보고한다. Terminal plugin은 0.0.53부터 `title`을 선언한다. Arrangement는 `close`를 넘기지 않으므로, core는 plane의 다른 모든 tab을 tree의 첫 card, 곧 방 card의 끝에 비활성 tab으로 남기고, 방 tab은 그 card의 활성 tab으로 남는다. Core는 plugin과 params가 entry와 같을 때만 tab을 재사용하므로, 이전 형식 `{session}`의 entry처럼 다른 params로 member session을 보이는 tab은 남고, core는 view가 그 session에 붙지 못하는 새 tab을 연다. 그래서 방은 apply 전에 `core.sessions`에서 각 member session의 `shownBy`를 읽고, 각 entry가 재사용하는 tab을 `cards`로 밝히는 plan이 보이는 tab을 재사용하지 않으면 그 tab을 `core.layout.close {tab}`으로 닫은 뒤 다시 plan한다. Session은 열린 채 남고 entry의 새 tab이 그것을 보인다. 실행할 수 없는 plan은 tab을 밝히지 않으므로 방은 그때 tab을 닫지 않는다. 방은 이 tab과 끝난 자기 session의 member tab만 닫으며([restart](#restart)), 자기가 열지 않은 tab은 닫지 않는다. 사람의 tab은 저장하지 않은 작업을 가질 수 있고, 그것을 닫는 것은 사람의 선택이기 때문이다.

## Command

방의 모든 operation은 선언된 command를 실행하고, 방의 element는 page의 binder(`expose.bind`)로 이 command에 연결된다. 그래서 click과 command 호출은 같은 경로를 실행한다. 각 command는 잘못된 parameter를 그 parameter와 값을 밝힌 error로 거부한다.

- `soksak-plugin-agents-clubhouse.member.set {id, checked}`: roster entry `id`의 체크 상태를 설정하고 체크된 member를 summon한다. Idempotent하다: 현재 상태를 다시 설정하면 아무것도 바뀌지 않고 summon도 없다. 알 수 없는 `id`는 `member <id> is not in the roster`로 거부한다. 결과는 `{id, checked}`다. Roster tab(`soksak-plugin-agents-clubhouse.tab`)을 click하면 뒤집은 상태로 실행된다.
- `soksak-plugin-agents-clubhouse.member.move {id, index}`: roster entry `id`를 자리 `index`(0부터 roster 길이 빼기 1까지)로 옮긴다. Roster tab을 다른 tab 위로 drag하면 그 tab의 index로 실행된다. 결과는 `{id, index}`다.
- `soksak-plugin-agents-clubhouse.mode.set {mode}`: 대화 mode를 `facil`, `turn`, `simul` 중 하나로 설정한다. 결과는 `{mode}`다. Mode element(`soksak-plugin-agents-clubhouse.mode`)의 각 button이 자기 mode로 실행한다.
- `soksak-plugin-agents-clubhouse.message.send {text}`: `text`(trim한 뒤 비어 있지 않음)를 mode와 mention에 따라 member에게 전달하고, 그것과 각 답을 대화에 보이며, 전체 [대화](#conversation) 뒤에 turn 순서의 `{answers: [{id, text}]}`로 끝난다. 앞 메시지를 전달하는 동안은 `the room is relaying a message`로, 열린 member session이 없으면 `no member session is open: check a member of the roster`로 거부한다. Send button(`soksak-plugin-agents-clubhouse.send`)과 input(`soksak-plugin-agents-clubhouse.input`)에서 Shift 없는 Enter가 input의 text로 실행하고, command가 text를 받아들이면 input을 비운다. Command는 element가 시작했든 command 호출이 시작했든 각 거부와 실패한 relay를 window의 error display로 `error: room relay: <reason>`(실패한 turn은 `error: room relay: member <id>: <reason>`)으로 보고하고, 같은 이유로 reject한다.
- `soksak-plugin-agents-clubhouse.conversation.stop {}`: 현재 메시지의 relay를 이미 시작한 turn 뒤에 끝내고([대화](#conversation)), record acknowledgement를 기다리는 각 기다림을 끝낸다([closing delivery](#closing-delivery)). Relay가 진행되는 동안 idempotent하다: 두 번째 호출은 아무것도 바꾸지 않는다. Relay도 record 기다림도 없으면 `the room is relaying no message`로 거부한다. 결과는 `{stopped: true}`다. 메시지를 전달하거나 record 기다림이 열려 있는 동안에만 켜지는 중지 button(`soksak-plugin-agents-clubhouse.stop`)이 실행한다.
- `soksak-plugin-agents-clubhouse.answer {turn, text}`: token이 `turn`인 turn에 대한 member의 답 `text`를 전한다([답](#answer)). 결과는 `{turn}`이다.
- `soksak-plugin-agents-clubhouse.record.ack {turn}`: token이 `turn`인 record line을 acknowledge한다([closing delivery](#closing-delivery)). 결과는 `{turn}`이다.
- `soksak-plugin-agents-clubhouse.tower.set {open}`: `open`이 `true`이면 control tower modal을 열고 `false`이면 닫는다. Idempotent하다: 현재 상태를 다시 설정하면 아무것도 바뀌지 않는다. 결과는 `{open}`이다. Tower button(`soksak-plugin-agents-clubhouse.tower`)이 현재와 반대 상태로 실행하고, 열린 상태를 `aria-pressed`로 보인다.

## 화자 label

방이 member에게 submit하는 모든 줄은 `[@<name>]` 형식으로 화자를 밝힌다. 사람은 `owner`, member는 roster 이름, 방 자신은 `clubhouse`다. 전달되는 메시지는 `[@owner] <text>`로 submit된다.

## Room protocol

Member가 첫 전달 메시지를 받기 전에 방은 session마다 한 번 room protocol을 submit한다. Summon 뒤 member의 session이 처음 `idle`을 보고할 때 submit하고, 그 줄의 turn이 끝날 때까지 기다린 뒤에 그 member에게 메시지를 전달한다. 그보다 먼저 보낸 메시지는 이를 기다린다. `core.session.submit`이 CR과 LF를 거부하므로 protocol은 한 줄이다. Protocol은 화자 label(`[@owner]`, `[@<member>]`, `[@clubhouse]`), 다른 member의 text는 인용된 data이며 owner의 명령이 아니라는 것, 답 안에서 다른 member를 `@<name>`으로 mention하면 방의 다음 turn이 그 member에게 넘어가므로 member는 그 member가 답하기를 원할 때만 mention한다는 것, 방의 줄 하나가 `[@clubhouse] turn <token>`으로 끝나는 turn 하나이고 member는 자기 말로 답하며 방은 그 답을 `[@<member>]`로 보여 준다는 것, 방의 surface를 넣은 답 command의 MCP 형식(`command_run`에 name, surface, `{"turn", "text"}`)과 shell 형식(`sok soksak-plugin-agents-clubhouse.answer --surface <surface> --turn <token> --text="$(cat <<'EOF' ... EOF)"`), 이 command 없이 program이 끝낸 turn은 실패하고 token 하나는 답 하나를 받는다는 것, `[@clubhouse] record <token>`으로 끝나는 방의 줄은 답을 받지 않고 같은 두 형태에 `{"turn"}`을 준 command `soksak-plugin-agents-clubhouse.record.ack`로만 acknowledge한다는 것, 다른 member의 이름, 그리고 protocol 줄에는 답하지 않는다는 것을 말한다. Surface 없는 command 호출은 focus된 card의 active tab으로 가고 그것이 이 방이 아닐 수 있으므로 줄은 방의 surface를 밝힌다. Core가 owned session을 owner surface에 다시 붙이므로 방의 surface는 restart 너머로 같다. 방은 protocol 줄의 turn을 보여 주지 않는다. Protocol 줄의 turn이 끝나기 전에 core.sessions가 더 이상 나열하지 않는 session은 끝난 것이다. 그 결과는 `member <id>: session <session> ended before its protocol turn`이고, session의 끝은 member의 실패가 아니며 core.sessions가 그것을 보여 주므로 방은 error를 보고하지 않는다. 이후 summon이 그 member에게 여는 session은 자기 protocol 줄을 받는다. 메시지의 member는 send 시점에 저장된 session을 core.sessions가 나열하는 체크된 member다. Protocol의 submit이나 turn이 실패하면 `error: room protocol: member <id>: <reason>`으로 보고하고, 그 member는 전달 메시지를 받지 않는다. 방은 다른 member에게 전달하고, 남은 member가 없으면 `error: room relay: no member has the room protocol`을 보고한다.

방은 member의 terminal text를 읽을 수 없다. Claude Code는 alternate screen에 그리고, 방은 화면에서 답을 읽지 않는다([답](#answer)). Member가 자기 terminal에 쓴 text는 아무에게도 전달되지 않으므로, protocol이 내용 손실을 막는 수단이고 방의 live check가 그것을 측정한다. 긴 protocol은 재진술을 부르므로 protocol 줄은 짧은 명령문이며 다음 규칙을 말한다. 모든 말은 답이나 report, claim으로 방을 통해 한다([work reports](#work-reports)). Tool이 필요로 하는 것 외에는 terminal에 아무것도 쓰지 않는다. Owner에게 할 말은 답의 section `@owner:`에 넣는다([section](#sections)). 할 일을 미리 말하지 않고, 답을 보냈다고 확인하지 않는다. 화자가 한 말에 답한다. 각 turn 줄은 token 앞에 `[@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal`을 담는다.

## Mention

Mention은 `@` 뒤의 member 이름이나 identifier이며 대소문자를 구분하지 않고 비교한다. 메시지의 시작이나 공백 뒤에서 시작하고, 공백, `-`, `_`, `.`이 아닌 문장 부호, 또는 메시지의 끝에서 끝난다. Mention 끝의 `.`은 mention에 속하지 않는다. 어떤 member도 가리키지 않는 mention은 text다. Mention은 turn의 순서를 정하고 받는 member를 줄이지 않는다. Mention된 member가 처음 mention된 순서로 차례로 첫 turn을 받고, mode의 다른 member가 roster 순서로 뒤따르므로, 뒤의 각 member는 mention된 member의 답을 읽는다. Roster가 A, B, C일 때 메시지 `@B 정리해 줘. 나머지는 보태 줘.`는 turn을 B, A, C 순서로 주고, A의 turn 줄은 B의 답을 담는다. 답의 section `@<name>:`([section](#sections))도 mention이다.

## Mode

방의 mode(`facil`, `turn`, `simul`)는 메시지를 누가 어떤 순서로 받는지 정한다. Mention된 member가 먼저 turn을 받는다([mention](#mention)).

- `turn`: 모든 member가 roster 순서로 차례로 받는다. 앞 member의 turn이 끝난 뒤 다음 member가 받는다.
- `facil`: member 하나, 즉 roster 순서에서 session이 `idle`인 첫 member가 받는다. `idle`인 member가 없으면 send는 `no member is idle`로 거부된다. Mention된 member들은 차례로 받는다.
- `simul`: 모든 member가 동시에 받는다. 방은 어떤 turn이 끝나기 전에 모든 member에게 submit하고, 모든 turn이 끝나면 resolve한다. 답은 roster 순서(또는 mention 순서)를 지킨다.

모든 member는 room record 전체를 읽는다([room record](#room-record)). Member가 자기 turn 시작에 받는 줄은 그 member가 아직 받지 않은 모든 record 줄을 record 순서로 담고, 그 member의 turn token인 ` | [@clubhouse] turn <token>`으로 끝난다([답](#answer)). Member들이 메시지를 차례로 받을 때(`turn`, 그리고 `turn`과 `facil`에서 mention된 member) 이번 relay에서 앞 member들의 답은 record 줄이므로, 각 member는 자기 turn 전에 나온 말을 읽는다. `simul`에서는 방이 어떤 turn이 끝나기 전에 모든 member에게 submit하므로 각 줄은 owner의 메시지에서 끝나고, 그 relay의 답은 각 member의 다음 turn에 전달된다.

실패한 turn은 member와 이유로 relay를 reject하고, `message.send`가 그것을 보고한다([command](#command)). Core가 submit을 하나도 받아들이지 않은 relay는 owner의 줄을 room record와 대화에서 거둔다. 그 밖의 실패한 relay는 owner의 줄과 도착한 모든 답을 유지하고 방의 줄 `[@clubhouse] the relay failed: <reason>`을 덧붙인다([room record](#room-record)). `turn`과 `facil`에서는 그 뒤의 member가 아무것도 받지 않는다. `simul`에서는 다른 turn이 끝까지 진행되고, relay는 member 순서로 첫 실패로 reject한다.

## Conversation

한 메시지의 member들은 그 relay 안에서 대화한다. 방이 답을 record에 덧붙일 때, relay의 member, 즉 열린 session과 room protocol이 있는 체크된 member 사이에서 [mention 규칙](#mention)으로 그 답의 mention을 읽는다. 화자 자신의 mention과 다른 이름의 mention은 text다. 이 relay의 turn을 아직 기다리지 않는 각 mention된 member는 이미 기다리는 turn 뒤에 처음 mention된 순서로 turn을 받고, 받지 않은 record 줄을 받으므로([room record](#room-record)) 자기를 mention한 답을 읽는다. 그 답이 다시 다른 member를 mention할 수 있고, 대화는 같은 방식으로 이어진다. `simul`에서 방은 모든 turn이 끝난 뒤 그 relay의 답의 mention을 member 순서로 읽는다. 답이 시작하는 turn은 모든 mode에서 차례로 진행된다.

Plugin setting `conversationTurns`는 0부터 64까지의 정수이고 기본값은 48이며, owner의 메시지 하나에 대해 mention과 [settling](#settling)의 round가 시작하는 turn의 최대 수다. Turn이 기다리고 그런 turn이 그 수만큼 진행되었으면 relay는 끝나고 방은 record 줄 `[@clubhouse] the conversation ended: it reached the limit of <n> member turns`를 덧붙인다. Owner는 `conversation.stop`으로 대화를 끝낸다([command](#command)). 이미 시작한 turn은 끝까지 진행되고 더 이상 turn이 시작되지 않으며, 기다리던 turn이 있었으면 방은 `[@clubhouse] the conversation ended: the owner stopped it`을 덧붙인다. 방의 줄은 speaker가 `clubhouse`인 record와 [conversation status](#conversation-status)의 항목이며, 각 member는 다음 turn에 그것을 받는다. 한도와 중지는 실패 없이 relay를 끝내므로 `message.send`는 도착한 답으로 끝난다. 대화의 turn이 실패하면 [mode](#mode)에서처럼 relay가 실패하고 도착한 답은 유지된다.

## Settling

각 답은 status를 밝힌다. 열린 질문, 이견, 남은 작업이 있으면 `continue`, member의 몫이 끝나고 검증되었으며 더 할 말이 없으면 `settled`다. 답 command는 그 밖의 값을 `status must be continue or settled, got <value>`로 거부한다. Relay의 turn이 기다리지 않고 relay의 어떤 member의 마지막 답이 `continue`이면 방은 round를 시작한다. Relay의 모든 member가 roster 순서로 turn을 받고 받지 않은 record 줄을 받으므로, owner의 메시지 하나가 대화를 끝까지 진행한다. 모든 member의 마지막 답이 `settled`이면 방은 `[@clubhouse] the conversation settled`를 덧붙인다. 다른 member의 결론보다 먼저 `continue`로 답한 member는 다음 round의 turn과 함께 결론을 받는다. Round는 `conversationTurns`에 들어간다. Member가 continue인 채로 한도가 relay를 끝내면 방은 마지막 답이 `continue`인 각 member를 밝혀 `[@clubhouse] the conversation ended without settling: it reached the limit of <n> member turns; @<name> continue`를 덧붙인다. 기본값 48은 member 세 명의 round 16번이며, 계획 합의, 구현, 검증 보고를 거치는 개발 작업 하나의 크기다.

## Sections

여러 화자에게 답하는 답은 말한 화자의 순서대로 화자마다 section 하나를 둔다. Section은 자기 줄의 `@<name>:`로 시작하며, `<name>`은 member의 이름이나 identifier 또는 `owner`이고 대소문자를 구분하지 않는다. `@all:`은 나머지를 담고, 첫 section 앞의 text는 `all`에 속한다. Record는 답의 text를 바꾸지 않는다. Room view는 section마다 addressee를 머리로 단 block 하나를 그리고, [conversation status](#conversation-status)의 각 항목은 `sections: [{to, text}]`를 가지며 `to`는 `owner`, `all` 또는 member identifier다. Section 줄이 없는 답은 `[]`이다.

## Roles

각 roster 항목은 role을 가진다. Role은 control 문자가 없는 0자에서 200자의 text이며, member의 roster input이나 `member.role {id, role}`로 정하고 tab state에 남는다. Protocol 줄은 member의 role을 밝히고, relay의 어떤 member에게 role이 있으면 각 turn 줄은 token 앞에 `[@clubhouse] roles: you are <role>; <name>: <role>, ...`를 담으므로, 각 member는 자기 role과 다른 member의 role을 읽는다.

## Work reports

Member는 turn 동안 `soksak-plugin-agents-clubhouse.report {turn, text}`로 작업을 보고하고, 고칠 path를 `claim {turn, paths}`로 claim하고 `release {turn, paths}`로 release한다. 각 command는 member를 증명하는 열린 turn의 token만 받는다. Record token은 `turn <token> is a record line: only the token of a turn reports, claims or releases`로 거부된다. 각각은 member의 record 줄 `(report) <text>`, `(claim) <paths>`, `(release) <paths>`이다. 두 path가 같거나 하나가 다른 하나 뒤에 `/`가 이어진 것이면 두 claim은 겹친다. 방은 다른 handler보다 먼저 끝까지 실행되는 handler에서 각 claim을 정하므로, 다른 member의 claim과 겹치는 claim은 `paths <path> are claimed by <member>`로, member가 가지지 않은 path의 release는 `path <path> is not claimed by <member>`로 거부된다. Turn의 claim은 turn이 닫힐 때 release된다.

방은 보내지 않은 줄을 program이 `working`인 각 session에 바로 submit한다. 줄은 `답하지 말고 하던 작업을 계속해.`로 시작하고 token이 없으므로, member는 작업 중에 읽고 답하지 않는다. Idle session은 다음 turn 줄이나 record 줄과 함께 받고, blocked session은 core.sessions의 event가 다시 working을 보여 줄 때 받는다. 방은 session마다 두 수를 둔다. `sent`는 core가 받아들인 줄의 record 길이이며 다음 줄이 여기서 시작하고, `delivered`는 답이나 acknowledgement가 올 때만 `max(count, sent)`로 오른다. Session마다 submit queue가 하나이므로, session의 다음 줄은 core가 앞 submit에 답한 뒤에만 sent 수로 만들어진다.

## Room record

Room record는 방의 대화다. Owner의 각 메시지 줄, 각 member의 답, 방의 각 줄을 방이 받은 순서로 담는다. 방은 `message.send`가 owner의 줄을 받아들일 때 그 줄을, 각 답이 도착할 때 그 답을 덧붙인다. `simul`에서는 모든 turn이 끝난 뒤 그 relay의 답을 member 순서로 덧붙이며, 다른 turn이 실패한 relay의 답도 그렇게 한다.

방은 record를 각 member session에 전달한다. Record의 줄은 `[@<speaker>] <text>`이고 text 안의 줄바꿈은 공백으로 바뀌며, 한 submit의 줄은 ` | `로 잇는다. `core.session.submit`이 CR과 LF를 거부하기 때문이다. 방은 session마다 delivered number `d`, 즉 그 session이 받은 record 줄의 수를 보관한다(`delivered`, [tab state](#restart)). 수가 없는 session은 아무 줄도 받지 않았다. Session이 받지 않은 record 줄은 `d`부터 record 끝까지의 줄에서 그 member가 직접 한 줄을 뺀 것이다. Member가 그 줄을 준 당사자이기 때문이다. 전달은 다음 불변식을 지킨다.

- Turn completeness: turn의 줄은 session이 받지 않은 record 줄을 record 순서로 담으므로, member는 답하기 전에 그때까지 나온 모든 줄을 읽는다.
- Closing completeness: 방은 relay마다 끝에 각 member session에 받지 않은 record 줄을 보낸다([closing delivery](#closing-delivery)).
- Exactly once and in order: 각 submit은 `d`부터 방이 줄을 만들 때의 record 길이 `n`까지의 줄을 담고, submit의 token은 `n`을 기록한다. `d`는 turn token의 [답](#answer)이나 record token의 acknowledgement가 도착할 때만 `n`으로 오른다. 받아들여진 submit은 program이 그 줄을 읽었다는 것을 알려 주지 않기 때문이다(core `docs/spec/persistent-services.md#owned-sessions`). 수는 내려가지 않으므로 한 session의 submit들은 record를 0부터 빈틈도 겹침도 없이 덮는다.
- One open line per session: session은 turn이나 record line의 열린 token을 많아야 하나 가진다. Session의 다음 줄은 그 token이 답이나 acknowledgement를 받고 session의 program이 `idle`을 보고할 때까지 기다리므로, 다음 줄은 program의 turn 안에 들어가지 않는다.
- Restart recovery: 열린 token은 tab state에 남으므로, restart 뒤에 도착한 답이나 acknowledgement도 `d`를 올리고, 방은 그 뒤 남은 줄을 전달한다([restart](#restart)).

Core가 owner 줄의 submit을 하나도 받아들이지 않은 send는 그 줄을 거둔다. 방은 그 줄을 record와 대화에서 지우고, `message.send`는 실패를 error display로 보고하므로([command](#command)) 이유는 남는다. 어떤 session도 그 줄을 받지 않았으므로 record를 넘는 delivered number는 없다. Record에는 어떤 member도 받지 않은 메시지가 없으므로, 그런 실패 뒤에 다시 보낸 send는 owner의 줄 하나만 남긴다. Core가 submit을 받아들인 뒤 실패한 send는 owner의 줄과 도착한 답을 유지하고, 방은 `[@clubhouse] the relay failed: <reason>`을 덧붙인다. `<reason>`은 실패한 turn의 `member <id>: <reason>`이므로 모든 member가 relay가 실패했다는 것을 읽는다.

## Closing delivery

Relay가 정상으로 끝나든, turn 한도나 owner의 중지로 끝나든, 실패로 끝나든, 모든 mode에서 relay가 끝나면 방은 먼저 owner의 줄을 거두거나 실패 줄을 덧붙이고([room record](#room-record)), 그 뒤 각 member session에 받지 않은 record 줄을 보낸다. Closing delivery의 session은 체크된 member의 session 중 `core.sessions`가 나열하고 [room protocol](#room-protocol)을 받은 session이다. 체크가 해제된 member는 다시 체크된 뒤의 첫 turn에 그 줄을 받는다. 받지 않은 줄이 모두 자기 member의 줄인 session은 submit을 받지 않고, 그 delivered number는 record 길이가 된다.

Record line은 `답은 하지말고 알고있어. [@owner]와 [@<member1>], [@<member2>]의 대화기록이다. 답하지말고 참고해.` 뒤에 ` | `, session이 받지 않은 record 줄, 그리고 session의 새 record turn의 무작위 token인 ` | [@clubhouse] record <token>`이 온다. 이름은 그 줄에서 말하는 member를 첫 줄의 순서로 적은 것이다. Member는 `soksak-plugin-agents-clubhouse.record.ack {turn}`으로 acknowledge하고 아무것도 답하지 않는다. Acknowledgement는 delivered number를 줄을 만들 때의 record 길이로 올린다. Token은 한 번 acknowledge되고, 열린 record line이 아닌 token은 `turn <token> is not an open record line of this room`으로 거부된다. Answer command는 record token을 `turn <token> is a record line: acknowledge it with soksak-plugin-agents-clubhouse.record.ack`로, acknowledgement는 turn token을 `turn <token> is a turn: answer it with soksak-plugin-agents-clubhouse.answer`로 거부한다. 방이 acknowledgement를 기다리는 동안 member는 [conversation status](#conversation-status)의 `waiting`에 step `record`로 있다. 기다림은 그 token의 acknowledgement로만 끝난다. 현재 program state는 읽었다는 증거가 아니기 때문이다.

`message.send`는 closing delivery가 줄을 submit하면 끝나고, acknowledgement 기다림은 relay 뒤에도 이어진다. 이 기다림 중에도 다음 `message.send`는 받아들여지며, record line이 열린 member의 turn 줄은 그 acknowledgement와 program의 다음 `idle` 뒤에 submit된다. `conversation.stop`은 record acknowledgement의 각 기다림도 끝낸다. 방은 token을 닫고 `error: room record: member <id>: record wait stopped`를 보고하며, delivered number를 그대로 두고, 다음 relay까지 그 session에 closing delivery를 보내지 않으므로 그 session의 다음 turn이나 closing delivery가 그 줄을 담는다.

Closing delivery 때 실패한 member나 `blocked`처럼 `idle`이 아닌 session은 줄을 받지 않는다. 방은 `error: room record: member <id> is <state>`를 보고하고(session이 state를 보고하지 않으면 `<state>`는 `without a program state`), delivered number를 그대로 두며, [conversation status](#conversation-status)의 `delivery`에 그 session을 pending으로 표시한다. 거부된 submit은 `error: room record: member <id>: <reason>`으로 보고하고 그 session도 pending으로 표시한다. Relay가 없는 동안 pending session이 `idle`인 `core.sessions`의 각 값, token의 각 답이나 acknowledgement, 방 시작의 끝은 받을 줄이 있는 session에 closing delivery를 다시 실행한다. 방은 pending session의 state를 pending이 될 때 한 번 보고한다. 끝난 session은 전달에서 빠진다. 나중 summon이 member에게 여는 session은 수가 없으므로 첫 줄에서 record 전체를 받는다.

Relay가 없고 closing delivery의 기다림도 열려 있지 않으면, pending이 아니고 record 기다림이 중지되지 않은 closing delivery의 모든 session은 `delivery`에서 `delivered`가 `length`와 같다.

## Conversation status

선언된 status `soksak-plugin-agents-clubhouse.conversation`은 page가 보여 주는 대화 `{entries: [{speaker, text}], waiting: [{member, session, step, program}], delivery: [{member, session, delivered, length, pending}]}`를 담는다. `entries`는 [room record](#room-record)의 항목을 record 순서로 담으며, `speaker`는 `owner`, member의 식별자, 또는 방의 줄일 때 `clubhouse`다([대화](#conversation)). 방은 record가 바뀔 때마다, 실패한 send가 owner의 줄을 거둘 때도 새 값을 게시하므로, 호출자는 그려진 page가 아니라 status에서 대화를 읽는다.

`waiting`은 방이 turn을 기다리는 각 member를 기다림이 시작된 순서로 밝힌다. `step`은 session의 첫 `idle`을 기다리는 [room protocol](#room-protocol) turn의 시작부터 그 turn이 끝날 때까지 `protocol`이고, 전달된 줄의 submit부터 그 [답](#answer)이 도착하거나 turn이 실패할 때까지 `answer`이며, [closing delivery](#closing-delivery)의 record line submit부터 그 acknowledgement가 도착하거나 `conversation.stop`이 기다림을 끝낼 때까지 `record`다. `program`은 `core.sessions` 현재 값에서 그 session의 program state다. `idle`, `working`, `blocked`이며, core가 아무 state도 보고하지 않는 동안은 `null`, `core.sessions`가 그 session을 더 이상 나열하지 않으면 `ended`다. 폴더에서 처음 시작할 때 Claude Code의 folder-trust prompt처럼 첫 `idle` 전에 자기 질문에서 멈춘 program은 그 member를 step `protocol`로 `waiting`에 남긴다. 그 답은 사람의 결정이므로 방은 program의 질문에 답하지 않고, 어느 member를 기다리는지 보여 주며, 사람은 그 member의 tab에서 답한다. `delivery`는 [closing delivery](#closing-delivery)의 각 session을 roster 순서로 밝힌다. `delivered`는 그 delivered number, `length`는 record 길이, `pending`은 방이 그 session의 줄을 전달하려고 다음 `idle`을 기다리는지다. Relay와 기다림 밖에서 `delivered`가 `length`보다 작은 session에는 받지 않은 줄이 있다. 방은 기다림이 시작되거나 끝날 때, record나 delivered number가 바뀔 때, `core.sessions`의 각 값에서 timer 없이 새 값을 게시한다. Page는 대화 아래에 기다리는 member마다 page의 언어로 한 줄을 보여 준다. 영어는 `waiting for <name>: <step>, program <program>`, 한국어는 `<name> 기다리는 중: <step>, program <program>`이며, `<name>`은 roster 이름이다.

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

Application의 restart, 방 tab의 unload, view의 restart 뒤에도 방은 입력 없이 이전과 같은 상태를 보여 준다. 방은 `surface.unload` `{format: 1, maxBytes: 1048576}`을 선언하고, 바뀔 때마다 view의 tab state(`tab.state.write`)로 tab의 상태를 쓴다. Core는 이를 tab마다 restart 너머로 보관한다(core `docs/spec/plugins.md#memory-saver`). 상태는 `{roster, mode, conversation, sessions, protocolSessions, delivered, turns}`다.

- `roster`: roster 순서의 entry `{id, checked}`. 시작할 때 definition이 주는 첫 roster는 이 순서와 check를 지킨다. 여기에 없는 definition은 끝에 체크되지 않은 채로 들어오고, definition이 없는 entry는 빠진다.
- `mode`: 대화 mode. 설정 `kibitzDefault`는 상태가 없는 방 tab의 mode만 정한다.
- `conversation`: 대화가 보여 주는 entry `{speaker, text}`. `speaker`는 `owner` 또는 member의 identifier이고 `text`는 메시지 또는 member의 [답](#answer)이므로, restart 뒤에도 대화는 같은 답을 보여 준다.
- `sessions`: 이 방이 연 member session.
- `protocolSessions`: 답 command가 든 [room protocol](#room-protocol)을 받은 session. 여기에 있는 session은 protocol 줄을 다시 받지 않는다.
- `delivered`: member session을 방이 그 session에 전달한 [room record](#room-record) 줄의 수로 잇는 object. 수는 0부터 `conversation` 길이까지의 정수다.
- `turns`: 열린 token `{turn, session, member, kind, count}`. `kind`는 turn의 token이면 `answer`, record line의 token이면 `record`이고, `member`는 그 member의 식별자, `count`는 줄을 만들 때의 record 길이로 0부터 `conversation` 길이까지의 정수다. Restart 뒤에도 방은 그 답과 acknowledgement를 받는다. 둘 다 session의 delivered number를 `count`로 올리고, restart로 relay가 끝난 turn의 답은 `member`의 답으로 record에 덧붙인다. Restart 전부터 남은 token의 기다림은 그 답, acknowledgement, `conversation.stop`으로만 끝난다.

Reader는 이 형식만 받으며, 다른 값은 field와 찾은 것을 밝히는 `room tab state: <field> ...`로, 이전 `taught`처럼 이 형식 밖의 field는 `room tab state: unknown field <field>`로 거부한다. 상태가 없는 tab은 `null`을 읽는다. JSON이 `surface.unload`의 1048576 byte보다 큰 상태는 쓰지 않고 `error: room tab state: the state is <n> bytes, over the limit of 1048576 bytes`로 보고한다. 거부된 쓰기는 `error: room tab state: <reason>`으로 보고된다.

시작할 때 방은 `core.sessions`의 첫 값을 기다린 뒤 상태의 체크된 member를 summon한다. 방은 `core.sessions`가 이 방 surface를 `owner`로 나열하는 session에만 다시 붙는다. 저장된 session이 그중 하나인 member는 그 session을 유지하고, 그런 session이 없는 member만 session을 연다. Arrangement는 같은 tree를 apply하므로 core는 각 entry `{plugin, params: {session, title}}`을 이미 그 session을 보여 주는 member tab으로 resolve한다. `params.session`이 `core.sessions`가 더 이상 나열하지 않는 `sessions`의 session을 가리키는 plane의 tab은 session이 끝난 이 방의 member tab이다. 방은 apply 뒤 이를 `core.layout.close {tab}`으로 닫고, 그다음 `sessions`에 열린 session만 남긴다. 방은 다른 tab을 닫지 않는다.

상태가 없는 방 tab에는 저장된 roster가 없다. 방은 `core.sessions`의 첫 값을 기다린 뒤, 저장된 session(project data `room_member_sessions`의 문서 `<room surface>/<agentId>`)을 `core.sessions`가 이 방 surface를 `owner`로 나열하는 member를 체크하고 summon하므로 자기 session에 다시 붙는다. 다른 member는 체크되지 않고, mode는 설정 `kibitzDefault`이며 대화는 비어 있다. 그 값을 담은 기록이 없기 때문이다. Member relation 문서는 식별자가 `<room surface>/<agentId>`인 `{surface, agentId, sessionId, cwd, savedAt}`이므로 한 project의 두 방은 relation을 따로 보관한다. Store는 다른 형식의 문서를 `room_member_sessions <id>: <field> ...`로 거부한다. Summon은 자기가 연 session을 `core.sessions`가 나열할 때까지 열린 것으로 세므로, `core.sessions`가 session을 나열하기 전에 실행된 summon은 두 번째 session을 열지 않는다. Store가 relation의 put을 거부한 session은 `core.session.end {session}`으로 끝내고, summon은 그 이유로 reject한다. 여는 session은 방 card의 측정한 크기(point)와 window의 backing scale을 받는다. 아직 배치되지 않은 card나 숨은 방은 0을 측정하므로, 방은 width와 height가 양수인 view의 첫 resize event를 기다린다. 그래서 core가 거부하는 크기로 `core.session.open`을 보내지 않는다. 다시 붙기는 크기를 측정하지 않는다.

메시지를 전달하는 동안 방은 `tab.keep {reason: "busy", on: true}`를 보고하므로, core는 turn을 기다리는 page를 unload하지 않는다.
