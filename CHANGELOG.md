# Changelog

## Unreleased

- C2, C6: The room runs on its view page (`ui/clubhouse.html`) with the commands, elements, status and project data of `plugin.json`. The ACP engine, its dependency and the commands that used it are removed, so the room has no member transport until C3 and C5.
- C7: The project data stores (`createPersonaStore`, `createMemberSessionStore`) reject with the error of the data API instead of returning an empty text or `null`. A failed define is retried by the next call. Their tests cover the failures (`src/room/persona.test.ts`, `src/room/session-store.test.ts`).
