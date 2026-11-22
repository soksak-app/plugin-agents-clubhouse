# Changelog

## Unreleased

- C2, C6: The room runs on its view page (`ui/clubhouse.html`) with the commands, elements, status and project data of `plugin.json`. The ACP engine, its dependency and the commands that used it are removed, so the room has no member transport until C3 and C5.
- C7: The project data stores (`createPersonaStore`, `createMemberSessionStore`) reject with the error of the data API instead of returning an empty text or `null`. A failed define is retried by the next call. Their tests cover the failures (`src/room/persona.test.ts`, `src/room/session-store.test.ts`).
- C5: The member message relay (`src/room/relay.ts`) sends a room message with the declared `terminal.submit` command and takes the end of the turn from the declared `terminal.program` status. It refuses a send while the member waits or is not running. The port to a member terminal and the answer read are not built yet (C5 stays open).
