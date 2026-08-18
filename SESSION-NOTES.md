# Session notes

What was built, what was measured, and what is still not true.

---

## Measured

Every number here came from a run, not an estimate. Timings are measured on the
backend, across the phases it reports.

### Latency

| | time | measured on |
| --- | --- | --- |
| Project scan | 3.6s | the real project, 16 endpoints |
| Generation | 6–7s | gemini-3.1-flash-lite |
| Apply → verdict | 3.7s, identical across 15 runs | demo project |
| Apply → verdict | ~5s | the real project |
| Reload (ReqFlow starting the server) | 4.4s | real project, nodemon |
| Wait for ready | 0.5s | |
| The endpoint call itself | 0.1s | |

A run's phases are reported individually, so "it was slow" can be answered with
*where*:

```
reload → wait for ready → find a record to act on → find a real commanderId → run the endpoint
```

### Model selection

60 generations. Same machine, same fixture, same three tasks, five runs each,
one pipeline for every candidate. Nothing was scored by reading the code — each
generation was applied to a fresh copy of a small Express project, the project
was booted, the endpoint was called, and the result read back.

| | gemini-3.1-flash-lite | Phi-4-mini 3.8B | Qwen2.5-Coder 1.5B | Qwen2.5-Coder 3B |
| --- | --- | --- | --- | --- |
| Generation, median | **3.0s** | 30.1s | 29.2s | 24.9s |
| Endpoint actually works | **15/15** | 0/15 | 0/15 | 0/15 |

Model selection was based on end-to-end product correctness and latency, not on
model size or theoretical capability.

**Not every Gemini model can be used.** `gemini-3.5-flash`, `3.6-flash`,
`3.7-flash` and `flash-lite-latest` all have quota, but the newer ones reject the
`function` role that tool calling depends on. Only `gemini-3.1-flash-lite` and
`gemini-3.5-flash` work.

### Tests

| | before | after |
| --- | --- | --- |
| Backend | 285 | **375** |
| Frontend | 110 | **134** |
| Desktop | 42 | **59** |

The desktop suite reported 42 for a long time. The missing seventeen were the
ones that bind a real port, and their guard asked whether the port could be bound
rather than whether anything was answering there — which a running ReqFlow
passes. They ran, found the live app, and failed as confusing assertions.

---

## Prompts to test with

Run these against the Real-Time-Incident-Response-System project with the base
URL set to `http://localhost:3001`.

### First, always

```
Log in as admin@demo.com with demo123 and save the token
```

Both routers have `router.use(authenticateHTTP)` at the top, so **every** route
in them needs a token. Without this, ReqFlow cannot list a collection to find a
record, and no `:id` endpoint can be verified. Check that VARIABLES shows 1.

### Endpoints that should go green

```
Add a PATCH /api/incidents/:id/commander that sets the incident commander to a
user id from the body. Validate that the user exists and return 400 with a clear
message if not, 404 if the incident does not exist, and the updated incident with
200 on success.
```
Exercises the most machinery: a real record found from your own data, a real user
id substituted into the body, two models touched, and a write.

```
Add a GET /api/incidents/:id/duration that returns how long an incident has been
open — createdAt, resolvedAt, and the elapsed minutes, using the current time when
it is not resolved yet. Return 404 if the incident does not exist, 200 otherwise.
```
Read-only, so no state can conflict. `createdAt`/`resolvedAt` are already on the
model.

```
Add a GET /api/users/:id/activity that returns the incident updates a user has
made, newest first, with the incident title included. Return 404 if the user does
not exist, and 200 with the list otherwise.
```
Lands in `users.js` + `userService.js` rather than the incidents files — shows the
endpoint being written against the right part of the project.

### To show a specific behaviour

**The route-shadowing warning:**
```
Add a GET /api/incidents/stats that returns counts of incidents grouped by status
and by severity.
```
`router.get('/:id')` is registered at line 60 and matches `/stats` first, so this
route would never be reached. The diff says so before you apply.

**The agent testing rather than writing:**
```
Test every incidents endpoint and tell me which ones are broken
```
It logs in, sends real requests, and opens a tab for each with its response.

**Server ownership:** stop your own server, then apply anything. ReqFlow starts
it (`ownership: started`). Apply again and it restarts the one it started. Start
your own and it leaves it alone, saying so.

### What not to ask for

Anything at a bare path under an existing `/:id` route — `/api/incidents/stats`,
`/unassigned`, `/search`. They work as a demonstration of the warning, but they
will not answer, because Express matches `/:id` first.

---

## What was fixed

### Generated code went into the wrong files

- The style exemplar was whichever router scored highest across the whole
  project — always `auth.js`. An incidents endpoint was written into it. The
  exemplar is now chosen by the endpoint's own resource.
- A dead 28-line `services/incidents.js`, which nothing imported, beat the real
  523-line `incidentService.js` because it was small enough to use as an
  exemplar. Files the project actually imports are now preferred, matched by
  resolved path rather than by name.
- Data models were never shown to the model, so it wrote `.populate('notes.author')`
  against a schema with no `notes` field. Schemas are now read — and explicitly
  never written to.

### Applied code did not run

- `dropDuplicateLines` treated any line starting with `const` as a duplicate
  import. A router already holding `const { userId } = req.body;` in one handler
  had that exact line cut out of a newly generated one, leaving `userId`
  undefined. It now only touches file-scope imports.
- The prompt asked for imports "as a comment if they belong elsewhere in the
  file". A commented-out require is not an import: the code parses, applies,
  boots, and answers 500.
- The model reported `"method": "POST"` beside code that wrote
  `router.patch(...)`. The method now comes from the registration.

### Verification reported the wrong thing

- An endpoint taking an `:id` could not be checked at all. A real record is now
  found from the running server, signing in when the collection needs it.
- The read-back used an invented ObjectId, 404'd, and turned a 200 into
  "not working". Only records this run has seen are ever sent.
- The request body carried an invented `commanderId`; the endpoint correctly
  answered 400 and was reported as broken. Body ids are looked up too.
- A 409 was treated as failure, when it is often the endpoint doing exactly what
  was asked.

### The desktop app forgot everything

The frontend was served on `listen(0)` — a different port, and therefore a
different origin, every launch. `localStorage` is keyed by origin, so every
launch started with an empty workspace: no tabs, no variables, no scanned
project, no saved token. It is now served from a fixed port.

### Smaller

- Twelve axios calls had no timeout, so a hung backend meant a UI waiting
  forever.
- A spent daily quota was reported as "busy right now, ask again" — advice that
  cannot work — and the retry loop spent three more requests on it.
- The undefined-identifier warning skipped capitalised names, which is how
  `User is not defined` reached a running server.
- Re-applying an endpoint declared it a second time; Express only runs the first
  match, so a real project had four copies of one route, three of them dead.

---

## Still not true

- **The desktop build is unsigned.** It runs here. Handed to someone else,
  macOS will block it until they right-click → Open.
- **A fresh workspace needs a login before any `:id` endpoint can be verified.**
  The app says so clearly, but the step still has to be taken.
- **The full flow has not been run five times through the UI.** The
  apply-to-verdict half is 15/15 across two batches; a live end-to-end UI run has
  been done once.
- **Seven separate bugs surfaced in this one flow today.** Each fix was real and
  tested. That is not the same as knowing there is not an eighth.
