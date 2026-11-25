# Room relay

[English](room.md)

방은 입력창의 메시지를 owned session이 열린 체크된 member에게 전달한다. Member는 메시지를 turn의 token으로 끝나는 submit된 한 줄(`core.session.submit`)로 받고, 선언된 command `soksak-plugin-agents-clubhouse.answer`로 답을 전한다. 그 답이 도착하면 turn이 끝난다([답](#answer)).

## Manifest

`sok plugin install`이 같은 text로 manifest를 거부하므로, `plugin.json`은 plugin이 설치되는 core version의 release인 `@soksak/plugin-api`의 `validateManifest`를 통과한다. Test `src/manifest-validation.test.ts`가 이를 호출한다. Status와 command schema는 core exposure schema subset의 keyword `type`, `properties`, `required`, `items`, `enum`만 쓰고, `minimum` 같은 범위는 description에 적는다.

## Roster

방은 시작할 때 definition을 읽고, agents plugin의 project data가 바뀔 때마다 다시 읽는다. 그 변경은 `runtime.data.on`과 `{plugin: "agents"}`로 따른다. 그래서 agents plugin이 나중에 더한 definition은 재시작 없이 roster와 `definitions` 목록에 들어온다. Roster는 agents plugin의 agent definition마다 entry 하나를 나열한다. Entry는 그 definition이 있는 동안 membership, 체크 상태와 자리를 유지한다. 제거된 definition은 roster에서 빠지고, 새 definition은 방의 member가 아닌 채 끝에 들어온다. Member를 초대하는 것은 사람의 선택이기 때문이다. 방의 member는 사람이 초대한 entry이고([invite](#invite)), 체크된 entry는 다음 메시지를 받는 member다. 선택과 membership은 다르다: 체크되지 않은 member는 session과 함께 방에 남고 다시 체크될 때까지 줄을 받지 않으며, member만 체크된다. Member가 바뀌면 open session이 없는 member를 summon한다. program이 Claude Code이고 definition이 `core.roles`에 agent file을 가진 member는 team member처럼([team](#team)) 선언된 program `agent-file`로 읽은 그 file의 frontmatter name으로 `--agent <name>`과 함께 시작하므로, 그 member는 자기 agent의 지시와 도구로 실행된다.

## Header

방의 header는 plugin 이름, member card, mode button, transport status로 된 한 줄이며, card가 그 부분들보다 좁으면 다음 줄로 줄바꿈한다. Member 부분은 label `받는 멤버`와 개수 `<checked> / <members> 선택`으로 시작하고, member마다 card 하나를 roster 순서로 나열한 뒤 초대 button `+`로 끝난다. 이 부분은 최소 120 point를 차지하고 자기 부분 안에서 가로로 scroll하므로, 좁은 card도 member를 보인다. Card는 member 이름의 initials(첫 두 단어의 첫 글자, 한 단어 이름이면 첫 두 글자, 대문자), 이름, 그리고 role input과 member 상태의 둘째 줄을 보인다. 상태는 방이 그 member의 답을 기다리는 동안 `응답 중`, session이 열려 있고 기다리는 답이 없으면 `대기`, 열린 session이 없으면 `세션 없음`이며, 마지막 경우 card 테두리는 점선이다. 계정의 home에 login이 없는 동안은 `로그인 필요`와 `로그인` button을 보인다([login](#login)). Role input 밖에서 card를 누르면 뒤집은 상태로 `member.set`이 실행되고, 체크된 card는 강조되며, card를 다른 card 위로 drag하면 `member.move`, 오른쪽 click은 `member.leave`가 실행된다([command](#command)). Header는 member가 아닌 entry를 나열하지 않는다. 언어가 한국어가 아닌 page는 이 text를 `Receivers`, `<checked> / <members> selected`, `answering`, `idle`, `no session`, `login needed`, `Log in`으로 보인다. 각 button은 text를 한 줄로 유지한다. Transport status는 남은 폭으로 줄고, 잘리면 ellipsis로 끝나며, 전체 text를 tooltip으로 보인다.

방의 tab은 멤버의 이름을 roster 순서로 ` · `로 이어 보이고, 멤버가 없으면 plugin 이름을 보인다. 방은 roster가 바뀔 때마다 그것을 `tab.title`로 보고하므로 두 방이 구별되고 core는 기본 제목을 보이지 않는다. 이름의 control character는 지우고, 256자보다 긴 제목은 256자에서 말줄임표로 끝난다. `tab.title`이 1자에서 256자를 받기 때문이다.

## Invite

방은 `plugin.json` `dialogs`에 page `ui/invite.html`의 dialog `invite`를 선언한다(core `docs/spec/plugins.md#dialogs`). `invite`는 params `{definitions, groups, members}`로 그것을 연다. `definitions`는 roster 순서의 roster entry `{id, name}`, `groups`는 group identifier 순서의 agents data `groups` `{id, name, members}`이며 각 `members`는 저장된 순서의 그 group definition, `members`는 방 member의 identifier다. Page는 다른 형식의 params를 `invite params: <field> ...`로 거부하고, 그것을 자기 error로 보인 뒤 `null`로 닫는다.

Dialog는 definitions section처럼 definition을 나열한다: 각 group 아래 그 definition, 그 다음 `그룹 없음` 아래 어느 group에도 없는 definition. 각 definition 줄에는 check box가 있다. 방의 member는 이미 방에 있으므로 체크되고 비활성이며, 두 group에 있는 definition은 두 줄에서 하나의 선택이다. Button `초대`(`soksak-plugin-agents-clubhouse.invite.pick {ids}`)는 고른 definition 중 member가 아닌 것의 identifier를 roster 순서로 담은 `{ids}`로 dialog를 닫고, 고른 것이 없으면 비활성이다. Button `취소`와 Escape(`soksak-plugin-agents-clubhouse.invite.cancel {}`)는 `null`로 닫는다. `invite`는 고른 identifier마다 그 순서로 `member.join`을 실행하고, dialog가 열려 있는 동안 roster에서 빠진 identifier는 `member.join`이 거부한다.

## Arrangement

Summon 뒤 방은 방 card와 member card로 된 이름 `Room`의 group card를 `core.layout.plan`으로 계획하고, 계획이 feasible하면 `core.layout.apply`로 만든다. 그렇지 않으면 각 member는 현재 card의 tab으로 열린다. 각 member tab entry는 `{plugin, params: {session, title}}`이다. `session`은 member의 owned session이고, `title`은 방이 member에 보이는 이름, 곧 그 definition의 이름이며, member tab의 plugin이 tab의 title로 보인다(terminal plugin `docs/spec/tab-title.md`). Title은 `tab.title`의 text 규칙, 곧 control character 없는 1~256자를 따른다. 방은 다른 이름을 layout command를 보내기 전에 `arrangement member <session>: the tab title must be a text of 1 to 256 characters without control characters`로 거부하고 `error: room arrangement: <reason>`으로 보고한다. `surface.params`에 `title`을 선언하지 않은 member tab의 plugin은 core의 params 검사로 entry를 거부하며, 방은 그 거부를 같은 방식으로 보고한다. Terminal plugin은 0.0.53부터 `title`을 선언한다. Arrangement는 `close`를 넘기지 않으므로, core는 plane의 다른 모든 tab을 tree의 첫 card, 곧 방 card의 끝에 비활성 tab으로 남기고, 방 tab은 그 card의 활성 tab으로 남는다. Core는 plugin과 params가 entry와 같을 때만 tab을 재사용하므로, 이전 형식 `{session}`의 entry처럼 다른 params로 member session을 보이는 tab은 남고, core는 view가 그 session에 붙지 못하는 새 tab을 연다. 그래서 방은 apply 전에 `core.sessions`에서 각 member session의 `shownBy`를 읽고, 각 entry가 재사용하는 tab을 `cards`로 밝히는 plan이 보이는 tab을 재사용하지 않으면 그 tab을 `core.layout.close {tab}`으로 닫은 뒤 다시 plan한다. Session은 열린 채 남고 entry의 새 tab이 그것을 보인다. 실행할 수 없는 plan은 tab을 밝히지 않으므로 방은 그때 tab을 닫지 않는다. 방은 이 tab과 끝난 자기 session의 member tab만 닫으며([restart](#restart)), 자기가 열지 않은 tab은 닫지 않는다. 사람의 tab은 저장하지 않은 작업을 가질 수 있고, 그것을 닫는 것은 사람의 선택이기 때문이다.

## Command

방의 모든 operation은 선언된 command를 실행하고, 방의 element는 page의 binder(`expose.bind`)로 이 command에 연결된다. 그래서 click과 command 호출은 같은 경로를 실행한다. 각 command는 잘못된 parameter를 그 parameter와 값을 밝힌 error로 거부한다.

- `soksak-plugin-agents-clubhouse.member.set {id, checked}`: member `id`의 체크 상태를 설정하며, 이 상태가 다음 메시지를 받을지를 정한다. Idempotent하다: 현재 상태를 다시 설정하면 아무것도 바뀌지 않는다. 알 수 없는 `id`는 `member <id> is not in the roster`로, member가 아닌 entry는 `member <id> is not a member of the room`으로 거부한다. 결과는 `{id, checked}`다. Member card(`soksak-plugin-agents-clubhouse.tab`)를 누르면 뒤집은 상태로 실행된다.
- `soksak-plugin-agents-clubhouse.invite {}`: [invite](#invite) dialog를 열고 사람이 거기서 고른 definition을 `member.join`으로 초대한다. 결과는 `{invited}`, 들어온 identifier이며 사람이 취소하면 비어 있다. Header의 `+` button(`soksak-plugin-agents-clubhouse.invite`)이 실행한다.
- `soksak-plugin-agents-clubhouse.member.join {id}`: roster entry `id`를 방의 체크된 member로 만들고 summon한다. Idempotent하다: member는 그대로다. 알 수 없는 `id`는 `member <id> is not in the roster`로 거부한다. 결과는 `{id}`다.
- `soksak-plugin-agents-clubhouse.member.leave {id}`: member `id`를 방에서 뺀다: membership, 체크 상태, leader를 지우고, 열린 session을 `core.session.end {session}`으로 끝내며, `core.sessions`가 그 session을 더 나열하지 않으면 arrangement가 그 tab을 닫게 한다. Idempotent하다: member가 아닌 entry는 아무것도 바꾸지 않는다. 알 수 없는 `id`는 `member <id> is not in the roster`로 거부한다. 결과는 `{id}`다. Member card를 오른쪽 click하면 실행된다.
- `soksak-plugin-agents-clubhouse.member.move {id, index}`: roster entry `id`를 자리 `index`(0부터 roster 길이 빼기 1까지)로 옮긴다. Roster tab을 다른 tab 위로 drag하면 그 tab의 index로 실행된다. 결과는 `{id, index}`다.
- `soksak-plugin-agents-clubhouse.member.leader {id, leader}`: `leader`가 `true`이면 member `id`를 [leader](#leader)로 정하고 check하며 다른 모든 entry의 leader를 지우고, `false`이면 지운다. Idempotent하다. 결과는 `{id, leader}`다.
- `soksak-plugin-agents-clubhouse.member.summon {turn, definition, role, directory}`: leader의 turn token으로 [team](#team)의 member를 summon한다. 결과는 `{member, session}`이다.
- `soksak-plugin-agents-clubhouse.definitions {}`: `member.summon`이 받는 agent definition을 roster의 agents definition에서 `{definitions: [{id, name, plugin, groups, file}]}`로 나열한다. `groups`는 그 definition을 가진 agents data `groups`의 group 이름을 group 식별자 순서로 밝히고, `file`은 role 식별자가 definition 식별자와 같은 `core.roles`의 그 role의 첫 file이며, `core.roles`가 file을 나열하지 않으면 null이다. 방은 agent file을 읽지 않는다. Leader 줄이 leader에게 고르기 전에 각 `file`을 읽으라고 하므로, 줄에는 definition 목록이 없다.
- `soksak-plugin-agents-clubhouse.member.release {turn, member}`: leader의 turn token으로 [team](#team) member `member`의 session을 끝내고 tab을 닫으며 team에서 빼고 `@<name> was released`를 기록한다. Git은 건드리지 않는다. 결과는 `{member}`다.
- `soksak-plugin-agents-clubhouse.member.merged {turn, member, commit}`: leader의 turn token으로 team member `member`의 branch가 `commit`(1부터 64자까지의 text)에서 merge되었다고 기록하고 team view가 이를 보여 준다. 방은 git 상태를 읽지 않는다. 결과는 `{member, commit}`다.
- `soksak-plugin-agents-clubhouse.member.retask {turn, member, definition, role}`: leader의 turn token으로 [team](#team) member `member`에게 agent definition `definition`과 role text `role`을 주고 그 대화를 유지한다([retask](#team)). 결과는 `{member, definition}`다.
- `soksak-plugin-agents-clubhouse.mode.set {mode}`: 대화 mode를 `facil`, `turn`, `simul` 중 하나로 설정한다. 결과는 `{mode}`다. Mode element(`soksak-plugin-agents-clubhouse.mode`)의 각 button이 자기 mode로 실행한다.
- `soksak-plugin-agents-clubhouse.message.send {text}`: `text`(trim한 뒤 비어 있지 않음)를 mode와 mention에 따라 member에게 전달하고, 그것과 각 답을 대화에 보이며, 전체 [대화](#conversation) 뒤에 turn 순서의 `{answers: [{id, text}]}`로 끝난다. 앞 메시지를 전달하는 동안의 send는 그 대화에 [owner follow-up](#owner-follow-up)으로 더해지고 바로 `{answers: []}`로 끝난다. 열린 member session이 없으면 `no member session is open: check a member of the roster`로 거부한다. Send button(`soksak-plugin-agents-clubhouse.send`)과 input(`soksak-plugin-agents-clubhouse.input`)에서 Shift 없는 Enter가 input의 text로 실행하고, command가 text를 받아들이면 input을 비운다. Command는 element가 시작했든 command 호출이 시작했든 각 거부와 실패한 relay를 window의 error display로 `error: room relay: <reason>`(실패한 turn은 `error: room relay: member <id>: <reason>`)으로 보고하고, 같은 이유로 reject한다.
- `soksak-plugin-agents-clubhouse.conversation.stop {}`: 현재 메시지의 relay를 끝낸다([대화](#conversation)). 더 이상 turn이 시작되지 않고, 방이 답을 기다리는 turn은 답 없이 끝난다([turn end](#turn-end)). Restart 전부터 남은 각 token의 기다림도 끝낸다([restart](#restart)). Relay가 진행되는 동안 idempotent하다: 두 번째 호출은 아무것도 바꾸지 않는다. Relay도 남은 token도 없으면 `the room is relaying no message`로 거부한다. Team이 있으면 모든 team member의 session도 끝내고 team을 비우며 `the team was released`를 기록한다. 결과는 `{stopped: true}`다. 중지 button(`soksak-plugin-agents-clubhouse.stop`)이 실행하며, 이 button은 메시지를 전달하거나 남은 token이 열려 있는 동안에만 enabled이고, 그 밖에는 disabled이며 disabled로 그려진다. View status `soksak-plugin-agents-clubhouse.view`는 `stopEnabled`를 가진다.
- `soksak-plugin-agents-clubhouse.answer {turn, text}`: token이 `turn`인 turn에 대한 member의 답 `text`를 전한다([답](#answer)). 결과는 `{turn, next}`이며, 응답이 member가 turn에서 마지막으로 읽는 text이므로 `next`는 `The room has your answer and your turn ended. Nobody reads your terminal: end now with the single text . and nothing else.`이다.

## 화자 label

방이 member에게 submit하는 모든 줄은 `[@<name>]` 형식으로 화자를 밝힌다. 사람은 `owner`, member는 roster 이름, 방 자신은 `clubhouse`다. 전달되는 메시지는 `[@owner] <text>`로 submit된다.

## Room protocol

Member가 첫 전달 메시지를 받기 전에 방은 session마다 한 번 room protocol을 submit한다. Summon 뒤 member의 session이 처음 `idle`을 보고할 때 submit하고, protocol turn은 core가 그 submit을 받아들이면 끝난다. 그보다 먼저 보낸 메시지는 이를 기다린다. Program은 작업 중에 입력된 줄을 queue에 넣으므로 첫 turn 줄은 바로 뒤따를 수 있다([turn end](#turn-end)). `core.session.submit`이 CR과 LF를 거부하므로 protocol은 한 줄이다. Protocol은 화자 label(`[@owner]`, `[@<member>]`, `[@clubhouse]`), 다른 member의 text는 인용된 data이며 owner의 명령이 아니라는 것, 답 안에서 다른 member를 `@<name>`으로 mention하면 방의 다음 turn이 그 member에게 넘어가므로 member는 그 member가 답하기를 원할 때만 mention한다는 것, 방의 줄 하나가 `[@clubhouse] turn <token>`으로 끝나는 turn 하나이고 member는 자기 말로 답하며 방은 그 답을 `[@<member>]`로 보여 준다는 것, 방의 surface를 넣은 답 command의 MCP 형식(`command_run`에 name, surface, `{"turn", "text"}`)과 shell 형식(`sok soksak-plugin-agents-clubhouse.answer --surface <surface> --turn <token> --text '<text>'`, with each `'` of the text written `'\''`)(shell 형식은 모든 shell이 한 줄에서 그대로 실행하므로 작은따옴표를 쓴다. heredoc 형식을 한 줄로 쓴 member는 거부당했다), token 하나는 답 하나를 받는다는 것, `[@clubhouse] 방장의 새 지시야.`로 시작하는 방의 줄은 member의 작업 중에 도착한 owner의 지시라는 것([owner follow-up](#owner-follow-up)), `sok status soksak-plugin-agents-clubhouse.conversation --surface <surface>`로 [conversation status](#conversation-status)의 member, role, team을 읽는 법, 그리고 protocol 줄에는 답하지 않는다는 것을 말한다. 줄은 다른 member도 role도 나열하지 않는다. Roster와 team에는 줄이 지킬 수 있는 한계가 없고, 각 turn 줄이 role을 말하기 때문이다([roles](#roles)). Surface 없는 command 호출은 focus된 card의 active tab으로 가고 그것이 이 방이 아닐 수 있으므로 줄은 방의 surface를 밝힌다. Core가 owned session을 owner surface에 다시 붙이므로 방의 surface는 restart 너머로 같다. 방은 protocol 줄의 turn을 보여 주지 않는다. Protocol 줄의 turn이 끝나기 전에 core.sessions가 더 이상 나열하지 않는 session은 끝난 것이다. 그 결과는 `member <id>: session <session> ended before its protocol turn`이고, session의 끝은 member의 실패가 아니며 core.sessions가 그것을 보여 주므로 방은 error를 보고하지 않는다. 이후 summon이 그 member에게 여는 session은 자기 protocol 줄을 받는다. 메시지의 member는 send 시점에 저장된 session을 core.sessions가 나열하는 체크된 member다. Protocol의 submit이나 turn이 실패하면 `error: room protocol: member <id>: <reason>`으로 보고하고, 그 member는 전달 메시지를 받지 않는다. 방은 다른 member에게 전달하고, 남은 member가 없으면 `error: room relay: no member has the room protocol`을 보고한다.

방은 member의 terminal text를 읽을 수 없다. Claude Code는 alternate screen에 그리고, 방은 화면에서 답을 읽지 않는다([답](#answer)). Member가 자기 terminal에 쓴 text는 아무에게도 전달되지 않으므로, protocol이 내용 손실을 막는 수단이고 방의 live check가 그것을 측정한다. 긴 protocol은 재진술을 부르므로 protocol 줄은 짧은 명령문이며 다음 규칙을 말한다. 모든 말은 답이나 report, claim으로 방을 통해 한다([work reports](#work-reports)). Tool이 필요로 하는 것 외에는 terminal에 아무것도 쓰지 않는다. Owner에게 할 말은 답의 section `@owner:`에 넣는다([section](#sections)). 할 일을 미리 말하지 않고, 답을 보냈다고 확인하지 않는다. 화자가 한 말에 답한다. Protocol 줄은 turn의 작업 규칙도 말한다. 개발 작업은 독립된 부분으로 나누어 Agent tool로 subagent에게 맡기고, 병렬로 실행하며, report 전에 결과를 검증하고, 사소한 단일 file은 직접 고친다. Terminal에는 아무것도 쓰지 않고 turn을 text 없이 끝내며, `Waiting`, `Settled`, `Ready`, `Done`, `Sent`, `Noted`처럼 상태로 보이는 마무리 단어를 쓰지 않는다. 방은 terminal text를 읽지 않고 상태는 답의 status와 session state에만 있기 때문이다. Claim은 turn과 함께 끝나므로([work reports](#work-reports)) member는 각 file을 쓰는 turn에서 쓰기 전에 claim한다. 같은 shell 줄에서 앞선 명령이 room 명령이 시작되기 전에 줄을 멈추게 할 수 있고 그러면 방은 그 명령을 받지 못하므로, 각 room 명령(`answer`, `report`, `claim`, `release`)은 `;`, `&&`, `|`로 잇지 않고 foreground에서 단독으로 실행한다. Room 명령이 시간 초과로 끝나거나 background로 넘어간 것을 본 member는 그것을 `report`로 알리고, 보냈다고 말하지 않는다. 방 page가 reload되는 동안 실행된 room 명령은 어떤 page에도 가지 않고 error text로 실패한다. 다음 page는 [tab state](#restart)에서 열린 turn token을 읽어 받아들이므로, protocol은 member에게 실패한 room 명령을 받아들여지거나 열린 token이 아니라고 거부될 때까지 같은 token으로 다시 실행하라고 한다. 각 turn 줄은 token 앞에 `[@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs`을 담는다. Background 작업을 기다리는 member는 그렇지 않으면 사람에게 진행 문장을 쓰는데, 이는 token을 쓰고 아무에게도 전달되지 않으므로 이 규칙은 background 작업을 말한다. agent CLI는 text 없이 끝난 turn에 보이는 응답을 요구하고 그 뒤 member가 요약을 쓰므로, 규칙은 text 없음 대신 한 글자를 요구한다.

## Isolation

home이 있는 계정의 member는 그 home의 변수와 함께 `env`로 시작한다. 곧 `env <variable>=<folder> <cli> <args>`이므로 member CLI가 계정의 login을 쓴다([account homes](https://github.com/soksak-app/plugin-agents/blob/main/docs/spec/definitions.ko.md#계정-home)). 아래 표는 `env`가 아니라 cli의 base name으로 찾는다. maker group이 목록에 올린 정의는 `launch {args, env}`를 가진다([해석](https://github.com/soksak-app/plugin-agents/blob/main/docs/spec/definitions.ko.md#해석)). member는 home 변수 뒤에 `launch.env`의 변수를 이름순으로 두고, 계정의 인자 뒤에 `launch.args`를 두고 시작하므로, Claude Code member는 `--plugin-dir`과 `--add-dir`로 maker folder를 읽고 maker의 어떤 파일도 project에 쓰지 않는다.

Member Claude Code session은 인자가 막지 않으면 사람의 user-level instruction `~/.claude/CLAUDE.md`를 읽는다. `--setting-sources project,local`이면 user setting, user instruction, user-scope MCP server를 읽지 않고, PATH의 `sok`은 계속 방의 command를 실행한다. 방은 각 member program을 clubhouse의 table `ISOLATION_ARGS`의 isolation 인자로 시작한다. Table 항목은 program의 base name으로 찾고, 인자는 definition의 인자 뒤에 붙는다: `claude: ["--setting-sources", "project,local"]`. 그러면 member는 project instruction, room protocol, 자기 role만 읽는다. Claude 항목은 `--settings '{"env":{"CLAUDE_CODE_SHELL":"/bin/bash"}}'`도 가진다. Claude Code의 Bash tool은 Zsh에서는 `~/.zshrc`, Bash에서는 `~/.bashrc`를 source하고 잡은 alias, function, option을 적용하므로(Claude Code 문서 tools-reference#bash-tool-behavior), member가 standard input을 기다린 `ls` 같은 사람의 alias를 받았다. Member folder에서 측정한 결과: 인자가 없으면 `type ls`가 `~/.zshrc`의 alias를 가리킨다. `ZDOTDIR`를 빈 folder로 정해도 Claude Code가 `~/.zshrc`를 직접 읽으므로 여전히 alias를 가리킨다. `CLAUDE_CODE_SHELL=/bin/bash`를 환경이나 `--settings`로 주면 `type ls`는 `ls is /bin/ls`이고 `$0`은 `/bin/bash`이다. 남은 한계: 그러면 Bash tool은 사람에게 `~/.bashrc`가 있을 때 그것을 source하고, 문서는 rc를 끄는 설정을 밝히지 않는다. 항목이 없는 CLI는 그대로 시작하고, room state의 transport status는 그 member를 `notIsolated`에 나열하며 reason은 `Not isolated from personal settings: <members>.`를 말한다. Protocol 줄은 각 command의 shell 형식을 먼저 주고, 격리된 member에게는 user-scope MCP server가 없으므로 MCP 형식은 table이 격리하지 않는 member에게만 뒤따른다.

## Login

계정에 home이 있는 member는 그 home에 login이 있을 때만 시작한다. login이 없는 home의 agent CLI는 첫 실행 화면(text style 선택과 login)을 보여 주고 room의 line에 답하지 않기 때문이다. room은 summon마다 시작할 각 member의 home login을 home당 한 번 그 CLI의 문서화된 status 명령으로 읽는다. cli의 마지막 path segment가 `claude`이면 declared program `claude-status`, 곧 `env <variable>=<folder> <cli> auth status --json`이고, `codex`이면 `codex-status`, 곧 `env <variable>=<folder> <cli> login status`이다. `claude`는 `loggedIn`이 `true`이면 0, `false`이면 1로 끝나고, 읽은 folder를 `configDirectory`로 밝힌다. home과 다른 `configDirectory`는 `member <id>: claude reports the configuration folder <folder>, not the home <home>`으로 summon을 실패시킨다. CLI가 다른 login을 읽게 되기 때문이다. `codex`는 login이 있으면 0, 없으면 1로 끝난다. 다른 status, exit status와 어긋나는 status JSON, status JSON이 아닌 출력, 잘린 출력은 member와 program을 밝히는 오류로 summon을 실패시킨다. login이 없는 home의 member는 session을 열지 않고 room의 member로 남는다. 그 card는 상태 `로그인 필요: 에이전트 정의에서 계정에 로그인`과 `로그인 확인` 버튼을 보이고, 버튼은 `soksak-plugin-agents-clubhouse.login.check`를 실행한다.

room은 login을 열지 않는다. agents plugin이 정의 대화상자에서 계정에 login하고([account homes](https://github.com/soksak-app/plugin-agents/blob/main/docs/spec/definitions.md#account-homes)), member는 그 계정의 login을 쓴다. login은 member가 아니라 계정과 그 home에 속하기 때문이다. `login.check`는 member를 다시 summon해서 각 home의 login을 다시 읽으므로, 이제 login이 있는 home의 member가 시작한다. room의 다음 summon도 같은 방식으로 login을 읽는다. agents plugin이 login한 home에서 처음 시작하는 `claude`는 login을 묻지 않고, agents plugin이 home에 복사하는 설정이 권한을 우회하는 mode의 경고에 답하며, 선언된 program `project-trust`가 roster member가 시작하기 전에 프로젝트 folder를 trust한다([worktrees](#worktrees)).

## Soksak knowledge

Isolation은 사람의 개인 설정을 없애고 soksak 지식은 없애지 않는다. Soksak agent skill, 곧 `sok skill print`의 출력은 사람의 user scope(`~/.claude/skills/soksak`)에만 설치되고 `--setting-sources project,local`은 그것을 읽지 않으므로, room은 protocol 줄로 각 member에게 skill을 준다. 어떤 launch argument도 skill을 싣지 않는다. `--append-system-prompt`는 text를, `--append-system-prompt-file`은 file을 받는데(Claude Code CLI reference, [system prompt flags](https://code.claude.com/docs/en/cli-reference#system-prompt-flags)), room의 page는 `sok skill print`를 실행할 수 없고, terminal은 shell 없이 program을 시작하며, file은 사람의 folder에 써야 한다. SessionStart hook의 plain stdout은 10,000자로 제한되고 더 긴 출력은 file 경로와 preview로 바뀌는데(Claude Code hooks reference, [JSON output](https://code.claude.com/docs/en/hooks#json-output)), skill은 그보다 길다. 그래서 protocol 줄은 member에게 먼저 `sok skill print`를 한 번 실행하고 따르라고 한다. 또 web page나 local server를 먼저 soksak browser tab에서, plugin `browser`로 `core.layout.open`한 뒤 `browser.navigate {url}`로 확인하고, browser plugin이 설치되지 않았을 때만 다른 browser를 쓰며, 어느 경우였는지 보고하라고 한다. Leader가 없는 member, leader, worker의 모든 protocol 줄은 MCP form이 있든 없든 3500자 이하다. 새 규칙은 bound를 올리지 않고 맞도록 쓴다. 각 규칙은 반복과 규칙을 되풀이하는 예시 없이 한 번 말하고, `answer` 밖의 room command는 `sok soksak-plugin-agents-clubhouse.<command> --surface <surface> --params <json>` 형식으로 한 번 이름 붙인다. 이 bound는 가장 큰 구성, 곧 이름 40자와 role 200자인 team member 열여섯에서도 지켜진다. 줄에서 바뀌는 것은 member와 그 leader의 이름뿐이기 때문이다. Worker는 worktree 이름을 한 번만 말하고 command는 shell 변수를 쓴다. 이름 40자로 측정한 줄은 MCP form이 있을 때 leader 없이 2724자, leader 3491자, worker 3401자이고, 없을 때 2607자, 3374자, 3284자다. 이 문구 전에는 peer 열여섯과 role 200자인 leader 줄이 7749자였다.

## Mention

Mention은 `@` 뒤의 member 이름이나 identifier이며 대소문자를 구분하지 않고 비교한다. 메시지의 시작이나 공백 뒤에서 시작하고, 공백, `-`, `_`, `.`이 아닌 문장 부호, 또는 메시지의 끝에서 끝난다. Mention 끝의 `.`은 mention에 속하지 않는다. 어떤 member도 가리키지 않는 mention은 text다. Mention은 turn의 순서를 정하고 받는 member를 줄이지 않는다. Mention된 member가 처음 mention된 순서로 차례로 첫 turn을 받고, mode의 다른 member가 roster 순서로 뒤따르므로, 뒤의 각 member는 mention된 member의 답을 읽는다. Roster가 A, B, C일 때 메시지 `@B 정리해 줘. 나머지는 보태 줘.`는 turn을 B, A, C 순서로 주고, A의 turn 줄은 B의 답을 담는다. 답의 section `@<name>:`([section](#sections))도 mention이다.

Inline code span, fenced code block, `>`로 시작하는 인용 줄 안의 mention은 mention이 아니다. 그것들은 text를 인용하기 때문이다. 한글이 바로 뒤따르는 mention은 그 mention이다. 예를 들어 `@harness가`, `@all에게`다. 단어의 접두사이고 나머지가 한글 음절로 시작하는 가장 긴 member 이름이나 identifier, 또는 `all`이 mention을 가리킨다. 한국어 조사가 이름에 붙기 때문이다. `email@all`, `@allison`, `@all-hands`는 mention이 아니다.

대소문자를 구분하지 않는 `@all`은 체크된 모든 member, 곧 roster에서 체크된 member와 team에게 간다. 함수 하나가 이 집합을 만들고, [addressed views](#addressed-views)의 route와 relay가 그것을 쓰므로, `@all` 줄은 체크된 각 member의 addressed list에 한 번 들어가고 체크되지 않은 member의 list에는 들어가지 않는다. Owner 메시지와 leader 답만 `@all`로 turn을 시작한다. 그 밖의 답, 곧 worker의 답이나 leader 없는 방 member의 답에서 `@all`과 section 제목 `@all:`은 줄을 체크된 모든 member에게 보내고, 그들은 다음 turn에 읽으며, turn을 시작하지 않는다. 결정: protocol은 답의 section 제목으로 `@all:`을 권하고, 답마다 모두에게 퍼지면 답 하나가 turn 2개에서 15개를 시작해 `conversationTurns` 한도 48을 답 몇 개에 다 쓴다. 이름 mention과 `@all`이 함께 있으면 이름 mention된 member가 mention 순서로 먼저, 나머지가 그 뒤에 온다.

Leader가 있는 방에서 owner의 `@all`은 이름 mention된 worker를 mention 순서로, 그다음 다른 모든 worker를 병렬 batch 하나로, 그다음 leader를 시작하므로 leader는 모든 답을 읽는다. `@all`이 있는 leader 답은 모든 worker를 batch 하나로 시작한다. Leader가 없으면 `turn`은 전처럼 모든 member를 roster 순서로, `simul`은 모든 member를 동시에, `facil`은 idle member 하나를 고르지 않고 모든 member를 roster 순서로 실행한다. Owner가 모든 member에게 물었기 때문이다.

답한 반론: 서로를 mention하지 않고 `continue`로 답한 병렬 worker 둘은 서로의 답으로 turn을 받지 않는다. 답은 worker를 mention할 때만 그 worker에게 가므로 다음 turn은 leader의 것이다. Leader를 mention한 worker 답은 그 답이 시작하지 않은 어떤 worker turn보다 먼저 leader에게 다음 turn을 준다. Leader가 있는 relay의 한도 줄은 아직 `continue`를 밝힌 member를 밝힌다.

대소문자를 구분하지 않는 이름과 identifier `all`, `owner`, `clubhouse`는 예약되어 있다. Definition을 읽을 때 그중 하나를 쓰는 definition을 `agents project data definitions: definition <id> uses the reserved name <name>`으로 거부하고, error display로 보고하며, 다른 definition은 남긴다. Team id는 그 definition에서 나온다.

거부한 반론: turn 줄에는 길이 bound가 없다. 그것이 싣는 record는 설계상 한계가 없고, 450,000자 submit이 Claude Code의 transcript에 온전히 도착했다. 명시적 bound는 tab state 한도 1 MiB다([restart](#restart)).

## Mention hint

composer의 caret 앞 단어가 text의 시작이나 공백 뒤에서 `@`로 시작하는 동안, composer 위의 목록이 `all`과, 체크된 roster member와 team member 가운데 단어의 나머지로 시작하는 이름을 대소문자 구분 없이 `all`을 먼저 보인다. 각 항목은 element `soksak-plugin-agents-clubhouse.mention`이다. 항목을 click하거나 표시된 항목에서 Enter나 Tab을 누르면 `mention.insert {name}`이 실행되고, 이는 그 단어를 `@<name> `으로 바꾸고 caret을 그 뒤에 둔다. caret에 `@` 단어가 없는 호출은 `mention.insert: no @ word ends at the caret of the composer`로 거부된다. 화살표 key는 표시를 옮기고, Escape는 다음 입력까지 목록을 닫으며, Enter는 목록이 닫혀 있을 때만 message를 보낸다.

## Mode

방의 mode(`facil`, `turn`, `simul`)는 메시지를 누가 어떤 순서로 받는지 정한다. Mention된 member가 먼저 turn을 받는다([mention](#mention)). [Leader](#leader)가 있으면 owner의 메시지는 모든 mode에서 mention된 member 다음에 leader의 turn을 시작한다.

- `turn`: 모든 member가 roster 순서로 차례로 받는다. 앞 member의 turn이 끝난 뒤 다음 member가 받는다.
- `facil`: member 하나, 즉 roster 순서에서 session이 `idle`인 첫 member가 받는다. `idle`인 member가 없으면 send는 `no member is idle`로 거부된다. Mention된 member들은 차례로 받는다.
- `simul`: 모든 member가 동시에 받는다. 방은 어떤 turn이 끝나기 전에 모든 member에게 submit하고, 모든 turn이 끝나면 resolve한다. 답은 roster 순서(또는 mention 순서)를 지킨다.

모든 member는 room record 전체를, 자기 turn의 줄에서만 읽는다([room record](#room-record), [conversation first](#conversation-first)). Member가 자기 turn 시작에 받는 줄은 `[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야.` 뒤에 그 member가 아직 받지 않은 모든 record 줄을 바꾸지 않고 record 순서로 담고, 그 member의 turn token인 ` | [@clubhouse] turn <token>`으로 끝난다([답](#answer)). 모든 줄을 받은 member는 줄 대신 `[@clubhouse] 네 차례야. 네가 아직 못 본 기록은 없어.`를 받는다. 모든 mode에 같은 규칙이 적용된다. `turn`에서, 그리고 `turn`과 `facil`에서 mention된 member는 차례로 turn을 받으므로, round 안에서 앞 member들의 답은 각 member가 자기 turn 줄에서 읽는 record 줄이다. `simul`에서는 모든 member가 함께 시작하고 각 줄은 owner의 메시지에서 끝나며, 각 member는 다른 member의 답을 다음 round의 자기 turn 줄에서 읽는다.

Turn은 program이 `idle`이든 `working`이든 session의 submit queue로 줄을 submit한다([work reports](#work-reports)). `blocked` session은 core.sessions의 값이 blocked가 아님을 보여 줄 때까지 줄을 받지 않는다([turn end](#turn-end)). 기다리는 동안 [conversation status](#conversation-status)는 그 member를 step `turn`으로 보여 준다. `conversation.stop`은 그 기다림을 끝낸다. Turn은 아무것도 submit하지 않고, 방은 `[@clubhouse] the conversation ended: the owner stopped it`을 덧붙인다.

실패한 turn은 member와 이유로 relay를 reject하고, `message.send`가 그것을 보고한다([command](#command)). Core가 submit을 하나도 받아들이지 않은 relay는 owner의 줄을 room record와 대화에서 거둔다. 그 밖의 실패한 relay는 owner의 줄과 도착한 모든 답을 유지하고 방의 줄 `[@clubhouse] the relay failed: <reason>`을 덧붙인다([room record](#room-record)). `turn`과 `facil`에서는 그 뒤의 member가 아무것도 받지 않는다. `simul`에서는 다른 turn이 끝까지 진행되고, relay는 member 순서로 첫 실패로 reject한다.

## Conversation

한 메시지의 member들은 그 relay 안에서 대화한다. 방이 답을 record에 덧붙일 때, relay의 member, 즉 열린 session과 room protocol이 있는 체크된 member 사이에서 [mention 규칙](#mention)으로 그 답의 mention을 읽는다. 화자 자신의 mention과 다른 이름의 mention은 text다. 이 relay의 turn을 아직 기다리지 않는 각 mention된 member는 이미 기다리는 turn 뒤에 처음 mention된 순서로 turn을 받고, 받지 않은 record 줄을 받으므로([room record](#room-record)) 자기를 mention한 답을 읽는다. 그 답이 다시 다른 member를 mention할 수 있고, 대화는 같은 방식으로 이어진다. `simul`에서 방은 모든 turn이 끝난 뒤 그 relay의 답의 mention을 member 순서로 읽는다. 답이 시작하는 turn은 모든 mode에서 차례로 진행된다.

Plugin setting `conversationTurns`는 0부터 64까지의 정수이고 기본값은 48이며, owner의 메시지 하나에 대해 mention과 [settling](#settling)의 round가 시작하는 turn의 최대 수다. Turn이 기다리고 그런 turn이 그 수만큼 진행되었으면 relay는 끝나고 방은 record 줄 `[@clubhouse] the conversation ended: it reached the limit of <n> member turns`를 덧붙인다. Owner는 `conversation.stop`으로 대화를 끝낸다([command](#command)). 더 이상 turn이 시작되지 않고, 방이 답을 기다리는 turn은 답 없이 끝나며, 기다리거나 열린 turn이 있었으면 방은 `[@clubhouse] the conversation ended: the owner stopped it`을 덧붙인다. 방의 줄은 speaker가 `clubhouse`인 record와 [conversation status](#conversation-status)의 항목이며, 각 member는 다음 turn에 그것을 받는다. 한도와 중지는 실패 없이 relay를 끝내므로 `message.send`는 도착한 답으로 끝난다. 대화의 turn이 실패하면 [mode](#mode)에서처럼 relay가 실패하고 도착한 답은 유지된다.

## Owner follow-up

Room이 메시지를 전달하는 동안 owner가 보낸 메시지는 바로 owner 줄로 record에 더해지고 relay는 이어진다. Working member는 session의 submit queue로 그것을 owner의 지시로 바로 받는다. 줄은 `[@clubhouse] 방장의 새 지시야. 하던 작업에 반영하고 다음 답에서 답해.` 뒤에 그 member가 받지 않은 record 줄을 담고 owner 줄로 끝나므로, 각 줄은 record 순서를 지키고 한 번만 전달된다. 이 줄에는 token이 없다. `blocked` session은 core.sessions의 값이 다시 working을 보여 줄 때 받고, idle member는 다음 turn의 줄로 받는다. Owner의 지시는 member가 지금 하는 작업을 바꾸므로, 이 inject는 방이 turn 밖에서 submit하는 유일한 줄이다([conversation first](#conversation-first)). 어느 member도 continue하지 않으면, 마지막 turn이 owner 줄보다 먼저 시작한 각 member가 [대화](#conversation)의 bound 안에서 turn을 한 번 더 받으므로 모든 member가 그 줄에 답한다. `conversation.stop`은 전처럼 대화를 끝낸다.

## Settling

[Leader](#leader)가 있으면 leader의 답 status만 settling을 정한다. 기다리는 turn이 없으면 relay에서 turn을 받았고 `settled` 답 말고 받지 않은 addressed 줄이 있는 각 worker가 turn을 받고, 그다음 leader는 받지 않은 줄이 있는 동안 turn을 받는다. Leader의 마지막 답이 `settled`이고 모든 줄을 받았으면 대화는 settle된다. Leader가 없으면 각 답은 status를 밝힌다. 열린 질문, 이견, 남은 작업이 있으면 `continue`, member의 몫이 끝나고 검증되었으며 더 할 말이 없으면 `settled`다. 답 command는 그 밖의 값을 `status must be continue or settled, got <value>`로 거부한다. Relay의 turn이 기다리지 않고 relay의 어떤 member의 마지막 답이 `continue`이면 방은 round를 시작한다. Relay의 모든 member가 roster 순서로 turn을 받고 받지 않은 record 줄을 받으므로, owner의 메시지 하나가 대화를 끝까지 진행한다. Turn에는 그 member가 받지 않은 줄이 있어야 한다. Member가 continue인데 relay의 어떤 member에게도 받지 않은 줄이 없거나, leader가 받지 않은 줄도 뒤처진 worker도 없이 continue이면, 방은 turn을 시작하지 않고 마지막 답이 `continue`인 각 member를 밝혀 `[@clubhouse] the conversation waits for the owner: @<name> continue`를 덧붙인다. Owner의 다음 메시지가 대화를 다시 시작한다. 빈 turn은 member에게 답할 것을 주지 않고, 새 줄 없이 continue인 member는 owner의 답처럼 방 밖의 것을 기다리기 때문이다. 모든 member의 마지막 답이 `settled`이면 방은 `[@clubhouse] the conversation settled`를 덧붙이기 전에 relay의 모든 member를 확인한다. Member들의 `settled` 답 말고 받지 않은 record 줄이 있는 member는 `conversationTurns`에 들어가는 turn을 한 번 더 받고, 방은 settling을 다시 판단하므로 owner 줄, 작업 줄, 방의 줄은 사라지지 않는다. 각 답은 다른 member가 받지 않은 줄이고 그 하나하나에 turn을 주면 끝나지 않으므로, member가 받지 않은 `settled` 답은 다음 turn에 전달된다. 다른 member의 결론보다 먼저 `continue`로 답한 member는 다음 round의 turn과 함께 결론을 받는다. Round는 `conversationTurns`에 들어간다. Member가 continue인 채로 한도가 relay를 끝내면 방은 마지막 답이 `continue`인 각 member를 밝혀 `[@clubhouse] the conversation ended without settling: it reached the limit of <n> member turns; @<name> continue`를 덧붙인다. 기본값 48은 member 세 명의 round 16번이며, 계획 합의, 구현, 검증 보고를 거치는 개발 작업 하나의 크기다.

## Sections

여러 화자에게 답하는 답은 말한 화자의 순서대로 화자마다 section 하나를 둔다. Section은 자기 줄의 `@<name>:`로 시작하며, `<name>`은 member의 이름이나 identifier 또는 `owner`이고 대소문자를 구분하지 않는다. `@all:`은 [mention 규칙](#mention)으로 모두에게 가고, 첫 section 앞의 text는 `all`에 속한다. Record는 답의 text를 바꾸지 않는다. Room view는 section마다 addressee를 머리로 단 block 하나를 그리고, [conversation status](#conversation-status)의 각 항목은 `sections: [{to, text}]`를 가지며 `to`는 `owner`, `all` 또는 member identifier다. Section 줄이 없는 답은 `[]`이다.

## Room role

방은 대화를 전달하고 보여 줄 뿐, member의 작업을 판단하거나 막지 않는다. 방은 각 command의 입력을 경계에서 확인하고, 각 줄을 그 줄을 받을 member에게 전달하며, record, 기다림, team을 보여 주지만, member의 주장을 검증하지 않고, 그 작업의 check를 실행하지 않으며, git 상태를 읽지 않고, 작업 내용 때문에 어떤 답이나 status도 거부하지 않는다. Leader는 신뢰받고 member는 대화로 작업 상태를 알아낸다. Agent의 작업을 판단하는 방은 그들의 오류에 자기 오류를 더하고, 그것을 바로잡을 수 있는 대화를 막기 때문이다.

## Leader

Roster entry 하나가 leader일 수 있다. `member.leader {id, leader}`로 정하고 [tab state](#restart)의 roster entry `leader`로 남는다. Leader를 정하면 그 entry를 check하고 다른 모든 entry의 leader를 지운다. Owner는 leader만 check하거나 정하고, leader가 작업을 계획하고 지휘한다. Leader는 [team](#team)의 member를 summon하고, 모든 record 줄을 받으며([addressed views](#addressed-views)), 자기 `settled` 답으로 대화를 끝낸다([settling](#settling)). Leader가 없으면 방은 전처럼 동작한다. 모든 member가 모든 줄을 받고 방의 mode가 turn 순서를 정한다. Leader의 protocol 줄은 그가 지휘한다는 것, summon command, 그리고 그의 답 하나가 mention한 member들이 함께 시작한다는 것을 말한다.

## Team

Leader는 `member.summon {turn, definition, role, directory}`로 team의 member를 summon한다. Command는 leader의 열린 turn token만 받고, 다른 token은 `member.summon takes the turn token of the leader <leader>, got a turn of <member>`로, leader가 없으면 `member.summon needs a leader: set one with member.leader`로 거부한다. `definition`은 agent definition을 가리키고(아니면 `definition <id> is not an agent definition`), `role`은 [roles](#roles) 규칙의 role text이며, `directory`는 절대 경로다. Leader가 작업과 folder를 맡으므로 summon은 이 입력만 확인한다. Session은 definition의 program과 argument로 `directory`에서 열린다. Terminal은 없는 directory를 거부하고, summon은 그 거부로 reject하며 team entry를 남기지 않는다. Plugin setting `maxMembers`는 1부터 16까지의 정수이고 기본값은 6이며 team의 크기를 제한한다. 이를 넘는 summon은 `the team has reached maxMembers <n>`으로 거부한다.

Team member는 summon id `<definition>-<n>`을 가진다. `<n>`은 그 definition의 어떤 team member도 쓰지 않는 가장 작은 양의 정수다. 이름은 `<definition name>-<n>`이고 mention은 이 이름으로 그 member를 부른다. Team은 definition의 roster 옆의 별도 목록이며 tab state에 `team: [{id, definition, role, directory}]`로 남는다. Roster는 agent definition을, team은 summon된 member를 나열하므로 같은 definition이 두 folder에서 동시에 일할 수 있다. Team member의 relation은 roster member처럼 `<room surface>/<summon id>`로 저장되므로 restart는 각 team member를 자기 session에 다시 붙인다. Team member는 체크된 roster member처럼 room protocol을 받고 각 relay에 참여한다.

방은 summon 때 각 team member의 worktree를 만들고 member를 그 안에서 시작한다([worktrees](#worktrees)). Worker는 그곳에서 commit하고 삭제는 방에 맡긴다. Leader 줄은 지휘의 작업 규칙도 말한다. 각 brief에 API contract를 정하고, server branch를 먼저 merge하며, 의존하는 worker가 integration branch에서 update하게 하고, worker가 merge를 요청하기 전에 unit test하고 integration branch를 자기 branch에 merge하게 한다. Worker 줄은 brief가 자기 범위이고, 꼼꼼히 unit test하며, 완료를 알리기 전에 최신 integration branch를 merge하고 충돌을 해결하고, 답할 때 실행 중인 background task를 남기지 않는다고 말한다. Team view, 곧 [conversation status](#conversation-status)의 `team`은 각 team member `{member, name, role, directory, branch, merged, session, state}`를 나열한다. `branch`는 member id이고, `directory`는 worktree가 생긴 뒤 그 worktree이며, `merged`는 `member.merged`가 기록한 commit 또는 null이며, `state`는 session의 program 상태 또는 `ended`다.

Program이 Claude Code인 team member는 방이 summon 때 만드는 UUID인 `--session-id <id>`로 시작하고, core.roles가 그 definition의 role에 agent file을 나열하면 `--agent <name>`으로도 시작한다. `<name>`은 그 file의 YAML frontmatter의 `name`이며, 방은 선언된 program `agent-file`(절대 `.md` 경로의 `cat`)로 그 file을 읽고 `yaml` library로 parse한다. Claude Code는 project agent를 file 이름이 아니라 그 `name`으로 찾는다. Project의 agent가 있을 때 `--agent no-such-agent`는 쓸 수 있는 이름의 목록과 함께 거부된다. Frontmatter에 `name`이 없는 file은 summon을 `agent file <file> has no name in its frontmatter`로 거부한다. 그 session id는 retask가 resume하는 id이며, 첫 launch 뒤의 launch, 예를 들어 session이 끝난 restart 뒤의 summon은 `--resume <id>`로 시작한다. Claude Code는 같은 id의 두 번째 `--session-id`를 거부하기 때문이다(`Session ID <id> is already in use`). Team entry는 `agentSession`(id, 다른 program이면 `null`), `resume`(다음 launch가 resume하는지), `agent`(agent 이름 또는 `null`)를 가진다.

`member.retask {turn, member, definition, role}`는 team member에게 그 자리에서 다른 definition과 다른 role text를 준다. 예를 들어 developer가 end-to-end tester가 된다. `member.summon`처럼 leader의 turn token과 [roles](#roles) 규칙의 role text를 받는다. Leader가 summon 때 준 role은 이전 작업을 설명하고, 이후 각 turn의 roles 줄은 새 role을 밝히기 때문이다. 다른 형식의 role은 roles 규칙의 오류로, team에 없는 member는 `member <member> is not in the team`으로, 알 수 없는 definition은 `definition <id> is not an agent definition`으로, turn이 열린 member는 `member <member> is in a turn; retask it after its answer`로, Claude Code session id가 없는 member는 `member <member> has no Claude Code session to resume`으로, role에 agent file이 없는 definition은 `definition <id> has no agent file for --agent`로 거부한다. 방은 `core.session.end`로 member의 session을 끝낸다. 그것은 session의 owner가 그 program을 끝내는 operation이며, terminal 안의 program은 안에서 자기 agent를 바꿀 수 없기 때문이다. 그리고 core.sessions가 그 session을 더 나열하지 않을 때까지 기다린다. Command는 core.sessions가 그것을 빼기 전에 답하고, 그 전의 summon은 session이 열려 있다고 보고 아무것도 열지 않기 때문이다. 그다음 team entry의 definition, agent 이름, `resume`을 정하고, `@<old name> is now <definition>, named @<new name>`을 기록하며, summon이 member를 `--resume <session id> --agent <name>`으로 arrangement의 새 tab에서 다시 연다. 끝난 session의 tab은 닫힌다. Member는 자기 id와 이름의 번호를 유지하고, 이름은 새 definition을 따른다. Record는 설계상 각 줄의 speaker로 id를 유지하고, view와 turn 줄에 있는 record의 모든 label은 member의 현재 이름을 보인다. 방은 이전 session의 전달을 새 session으로 옮기고 protocol을 받은 것으로 센다. Resume된 session이 대화를 가지기 때문이다. 새 session을 tab이 보이면 방은 `core.tab.role {tab, role}`로 그 tab의 role을 새 definition의 role로 정하므로, terminal은 role file을 이름 짓는 change message를 보낸다(core `docs/spec/agent-roles.md#change-message`). Team view는 그 command reply의 상태, `pending` 또는 `ready`를 보이고, 방은 그것으로 아무것도 판단하지 않는다. 방은 `core.tab.role`을 watch하지 않는다. Core는 view의 plugin의 것이 아닌 surface의 status watch를 거부하고, 그 tab은 terminal surface이기 때문이다.

Claude Code 2.1.330으로 측정했다. `--resume <id> --agent <name>`은 agent의 tool을 바꾸고 대화를 유지하지만 시작한 agent의 지시를 유지하므로, agent가 새 role을 따르게 하는 것은 role의 change message다. 둘을 함께 쓰면 agent는 새 role을 따르고 그 tool을 쓰며 대화를 기억했다. Agent frontmatter가 선언한 MCP server는 새 `--agent` session에서도 load되지 않았다. 이 contract는 그것에 대해 아무것도 말하지 않으며, 측정되지 않았다.

## Accept all

설정 `acceptAll`은 `ask` 또는 `accept`이고 기본값은 `ask`다. `accept`이면 방은 roster와 team의 각 member를 그 program이 모든 요청을 묻지 않고 수락하는 flag로 시작한다. Claude Code는 `--dangerously-skip-permissions`, Codex는 `--yolo`다. 방은 shell 없이 program을 시작하므로 사람이 그런 flag를 더하는 alias나 shell 함수는 member에 적용되지 않는다. 이 설정이 그 선택을 선언하는 자리다. Account의 인자에 같은 뜻의 flag(Codex는 `--yolo` 또는 `--dangerously-bypass-approvals-and-sandbox`)가 있으면 더하지 않는다. Codex는 `--yolo`가 반복되면 거부하기 때문이다. 알려진 flag가 없는 program은 `settings.acceptAll: program <name> has no known flag that accepts every request`로 시작에 실패하므로, `accept`는 여전히 묻는 member를 시작하지 않는다.

## Agent line

Claude Code는 `--agent <name>`으로 definition의 agent file을 읽고, 지원하는 다른 program에는 그런 argument가 없다. Program이 `--agent`를 받지 않고 definition에 agent file이 있는 member는 protocol 줄 뒤에 agent 줄 `[@clubhouse] agent: you are <agent>, called @<member name>. Read the agent file <file> and its folder <folder>, and follow them as your instructions from now on; this line takes no answer.`을 받는다. `<agent>`는 file의 frontmatter name이고 `<folder>`는 그 folder다. `member.retask`는 member의 program을 유지하고, 다른 program의 definition은 `member <id> runs <program>; member.retask takes a definition of the same program, got <definition> of <program>`으로 거부한다. Session이 program을 유지하기 때문이다. Claude Code member의 retask는 session을 끝내고 새 `--agent`로 session id를 resume하며, 다른 member의 retask는 session을 유지하고 새 definition의 agent 줄을 보낸다. Agent file이 없는 definition은 `definition <id> has no agent file`로 거부한다.

## Worktrees

각 team member의 worktree는 agent가 아니라 방이 만들고 지운다. 둘 다 판단이 필요 없는 정해진 절차이고, code로 실행하는 절차는 매번 같게 실행되며 실패를 알리기 때문이다. `member.summon`은 session을 열기 전에 선언된 program `team-worktree add <directory> <member id>`를 실행한다. Program은 `git worktree add`로 branch `<member id>`에 worktree `<home>/soksak/worktrees/<repository name>-<hash>/<member id>`를 만들고(`<hash>`는 main checkout root 경로의 SHA-256 앞 8자리 16진수), 방은 그 worktree를 folder로 member를 시작하고 team entry의 `worktree`로 저장한다. Worktree는 project 밖에 있으므로 project에는 worktree folder가 없고 `.gitignore` 항목도 필요 없다. Member가 그 안에서 시작하므로 Claude Code는 `cd`와 edit를 session의 folder 안에서 permission 질문 없이 유지한다. Member의 기존 worktree는 그대로 두고 기존 branch를 checkout한다. Worktree가 생긴 뒤 실패한 summon은 그것을 다시 지운다.

`member.release`와 team 전체의 release는 session이 사라진 뒤 `team-worktree remove <directory> <member id>`를 실행한다. Force 없는 `git worktree remove`와 `git branch -d`이며, commit되지 않은 변경이 있는 worktree와 merge되지 않은 branch는 거부된다. `<repository name>-<hash>` folder는 마지막 worktree와 함께 지워진다. 거부되면 worktree와 branch가 남고, 방은 record에 `the worktree <path> of @<name> stays: <git error>`를 더하고 error display로 알린다. 그래서 작업은 사라지지 않고 남은 것이 보인다.

### First start

Claude Code는 첫 시작에서 세 종류의 질문을 하고, 각 질문은 configuration file `$CLAUDE_CONFIG_DIR/.claude.json`(없으면 `<home>/.claude.json`)의 서로 다른 member로 건너뛴다. 첫 시작 단계인 text style과 security notes는 `hasCompletedOnboarding`으로, 시작 folder와 `--add-dir`이 가리키는 각 folder의 trust는 `projects[<folder>].hasTrustDialogAccepted`로 건너뛴다. Trust key는 git repository 안의 folder면 main checkout의 root이고(worktree도 이것을 따른다), 아니면 folder 자체다(Claude Code permissions documentation, "What runs before you trust a folder"). Home에는 이 중 어느 것이든 없을 수 있으므로 질문은 하나, 둘, 또는 셋 모두 나올 수 있다. 방의 member는 terminal 질문에 답하지 않으므로, Claude Code member가 시작하기 전에 방이 없는 member를 쓴다. Member의 각 folder, 즉 시작 folder와 account와 launch의 인자에 있는 각 `--add-dir` folder에 대해 선언된 program `member-start`(`team-worktree start <home> <folder>`)를 실행한다. 이 program은 account home의 configuration file에 `hasCompletedOnboarding`과 그 folder의 trust를 쓴다. Home이 없는 definition에는 `project-trust`(`team-worktree trust <folder>`)를 실행해 사람의 configuration file에 trust를 쓴다. Roster member는 roster를 summon할 때 definition의 folder로, team member는 `team-worktree add` 뒤 자기 worktree로 준비한다. 절대 경로가 아닌 `--add-dir` folder는 `definition <id>: --add-dir <folder> is not an absolute path`로 거부한다. Program은 없는 member만 쓰고, file을 읽고 쓰는 동안 proper-lockfile의 lock을 잡고 file 전체를 바꿔 쓴다. Claude Code가 실행 중에 같은 file을 다시 쓰기 때문이다. File의 다른 member는 모두 유지한다. Program이 실패하면 summon이 그 오류로 실패한다.

## Addressed views

각 member session은 addressed list, 곧 그 session에 가는 줄의 record index를 record 순서로 가지며 tab state의 `addressed`로 남는다. Leader가 없으면 모든 줄이 모든 session에 간다. Leader가 있으면 leader는 모든 줄을 받고, 그 밖의 모든 member인 worker는 owner의 줄, [mention 규칙](#mention)으로 자기나 `@all`을 mention한 줄, 자기를 mention한 방의 줄을 받는다. Worker에게는 자기 brief와 자기에게 온 질문이 필요하고, 전체 record는 다른 member의 작업으로 그 context를 채우기 때문이다. 방은 새 줄을 덧붙일 때 그 줄이 가는 각 session의 list에 index를 더하고, list가 없는 session은 처음 쓰일 때 자기에게 가는 모든 줄의 index를 받는다. `sent`와 `delivered`는 session의 addressed list 안의 위치이고, turn 줄은 `sent`부터 끝까지의 addressed 줄을 member 자신의 줄 없이 담는다.

Leader의 답이 여러 worker를 mention하면 그 worker들은 함께 turn을 시작하고, 방은 각 답이 도착할 때 record에 덧붙인다. 그래서 leader의 다음 turn 줄은 그 답을 모두 담고, leader는 일찍 끝낸 worker를 본다. Worker의 답이 시작하는 turn은 차례로 진행된다.

## Roles

각 roster 항목은 role을 가진다. Role은 control 문자가 없는 0자에서 200자의 text이며, member의 roster input이나 `member.role {id, role}`로 정하고 tab state에 남는다. Protocol 줄은 member의 role을 밝히고, relay의 어떤 member에게 role이 있으면 각 turn 줄은 token 앞에 `[@clubhouse] roles: you are <role>; <name>: <role>, ...`를 담으므로, 각 member는 자기 role과 다른 member의 role을 읽는다.

## Work reports

Member는 turn 동안 `soksak-plugin-agents-clubhouse.report {turn, text}`로 작업을 보고하고, 고칠 path를 `claim {turn, paths}`로 claim하고 `release {turn, paths}`로 release한다. 각 command는 member를 증명하는 열린 turn의 token만 받는다. Record token은 `turn <token> is a record line: only the token of a turn reports, claims or releases`로 거부된다. 각각은 member의 record 줄 `(report) <text>`, `(claim) <paths>`, `(release) <paths>`이다. 두 path가 같거나 하나가 다른 하나 뒤에 `/`가 이어진 것이면 두 claim은 겹친다. 방은 다른 handler보다 먼저 끝까지 실행되는 handler에서 각 claim을 정하므로, 다른 member의 claim과 겹치는 claim은 `paths <path> are claimed by <member>`로, member가 가지지 않은 path의 release는 `path <path> is not claimed by <member>`로 거부된다. Turn의 claim은 turn이 닫힐 때 release된다. Report는 선택 항목 `paths`, 즉 보고하는 변경이 건드린 file을 받는다. 각 path는 열린 turn에서 보고자가 가진 claim과 같거나 그 아래에 있어야 하며, 아니면 report는 `paths <paths> are not claimed by <member>`로 거부되고, record 줄은 ` [<paths>]`로 끝난다. Claim은 약속일 뿐이므로 방은 이것을 검사한다. 방은 member의 file 쓰기를 보지 못하고, report가 밝힌 path가 방이 볼 수 있는 작업의 부분이다. 자유 text는 file을 믿을 수 있는 형식으로 밝히지 않으므로 방은 report text에서 path를 읽지 않는다.

방은 turn 밖에서 session에 작업 줄을 submit하지 않는다. Report, claim, release는 record 줄이고, 다른 각 member는 다음 turn 줄에서 그것을 읽는다([conversation first](#conversation-first)). 방은 session마다 두 수를 둔다. `sent`는 core가 받아들인 줄의 record 길이이며 다음 줄이 여기서 시작하고, `delivered`는 turn의 답이 도착할 때만 `max(count, sent)`로 오른다. Session마다 submit queue가 하나이므로, session의 다음 줄은 core가 앞 submit에 답한 뒤에만 sent 수로 만들어진다.

## Room record

Room record는 방의 대화다. Owner의 각 메시지 줄, 각 member의 답, 방의 각 줄을 방이 받은 순서로 담는다. 방은 `message.send`가 owner의 줄을 받아들일 때 그 줄을, 각 답이 도착할 때 그 답을 덧붙인다. `simul`에서는 모든 turn이 끝난 뒤 그 relay의 답을 member 순서로 덧붙이며, 다른 turn이 실패한 relay의 답도 그렇게 한다.

방은 record를 각 member session에 전달한다. Record의 줄은 `[@<speaker>] <text>`이고 text 안의 줄바꿈은 공백으로 바뀌며, 한 submit의 줄은 ` | `로 잇는다. `core.session.submit`이 CR과 LF를 거부하기 때문이다. 방은 session마다 delivered number `d`, 즉 그 session이 받은 record 줄의 수를 보관한다(`delivered`, [tab state](#restart)). 수가 없는 session은 아무 줄도 받지 않았다. Session이 받지 않은 record 줄은 `d`부터 record 끝까지의 줄에서 그 member가 직접 한 줄을 뺀 것이다. Member가 그 줄을 준 당사자이기 때문이다. 전달은 다음 불변식을 지킨다.

모든 record 줄을 이미 받은 member의 turn도, 예컨대 작업 중에 [owner follow-up](#owner-follow-up)을 받은 뒤에도 실행된다. 그 줄은 record 줄 없이 turn rule과 token 앞에 `[@clubhouse] 네 차례야. 네가 아직 못 본 기록은 없어.`만 담고, 답과 status는 다른 turn처럼 센다.

- Turn completeness: turn의 줄은 session의 sent 위치부터의 addressed 줄을 record 순서로 담으므로, member는 답하기 전에 자기에게 온 모든 줄을 읽는다([addressed views](#addressed-views)).
- No line lost: 대화가 settle되기 전에 받지 않은 record 줄이 있는 각 member는 turn을 한 번 더 받고([settling](#settling)), [conversation status](#conversation-status)의 `delivery`는 언제나 각 member가 받지 않은 줄을 보여 준다.
- Exactly once and in order: 각 submit은 위치 `d`부터 방이 줄을 만들 때의 addressed list 길이 `n`까지의 줄을 담고, submit의 token은 `n`을 기록한다. 위치 `d`는 turn token의 [답](#answer)이 도착할 때만 `n`으로 오른다. 받아들여진 submit은 program이 그 줄을 읽었다는 것을 알려 주지 않기 때문이다(core `docs/spec/persistent-services.md#owned-sessions`). 위치는 내려가지 않으므로 한 session의 submit들은 그 addressed list를 0부터 빈틈도 겹침도 없이 덮는다.
- One open line per session: session은 열린 turn token을 많아야 하나 가진다. Session의 다음 turn 줄은 그 token이 답을 받거나 owner의 중지가 그것을 닫을 때까지 기다리고, session의 program이 `idle`을 보고하기를 기다리지 않는다([turn end](#turn-end)).
- Restart recovery: 열린 token은 tab state에 남으므로 restart 뒤에 도착한 답도 `d`를 올리고, member의 다음 turn이 남은 줄을 담는다([restart](#restart)).

Core가 owner 줄의 submit을 하나도 받아들이지 않은 send는 그 줄을 거둔다. 방은 그 줄을 record와 대화에서 지우고, `message.send`는 실패를 error display로 보고하므로([command](#command)) 이유는 남는다. 어떤 session도 그 줄을 받지 않았으므로 record를 넘는 delivered number는 없다. Record에는 어떤 member도 받지 않은 메시지가 없으므로, 그런 실패 뒤에 다시 보낸 send는 owner의 줄 하나만 남긴다. Core가 submit을 받아들인 뒤 실패한 send는 owner의 줄과 도착한 답을 유지하고, 방은 `[@clubhouse] the relay failed: <reason>`을 덧붙인다. `<reason>`은 실패한 turn의 `member <id>: <reason>`이므로 모든 member가 relay가 실패했다는 것을 읽는다.

## Conversation first

Member는 자기 turn의 줄에서만 record를 받는다. Turn은 owner의 메시지, mention, [settling](#settling)의 round가 member를 부를 때 시작하고, 그 줄은 member가 받지 않은 모든 record 줄을 바꾸지 않고 record 순서로 담는다([mode](#mode)). 방은 member에게 알리기만 하는 줄을 submit하지 않는다. Relay 뒤의 record 줄도, member의 작업 중의 작업 줄도 없다. Report, claim, release, 방의 줄은 record 줄이고, 각 member는 다음 turn 줄에서 그것을 읽는다. 방이 turn 밖에서 submit하는 유일한 줄은 owner의 지시인 [owner follow-up](#owner-follow-up)이다. Session의 `delivered` number는 그 turn의 답이 도착할 때 오른다.

### Decision

- 알리기만 하는 줄은 member에게 무엇을 알되 답하지 말라고 하고, member는 그런 줄에 terminal에서 답하거나, turn으로 여기거나, 작업 아래에서 잃었다. Member는 history에 따라 행동할 때, 곧 turn의 시작에 읽으므로 record가 member에게 가는 길은 하나다.
- Relay 뒤 closing delivery는 record 줄마다 acknowledgement를 기다리고 relay 뒤에도 token을 열어 두었다. 모든 줄을 다음 turn이 담으므로 acknowledgement command와 그 token은 쓸모가 없어 없앤다.
- 줄은 member가 더 이상 turn을 받지 않을 때만 사라진다. [settling](#settling) 확인은 대화가 settle되기 전에 받지 않은 줄이 있는 각 member에게 turn을 한 번 더 준다.

## Turn end

Turn은 그 답이 도착해 token이 닫히면 끝난다. 방은 session의 program이 `idle`을 보고하기를 기다리지 않는다. Program state는 줄을 입력하기 전에만 읽는다. Permission prompt 같은 program의 질문은 줄을 자기 답으로 받으므로, 방은 `blocked` session에 줄을 입력하지 않는다. 방은 core.sessions의 값이 session이 blocked가 아님을 보여 줄 때까지 [conversation status](#conversation-status)의 step `turn`으로 기다리고, `conversation.stop`은 그 기다림을 끝낸다. `idle`이나 `working` session은 줄을 바로 받는다.

### Decision

- Program state는 turn의 믿을 만한 끝이 아니다. 답 뒤에도 program record가 `working`에 머문 Claude Code session이 relay를 10분 넘게 붙잡았다. 답은 member가 자기 turn을 끝내는 행위다.
- `working` session에 입력해도 안전하다. Claude Code는 작업 중에 입력된 메시지를 queue에 넣고, 실행 중인 tool call이 끝나는 대로 같은 turn 안에서 Claude에게 넘기거나 turn이 끝날 때 보낸다(Claude Code interactive mode, [queue messages while Claude works](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works)). 측정한 member session은 queue에 든 줄을 다음 입력으로 받았다. 방은 session의 다음 줄을 그 답 뒤에만 submit하므로, 두 경우 모두 member는 앞 turn에 답한 뒤 다음 turn 줄을 읽는다.
- 그 보고는 끝나지 않은 `working` 보고와 같은 출처이므로, 방은 답 없이 program이 `idle`을 보고한 turn을 더 이상 실패로 보지 않는다. 답이 없는 turn은 열린 채로 남는다. [conversation status](#conversation-status)는 그 member를 step `answer`로 보여 주고, `conversation.stop`이 그 turn을 끝낸다. core.sessions가 더 이상 나열하지 않는 session은 전처럼 turn을 실패시킨다.

## Conversation status

선언된 status `soksak-plugin-agents-clubhouse.conversation`은 page가 보여 주는 대화 `{entries: [{speaker, text}], waiting: [{member, session, step, program}], delivery: [{member, session, sent, delivered, length, unreceived}]}`를 담는다. `entries`는 [room record](#room-record)의 항목을 record 순서로 담으며, `speaker`는 `owner`, member의 식별자, 또는 방의 줄일 때 `clubhouse`다([대화](#conversation)). 방은 record가 바뀔 때마다, 실패한 send가 owner의 줄을 거둘 때도 새 값을 게시하므로, 호출자는 그려진 page가 아니라 status에서 대화를 읽는다.

`waiting`은 방이 turn을 기다리는 각 member를 기다림이 시작된 순서로 밝힌다. `step`은 session의 첫 `idle`을 기다리는 [room protocol](#room-protocol) turn의 시작부터 그 turn이 끝날 때까지 `protocol`이고, turn 줄이 `blocked` session을 기다리는 동안 `turn`이며([turn end](#turn-end)), turn 줄의 submit부터 그 [답](#answer)이 도착하거나 turn이 실패하거나 `conversation.stop`이 끝낼 때까지 `answer`다. View는 program이 `idle`인 step `answer`의 기다림을 `idle without answer`로 보여 주며, 이는 표시일 뿐이다. `program`은 `core.sessions` 현재 값에서 그 session의 program state다. `idle`, `working`, `blocked`이며, core가 아무 state도 보고하지 않는 동안은 `null`, `core.sessions`가 그 session을 더 이상 나열하지 않으면 `ended`다. 폴더에서 처음 시작할 때 Claude Code의 folder-trust prompt처럼 첫 `idle` 전에 자기 질문에서 멈춘 program은 그 member를 step `protocol`로 `waiting`에 남기고, 방은 그 질문과 답하기 button을 보여 준다([questions](#questions)). `questions`는 막힌 각 member의 질문을 나열한다([questions](#questions)). `delivery`는 방의 각 member, 곧 core.sessions가 session을 나열하고 [room protocol](#room-protocol)을 받은 체크된 member의 session, 이름, role을 roster 순서로 밝힌다. `sent`와 `delivered`는 그 수이고([work reports](#work-reports)), `length`는 record 길이, `unreceived`는 `sent`부터 끝까지에서 그 member가 하지 않은 record 줄의 수이며, 다음 turn 줄이 그것을 담는다([conversation first](#conversation-first)). 방은 기다림이 시작되거나 끝날 때, record나 delivered number가 바뀔 때, `core.sessions`의 각 값에서 timer 없이 새 값을 게시한다. Page는 대화 아래에 기다리는 member마다 page의 언어로 한 줄을 보여 준다. 영어는 `waiting for <name>: <step>, program <program>`, 한국어는 `<name> 기다리는 중: <step>, program <program>`이며, `<name>`은 roster 이름이다.

## Questions

program은 첫 시작 folder에서 Claude Code의 folder-trust prompt나 permission prompt 같은 자기 질문에서 멈출 수 있고, 그때 `core.sessions`에 `blocked`를 보고한다. 그런 질문은 모두 방에서 답할 수 있다. 기다리는 member의 program을 `blocked`로 보이는 `core.sessions` 값에서, 방은 그 session의 화면을 `core.session.read {session}`로 한 번 읽고, text가 있는 첫 행부터 마지막 행까지를 [conversation status](#conversation-status)의 `questions`에 `{member, session, rows, choices}`로 나열한다. page는 대화 아래에 각 질문을 보여 준다. 곧 `The program of <name> asks a question and waits for its answer:`, 한국어로 `<name>의 프로그램이 질문하고 답을 기다립니다:` 줄, 화면의 행, 그리고 element `soksak-plugin-agents-clubhouse.question`인 button `Answer in the <name> tab`, 한국어로 `<name> 탭에서 답하기`이다. button은 `member.show {member}`를 실행하고, 이는 `core.layout.select`로 그 member의 session을 보이는 tab을 active로 만들며, 사람은 program에서 답한다. 어떤 tab도 session을 보이지 않는 member는 `member <member>: no tab shows its session <session>`로 거부된다. 질문은 program을 다른 상태로 보이는 `core.sessions` 값에서, 또는 기다림이 끝날 때 `questions`에서 빠진다. core가 거부한 읽기는 error 경로로 `room question: member <member>: <text>`로 보고된다.

cursor 목록이 있는 질문은 그 선택지를 element `soksak-plugin-agents-clubhouse.question.choice`인 button으로도 보여 주고, 그 글자를 질문의 `choices`로 나열한다. cursor 목록이 없는 질문의 `choices`는 비어 있다. 선택지는 cursor 표시(Claude Code의 `❯`, Codex의 `›`, 또는 `>`) 뒤에 글자가 오는 행과, 그 주변에서 공백만 앞에 두고 같은 column에서 글자가 시작하는 행이다. button은 `question.answer {member, choice}`를 실행한다. 이 명령은 화면을 다시 읽고, 화면에 더는 없는 선택은 `member <member>: the question of session <session> no longer shows the choice <choice>`로 거부하며 그때는 아무것도 입력하지 않고, 아니면 `core.session.input`으로 cursor에서 선택까지의 아래 또는 위 화살표 key와 Enter를 입력한다. 질문이 없는 member는 `member <member> has no question`으로 거부된다.

### Decision

방은 program의 key로 질문에 답한다. member는 아무도 보지 않는 terminal에서 일하고, tab에서만 답할 수 있는 질문은 사람이 그곳에 갈 때까지 작업을 멈추기 때문이다. core는 session 화면이 바뀔 때 event를 게시하지 않으므로 방의 선택지는 화면보다 오래되었을 수 있다. 방은 선택하는 순간 화면을 읽고, 그 화면에서 선택을 판정하며, 그 cursor에서 key를 계산하므로 읽지 않은 화면에는 아무것도 입력하지 않고, timer로 읽지 않는다. cursor 목록이 없는 질문에는 session tab에서 답하는 길이 그대로 남는다.

## Conversation view

Room view는 각 record 항목을 말풍선으로 그린다. Owner의 말풍선은 오른쪽, member의 말풍선은 왼쪽에 놓이고, 화자의 이름과 role이 말풍선 위에 온다. 각 member는 roster 자리를 6으로 나눈 나머지에 해당하는 자기 말풍선 색을 가지므로, roster 순서가 같은 동안 색은 바뀌지 않는다. Owner 말풍선은 core theme의 accent token을 쓰고, member 색은 theme의 card token에 hue를 섞는다. 방의 줄(`clubhouse`)은 가운데 정렬된 system 줄이다. Member의 member의 claim이나 report([work reports](#work-reports))는 열린 turn에서 그 turn의 답보다 먼저 온다. 그 답이 올 때까지 기록의 자리에서 member 이름 아래의 짧은 note이고, 답이 오면 그 답 아래의 note다. release는 turn을 닫을 때 답 뒤에 오므로 member의 마지막 답 아래의 note다. 답의 section([section](#sections))은 말풍선 안에서 addressee를 머리로 단 별도 block이다. Owner의 줄 뒤 첫 답 앞과, 그 줄 이후 이미 답한 member의 답 앞에는 round 번호를 단 구분선이 오므로 [settling](#settling)의 각 round가 눈에 보이게 나뉜다.

## Follow mode

대화 view는 bottom에 있을 때만, 즉 마지막 항목이 4 point 안에서 모두 보일 때만 새 항목을 따라간다. 따라가는 동안 새 항목이 있는 각 draw는 마지막 항목으로 scroll한다. 사람이 위로 scroll하면 view는 reading mode다. Draw는 scroll 위치를 유지하고 새 항목은 그 아래에 쌓인다. Reading mode에서는 card 아래쪽의 pill이 사람이 위로 scroll한 뒤 아직 보이지 않은 viewport 아래 항목의 수를 `새 대화 3개 ↓`처럼 보여 준다. View의 IntersectionObserver가 모두 보이게 된 각 항목을 알리므로 그 항목이 scroll되어 보이면 수가 줄고, 방은 timer를 쓰지 않는다. Scroll로 bottom에 이르면 수가 0이 되고 pill이 사라지며 다시 따라간다. Pill은 선언된 element `pill`이며 선언된 command `conversation.scroll.bottom`을 실행한다. 이 command는 마지막 항목으로 scroll하고 다시 따라간다. 선언된 status `soksak-plugin-agents-clubhouse.view`는 `{following, unseen, stopEnabled}`를 가진다.

## Timing

각 record 항목은 방이 그것을 받은 시각 `at`을 epoch millisecond로 가지고, member의 답은 turn 줄의 submit이 받아들여진 때부터 답이 도착할 때까지의 millisecond인 `elapsedMs`를 가진다. 다른 항목의 `elapsedMs`는 null이다. Tab state와 [conversation status](#conversation-status)의 항목은 두 field를 모두 가지고, tab state의 reader는 두 field가 없는 항목을 `room tab state: conversation must be an array of {speaker, text, at, elapsedMs}`로 거부한다. 방이 시각을 기록하기 전에 받은 항목은 `at: null`, `elapsedMs: null`이며 view는 시각 없이 보여 준다. 답의 말풍선은 시간을 소수 한 자리의 초로, 예를 들어 `12.4초`로 보여 준다. 기다리는 member([conversation status](#conversation-status))는 방이 그 member를 기다리기 시작한 뒤의 시간을 보여 준다. View는 이 counter를 label이 바뀔 때만 쓴다. Label 단위가 지났음을 알리는 event가 없으므로 기다리는 member의 label 중 다음 변화까지 timer 하나가 돌고, 기다리는 member가 없어지거나 view가 끝나면 멈춘다.

## Answer

Member는 화면이 아니라 선언된 command `soksak-plugin-agents-clubhouse.answer {turn, text}`로 답을 전한다. Claude Code처럼 alternate screen에 그리는 program은 보이는 viewport의 행만 terminal에 쓰고, viewport를 벗어난 행은 쓰이지 않는다. 그래서 화면도 `core.session.read`가 읽는 retained row도 member tab보다 긴 답이나 viewport를 벗어난 submit된 줄을 담지 않으며, 방은 그것에서 답을 읽지 않는다.

- Turn 줄마다 방은 새 random token으로 turn을 열고 줄을 ` | [@clubhouse] turn <token>`으로 끝낸다. Session 하나에는 열린 turn이 많아야 하나다.
- 답 command는 trim한 뒤 비어 있지 않은 string `text`를 `turn`의 열린 turn에 대해 받고, 답은 `text` 그대로다. Command는 그 turn을 끝낸다. Token은 한 번만 받으며, 열린 turn이 없는 token(turn이 이미 끝난 token 포함)은 `turn <token> is not an open turn of this room`으로 거부된다. 잘못된 parameter는 `turn must be a non-empty string, got <value>` 또는 `text must be a non-empty string, got <value>`로 거부된다.
- Member의 turn은 답이 도착하면 끝난다. 방은 turn을 끝내려고 program state를 읽지 않는다([turn end](#turn-end)). 방은 program의 질문에 답하지 않으므로 turn 중에 `blocked`를 보고한 program은 사람을 기다리고, turn은 이어진다. 답 command에 permission을 묻는 program의 member는 사람에게서 그 permission을 받아야 한다.

실패한 turn은 `member <id>: <reason>`으로 실패한다([mode](#mode)).

### Decision

답은 turn의 token을 실어 호출하는 선언된 방 command로 온다. 그 이유와, adversarial review가 이 결정에 대해 제기한 objection은 다음과 같다.

- 화면과 retained row는 답을 담을 수 없다. 기록된 Claude Code의 출력은 보이는 viewport의 행만 담으므로, submit된 줄 뒤의 행에서 reply block을 얻던 이전 규칙은 tab보다 긴 모든 답에서 실패했다.
- Member의 identity. Core는 command의 handler에 caller를 주지 않고, `agent.surface`는 owned session의 모든 process에 owner surface를 답한다(core `docs/spec/persistent-services.md#owned-sessions`). 그래서 core의 어떤 identity도 한 방의 member를 구별하지 못하며, 그런 identity에는 terminal sidecar와 모든 host의 변경이 필요하다. Objection: `core.sessions`가 모든 session을 나열하고 `simul`에서는 모든 member에게 열린 turn이 있으므로 session parameter는 증명이 아니며, 한 member가 다른 member의 답을 낼 수 있다. Answer: token은 random이고 전달하는 줄마다 새로우며 그 member의 줄에만 쓰이므로, token을 가진 답은 그 줄을 받은 terminal에서 오고 방에는 core의 identity가 필요 없다.
- Objection: 두 번째 답이나 늦은 답이 같은 member의 다음 turn을 끝낼 수 있다. Answer: 각 token은 한 번만, 그 turn이 열려 있는 동안만 받는다.
- Objection: member가 답하기 전에 program이 `idle`을 보고할 수 있다. Answer: turn은 답으로만 끝나므로([turn end](#turn-end)) program state의 보고는 어떤 turn도 끝내지 않는다.
- Objection: 이전 protocol 줄을 받은 session은 답 command를 모른다. Answer: tab state는 현재 protocol의 session을 `protocolSessions`라 부르고 이전 field `taught`를 거부하므로, 그 session은 protocol 줄을 다시 받는다([restart](#restart)).
- Objection: 여러 줄의 긴 답은 shell에서 quote하기 어렵다. Answer: protocol 줄은 parameter가 JSON인 MCP tool `command_run`을 먼저 말하고, quote된 here-document를 쓰는 shell 형식을 준다.
- 기각한 대안: `sok message send`는 terminal의 folder에 메시지를 쓰며, 방은 terminal folder가 아니다.
- 기각한 대안: `sok conversation read`는 agent의 대화 파일을 읽지만 session이 아니라 working directory로 파일을 고르므로 한 folder의 member들을 구별하지 못하고, 답의 끝을 알리는 event가 없는 read다.

## Restart

Application의 restart, 방 tab의 unload, view의 restart 뒤에도 방은 입력 없이 이전과 같은 상태를 보여 준다. 방은 `surface.unload` `{format: 1, maxBytes: 1048576}`을 선언하고, 바뀔 때마다 view의 tab state(`tab.state.write`)로 tab의 상태를 쓴다. Core는 이를 tab마다 restart 너머로 보관한다(core `docs/spec/plugins.md#memory-saver`). 방은 turn 줄을 그 token이 든 tab state의 쓰기가 끝난 뒤에만 submit하므로, page의 reload가 다음 page가 복원할 수 없는 token을 member에게 남기지 않는다. 쓰기가 실패하면 turn은 그 이유로 실패한다. 상태는 `{roster, team, mode, conversation, sessions, protocolSessions, addressed, delivered, sent, turns}`다.

- `roster`: roster 순서의 entry `{id, member, checked, role, leader}`이며 `leader`가 `true`인 것은 많아야 하나다. `checked`나 `leader`가 `true`인 entry는 `member`가 `true`다. 시작할 때 definition이 주는 첫 roster는 이 순서, membership, check, role, leader를 지킨다. 여기에 없는 definition은 끝에 member가 아닌 채 붙고, definition이 없는 entry는 빠진다.
- `team`: summon 순서의 [team](#team) member `{id, definition, role, directory, merged, agentSession, resume, agent}`.
- `mode`: 대화 mode. 설정 `kibitzDefault`는 상태가 없는 방 tab의 mode만 정한다.
- `conversation`: 대화가 보여 주는 entry `{speaker, text}`. `speaker`는 `owner` 또는 member의 identifier이고 `text`는 메시지 또는 member의 [답](#answer)이므로, restart 뒤에도 대화는 같은 답을 보여 준다.
- `sessions`: 이 방이 연 member session.
- `protocolSessions`: 답 command가 든 [room protocol](#room-protocol)을 받은 session. 여기에 있는 session은 protocol 줄을 다시 받지 않는다.
- `addressed`: member session을 그 addressed list, 곧 `conversation` 길이보다 작고 증가하는 record index로 잇는 object([addressed views](#addressed-views)).
- `delivered`와 `sent`: member session을 그 addressed list 안의 delivered 위치와 sent 위치로 잇는 object. 0부터 list 길이까지의 정수이며 `delivered`는 `sent`를 넘지 않는다.
- `turns`: 열린 turn token `{turn, session, member, count}`. `member`는 그 member의 식별자, `count`는 줄을 만들 때의 record 길이로 0부터 `conversation` 길이까지의 정수다. Restart 뒤에도 방은 그 답을 받는다. 답은 session의 delivered number를 `count`로 올리고, restart로 relay가 끝난 turn의 답은 `member`의 답으로 record에 덧붙인다. Restart 전부터 남은 token의 기다림은 그 답이나 `conversation.stop`으로만 끝난다.

Reader는 이 형식만 받으며, 다른 값은 field와 찾은 것을 밝히는 `room tab state: <field> ...`로, 이전 `taught`처럼 이 형식 밖의 field는 `room tab state: unknown field <field>`로 거부한다. 상태가 없는 tab은 `null`을 읽는다. JSON이 `surface.unload`의 1048576 byte보다 큰 상태는 쓰지 않고 `error: room tab state: the state is <n> bytes, over the limit of 1048576 bytes`로 보고한다. 거부된 쓰기는 `error: room tab state: <reason>`으로 보고된다.

시작할 때 방은 `core.sessions`의 첫 값을 기다린 뒤 상태의 member를 summon한다. 방은 `core.sessions`가 이 방 surface를 `owner`로 나열하는 session에만 다시 붙는다. 저장된 session이 그중 하나인 member는 그 session을 유지하고, 그런 session이 없는 member만 session을 연다. Arrangement는 같은 tree를 apply하므로 core는 각 entry `{plugin, params: {session, title}}`을 이미 그 session을 보여 주는 member tab으로 resolve한다. `params.session`이 `core.sessions`가 더 이상 나열하지 않는 `sessions`의 session을 가리키는 plane의 tab은 session이 끝난 이 방의 member tab이다. 방은 apply 뒤 이를 `core.layout.close {tab}`으로 닫고, 그다음 `sessions`에 열린 session만 남긴다. 방은 다른 tab을 닫지 않는다.

상태가 없는 방 tab에는 저장된 roster가 없다. 방은 `core.sessions`의 첫 값을 기다린 뒤, 저장된 session(project data `room_member_sessions`의 문서 `<room surface>/<agentId>`)을 `core.sessions`가 이 방 surface를 `owner`로 나열하는 definition을 체크된 member로 만들고 summon하므로 자기 session에 다시 붙는다. 다른 definition은 member가 아니고, mode는 설정 `kibitzDefault`이며 대화는 비어 있다. 그 값을 담은 기록이 없기 때문이다. Member relation 문서는 식별자가 `<room surface>/<agentId>`인 `{surface, agentId, sessionId, cwd, savedAt}`이므로 한 project의 두 방은 relation을 따로 보관한다. Store는 다른 형식의 문서를 `room_member_sessions <id>: <field> ...`로 거부한다. Summon은 자기가 연 session을 `core.sessions`가 나열할 때까지 열린 것으로 세므로, `core.sessions`가 session을 나열하기 전에 실행된 summon은 두 번째 session을 열지 않는다. Store가 relation의 put을 거부한 session은 `core.session.end {session}`으로 끝내고, summon은 그 이유로 reject한다. 여는 session은 방 card의 측정한 크기(point)와 window의 backing scale을 받는다. 아직 배치되지 않은 card나 숨은 방은 0을 측정하므로, 방은 width와 height가 양수인 view의 첫 resize event를 기다린다. 그래서 core가 거부하는 크기로 `core.session.open`을 보내지 않는다. 다시 붙기는 크기를 측정하지 않는다.

메시지를 전달하는 동안 방은 `tab.keep {reason: "busy", on: true}`를 보고하므로, core는 turn을 기다리는 page를 unload하지 않는다.
